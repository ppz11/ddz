/* 网络层：WebSocket + HTTP API，自动重连
 *
 * v39 关键改动：打包成 APK 后，WebSocket 由「前台服务」原生持有（DDZPushService），
 * WebView 这边只负责收发内容。原因：Activity 退到后台 / 锁屏后，系统 WebView 会
 * 节流甚至冻结 JS 定时器，原来 setInterval 的 10s 心跳发不出去，服务端 25s 收不到
 * pong 就判离线 —— 这就是「切后台就收不到消息、再打开要重新登录」的根因。
 * 现在只要 App 进程没被系统杀掉，连接一直在、消息一直收，跟是否回前台无关。
 *
 * 浏览器（无 DDZNative）仍走原来的 JS WebSocket，便于 PC 上调试。
 */
window.Net = (function () {
  var ws = null, handlers = {}, token = '', base = '', retry = 0, timer = null;
  var queue = [], opened = false, nativeMode = false;
  var alertSound = true, alertVibe = true;
  /* 打包成 App 时由 build-www 注入固定服务器地址；浏览器访问时留空，走同源 */
  var SERVER = window.APP_SERVER || '';

  function nat() {
    try {
      return (window.DDZNative && typeof window.DDZNative.wsStart === 'function') ? window.DDZNative : null;
    } catch (e) { return null; }
  }
  function stateOpen() {
    var n = nat();
    if (!n || typeof n.wsState !== 'function') return false;
    try { return n.wsState() === 'open'; } catch (e) { return false; }
  }
  function wsUrl() {
    if (!SERVER) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    return SERVER.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
  }
  function serverLabel() { return SERVER || ('(未注入 · 将连 ' + location.host + ')'); }

  function on(t, fn) {
    (handlers[t] = handlers[t] || []).push(fn);
    return function () { handlers[t] = (handlers[t] || []).filter(function (x) { return x !== fn; }); };
  }
  function fire(t, m) {
    (handlers[t] || []).forEach(function (f) { try { f(m); } catch (e) { console.error(e); } });
  }
  var seen = {}, seenList = [];
  function dispatch(m) {
    if (!m || typeof m !== 'object' || !m.t) return;
    /* 原生服务会「前台实时注入 + 积压队列各一份」，用序号去重，避免渲染两遍 */
    if (m._seq) {
      var k = String(m._seq);
      if (seen[k]) return;
      seen[k] = 1; seenList.push(k);
      if (seenList.length > 1500) { try { delete seen[seenList.shift()]; } catch (e) { } }
    }
    if (m.t === '__native_open') {
      if (!opened) { opened = true; retry = 0; fire('open', {}); flushQueue(); }
      return;
    }
    fire('*', m);
    fire(m.t, m);
  }

  /* 原生服务把服务端推来的原始 JSON 注入 WebView 时调用 */
  function onNativeMessage(raw) {
    var m = raw;
    if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch (e) { return; } }
    dispatch(m);
  }

  /* 回前台：把后台期间服务缓存的消息一次性补投给各业务模块。
     带 _bg 标记的消息不会让 app.js 重复弹一条通知栏广告。 */
  function hydrate() {
    var n = nat();
    if (!n || typeof n.wsDrain !== 'function') return;
    try {
      var arr = JSON.parse(n.wsDrain() || '[]');
      if (arr && arr.length) for (var i = 0; i < arr.length; i++) dispatch(arr[i]);
    } catch (e) { }
  }

  function flushQueue() {
    var q = queue.splice(0);
    for (var i = 0; i < q.length; i++) send(q[i]);
  }

  /* 服务可能在页面 JS 加载完成前就连上了，__native_open 注入会丢。
     这里轮询原生状态补一次 open 事件，不依赖那条注入消息。 */
  function fireOpenWhenReady(tries) {
    if (!nativeMode) return;
    if (stateOpen()) {
      if (!opened) { opened = true; fire('open', {}); flushQueue(); }
      return;
    }
    if (tries > 0) setTimeout(function () { fireOpenWhenReady(tries - 1); }, 300);
  }

  function connect(tok) {
    token = tok || token;
    var n = nat();
    if (n) {
      nativeMode = true;
      retry = 0;
      try { n.wsStart(wsUrl(), token, alertSound ? 1 : 0, alertVibe ? 1 : 0); } catch (e) { }
      hydrate();
      fireOpenWhenReady(20);
      return;
    }
    /* ---- 浏览器回退：JS 自己连 ---- */
    if (ws && ws.readyState === 1) return;
    try { ws = new WebSocket(wsUrl()); } catch (e) { return schedule(); }
    ws.onopen = function () {
      opened = true; retry = 0;
      startHeartbeat();
      fire('open', {});
      send({ t: 'auth', token: token });
      flushQueue();
    };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      dispatch(m);
    };
    ws.onclose = function () { opened = false; fire('close', {}); schedule(); };
    ws.onerror = function () { try { ws.close(); } catch (e) { } };
  }

  /* 浏览器模式的心跳（原生模式由服务侧的 Java 线程负责，不走这里） */
  var hbTimer = null;
  function startHeartbeat() {
    if (hbTimer) return;
    hbTimer = setInterval(function () {
      if (ws && ws.readyState === 1) {
        try { ws.send(JSON.stringify({ t: 'ping' })); } catch (e) { }
      }
    }, 10000);
  }

  function ensure() {
    if (nativeMode) { hydrate(); return; }
    if (ws && ws.readyState === 1) return;
    clearTimeout(timer); retry = 0; connect();
  }
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        hydrate();      // 后台积压的消息补投
        ensure();       // 浏览器模式顺手补连
      }
    });
  } catch (e) { }

  function schedule() {
    clearTimeout(timer);
    retry = Math.min(retry + 1, 6);
    timer = setTimeout(function () { connect(); }, retry * 700);
  }

  function send(m) {
    if (nativeMode) {
      var n = nat();
      if (n) {
        /* 服务未连上时由服务侧 outbox 暂存，onOpen 后自动补发 */
        try { n.wsSend(JSON.stringify(m)); return; } catch (e) { }
      }
    }
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
    else queue.push(m);
  }

  function api(path, body) {
    var url = (SERVER || base) + path;
    return fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (!r.ok) {
        var e = new Error('HTTP ' + r.status + ' @ ' + url);
        e.httpStatus = r.status; e.url = url; throw e;
      }
      return r.json();
    }, function (err) {
      var e = new Error((err && err.message ? err.message : '请求失败') + ' → ' + url);
      e.url = url; e.cause = err; throw e;
    });
  }
  function upload(file, kind, dur) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var b64 = String(fr.result).split(',')[1];
        api('/api/upload', { name: file.name || ('file_' + Date.now()), mime: file.type || 'application/octet-stream', data: b64, kind: kind, dur: dur })
          .then(res).catch(rej);
      };
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  }
  function abs(u) {
    if (!u) return u;
    if (/^https?:\/\//.test(u)) return u;
    return (SERVER || '') + u;
  }
  function setAlert(s, v) {
    alertSound = (s !== false);
    alertVibe = (v !== false);
    var n = nat();
    if (n && typeof n.wsAlert === 'function') {
      try { n.wsAlert(alertSound ? 1 : 0, alertVibe ? 1 : 0); } catch (e) { }
    }
  }

  return {
    on: on, send: send, connect: connect, api: api, upload: upload, abs: abs,
    setServer: function (v) {
      SERVER = String(v || '').trim().replace(/\/$/, '');
      retry = 0; queue.length = 0; opened = false;
      clearTimeout(timer);
      if (nativeMode) {
        var n = nat();
        if (n) { try { n.wsStart(wsUrl(), token, alertSound ? 1 : 0, alertVibe ? 1 : 0); } catch (e) { } }
      } else {
        try { if (ws) ws.close(); } catch (e) { }
        ws = null;
      }
    },
    serverLabel: serverLabel,
    setToken: function (t) { token = t || token; },
    reauth: function (t) {
      token = t || token; retry = 0; queue.length = 0; opened = false;
      var n = nat();
      if (nativeMode && n) {
        try { n.wsStart(wsUrl(), token, alertSound ? 1 : 0, alertVibe ? 1 : 0); } catch (e) { }
        return;
      }
      try { if (ws) ws.close(); } catch (e) { }
      ws = null; connect(token);
    },
    currentServer: function () { return SERVER || ''; },
    get open() { return nativeMode ? stateOpen() : (opened && ws && ws.readyState === 1); },
    ensure: ensure,
    hydrate: hydrate,
    onNativeMessage: onNativeMessage,
    setAlert: setAlert,
    isNative: function () { return nativeMode; },
    close: function () { if (ws) try { ws.close(); } catch (e) { } }
  };
})();
