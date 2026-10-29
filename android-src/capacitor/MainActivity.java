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
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import java.io.File;
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

    private MediaRecorder recorder = null;
    private String recPath = null;
    private long recStart = 0;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static final int REQ_PERM = 1002;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 默认竖屏；进入牌桌时由 JS 调 DDZNative.setOrientation('landscape') 切横屏
        try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT); } catch (Exception ignored) { }

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
    @Override
    protected void onPause() {
        super.onPause();
        evalJs("(window.__ddzPause&&window.__ddzPause())");
        try {
            android.webkit.WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
            if (wv != null) wv.onPause();
        } catch (Throwable ignored) { }
    }

    @Override
    protected void onResume() {
        super.onResume();
        try {
            android.webkit.WebView wv = (getBridge() != null) ? getBridge().getWebView() : null;
            if (wv != null) wv.onResume();
        } catch (Throwable ignored) { }
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
        // 回到前台：清掉桌面角标
        try { BadgeUtil.setBadge(this, 0); } catch (Throwable ignored) { }
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
            new DDZBridge().startPush();
        } catch (Throwable ignored) { }
    }

    public class DDZBridge {
        @JavascriptInterface
        public void setOrientation(final String o) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if ("landscape".equals(o)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                        else setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
                    } catch (Exception ignored) { }
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

        /* ---------- 后台保活（方案 A）：前台服务 ---------- */

        @JavascriptInterface
        public void startPush() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (android.os.Build.VERSION.SDK_INT >= 33) {   // 33 = TIRAMISU
                            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, REQ_PERM);
                            }
                        }
                    } catch (Throwable ignored) { }
                    try {
                        android.content.Intent i = new android.content.Intent(MainActivity.this, DDZPushService.class);
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                            startForegroundService(i);
                        } else {
                            startService(i);
                        }
                    } catch (Throwable ignored) { }
                }
            });
        }

        @JavascriptInterface
        public void stopPush() {
            try {
                stopService(new android.content.Intent(MainActivity.this, DDZPushService.class));
            } catch (Throwable ignored) { }
        }

        /** 发一条系统通知；badge 同时用于部分 launcher 的角标数字 */
        @JavascriptInterface
        public void notifyMsg(final String title, final String body, final int id, final int badge) {
            DDZPushService.postNotification(MainActivity.this, title, body, id, badge);
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
        @JavascriptInterface
        public String saveFile(final String url, final String name) {
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
                rq.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, fn);
                rq.allowScanningByMediaScanner();
                // 服务器是 http，需要明确放行明文（Android 9+ 默认禁止）
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
                    rq.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, fn);
                }
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
