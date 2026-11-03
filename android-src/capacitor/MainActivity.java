package com.yuanbao.ddz;

import android.Manifest;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
import android.os.Build;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.speech.tts.TextToSpeech;
import java.util.Locale;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;

/**
 * Capacitor 版 MainActivity。
 *
 * 说明：Capacitor 默认用 https://localhost 承载页面 → 属于「安全上下文」，
 * 所以网页端的录音（MediaRecorder）和 WebRTC 摄像头本身就能用，
 * 这里只需要补两件事：
 *   1) onPermissionRequest 放行麦克风 / 摄像头（否则网页永远拿不到权限）
 *   2) DDZNative 桥接：横竖屏切换 + 原生录音兜底
 *
 * 注意：不能整个替换掉 Capacitor 自带的 WebChromeClient（会破坏文件选择等插件能力），
 * 这里用「委托」的方式：只接管 onPermissionRequest，其余全部转发给原来的 Client。
 */
public class MainActivity extends BridgeActivity {

    /* v39：前台服务要把后台收到的消息实时注入 WebView；
       退到后台后注入停止，消息改由服务缓存 + 直接弹通知。 */
    private static volatile MainActivity sInstance = null;
    private static volatile boolean sForeground = false;

    /* ---- 原生语音合成（TextToSpeech）----
       WebView 的 window.speechSynthesis 在很多国产 ROM / WebView 上不可用或没有中文语音，
       表现是「只响音效、不说话」。Android 自带的 TextToSpeech 走系统 TTS 引擎，
       覆盖率远高于 WebView，所以优先用它；它不可用才回落到 Web 语音。 */
    private TextToSpeech tts = null;
    private volatile boolean ttsOk = false;
    private String ttsErr = "";

