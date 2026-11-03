package com.yuanbao.ddz;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 后台常驻服务：自己持有 WebSocket 连接，不再依赖 WebView 的 JS 定时器。
 *
 * 只要 App 进程没被系统杀掉：
 *   - 连接一直在线（原生线程 10s 应用层心跳 + 协议级 pong 应答）
 *   - 新消息立刻进通知栏 + 提示音 + 震动 + 桌面角标，无需等用户打开 App
 *   - 消息同时压入 backlog，回前台时由 Net.hydrate() 一次性补投给各业务模块
 *
 * 服务被 START_STICKY 拉起后，会从 SharedPreferences 恢复 url/token 自动重连，
 * 连「进程被回收后重启」也能接着收消息（消息本身在服务端 db 里另有落库兜底）。
 */
public class DDZPushService extends Service {

    public static final String ACTION_CONFIG = "ddz.CONFIG";
    public static final String ACTION_STOP = "ddz.STOP";
    public static final String CHANNEL_KEEP = "ddz_keep";
    public static final String CHANNEL_MSG = "ddz_msg";
    private static final int KEEP_ID = 99001;
    private static final String PREF = "ddz_push";

    private static volatile DDZPushService instance = null;

    /* 通知栏永远是斗地主营销广告，不泄露真实消息；与 shared/ads.js 同一套文案 */
    private static final String[][] ADS = new String[][]{
            {"🎁 每日福利已到账", "登录即领 8888 欢乐豆，连续签到再送稀有头像框"},
            {"🃏 好友邀请你开局", "「明牌抢地主」房间已开好，就等你上桌"},
            {"🏆 牌桌排行榜更新", "你在本周好友榜上升 3 位，点击查看完整榜单"},
            {"⚡ 限时双倍积分", "今日 20:00-22:00 对局积分翻倍，错过等明天"},
            {"💎 商城上新", "「翡翠牌背」限时 6 折，仅剩 12 件"},
            {"🕹 新模式上线", "「让牌玩法」已全量开放，抢地主更刺激"},
            {"📢 版本更新提醒", "新版本优化发牌动画，启动即可体验"},
            {"🃏 牌桌已开好", "「经典三人场」仅剩 1 个空位，先到先得"},
            {"🎯 每日任务刷新", "完成 3 局对战可领取「记牌器」道具"},
            {"🧧 红包雨即将开始", "整点开抢，最高可得 66 元话费券"}
    };

    private static final HashSet<String> NEWS = new HashSet<String>(Arrays.asList(
            "chat", "secret:msg", "secret:invited", "call:invite",
            "invite", "offline:digest", "presence"));

    /* 高频状态广播不进积压队列：回前台各模块会主动重拉，缓存它们只会让补投变卡 */
    private static final HashSet<String> SKIP_BACKLOG = new HashSet<String>(Arrays.asList(
            "lobby", "pong", "presence"));

    private long seq = 0;
    private synchronized long nextSeq() { return ++seq; }

    private PowerManager.WakeLock wakeLock = null;
    private ScheduledExecutorService sched = null;
    private final ArrayList<String> backlog = new ArrayList<String>();
    private final ArrayList<String> outbox = new ArrayList<String>();
    private DDZSocket sock = null;
    private String url = "";
    private String token = "";
    private boolean alertSound = true;
    private boolean alertVibe = true;
    private int badge = 0;
    private int retry = 0;
    private volatile String state = "closed";

    /* ---------------- 生命周期 ---------------- */

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createChannels();
        sched = Executors.newSingleThreadScheduledExecutor();
        SharedPreferences p = getSharedPreferences(PREF, MODE_PRIVATE);
        url = p.getString("url", "");
        token = p.getString("token", "");
        alertSound = p.getBoolean("sound", true);
        alertVibe = p.getBoolean("vibe", true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannels();
        try { startForeground(KEEP_ID, keepNotification(stateLabel())); } catch (Throwable e) {
            try { startForeground(KEEP_ID, new Notification.Builder(this).build()); } catch (Throwable ignored) { }
        }
        acquireWakeLock();

        String act = (intent == null) ? null : intent.getAction();
        if (ACTION_STOP.equals(act)) {
            stopAll();
            stopSelf();
            return START_NOT_STICKY;
        }
        /* 无论是 JS 配置变更，还是被系统 START_STICKY 重新拉起，都读一次偏好 */
        applyConfigFromPrefs();
        startSocket();
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        stopAll();
        instance = null;
        super.onDestroy();
    }

