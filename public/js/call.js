/* ===================== 语音通话 / 视频通话 =====================
 * 优先走 WebRTC（https 或 App 内置安全环境）；
 * 普通 http 环境无法使用摄像头麦克风，自动降级为「服务器中转的语音通话」
 * —— 按住说话，对方立刻听到，功能真实可用。
 * =============================================================== */
window.Call = (function () {
  var peer = null, mode = 'audio', state = 'idle', t0 = 0, timer = null;
  var pc = null, localStream = null, remoteVideo = null, localVideo = null;
  var ringTimer = null, useRtc = false, muted = false, camOff = false;
  var peerInfo = null;
  var el = null, incomingBox = null, rtcWatch = null;

  var ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

  /* 为什么不能视频：要么没有接口，要么不是安全环境（App 走 http 时浏览器禁用摄像头） */
  function rtcWhy() {
    if (!window.RTCPeerConnection) return '本系统不支持视频通话，已切换为语音通话';
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return '当前不是安全环境（http），摄像头不可用，已切换为语音通话';
    }
    return '已切换为语音通话（按住说话，对方立即听到）';
  }

  function rtcOk() {
    try {
      return !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
        (window.isSecureContext || location.protocol === 'https:' || location.protocol === 'file:'));
    } catch (e) { return false; }
  }

  function init() {
    Net.on('call:invite', function (m) { onInvite(m); });
    Net.on('call:accept', function (m) { onAccept(m); });
    Net.on('call:reject', function (m) { stopRing(); App.toast('对方拒绝了通话'); hangup(true); });
    Net.on('call:busy', function () { App.toast('对方正在通话中'); hangup(true); });
    Net.on('call:hangup', function (m) { stopRing(); App.toast('通话已结束'); hangup(true); });
    Net.on('call:offline', function () { App.toast('对方当前离线，无法通话'); cleanup(); });
    Net.on('call:signal', function (m) { onSignal(m); });
    Net.on('call:ptt', function (m) { playPtt(m); });
  }

  /* ---------------- 发起 ---------------- */
  /* extra：{pid, nick, avatar} —— 好友空间按「人」呼叫时用 */
  function start(uid, m, extra) {
    if (state !== 'idle') return App.toast('正在通话中');
    mode = (m === 'video' && rtcOk()) ? 'video' : 'audio';
    if (m === 'video' && !rtcOk()) App.toast('当前环境不支持视频，已切换为语音通话');
    peer = uid || ''; useRtc = rtcOk();
    peerInfo = extra || null;
    state = 'ringing';
    Net.send({ t: 'call:invite', to: uid, pid: extra && extra.pid, mode: mode });
    var c = (extra && extra.nick) ? { nick: extra.nick, avatar: extra.avatar } : contactOf(uid);
    openUI(c, '正在呼叫…');
    Sfx.alarm();
    setTimeout(function () {
      if (state === 'ringing') { App.toast('对方未接听'); hangup(false); }
    }, 30000);
  }

  function contactOf(uid) {
    var list = (App.contacts && App.contacts()) || [];
    var c = list.filter(function (x) { return x.uid === uid; })[0];
    if (c) return c;
    if (window.Secret && Secret.otherOf) { var o = Secret.otherOf(uid); if (o) return o; }
    return { uid: uid, nick: '好友', avatar: null };
  }

  /* ---------------- 来电 ---------------- */
  function onInvite(m) {
    if (state !== 'idle') { Net.send({ t: 'call:busy', to: m.from.uid }); return; }
    peer = m.from.uid;
    peerInfo = null;
    mode = (m.mode === 'video' && rtcOk()) ? 'video' : 'audio';
    useRtc = rtcOk();
    state = 'incoming';
    ring();
    var c = m.from || {};
    incomingBox = App.modal(
      '<h3>' + (mode === 'video' ? '📹 视频通话' : '📞 语音通话') + '</h3>' +
      '<p><b style="color:var(--gold)">' + App.esc(c.nick || '好友') + '</b> 邀请你通话</p>' +
      '<div class="row"><button class="btn ghost" id="ck-no">拒绝</button>' +
      '<button class="btn jade" id="ck-yes">接听</button></div>',
      [{ sel: '#ck-no', fn: function () { stopRing(); Net.send({ t: 'call:reject', to: peer }); state = 'idle'; peer = null; } },
       { sel: '#ck-yes', fn: function () { stopRing(); accept(); } }]);
  }

  function ring() {
    stopRing();
    Sfx.alarm();
    ringTimer = setInterval(function () { try { Sfx.alarm(); } catch (e) { } }, 2600);
  }
  function stopRing() { clearInterval(ringTimer); ringTimer = null; }

  function accept() {
    Net.send({ t: 'call:accept', to: peer, mode: mode, rtc: useRtc });
    state = 'active'; t0 = Date.now();
    var c = contactOf(peer);
    openUI(c, mode === 'video' ? '视频通话中' : '语音通话中');
    if (useRtc) setupRtc(false);
  }
  function onAccept(m) {
    if (state !== 'ringing') return;
    stopRing();
    // 对方不支持实时音视频 → 双方一起降级为「按住说话」
    if (m && m.rtc === false) {
      useRtc = false; mode = 'audio';
      if (pc) { try { pc.close(); } catch (e) { } pc = null; }
    }
    state = 'active'; t0 = Date.now();
    var c = contactOf(peer);
    openUI(c, mode === 'video' ? '视频通话中' : '语音通话中');
    if (useRtc) setupRtc(true);
  }

  /* ---------------- WebRTC ---------------- */
  function setupRtc(isCaller) {
    try { pc = new RTCPeerConnection({ iceServers: ICE }); } catch (e) { useRtc = false; return pttMode(); }
    // 兜底：摄像头权限一直没给 / 连不上时，6 秒后自动转为「按住说话」，避免永远卡在呼叫中
    clearTimeout(rtcWatch);
    rtcWatch = setTimeout(function () {
      if (state !== 'active' || !useRtc) return;
      if (pc && pc.connectionState === 'connected') return;
      useRtc = false;
      if (pc) { try { pc.close(); } catch (e) { } pc = null; }
      pttMode();
    }, 6000);
    pc.onicecandidate = function (e) {
      if (e.candidate) Net.send({ t: 'call:signal', to: peer, data: { type: 'candidate', candidate: e.candidate } });
    };
    pc.ontrack = function (e) {
      var v = document.getElementById('c-remote');
      if (v) { v.srcObject = e.streams[0]; v.play().catch(function () { }); }
      setSt(mode === 'video' ? '视频通话中' : '语音通话中');
    };
    pc.onconnectionstatechange = function () {
      if (!pc) return;
      if (pc.connectionState === 'connected') { clearTimeout(rtcWatch); setSt(mode === 'video' ? '视频通话中' : '语音通话中'); }
      else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') { useRtc = false; pttMode(); }
    };
    var want = { audio: true, video: mode === 'video' };
    navigator.mediaDevices.getUserMedia(want).then(function (s) {
      localStream = s;
      s.getTracks().forEach(function (t) { pc.addTrack(t, s); });
      var lv = document.getElementById('c-local');
      if (lv) { lv.srcObject = s; lv.play().catch(function () { }); }
      if (isCaller) {
        pc.createOffer().then(function (o) {
          pc.setLocalDescription(o);
          Net.send({ t: 'call:signal', to: peer, data: { type: 'offer', sdp: o } });
        });
      }
    }).catch(function () { useRtc = false; pttMode(); });
  }
  function onSignal(m) {
    if (!pc || !m.data) return;
    var d = m.data;
    if (d.type === 'offer') {
      pc.setRemoteDescription(new RTCSessionDescription(d.sdp)).then(function () {
        return pc.createAnswer();
      }).then(function (a) {
        pc.setLocalDescription(a);
        Net.send({ t: 'call:signal', to: peer, data: { type: 'answer', sdp: a } });
      }).catch(function () { });
    } else if (d.type === 'answer') {
      pc.setRemoteDescription(new RTCSessionDescription(d.sdp)).catch(function () { });
    } else if (d.type === 'candidate') {
      pc.addIceCandidate(new RTCIceCandidate(d.candidate)).catch(function () { });
    }
  }

  /* ---------------- 中转语音（按住说话） ---------------- */
  function pttMode() {
    setSt('语音通话 · 按住说话，松开对方立即听到');
    if (mode === 'video') App.toast(rtcWhy());
    var b = document.getElementById('c-ptt');
    if (!b) return;
    b.classList.remove('hidden');
    Rec.hold(b, function (r) {
      App.toast('发送中…');
      Net.upload(r.file, 'voice', r.dur).then(function (up) {
        if (up.err) return App.toast(up.err);
        Net.send({ t: 'call:ptt', to: peer, url: up.url, dur: r.dur });
      });
    });
  }
  var audioEl = null;
  function playPtt(m) {
    if (state !== 'active') return;
    if (audioEl) { audioEl.pause(); audioEl = null; }
    audioEl = new Audio(Net.abs(m.url));
    audioEl.play().catch(function () { });
    setSt('对方说话中… ' + (m.dur || 0) + '″');
    audioEl.onended = function () { audioEl = null; setSt(mode === 'video' ? '视频通话中' : '语音通话中'); };
  }

  /* ---------------- 界面 ---------------- */
  function openUI(c, st) {
    closeUI();
    el = document.createElement('div');
    el.className = 'callui'; el.id = 'callui';
    el.innerHTML =
      '<div class="cbox">' +
      '<div class="cav" id="c-av">' + Avatar.svg(c.avatar, 76) + '</div>' +
      '<div class="cnm">' + App.esc(c.nick || '好友') + '</div>' +
      '<div class="cst" id="c-st">' + st + '</div>' +
      '<div class="cvid ' + (mode === 'video' ? '' : 'hidden') + '">' +
      '<video id="c-remote" autoplay playsinline></video>' +
      '<video id="c-local" autoplay playsinline muted></video></div>' +
      '<div class="crow">' +
      '<button class="cBtn" id="c-mute">🔇<span>静音</span></button>' +
      (mode === 'video' ? '<button class="cBtn" id="c-cam">📹<span>关摄像头</span></button>' : '') +
      '<button class="cBtn end" id="c-end">✕<span>挂断</span></button>' +
      '</div>' +
      '<button class="ptt hidden" id="c-ptt">🎙 按住说话</button>' +
      '</div>';
    document.getElementById('app').appendChild(el);
    document.getElementById('c-end').onclick = function () { hangup(false); };
    document.getElementById('c-mute').onclick = function () {
      muted = !muted;
      if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
      document.getElementById('c-mute').classList.toggle('on', muted);
      App.toast(muted ? '已静音' : '已取消静音');
    };
    var cam = document.getElementById('c-cam');
    if (cam) cam.onclick = function () {
      camOff = !camOff;
      if (localStream) localStream.getVideoTracks().forEach(function (t) { t.enabled = !camOff; });
      cam.classList.toggle('on', camOff);
      cam.querySelector('span').textContent = camOff ? '开摄像头' : '关摄像头';
    };
    startTimer();
    if (!useRtc) pttMode();
  }
  function setSt(t) { var s = document.getElementById('c-st'); if (s) s.textContent = t; }
  function startTimer() {
    clearInterval(timer);
    var s = document.getElementById('c-st');
    timer = setInterval(function () {
      if (state !== 'active') return;
      var n = Math.round((Date.now() - t0) / 1000);
      var txt = String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
      var b = document.getElementById('c-time');
      if (!b) {
        b = document.createElement('div'); b.id = 'c-time'; b.className = 'ctime';
        var box = document.getElementById('callui'); box && box.querySelector('.cbox').appendChild(b);
      }
      b.textContent = txt;
    }, 1000);
  }
  function closeUI() { if (el) { el.remove(); el = null; } }

  function hangup(silent) {
    if (peer && !silent) Net.send({ t: 'call:hangup', to: peer });
    cleanup();
  }
  function cleanup() {
    stopRing(); clearInterval(timer); clearTimeout(rtcWatch);
    if (pc) { try { pc.close(); } catch (e) { } pc = null; }
    if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
    if (audioEl) { audioEl.pause(); audioEl = null; }
    closeUI();
    state = 'idle'; peer = null; peerInfo = null; muted = false; camOff = false;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  return { init: init, start: start, hangup: hangup, get state() { return state; } };
})();