    /* 运行时强制精确位置：对话框不可取消，只有「去开启」和「退出应用」。
       这已经是在安卓权限模型下能做到的最强限制 —— 系统不允许安装时强制授权。 */
    private boolean locationGateShowing = false;
    private void enforceFineLocation() {
        try {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED) return;
            if (locationGateShowing) return;
            locationGateShowing = true;
            new AlertDialog.Builder(this)
                .setTitle("需要精确位置权限")
                .setMessage("本应用必须获取「精确位置」才能使用。\n\n"
                    + "请在系统设置里把位置权限设为「仅在使用中允许」并打开「使用精确位置」。\n\n"
                    + "关闭该权限后，应用将无法继续运行。")
                .setCancelable(false)
                .setPositiveButton("去开启", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        locationGateShowing = false;
                        try {
                            Intent it = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.parse("package:" + getPackageName()));
                            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(it);
                        } catch (Exception ignored) { }
                    }
                })
                .setNegativeButton("退出应用", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { finish(); }
                })
                .show();
        } catch (Exception ignored) { }
    }

    private void initTts() {
        try {
            tts = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    if (status != TextToSpeech.SUCCESS) { ttsErr = "init_failed"; return; }
                    try {
                        int r = tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
                        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                            boolean ok = false;
                            try {
                                java.util.Set<Locale> ls = tts.getAvailableLanguages();
                                if (ls != null) {
                                    for (Locale l : ls) {
                                        if (l != null && "zh".equals(l.getLanguage())) { tts.setLanguage(l); ok = true; break; }
                                    }
                                }
                            } catch (Exception ignored) { }
                            if (!ok) { ttsErr = "no_zh_voice"; return; }
                        }
                        tts.setSpeechRate(0.92f);
                        ttsOk = true;
                    } catch (Exception e) { ttsErr = "err"; }
                }
            });
        } catch (Exception e) { ttsErr = "no_tts"; }
    }

    /* 是否正在用系统文件选择器（选图/视频/文件）。
       此时 Activity 会短暂 onPause，不能当成「切后台」把好友空间收起。 */
    private volatile boolean pickingFile = false;

    private MediaRecorder recorder = null;
    private String recPath = null;
    private long recStart = 0;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static final int REQ_PERM = 1002;

    /* 在这些目录写 .nomedia，阻止系统媒体库扫描（相册/文件管理/管家类 App）
       注意：这是自定义私有方法，父类没有同名方法，不能加 @Override
       —— 加了会报「method does not override or implement a method from a supertype」。 */
    private void hideCacheFromGallery() {
        File[] roots = new File[]{
                getFilesDir(),
                getCacheDir(),
                getExternalFilesDir(null),
                getExternalCacheDir(),
                new File(getFilesDir(), "webview"),
                new File(getCacheDir(), "webview"),
                new File(getFilesDir(), "ddz_cache")
        };
        for (File dir : roots) {
            if (dir == null) continue;
            try {
                if (!dir.exists() && !dir.mkdirs()) continue;
                File nm = new File(dir, ".nomedia");
                if (!nm.exists()) {
                    FileOutputStream fo = new FileOutputStream(nm, false);
                    fo.close();
                }
                // 子目录也补一层，避免 WebView 自己新建的目录漏掉
                File[] subs = dir.listFiles();
                if (subs != null) {
                    for (File sub : subs) {
                        if (sub != null && sub.isDirectory()) {
                            File sn = new File(sub, ".nomedia");
                            if (!sn.exists()) {
                                FileOutputStream fo2 = new FileOutputStream(sn, false);
                                fo2.close();
                            }
                        }
                    }
                }
            } catch (Exception ignored) { }
        }
    }

    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        sInstance = this;
        /* v37：强制「精确位置」权限。安卓无法在安装时强制授权，
           但可以在运行时要求：没授予就弹不可取消的引导页，不授权就用不了；
           后来在系统设置里关掉权限，再切回来同样会被拦住。 */
        enforceFineLocation();
        // 默认竖屏；进入牌桌时由 JS 调 DDZNative.setOrientation('landscape') 切横屏
        try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT); } catch (Exception ignored) { }

        /* 让 App 内部产生的所有缓存（表情动图/图片/视频/文件/录音临时文件）
           不被「文件管理 / 系统管家 / 相册」扫描到。
           做法：在 App 私有目录及其子目录里放 .nomedia —— 媒体扫描器见到
           该文件会跳过整个目录。App 私有目录（/data/data/包名/...）本身
           第三方文件管理器也读不到，双保险。
           注意：用户主动「保存到手机」的文件走公共目录，那个应该能被看到。 */
        hideCacheFromGallery();
        initTts();

        applyWebViewSettings();
        WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
        if (wv != null) {
            wv.addJavascriptInterface(new DDZBridge(), "DDZNative");
            final WebChromeClient orig = wv.getWebChromeClient();
            wv.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                    requestPermissions(new String[]{
                                            Manifest.permission.RECORD_AUDIO,
                                            Manifest.permission.CAMERA,
                                            Manifest.permission.ACCESS_FINE_LOCATION,
                                            Manifest.permission.ACCESS_COARSE_LOCATION
                                    }, REQ_PERM);
                                }
                                request.grant(request.getResources());
                            } catch (Exception e) {
                                try { request.deny(); } catch (Exception ignored) { }
                            }
                        }
                    });
                }

                /* ---- 其余能力全部转发给 Capacitor 自己的 Client ---- */
                @Override
                public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                    return orig != null && orig.onShowFileChooser(v, cb, params);
                }

                @Override
                public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                    if (orig != null) orig.onGeolocationPermissionsShowPrompt(origin, callback);
                    else callback.invoke(origin, true, false);
                }

                @Override
                public void onProgressChanged(WebView v, int newProgress) {
                    if (orig != null) orig.onProgressChanged(v, newProgress);
                }

                @Override
                public boolean onConsoleMessage(ConsoleMessage m) {
                    return orig != null && orig.onConsoleMessage(m);
                }
            });
        }

        /* 首次进入即一次性申请所需权限（含定位），避免后面用到才弹窗 */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(new String[]{
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.CAMERA,
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
            }, REQ_PERM);
        }
    }

    /**
     * 关键：页面跑在 https://localhost（安全上下文），App 却要请求 http://服务器:8080，
     * 属于「混合内容」，WebView 默认拦截 → 表现就是「连接服务器失败」。这里强制放行。
     *
     * 注意：Bridge 的 WebView 在部分 Capacitor 版本里 onCreate 时还没建好（getWebView() 返回 null），
     * 所以这里在 onCreate 和 onStart 各调一次，确保一定生效。
     */
    private void applyWebViewSettings() {
        try {
            WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
            if (wv == null) return;
            wv.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            wv.getSettings().setMediaPlaybackRequiresUserGesture(false);
        } catch (Exception ignored) { }
    }

    /* ---------------- 后台静音（可靠版） ----------------
     * 我们为了让 App 退到后台还能收消息，起了一个前台服务保活。
     * 副作用是 WebView 不会暂停，JS 里的 AudioContext 继续出声 ——
     * 表现就是「切到后台还在响」。
     * 这里在原生 onPause/onResume 里直接通知 JS 静音/恢复，
     * 比依赖 WebView 的 visibilitychange 可靠得多。 */
    /* 注意：Capacitor 的 BridgeActivity 把 onPause/onResume 声明成 public，
       这里的重写必须同样用 public —— 写成 protected 会因为「降低访问权限」直接编译失败。 */
    @Override
    public void onStop() {
        collapseSecretNow();
        super.onStop();
    }
    /* 锁屏/切后台时同步把好友空间收掉：
       系统在 onPause 之后就会取 Activity 快照，晚一步快照里就有私密内容，
       解锁时看到的就是「从好友空间退到主界面」的过程。 */
    private void collapseSecretNow() {
        /* 正在用系统文件选择器 → 不收起。
           否则选完图回来好友空间已被关掉、curRid 丢失，
           点发送就报「会话已失效，请重新进入」。 */
        if (pickingFile) return;
        try {
            android.webkit.WebView wv2 = this.bridge != null ? this.bridge.getWebView() : null;
            if (wv2 != null) {
                /* 关键：evaluateJavascript 是异步的，靠它「赶在截图前执行」根本不靠谱 ——
                   这就是为什么锁屏后解锁还能看到「好友空间 → 主界面」的收起过程。
                   这里改用 loadUrl("javascript:")（UI 线程同步排队执行），
                   再加一道硬保险：直接把 WebView 隐藏掉，
                   系统快照里就不可能有任何私密内容。 */
                wv2.loadUrl("javascript:(function(){try{window.__ddzSecretPanic&&window.__ddzSecretPanic();}catch(e){}})();");
                wv2.setVisibility(android.view.View.GONE);
                wv2.post(new Runnable() {
                    public void run() {
                        try {
                            wv2.loadUrl("javascript:(function(){try{window.__ddzSecretPanic&&window.__ddzSecretPanic();}catch(e){}})();");
                        } catch (Exception ignored) { }
                    }
                });
            }
        } catch (Exception ignored) { }
    }
    /* 回到前台：确认已收起后再把 WebView 显示出来，
       这样解锁看到的第一帧就是主界面，不会闪过收起动画。 */
    private void revealAfterCollapse() {
        try {
            android.webkit.WebView wv = this.bridge != null ? this.bridge.getWebView() : null;
            if (wv == null) return;
            if (!pickingFile) {
                wv.loadUrl("javascript:(function(){try{window.__ddzSecretPanic&&window.__ddzSecretPanic();}catch(e){}})();");
            }
            wv.setVisibility(android.view.View.VISIBLE);
        } catch (Exception ignored) { }
    }

    public void onPause() {
        sForeground = false;
        collapseSecretNow();
        // 关键：先同步收起好友空间，再走 super.onPause()。
        // 锁屏时系统会在 onPause 之后立刻取 Activity 快照，
        // 若等 WebView 的 pause 事件才处理，快照里还留着好友空间，
        // 解锁后就会看到「好友空间 → 主界面」这段收起过程。
        super.onPause();
        evalJs("(window.__ddzPause&&window.__ddzPause())");
        /* 关键：这里以前调 wv.onPause()，会把 WebView 的 JS 定时器全部冻结，
           Net 的心跳发不出去 → 服务端 25s 内 ping 不到 pong → 判定离线 → 后台收不到消息。
           现在只静音（__ddzPause），不冻结 WebView；前台服务 + WakeLock 继续保活，
           WebSocket 在锁屏 / 切后台时仍然在线。 */
    }

    @Override
    public void onResume() {
        sForeground = true;
        enforceFineLocation();
        /* 回到前台无条件再收一次：只要私密界面还开着就立刻干掉，
           不依赖「上次是否成功退出」的标记 —— 锁屏时 WebView 可能已被冻结，标记设不上。 */
        collapseSecretNow();
        super.onResume();
        try {
            android.webkit.WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
            if (wv != null) wv.onResume();
        } catch (Throwable ignored) { }
        revealAfterCollapse();
        evalJs("(window.__ddzResume&&window.__ddzResume())");
    }

    /* 兼容不同 Capacitor 版本：有的暴露 getBridge().getWebView()，
       有的需要自己 findViewById；取不到就静默跳过（不影响编译和运行） */
    private void evalJs(final String js) {
        try {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        android.webkit.WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
                        if (wv == null) return;
                        wv.evaluateJavascript(js, null);
                    } catch (Throwable ignored) { }
                }
            });
        } catch (Throwable ignored) { }
    }

    @Override
    public void onStart() {
        super.onStart();
        applyWebViewSettings();
        // 回到前台：清掉桌面角标（服务里的计数也要归零，否则下次后台会接着旧数字累加）
        sForeground = true;
        try { BadgeUtil.setBadge(this, 0); } catch (Throwable ignored) { }
        try { DDZPushService.clearBadge(); } catch (Throwable ignored) { }
        // 首次打开：一次性申请定位 / 录音 / 相机 / 通知权限
        ensurePerms();
        // 启动后台保活服务（前台服务，保证退到后台时 WebSocket 不被掐断）
        ensurePush();
    }

    /* 首次进入后启动保活服务；App 被杀由系统回收，这是 Android 机制 */
    private boolean pushStarted = false;

    /* 首次打开 App 时一次性把需要的权限全要齐。
       注意：定位权限不会由 WebView 主动发起（它不在 onPermissionRequest 的
       resources 里），必须原生侧主动申请，否则用户永远看不到定位授权弹窗。 */
    private boolean permsAsked = false;
    private void ensurePerms() {
        try {
            if (permsAsked) return;
            permsAsked = true;
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
            java.util.ArrayList<String> need = new java.util.ArrayList<String>();
            String[] want = {
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.CAMERA
            };
            for (String w : want) {
                if (checkSelfPermission(w) != android.content.pm.PackageManager.PERMISSION_GRANTED) need.add(w);
            }
            if (Build.VERSION.SDK_INT >= 33) {   // 33 = Android 13
                if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    need.add(android.Manifest.permission.POST_NOTIFICATIONS);
                }
            }
            if (!need.isEmpty()) {
                requestPermissions(need.toArray(new String[0]), REQ_PERM);
            }
        } catch (Throwable ignored) { }
    }

    private void ensurePush() {
        try {
            if (pushStarted) return;
            pushStarted = true;
            Intent i = new Intent(this, DDZPushService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i);
            else startService(i);
        } catch (Throwable ignored) { }
    }

    /* ---------------- 前台服务 → WebView 的消息通道 ---------------- */

    public static boolean isForeground() { return sForeground; }

    /** 服务在前台时把服务端推来的原始 JSON 实时交给 Net 派发；
        返回 false 表示应转入后台积压队列（Activity 不在或被隐藏）。 */
    public static boolean pushToJs(String raw) {
        final MainActivity a = sInstance;
        if (a == null || !sForeground || raw == null) return false;
        final String js;
        try {
            js = "(function(){try{if(window.Net&&Net.onNativeMessage)Net.onNativeMessage("
                    + org.json.JSONObject.quote(raw) + ");}catch(e){}})();";
        } catch (Throwable e) { return false; }
        try {
            a.runOnUiThread(new Runnable() {
                @Override public void run() { a.evalJs(js); }
            });
            return true;
        } catch (Throwable e) { return false; }
    }

    public class DDZBridge {
        @JavascriptInterface
        public void setOrientation(final String o) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if ("landscape".equals(o)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                        /* 竖屏用「不带 SENSOR」的 PORTRAIT：硬锁竖屏，不跟随传感器。
                           之前用 SENSOR_PORTRAIT，用户点「竖屏」后手机稍微一斜/传感器一变
                           就被系统拉回横屏，表现为「点了竖屏又自动切回横屏」。 */
                        else setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
                    } catch (Exception ignored) { }
                }
            });
        }

        /* 横屏打牌时隐藏系统状态栏（沉浸全屏），竖屏时恢复显示。
           JS 侧在 Orient.landscape()/portrait() 里调用。 */
        @JavascriptInterface
        public void setImmersive(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        android.view.Window w = getWindow();
                        android.view.View dec = w.getDecorView();
                        if (android.os.Build.VERSION.SDK_INT >= 19) {
                            int flags = android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                    | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                    | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                    | android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                                    | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
                            if (on) {
                                dec.setSystemUiVisibility(flags);
                            } else {
                                dec.setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                        | android.view.View.SYSTEM_UI_FLAG_VISIBLE);
                            }
                        }
                    } catch (Throwable ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void minimizeApp() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { try { moveTaskToBack(true); } catch (Exception ignored) { } }
            });
        }

        @JavascriptInterface
        public String hasNative() { return "1"; }

        /* ---------- 原生震动 ----------
           WebView 的 navigator.vibrate 在不少 ROM 上被禁（需要用户手势 + 权限），
           表现就是「开了出牌震动但打牌时完全不震」。这里走系统 Vibrator，可靠得多。 */
        @JavascriptInterface
        public void vibrate(final int ms) {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(android.content.Context.VIBRATOR_SERVICE);
                if (v == null) return;
                if (android.os.Build.VERSION.SDK_INT >= 26) {
                    v.vibrate(android.os.VibrationEffect.createOneShot(Math.max(1, ms),
                            android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(Math.max(1, ms));
                }
            } catch (Exception ignored) { }
        }

        /* ---------- 系统文件选择器标记 ----------
           选图片/选视频/选文件会拉起系统选择器，我们的 Activity 会走一次
           onPause → onResume。如果这时按「切后台」处理，好友空间会被收起、
           curRid 丢失，随后点发送就报「会话已失效」。
           所以 JS 在拉起选择器前置 1，选完置 0；原生据此跳过收起动作。 */
        @JavascriptInterface
        public void setPicking(final boolean on) {
            pickingFile = on;
        }

        /* ---------- 后台保活：前台服务自带 WebSocket ---------- */

        @JavascriptInterface
        public void startPush() { ensurePush(); }

        @JavascriptInterface
        public void stopPush() { DDZPushService.stop(MainActivity.this); }

        /* ---------- v39：原生托管的 WebSocket 通道 ----------
           WebView 退到后台后 JS 定时器会被冻结，net.js 的心跳发不出去，
           服务端 25s 判离线。这里让前台服务自己持有连接，JS 只负责收发内容。 */

        /** 用本地 token 建立/更新后台连接；url/token 不变时不会重连。 */
        @JavascriptInterface
        public void wsStart(final String url, final String token, final int sound, final int vibe) {
            try {
                DDZPushService.configure(MainActivity.this, url, token, sound != 0, vibe != 0);
            } catch (Throwable ignored) { }
        }

        /** 业务消息统一经原生连接发出；服务未连上时由服务侧 outbox 暂存补发。 */
        @JavascriptInterface
        public void wsSend(final String json) {
            try { DDZPushService.send(json); } catch (Throwable ignored) { }
        }

        /** 回前台取走后台积压的消息（JSON 数组字符串），取完即清空。 */
        @JavascriptInterface
        public String wsDrain() {
            try { return DDZPushService.drain(); } catch (Throwable e) { return "[]"; }
        }

        /** 「新消息提示音 / 震动」开关变化同步给服务，后台提醒也跟着生效。 */
        @JavascriptInterface
        public void wsAlert(final int sound, final int vibe) {
            try { DDZPushService.setAlert(MainActivity.this, sound != 0, vibe != 0); } catch (Throwable ignored) { }
        }

        @JavascriptInterface
        public String wsState() {
            try { return DDZPushService.state(); } catch (Throwable e) { return "stopped"; }
        }

        /** 发一条系统通知；badge 同时用于部分 launcher 的角标数字 */
        @JavascriptInterface
        public void notifyMsg(final String title, final String body, final int id, final int badge) {
            DDZPushService.postNotification(MainActivity.this, title, body, id, badge);
        }

        /** 新消息通知：可控提示音 / 震动。用 int 而非 boolean，避开 JS 桥反射匹配问题。
            关掉声音或震动时，通知栏那条营销广告照常显示，逻辑不变。 */
        @JavascriptInterface
        public void notifyMsgEx(final String title, final String body, final int id,
                                final int badge, final int sound, final int vibe) {
            DDZPushService.postNotificationEx(MainActivity.this, title, body, id, badge,
                    sound != 0, vibe != 0);
        }

        /** 桌面角标数字；0 = 清除 */
        @JavascriptInterface
        public void setBadge(final int n) {
            try { BadgeUtil.setBadge(MainActivity.this, n); } catch (Throwable ignored) { }
        }

        /**
         * 把聊天里的语音 / 图片 / 视频 / 文件保存到手机。
         * 走系统 DownloadManager 落到公共「下载」目录，无需存储权限（Android 10+ 亦可用）。
         * 返回 "ok" 或 "error:原因"。
         */
        /* JS 传来的目录名 → 系统公共目录名；认不出来的退回 Downloads */
        private String pubDir(String d) {
            String k = (d == null ? "" : d.trim().toUpperCase());
            if ("PICTURES".equals(k)) return android.os.Environment.DIRECTORY_PICTURES;
            if ("DCIM".equals(k)) return android.os.Environment.DIRECTORY_DCIM;
            if ("MOVIES".equals(k)) return android.os.Environment.DIRECTORY_MOVIES;
            if ("MUSIC".equals(k)) return android.os.Environment.DIRECTORY_MUSIC;
            if ("DOCUMENTS".equals(k)) return android.os.Environment.DIRECTORY_DOCUMENTS;
            return android.os.Environment.DIRECTORY_DOWNLOADS;
        }

        /* WebView 的 JS 桥对「同名重载」支持很差：同时存在 2 参和 3 参的
           @JavascriptInterface saveFile 时，JS 调用会报 error:Method not found。
           用户选择「不要目录选择框、直接存下载目录」，这里只保留唯一一个桥接方法。 */
        @JavascriptInterface
        public String saveFile(final String url, final String name) {
            return saveFileTo(url, name, android.os.Environment.DIRECTORY_DOWNLOADS);
        }

        /* 按扩展名猜 MIME：不设置的话 DownloadManager 存出来的文件没有类型，
           系统「文件管理」认不出来，点开也播不了。 */
        private String mimeOf(String fn) {
            String n = (fn == null ? "" : fn).toLowerCase();
            if (n.endsWith(".png")) return "image/png";
            if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
            if (n.endsWith(".gif")) return "image/gif";
            if (n.endsWith(".webp")) return "image/webp";
            if (n.endsWith(".mp4") || n.endsWith(".m4v") || n.endsWith(".mov")) return "video/mp4";
            if (n.endsWith(".webm")) return "video/webm";
            if (n.endsWith(".m4a") || n.endsWith(".aac")) return "audio/mp4";
            if (n.endsWith(".mp3")) return "audio/mpeg";
            if (n.endsWith(".wav")) return "audio/wav";
            if (n.endsWith(".ogg")) return "audio/ogg";
            if (n.endsWith(".amr")) return "audio/amr";
            if (n.endsWith(".3gp")) return "video/3gpp";
            if (n.endsWith(".mkv")) return "video/x-matroska";
            if (n.endsWith(".avi")) return "video/avi";
            if (n.endsWith(".pdf")) return "application/pdf";
            if (n.endsWith(".txt") || n.endsWith(".log")) return "text/plain";
            if (n.endsWith(".zip")) return "application/zip";
            /* 上传时若丢了扩展名，按名字关键字兜底，避免存成「未知文件」谁都打不开 */
            if (n.contains("video") || n.startsWith("vid")) return "video/mp4";
            if (n.contains("image") || n.startsWith("img")) return "image/jpeg";
            if (n.contains("voice") || n.startsWith("aud")) return "audio/mp4";
            return "application/octet-stream";
        }

        private String saveFileTo(final String url, final String name, final String dir) {
            if (url == null || url.length() == 0) return "error:地址为空";
            try {
                android.app.DownloadManager dm = (android.app.DownloadManager) getSystemService(android.content.Context.DOWNLOAD_SERVICE);
                if (dm == null) return "error:系统不支持下载";
                android.app.DownloadManager.Request rq =
                        new android.app.DownloadManager.Request(android.net.Uri.parse(url));
                String fn = (name == null || name.trim().length() == 0) ? "ddz_file" : name.trim();
                fn = fn.replaceAll("[\\\\/:*?\"<>|]", "_");
                rq.setTitle(fn);
                rq.setDescription("PP斗地主");
                rq.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                /* 必须显式给 MIME，否则存出来的文件没有类型：
                   系统「文件管理」里显示为未知文件，点开也播不了。 */
                rq.setMimeType(mimeOf(fn));
                rq.allowScanningByMediaScanner();
                rq.setDestinationInExternalPublicDir(dir, fn);
                // 服务器是 http，Android 9+ 默认禁止明文，已在 network_security_config 放行
                dm.enqueue(rq);
                return "ok";
            } catch (Exception e) {
                return "error:" + (e.getMessage() == null ? "下载失败" : e.getMessage());
            }
        }

        @JavascriptInterface
        public String startRecord() {
            final String[] out = new String[1];
            final Object lock = new Object();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    String r = "ok";
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                                checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_PERM);
                            r = "error:请在系统弹窗里允许麦克风权限";
                        } else {
                            stopRecorder();
                            File f = new File(getCacheDir(), "ddz_voice_" + System.currentTimeMillis() + ".m4a");
                            recPath = f.getAbsolutePath();
                            MediaRecorder mr = new MediaRecorder();
                            mr.setAudioSource(MediaRecorder.AudioSource.MIC);
                            try {
                                mr.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
                                mr.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
                                mr.setAudioSamplingRate(44100);
                                mr.setAudioEncodingBitRate(96000);
                            } catch (Exception e2) {
                                mr = new MediaRecorder();
                                mr.setAudioSource(MediaRecorder.AudioSource.MIC);
                                mr.setOutputFormat(MediaRecorder.OutputFormat.THREE_GPP);
                                mr.setAudioEncoder(MediaRecorder.AudioEncoder.AMR_NB);
                            }
                            mr.setMaxDuration(60000);
                            mr.setOutputFile(recPath);
                            mr.prepare();
                            mr.start();
                            recorder = mr;
                            recStart = System.currentTimeMillis();
                        }
                    } catch (Exception e) {
                        recPath = null;
                        r = "error:" + (e.getMessage() == null ? "无法录音" : e.getMessage());
                    }
                    synchronized (lock) { out[0] = r; lock.notifyAll(); }
                }
            });
            synchronized (lock) {
                if (out[0] == null) { try { lock.wait(3000); } catch (InterruptedException ignored) { } }
            }
            return out[0] == null ? "error:timeout" : out[0];
        }

        @JavascriptInterface
        public String stopRecord() {
            final String[] out = new String[1];
            final Object lock = new Object();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    String r = null;
                    try {
                        long dur = System.currentTimeMillis() - recStart;
                        stopRecorder();
                        if (recPath != null) {
                            File f = new File(recPath);
                            if (f.exists() && f.length() > 0) {
                                String b64 = Base64.encodeToString(readAll(f), Base64.NO_WRAP);
                                String mime = recPath.endsWith(".3gp") ? "audio/3gpp" : "audio/mp4";
                                r = "{\"data\":\"" + b64 + "\",\"dur\":" + dur + ",\"mime\":\"" + mime + "\"}";
                            }
                            try { f.delete(); } catch (Exception ignored) { }
                        }
                        recPath = null;
                    } catch (Exception e) { r = null; }
                    synchronized (lock) { out[0] = r; lock.notifyAll(); }
                }
            });
            synchronized (lock) {
                if (out[0] == null) { try { lock.wait(4000); } catch (InterruptedException ignored) { } }
            }
            return out[0] == null ? "" : out[0];
        }
    
        @android.webkit.JavascriptInterface
        public String ttsReady() {
            return ttsOk ? "ok" : (ttsErr == null || ttsErr.isEmpty() ? "init" : ttsErr);
        }

        @android.webkit.JavascriptInterface
        public void speak(String text) {
            if (!ttsOk || tts == null || text == null) return;
            try {
                if (android.os.Build.VERSION.SDK_INT >= 21) {
                    android.os.Bundle bp = new android.os.Bundle();
                    bp.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, bp, "ddz");
                } else {
                    java.util.HashMap<String, String> hm = new java.util.HashMap<String, String>();
                    hm.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "ddz");
                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, hm);
                }
            } catch (Exception ignored) { }
        }

        @android.webkit.JavascriptInterface
        public void stopSpeak() {
            try { if (tts != null) tts.stop(); } catch (Exception ignored) { }
        }

        /* 语速 / 音调：设置页滑钮调完立刻生效，试听听到的就是调后的效果。
           注意：这是自定义桥接方法，父类没有同名方法，不能加 @Override，
           加了会报「method does not override or implement a method from a supertype」。 */
        @android.webkit.JavascriptInterface
        public void ttsTune(float rate, float pitch) {
            if (!ttsOk || tts == null) return;
            try {
                if (rate > 0f) tts.setSpeechRate(rate);
                if (pitch > 0f) tts.setPitch(pitch);
            } catch (Exception ignored) { }
        }
}

    private void stopRecorder() {
        if (recorder != null) {
            try { recorder.stop(); } catch (Exception ignored) { }
            try { recorder.reset(); } catch (Exception ignored) { }
            try { recorder.release(); } catch (Exception ignored) { }
            recorder = null;
        }
    }

    private static byte[] readAll(File f) throws Exception {
        int n = (int) f.length();
        byte[] buf = new byte[n];
        FileInputStream in = new FileInputStream(f);
        try {
            int off = 0;
            while (off < n) {
                int r = in.read(buf, off, n - off);
                if (r < 0) break;
                off += r;
            }
        } finally {
            try { in.close(); } catch (Exception ignored) { }
        }
        return buf;
    }

    @Override
    public void onBackPressed() {
        WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
        if (wv != null) {
            wv.evaluateJavascript(
                "(function(){try{return (window.Nav&&Nav.back)?String(Nav.back()):'false';}catch(e){return 'false';}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String v) {
                        if (v == null || !v.contains("true")) {
                            try { finish(); } catch (Exception ignored) { }
                        }
                    }
                });
            return;
        }
        super.onBackPressed();
    }
}
