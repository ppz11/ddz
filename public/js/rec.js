/* ===================== 录音（短语音） =====================
 * App 内（打包成 APK）走安卓原生录音：http 环境没有 navigator.mediaDevices，
 * 原生录音是唯一能用的方案；浏览器 / https 环境走 MediaRecorder。
 * 对外只暴露 available / start / stop 三个方法。
 * ========================================================= */
window.Rec = (function () {
  var nat = null;
  function native() {
    if (nat !== null) return nat;
    try {
      nat = (window.DDZNative && typeof window.DDZNative.startRecord === 'function') ? window.DDZNative : false;
    } catch (e) { nat = false; }
    return nat;
  }
  function web() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }
  function available() { return !!native() || web(); }

  var rec = null, chunks = [], stream = null, t0 = 0, mimeType = '';
  var natDur = 0;

  /* cb(err)：err 为空表示已经开始录音 */
  function start(cb) {
    cb = cb || function () { };
    if (native()) {
      try {
        var r = native().startRecord();
        if (r && String(r).indexOf('ok') !== 0) return cb(String(r).replace(/^error:?/, '') || '无法录音');
        t0 = Date.now();
        return cb();
      } catch (e) { return cb('无法启动录音'); }
    }
    if (!web()) return cb(isSecure() ? '本设备不支持录音' : '当前环境不支持录音（需在 App 内使用）');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s; chunks = [];
      var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', ''];
      var mt = '';
      for (var i = 0; i < list.length; i++) {
        if (!list[i] || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(list[i]))) { mt = list[i]; break; }
      }
      try { rec = new MediaRecorder(s, mt ? { mimeType: mt } : undefined); }
      catch (e) { try { rec = new MediaRecorder(s); } catch (x) { return cb('无法录音'); } }
      mimeType = rec.mimeType || mt || 'audio/webm';
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      t0 = Date.now();
      rec.start();
      cb();
    }).catch(function (e) { cb('没有麦克风权限'); });
  }

  /* 返回 Promise<{file:File, dur:秒}>；失败 resolve(null) */
  function stop() {
    return new Promise(function (res) {
      if (native()) {
        try {
          var out = native().stopRecord();
          var o = null;
          try { o = JSON.parse(out); } catch (e) { }
          if (!o || !o.data) return res(null);
          var dur = Math.round((o.dur || (Date.now() - t0)) / 1000) || 1;
          var bin = atob(o.data);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          var mime = o.mime || 'audio/mp4';
          var ext = mime.indexOf('webm') >= 0 ? '.webm' : (mime.indexOf('ogg') >= 0 ? '.ogg' : '.m4a');
          var f = new File([new Blob([arr], { type: mime })], 'voice_' + Date.now() + ext, { type: mime });
          return res({ file: f, dur: dur });
        } catch (e) { return res(null); }
      }
      if (!rec) return res(null);
      var r = rec;
      r.onstop = function () {
        var blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null; rec = null;
        var dur = Math.round((Date.now() - t0) / 1000);
        if (dur < 1 || blob.size < 200) return res(null);
        var ext = (blob.type.indexOf('webm') >= 0) ? '.webm' : (blob.type.indexOf('ogg') >= 0 ? '.ogg' : '.m4a');
        var f = new File([blob], 'voice_' + Date.now() + ext, { type: blob.type });
        res({ file: f, dur: dur });
      };
      try { r.stop(); } catch (e) { res(null); }
    });
  }

  function isSecure() { try { return !!(window.isSecureContext || location.protocol === 'https:' || location.protocol === 'file:'); } catch (e) { return false; } }

  /* 统一的「按住说话」绑定：按下开始、松开发送 */
  function hold(btn, onDone, onErr) {
    if (!btn) return;
    var holding = false, canceled = false;
    function down(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (holding) return;
      holding = true; canceled = false;
      start(function (err) {
        if (err) { holding = false; (onErr || window.App.toast)(err); return; }
      });
    }
    function up(e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!holding) return;
      holding = false;
      stop().then(function (r) {
        if (canceled) return;
        if (!r) { window.App.toast('录音太短'); return; }
        onDone && onDone(r);
      });
    }
    function cancel() { if (holding) { holding = false; canceled = true; stop(); } }
    btn.addEventListener('touchstart', down, { passive: false });
    btn.addEventListener('touchend', up, { passive: false });
    btn.addEventListener('touchcancel', cancel);
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', cancel);
  }

  return { available: available, start: start, stop: stop, hold: hold, native: function () { return !!native(); } };
})();
