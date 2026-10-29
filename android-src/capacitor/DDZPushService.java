package com.yuanbao.ddz;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * 后台保活服务（方案 A）。
 *
 * 作用：把 App 进程提升为「前台」优先级，让系统不会在锁屏 / 退到后台时
 * 杀掉 WebView 里的 WebSocket —— 这样服务端推来的消息（聊天、邀请、
 * 对战事件）在 App 没显示时依然能到达，再由 JS 调 DDZNative.notify 弹出系统通知。
 *
 * 说明：
 *  - Android 8+ 前台服务必须挂一条常驻通知，这里用的是「低重要性」渠道，
 *    不会发声、不弹heads-up，用户可在系统设置里把该渠道彻底关掉（关了也照常保活）。
 *  - 进程被用户手动划掉、或系统内存极端紧张时仍会被回收，这是 Android 机制决定的。
 */
public class DDZPushService extends Service {

    public static final String CHANNEL_KEEP = "ddz_keep";   // 保活渠道（低优先级，可静默）
    public static final String CHANNEL_MSG = "ddz_msg";     // 消息渠道
    private static final int KEEP_ID = 99001;

    private PowerManager.WakeLock wakeLock = null;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannels();
        try {
            startForeground(KEEP_ID, keepNotification());
        } catch (Throwable e) {
            try { startForeground(KEEP_ID, new Notification.Builder(this).build()); } catch (Throwable ignored) { }
        }
        // 持一个轻量 WakeLock：锁屏时 CPU 不休眠，WebSocket 心跳才不会被掐断
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ddz:push");
                wakeLock.setReferenceCounted(false);
                if (!wakeLock.isHeld()) wakeLock.acquire();
            }
        } catch (Throwable ignored) { }
        return START_STICKY;   // 被杀后尽量重启
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) { }
        wakeLock = null;
        super.onDestroy();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            // 保活渠道：IMPORTANCE_MIN → 不发声、不震动、不弹窗，用户可关闭显示
            NotificationChannel keep = new NotificationChannel(CHANNEL_KEEP, "后台运行",
                    NotificationManager.IMPORTANCE_MIN);
            keep.setShowBadge(false);
            keep.setDescription("保持连接以便及时收到消息，可在设置里关闭本项提示");
            nm.createNotificationChannel(keep);

            // 消息渠道：正常提示
            NotificationChannel msg = new NotificationChannel(CHANNEL_MSG, "新消息",
                    NotificationManager.IMPORTANCE_HIGH);
            msg.setShowBadge(true);
            msg.enableVibration(true);
            nm.createNotificationChannel(msg);
        } catch (Throwable ignored) { }
    }

    private Notification keepNotification() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = null;
        if (open != null) {
            int f = PendingIntent.FLAG_UPDATE_CURRENT;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
            pi = PendingIntent.getActivity(this, 0, open, f);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(this, CHANNEL_KEEP)
                    .setContentTitle("PP斗地主正在后台运行")
                    .setContentText("保持连接，以便及时收到消息")
                    .setSmallIcon(iconRes(this))
                    .setContentIntent(pi)
                    .setOngoing(true)
                    .setPriority(Notification.PRIORITY_MIN)
                    .build();
        }
        return new Notification.Builder(this)
                .setContentTitle("PP斗地主正在后台运行")
                .setContentText("保持连接，以便及时收到消息")
                .setSmallIcon(iconRes(this))
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(Notification.PRIORITY_MIN)
                .build();
    }

    /* 运行时取 App 图标，不引用 R 里可能不存在的资源，避免编译失败 */
    static int iconRes(Context ctx) {
        try {
            int id = ctx.getApplicationInfo().icon;
            if (id != 0) return id;
        } catch (Throwable ignored) { }
        return android.R.drawable.stat_notify_chat;
    }

    /* ---------- 由 JS 调用：发一条系统通知 ---------- */
    public static void postNotification(Context ctx, String title, String body, int id, int badge) {
        if (ctx == null) return;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    NotificationChannel c = new NotificationChannel(CHANNEL_MSG, "新消息",
                            NotificationManager.IMPORTANCE_HIGH);
                    c.setShowBadge(true);
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
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                b = new Notification.Builder(ctx, CHANNEL_MSG);
            } else {
                b = new Notification.Builder(ctx);
            }
            b.setContentTitle(title == null ? "PP斗地主" : title)
                    .setContentText(body == null ? "" : body)
                    .setSmallIcon(iconRes(ctx))
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .setPriority(Notification.PRIORITY_HIGH)
                    .setDefaults(Notification.DEFAULT_ALL)
                    .setNumber(Math.max(1, badge));      // 部分 launcher（小米等）据此显示角标
            nm.notify(id <= 0 ? 20001 : id, b.build());
        } catch (Throwable ignored) { }
    }
}
