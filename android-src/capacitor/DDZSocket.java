package com.yuanbao.ddz;

import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.security.SecureRandom;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * 零第三方依赖的 WebSocket 客户端（RFC6455）。
 *
 * 为什么不用 WebView 里的 JS WebSocket：
 *   Activity 退到后台 / 锁屏后，系统 WebView 会节流甚至冻结 JS 定时器，
 *   net.js 里 setInterval 的心跳发不出去，服务端 25s 收不到 pong 就判离线，
 *   于是「切后台＝收不到消息」。把连接放到前台服务里，用 Java 线程收发，
 *   完全不依赖渲染进程是否还活着 —— 只要 App 进程没被系统杀掉，就一直在线。
 *
 * 只处理本服务端用到的部分：文本帧、分片、ping/pong、close、客户端掩码。
 * 服务端（Node ws）默认不协商 permessage-deflate，故无需解压扩展。
 */
public class DDZSocket {

    public interface Listener {
        void onOpen();
        void onText(String text);
        void onClose(String reason);
    }

    private static final int MAX_FRAME = 32 * 1024 * 1024;
    private final SecureRandom rnd = new SecureRandom();

    private volatile boolean running = false;
    private volatile boolean opened = false;
    private Socket socket = null;
    private InputStream in = null;
    private OutputStream out = null;
    private Thread readerThread = null;
    private Thread hbThread = null;
    private Listener listener = null;
    private String url = "";
    private String token = "";

    public synchronized void connect(String u, String tok, Listener l) {
        closeSilently();
        this.url = u;
        this.token = tok;
        this.listener = l;
        this.running = true;
        this.opened = false;
        readerThread = new Thread(new Runnable() {
            @Override public void run() { runReader(); }
        }, "ddz-ws-reader");
        readerThread.setDaemon(true);
        readerThread.start();
    }

    public boolean isOpen() { return opened && running; }

    /** 由前台服务在 onOpen 回调里调用：发 auth，之后所有业务消息走 send()。 */
    public String authJson() {
        return "{\"t\":\"auth\",\"token\":" + quote(token) + "}";
    }

    public void send(String text) throws IOException {
        sendFrame(0x1, text.getBytes("UTF-8"), true);
    }

    /** 外部主动关闭：停止线程、关 socket，不再回调 onClose。 */
    public synchronized void close() {
        running = false;
        opened = false;
        listener = null;
        closeSilently();
    }

    private synchronized void closeSilently() {
        opened = false;
        try { if (socket != null) socket.close(); } catch (Throwable ignored) { }
        socket = null; in = null; out = null;
        Thread r = readerThread;
        readerThread = null;
        if (r != null && r != Thread.currentThread()) { try { r.interrupt(); } catch (Throwable ignored) { } }
        Thread h = hbThread;
        hbThread = null;
        if (h != null && h != Thread.currentThread()) { try { h.interrupt(); } catch (Throwable ignored) { } }
    }

    /** 只关 socket 打断阻塞读，让 reader 自己走到 finally 触发重连。 */
    private synchronized void breakSocket() {
        try { if (socket != null) socket.close(); } catch (Throwable ignored) { }
    }

    /* ---------------- 连接 + 握手 + 读循环 ---------------- */