    private void stopAll() {
        retry = 0;
        try { if (sock != null) sock.close(); } catch (Throwable ignored) { }
        sock = null;
        state = "closed";
        try { if (sched != null) sched.shutdownNow(); } catch (Throwable ignored) { }
        sched = null;
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Throwable ignored) { }
        wakeLock = null;
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ddz:push");
                wakeLock.setReferenceCounted(false);
                if (!wakeLock.isHeld()) wakeLock.acquire();
            }
        } catch (Throwable ignored) { }
    }

    /* ---------------- 对外接口（由 MainActivity 的 JS 桥调用） ---------------- */

    /** 配置连接参数；url/token 没变就不重连，避免 enterApp 二次调用把连接掐断。 */
    public static void configure(Context c, String u, String tok, boolean sound, boolean vibe) {
        SharedPreferences.Editor e = prefs(c).edit();
        e.putString("url", u == null ? "" : u);
        e.putString("token", tok == null ? "" : tok);
        e.putBoolean("sound", sound);
        e.putBoolean("vibe", vibe);
        e.apply();
        try {
            Intent i = new Intent(c, DDZPushService.class);
            i.setAction(ACTION_CONFIG);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i);
            else c.startService(i);
        } catch (Throwable ignored) { }
        DDZPushService s = instance;
        if (s != null) s.applyConfigFromPrefs();
    }

    public static void setAlert(Context c, boolean sound, boolean vibe) {
        SharedPreferences.Editor e = prefs(c).edit();
        e.putBoolean("sound", sound).putBoolean("vibe", vibe).apply();
        DDZPushService s = instance;
        if (s != null) { s.alertSound = sound; s.alertVibe = vibe; }
    }

    public static void send(String json) {
        DDZPushService s = instance;
        if (s != null) s.socketSend(json);
    }

    public static String state() { DDZPushService s = instance; return s == null ? "stopped" : s.state; }

    /** 回前台：取走后台期间积压的消息，清空队列，避免重复渲染 / 重复通知。 */
    public static String drain() {
        DDZPushService s = instance;
        if (s == null) return "[]";
        synchronized (s.backlog) {
            JSONArray a = new JSONArray();
            for (String raw : s.backlog) {
                try { a.put(new JSONObject(raw)); } catch (Throwable e) { a.put(raw); }
            }
            s.backlog.clear();
            return a.toString();
        }
    }

    public static void clearBadge() {
        DDZPushService s = instance;
        if (s != null) s.badge = 0;
    }

    public static void stop(Context c) {
        try {
            Intent i = new Intent(c, DDZPushService.class);
            i.setAction(ACTION_STOP);
            c.startService(i);
        } catch (Throwable ignored) { }
    }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREF, MODE_PRIVATE); }

    /* ---------------- 连接管理 ---------------- */

    private void applyConfigFromPrefs() {
        SharedPreferences p = getSharedPreferences(PREF, MODE_PRIVATE);
        String nu = p.getString("url", "");
        String nt = p.getString("token", "");
        alertSound = p.getBoolean("sound", true);
        alertVibe = p.getBoolean("vibe", true);
        if (!nu.equals(url) || !nt.equals(token)) {
            url = nu;
            token = nt;
            try { if (sock != null) sock.close(); } catch (Throwable ignored) { }
            sock = null;
            state = "closed";
            retry = 0;
        }
    }

    private synchronized void startSocket() {
        if (sock != null) return;
        if (url.length() == 0 || token.length() == 0) {
            state = "waiting";
            updateKeep();
            return;
        }
        state = "connecting";
        updateKeep();
        final DDZSocket s = new DDZSocket();
        sock = s;
        s.connect(url, token, new DDZSocket.Listener() {
            @Override public void onOpen() {
                state = "open";
                retry = 0;
                updateKeep();
                try { s.send(s.authJson()); } catch (Throwable ignored) { }
                MainActivity.pushToJs("{\"t\":\"__native_open\"}");
                flushOutbox();
            }
            @Override public void onText(String text) { onWsText(text); }
            @Override public void onClose(String reason) {
                sock = null;
                if (state.equals("open") || state.equals("connecting")) state = "closed";
                updateKeep();
                scheduleReconnect();
            }
        });
    }

    private void scheduleReconnect() {
        if (sched == null || sched.isShutdown()) return;
        retry = Math.min(retry + 1, 6);
        final long delay = 800L * retry;   // 0.8s ~ 4.8s
        try {
            sched.schedule(new Runnable() {
                @Override public void run() {
                    DDZPushService s = instance;
                    if (s != null && s.state.equals("closed")) s.startSocket();
                }
            }, delay, TimeUnit.MILLISECONDS);
        } catch (Throwable ignored) { }
    }

    private void socketSend(String json) {
        if (json == null) return;
        DDZSocket s = sock;
        if (s != null && s.isOpen()) {
            try { s.send(json); return; } catch (Throwable ignored) { }
        }
        synchronized (outbox) {
            outbox.add(json);
            if (outbox.size() > 200) outbox.remove(0);
        }
        startSocket();
    }

    private void flushOutbox() {
        synchronized (outbox) {
            for (String j : outbox) {
                try { if (sock != null) sock.send(j); } catch (Throwable ignored) { }
            }
            outbox.clear();
        }
    }

    /* ---------------- 收到消息 ---------------- */

    private void onWsText(String raw) {
        if (raw == null || raw.length() == 0) return;
        String t = "";
        try { t = new JSONObject(raw).optString("t", ""); } catch (Throwable ignored) { }
        long s = nextSeq();
        boolean bg = !MainActivity.isForeground();

        /* 每条消息一律进积压队列（带递增序号）：
           前台时再实时注入 WebView 一份，注入失败或页面还没加载完也不丢；
           JS 侧按 _seq 去重，两路同时到达不会渲染两遍。 */
        if (!SKIP_BACKLOG.contains(t)) {
            synchronized (backlog) {
                backlog.add(markSeq(raw, s, bg));
                if (backlog.size() > 500) backlog.remove(0);
            }
        }
        if (!bg) {
            MainActivity.pushToJs(markSeq(raw, s, false));
        } else if (NEWS.contains(t)) {
            /* 后台：立刻进通知栏 + 响铃 + 震动 + 角标，不用等用户打开 App */
            postAd(raw);
        }
    }

    /** 序号用于 JS 去重；_bg 标记后台已弹过通知，回前台补投时不再重复弹。 */
    private static String markSeq(String raw, long s, boolean bg) {
        try {
            JSONObject o = new JSONObject(raw);
            o.put("_seq", s);
            if (bg) o.put("_bg", 1);
            return o.toString();
        } catch (Throwable e) { return raw; }
    }

    private void postAd(String raw) {
        int idx = Math.abs(raw.hashCode()) % ADS.length;
        badge++;
        postNotification(this, ADS[idx][0], ADS[idx][1],
                20000 + (int) (System.currentTimeMillis() % 30000), badge, true);
        playAlert(this, alertSound, alertVibe);
        try { BadgeUtil.setBadge(this, badge); } catch (Throwable ignored) { }
    }

    private String stateLabel() {
        if (state.equals("open")) return "在线 · 正在接收消息";
        if (state.equals("connecting")) return "正在连接…";
        if (state.equals("waiting")) return "等待账号配置";
        return "连接断开 · 正在重连";
    }

    private void updateKeep() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(KEEP_ID, keepNotification(stateLabel()));
        } catch (Throwable ignored) { }
    }

    /* ---------------- 通知 ---------------- */

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel keep = new NotificationChannel(CHANNEL_KEEP, "后台运行",
                    NotificationManager.IMPORTANCE_MIN);
            keep.setShowBadge(false);
            keep.setDescription("保持连接以便及时收到消息，可关闭本项提示，不影响收消息");
            nm.createNotificationChannel(keep);
            NotificationChannel msg = new NotificationChannel(CHANNEL_MSG, "新消息",
                    NotificationManager.IMPORTANCE_HIGH);
            msg.setShowBadge(true);
            msg.enableVibration(false);
            msg.setSound(null, null);
            nm.createNotificationChannel(msg);
        } catch (Throwable ignored) { }
    }

    private Notification keepNotification(String status) {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = null;
        if (open != null) {
            int f = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
            pi = PendingIntent.getActivity(this, 0, open, f);
        }
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b = new Notification.Builder(this, CHANNEL_KEEP);
        else b = new Notification.Builder(this);
        return b.setContentTitle("PP斗地主 · 后台在线")
                .setContentText(status)
                .setSmallIcon(iconRes(this))
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(Notification.PRIORITY_MIN)
                .build();
    }

    static int iconRes(Context ctx) {
        try { int id = ctx.getApplicationInfo().icon; if (id != 0) return id; } catch (Throwable ignored) { }
        return android.R.drawable.stat_notify_chat;
    }

    /** JS 层主动弹通知时仍走这里（前台/浏览器兼容），声音震动开关独立控制。 */
    public static void postNotification(Context ctx, String title, String body, int id, int b, boolean silent) {
        postNotification(ctx, title, body, id, b);
    }

    public static void postNotification(Context ctx, String title, String body, int id, int b) {
        if (ctx == null) return;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    NotificationChannel c = new NotificationChannel(CHANNEL_MSG, "新消息",
                            NotificationManager.IMPORTANCE_HIGH);
                    c.setShowBadge(true);
                    c.setSound(null, null);
                    c.enableVibration(false);
                    nm.createNotificationChannel(c);
                } catch (Throwable ignored) { }
            }
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            PendingIntent pi = null;
            if (open != null) {
                int f = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
                pi = PendingIntent.getActivity(ctx, 0, open, f);
            }
            Notification.Builder bld;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) bld = new Notification.Builder(ctx, CHANNEL_MSG);
            else bld = new Notification.Builder(ctx);
            bld.setContentTitle(title == null ? "PP斗地主" : title)
                    .setContentText(body == null ? "" : body)
                    .setSmallIcon(iconRes(ctx))
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .setPriority(Notification.PRIORITY_HIGH)
                    .setNumber(Math.max(1, b));
            nm.notify(id <= 0 ? 20001 : id, bld.build());
        } catch (Throwable ignored) { }
    }

    public static void postNotificationEx(Context ctx, String title, String body, int id,
                                          int b, boolean sound, boolean vibe) {
        postNotification(ctx, title, body, id, b);
        playAlert(ctx, sound, vibe);
    }

    private static void playAlert(Context ctx, boolean sound, boolean vibe) {
        if (ctx == null || (!sound && !vibe)) return;
        try {
            if (sound) {
                android.media.Ringtone r = android.media.RingtoneManager.getRingtone(ctx,
                        android.media.RingtoneManager.getDefaultUri(
                                android.media.RingtoneManager.TYPE_NOTIFICATION));
                if (r != null) r.play();
            }
            if (vibe) {
                android.os.Vibrator v = (android.os.Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
                if (v != null) {
                    long[] pat = new long[]{0, 180, 90, 180};
                    if (Build.VERSION.SDK_INT >= 26) v.vibrate(android.os.VibrationEffect.createWaveform(pat, -1));
                    else v.vibrate(pat, -1);
                }
            }
        } catch (Throwable ignored) { }
    }
}
