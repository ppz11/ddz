package com.yuanbao.ddz;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.KeyEvent;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;

public class MainActivity extends Activity {

    private WebView web;
    public static final String SERVER = "__SERVER_URL__";

    private ValueCallback<Uri[]> filePathCallback;
    private static final int REQ_FILE = 1001;
    private static final int REQ_PERM = 1002;

    /* ---------- 原生录音（App 是 http 环境，网页录音不可用，必须走原生） ---------- */
    private MediaRecorder recorder = null;
    private String recPath = null;
    private long recStart = 0;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 默认竖屏；进入牌桌时由 JS 调 DDZNative.setOrientation('landscape') 切横屏
        try { setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT); } catch (Exception ignored) { }

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " DDZApp/1.0");
        // 允许 http 明文 + 混合内容（服务器是 http）
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // 定位支持（好友空间「打开 App 时上报位置」用）
        s.setGeolocationEnabled(true);
        s.setGeolocationDatabasePath(getFilesDir().getPath());
        // 允许 file:// 页面里访问相册/文件
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);

        // 注入原生能力：横竖屏切换、录音、最小化
        web.addJavascriptInterface(new DDZBridge(), "DDZNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    return false;
                }
                // 地图等外部链接交给系统浏览器
                if (url != null && (url.startsWith("intent://") || url.startsWith("amap://") || url.startsWith("geo:"))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) { }
                    return true;
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView v, int code, String desc, String url) {
                String html = "<html><body style='background:#1a1a2e;color:#fff;font-family:sans-serif;"
                        + "display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>"
                        + "<div style='text-align:center'><h3>连接不上服务器</h3>"
                        + "<p style='opacity:.7'>请确认服务器已开启<br/>或网络正常</p>"
                        + "<p style='font-size:12px;opacity:.5'>" + SERVER + "</p></div></body></html>";
                v.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // 网页调用 navigator.geolocation 时，弹一次系统定位授权
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION
                        }, REQ_PERM);
                    }
                }
                // 用户已在 App 内点过「我同意，开启」，这里放行给网页
                callback.invoke(origin, true, false);
            }

            // 麦克风 / 摄像头（语音、视频通话）
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                requestPermissions(new String[]{
                                        Manifest.permission.RECORD_AUDIO,
                                        Manifest.permission.CAMERA
                                }, REQ_PERM);
                            }
                            request.grant(request.getResources());
                        } catch (Exception e) {
                            try { request.deny(); } catch (Exception ignored) { }
                        }
                    }
                });
            }

            // 聊天里发图片 / 视频 / 文件
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                try {
                    Intent i = params.createIntent();
                    if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    }
                    i.setType("*/*");
                    startActivityForResult(Intent.createChooser(i, "选择文件"), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        // 首次进入申请定位 / 录音 / 摄像头权限
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.CAMERA
            }, REQ_PERM);
        }

        web.loadUrl(SERVER);
        setContentView(web);
    }

    /* ================= 原生桥接：JS 通过 window.DDZNative 调用 ================= */
    public class DDZBridge {

        /** 'landscape' / 'portrait' */
        @JavascriptInterface
        public void setOrientation(final String o) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if ("landscape".equals(o)) {
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                        } else {
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
                        }
                    } catch (Exception ignored) { }
                }
            });
        }

        /** 把 App 推到后台（隐私空间紧急退出用） */
        @JavascriptInterface
        public void minimizeApp() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try { moveTaskToBack(true); } catch (Exception ignored) { }
                }
            });
        }

        @JavascriptInterface
        public String hasNative() { return "1"; }

        /** 开始录音，返回 "ok" 或 "error:原因" */
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

        /** 结束录音，返回 JSON：{"data":"base64","dur":毫秒,"mime":"audio/mp4"} */
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
                                byte[] bytes = readAll(f);
                                String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                                String mime = recPath.endsWith(".3gp") ? "audio/3gpp" : "audio/mp4";
                                r = "{\"data\":\"" + b64 + "\",\"dur\":" + dur + ",\"mime\":\"" + mime + "\"}";
                            }
                            try { f.delete(); } catch (Exception ignored) { }
                        }
                        recPath = null;
                    } catch (Exception e) {
                        r = null;
                    }
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
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (filePathCallback == null) { super.onActivityResult(requestCode, resultCode, data); return; }
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                String ds = data.getDataString();
                ClipData cd = data.getClipData();
                if (cd != null) {
                    results = new Uri[cd.getItemCount()];
                    for (int i = 0; i < cd.getItemCount(); i++) {
                        results[i] = cd.getItemAt(i);
                    }
                } else if (ds != null) {
                    results = new Uri[]{ Uri.parse(ds) };
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // 无论结果如何都继续，网页端会自行判断是否上报
    }

    @Override
    public void onBackPressed() {
        // 先交给你页面里的 Nav.back()（左滑右滑返回走同一套），页面没处理再退出 App
        if (web != null) {
            web.evaluateJavascript(
                "(function(){try{return (window.Nav&&Nav.back)?String(Nav.back()):'false';}catch(e){return 'false';}})()",
                new android.webkit.ValueCallback<String>() {
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

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        stopRecorder();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        stopRecorder();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