    private void runReader() {
        String reason = "";
        Listener cb = listener;
        try {
            URI u = new URI(url);
            String host = u.getHost();
            int port = u.getPort();
            boolean ssl = "wss".equalsIgnoreCase(u.getScheme()) || "https".equalsIgnoreCase(u.getScheme());
            if (host == null || host.length() == 0) throw new IOException("bad ws host");
            if (port < 0) port = ssl ? 443 : 80;
            String path = u.getRawPath();
            if (path == null || path.length() == 0) path = "/ws";
            if (u.getRawQuery() != null) path = path + "?" + u.getRawQuery();

            Socket s;
            if (ssl) {
                SSLSocketFactory f = (SSLSocketFactory) SSLSocketFactory.getDefault();
                SSLSocket ss = (SSLSocket) f.createSocket();
                s = ss;
            } else {
                s = new Socket();
            }
            s.connect(new InetSocketAddress(host, port), 8000);
            if (ssl) ((SSLSocket) s).startHandshake();
            s.setSoTimeout(0);
            try { s.setTcpNoDelay(true); } catch (Throwable ignored) { }
            socket = s;
            in = s.getInputStream();
            out = s.getOutputStream();

            byte[] keyRaw = new byte[16];
            rnd.nextBytes(keyRaw);
            String key = Base64.encodeToString(keyRaw, Base64.NO_WRAP);
            String hostHeader = host + ((port == (ssl ? 443 : 80)) ? "" : ":" + port);
            String req = "GET " + path + " HTTP/1.1\r\n"
                    + "Host: " + hostHeader + "\r\n"
                    + "Upgrade: websocket\r\n"
                    + "Connection: Upgrade\r\n"
                    + "Sec-WebSocket-Key: " + key + "\r\n"
                    + "Sec-WebSocket-Version: 13\r\n"
                    + "Origin: http://" + hostHeader + "\r\n"
                    + "\r\n";
            out.write(req.getBytes("US-ASCII"));
            out.flush();

            ByteArrayOutputStream hdr = new ByteArrayOutputStream();
            byte[] tail = new byte[]{'\r', '\n', '\r', '\n'};
            int c;
            while ((c = in.read()) != -1) {
                hdr.write(c);
                byte[] b = hdr.toByteArray();
                if (endsWith(b, tail)) break;
                if (b.length > 65536) throw new IOException("handshake too long");
            }
            String resp = new String(hdr.toByteArray(), "US-ASCII");
            if (!resp.contains(" 101 ")) {
                throw new IOException("handshake failed: " + resp.substring(0, Math.min(100, resp.length())));
            }

            opened = true;
            if (cb != null) cb.onOpen();
            startHeartbeat();

            ByteArrayOutputStream frag = new ByteArrayOutputStream();
            while (running) {
                int b0 = in.read();
                if (b0 < 0) break;
                int b1 = in.read();
                if (b1 < 0) break;
                boolean fin = (b0 & 0x80) != 0;
                int op = b0 & 0x0F;
                boolean masked = (b1 & 0x80) != 0;
                long len = b1 & 0x7F;
                if (len == 126) {
                    int hi = in.read(), lo = in.read();
                    if (hi < 0 || lo < 0) break;
                    len = ((long) ((hi & 0xff) << 8)) | (lo & 0xff);
                } else if (len == 127) {
                    long v = 0;
                    for (int i = 0; i < 8; i++) {
                        int x = in.read();
                        if (x < 0) throw new EOFException();
                        v = (v << 8) | (x & 0xff);
                    }
                    len = v;
                }
                byte[] mask = masked ? readFully(4) : null;
                byte[] payload = readFully(len);
                if (mask != null) {
                    for (int i = 0; i < payload.length; i++) payload[i] = (byte) (payload[i] ^ mask[i % 4]);
                }
                if (op == 0x9) {                 // 协议级 ping → 回 pong，保住服务端 isAlive
                    try { sendFrame(0xA, payload, true); } catch (Throwable ignored) { }
                    continue;
                }
                if (op == 0xA) continue;         // pong
                if (op == 0x8) break;            // close
                if (op == 0x1 || op == 0x2 || op == 0x0) {
                    frag.write(payload, 0, payload.length);
                    if (fin) {
                        byte[] all = frag.toByteArray();
                        frag.reset();
                        if (listener != null) listener.onText(new String(all, "UTF-8"));
                    }
                }
            }
            if (running) reason = "socket closed";
        } catch (Throwable e) {
            reason = (e.getMessage() == null) ? e.getClass().getSimpleName() : e.getMessage();
        } finally {
            boolean wasRunning = running;
            opened = false;
            closeSilently();
            if (wasRunning && cb != null) cb.onClose(reason);
        }
    }

    private byte[] readFully(long n) throws IOException {
        if (n < 0 || n > MAX_FRAME) throw new IOException("frame too large: " + n);
        byte[] b = new byte[(int) n];
        int off = 0;
        while (off < b.length) {
            int r = in.read(b, off, b.length - off);
            if (r < 0) throw new EOFException();
            off += r;
        }
        return b;
    }

    private static boolean endsWith(byte[] b, byte[] tail) {
        if (b.length < tail.length) return false;
        int off = b.length - tail.length;
        for (int i = 0; i < tail.length; i++) if (b[off + i] != tail[i]) return false;
        return true;
    }

    /* ---------------- 发送（客户端帧必须掩码） ---------------- */

    private synchronized void sendFrame(int op, byte[] payload, boolean fin) throws IOException {
        OutputStream o = out;
        if (o == null || !opened) throw new IOException("ws not open");
        int len = payload.length;
        ByteArrayOutputStream h = new ByteArrayOutputStream();
        h.write((fin ? 0x80 : 0x00) | op);
        if (len < 126) {
            h.write(0x80 | len);
        } else if (len <= 65535) {
            h.write(0x80 | 126);
            h.write((len >> 8) & 0xff);
            h.write(len & 0xff);
        } else {
            h.write(0x80 | 127);
            long l = len;
            for (int i = 7; i >= 0; i--) h.write((int) ((l >> (8 * i)) & 0xff));
        }
        byte[] mask = new byte[4];
        rnd.nextBytes(mask);
        byte[] body = new byte[len];
        for (int i = 0; i < len; i++) body[i] = (byte) (payload[i] ^ mask[i % 4]);
        o.write(h.toByteArray());
        o.write(mask);
        o.write(body);
        o.flush();
    }

    /* ---------------- 应用层心跳：10 秒一次，绕开空闲连接被 NAT 掐断 ---------------- */

    private void startHeartbeat() {
        hbThread = new Thread(new Runnable() {
            @Override public void run() {
                while (running && opened) {
                    try { Thread.sleep(10000); } catch (InterruptedException e) { return; }
                    if (!running || !opened) return;
                    try {
                        send("{\"t\":\"ping\"}");
                    } catch (Throwable e) {
                        breakSocket();   // 打断 reader 的阻塞读 → 触发 onClose → 重连
                        return;
                    }
                }
            }
        }, "ddz-ws-hb");
        hbThread.setDaemon(true);
        hbThread.start();
    }

    /* JSON 字符串字面量，避免 token 里的特殊字符破坏 auth 包 */
    private static String quote(String s) {
        if (s == null) s = "";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        /* 用 char 拼接，别在源码里写 "\u"，Java 编译器会当 Unicode 转义解析 */
                        b.append('\\').append('u');
                        String h = Integer.toHexString(c);
                        for (int z = h.length(); z < 4; z++) b.append('0');
                        b.append(h);
                    } else b.append(c);
            }
        }
        return b.append("\"").toString();
    }
}
