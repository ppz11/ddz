/* 网络层：WebSocket + HTTP API，自动重连 */
window.Net = (function () {
  var ws = null, handlers = {}, token = '', base = '', retry = 0, timer = null, queue = [], opened = false;
  /* 打包成 App 时由 build-www 注入固定服务器地址；浏览器访问时留空，走同源 */
  var SERVER = window.APP_SERVER || '';
  /* 允许在诊断框里手动改写服务器地址并立即生效（免重新编译） */
  function setServer(v) {
    SERVER = String(v || '').trim().replace(/\/$/, '');
    retry = 0; queue.length = 0; opened = false;
    clearTimeout(timer);
    try { if (ws) ws.close(); } catch (e) {}
    ws = null;
  }
  function wsUrl() {
    if (!SERVER) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    return SERVER.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
  }
  /* 诊断：App 实际连接的服务器地址，登录页底部会显示，连不上时一眼能看出连的是哪里 */
  function serverLabel() { return SERVER || ('(未注入 · 将连 ' + location.host + ')'); }

  function on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); return function () { handlers[t] = handlers[t].filter(function (x) { return x !== fn; }); }; }
  function fire(t, m) { (handlers[t] || []).forEach(function (f) { try { f(m); } catch (e) { console.error(e); } }); }

  function connect(tok) {
    token = tok || token;
    if (ws && (ws.readyState === 1)) return;
    try { ws = new WebSocket(wsUrl()); } catch (e) { return schedule(); }
    ws.onopen = function () {
      opened = true; retry = 0;
      fire('open', {});
      send({ t: 'auth', token: token });
      queue.splice(0).forEach(function (m) { send(m); });
    };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      fire('*', m);
      fire(m.t, m);
    };
    ws.onclose = function () { opened = false; fire('close', {}); schedule(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function schedule() {
    clearTimeout(timer);
    retry = Math.min(retry + 1, 6);
    timer = setTimeout(function () { connect(); }, retry * 700);
  }
  function send(m) {
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
      /* fetch 失败时浏览器只给 "Failed to fetch"，这里补上真实地址，便于定位 */
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
  return {
    on: on, send: send, connect: connect, api: api, upload: upload, abs: abs,
    /* 诊断与手动改地址（必须导出，否则 app.js 里永远是 undefined） */
    setServer: setServer, serverLabel: serverLabel,
    /* 当前实际使用的地址（供诊断展示） */
    currentServer: function () { return SERVER || ''; },
    get open() { return opened && ws && ws.readyState === 1; },
    close: function () { if (ws) try { ws.close(); } catch (e) {} }
  };
})();
