/* 音效：全部用 WebAudio 实时合成，不打包任何音频文件（省 3~8MB 体积）
 * 新增：出牌语音播报（说出牌型） + 循环背景音乐（程序化合成，无需音频文件）
 * 修复：App 切到后台时立即静音并挂起音频（此前后台仍在响）
 */
window.Sfx = (function () {
  var ctx = null, on = true, voiceOn = true, bgmOn = true;
  var bgmSrc = null, bgmGain = null, bgmBuf = null, bgmCtx = null;
  /* 后台状态：切后台 → 停 BGM + 挂起 AudioContext；回前台 → 恢复 */
  var hidden = false, wasPlaying = false;

  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
    if (ctx && ctx.state === 'suspended' && !hidden) ctx.resume();
    return ctx;
  }
  /* ---------- 切后台自动静音 ---------- */
  function toBackground() {
    if (hidden) return;
    hidden = true;
    wasPlaying = !!(bgmSrc && bgmOn && on);
    stopBgm();
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { }
    if (ctx && ctx.suspend) { try { ctx.suspend(); } catch (e) { } }
  }
  function toForeground() {
    if (!hidden) return;
    hidden = false;
    if (ctx && ctx.resume) { try { ctx.resume(); } catch (e) { } }
    if (wasPlaying && bgmOn && on) startBgm();
    wasPlaying = false;
  }
  function watchVisibility() {
    var fire = function () {
      // 三种信号任一为真即视为「在后台」
      var isHidden = document.hidden || document.visibilityState === 'hidden';
      if (isHidden) toBackground(); else toForeground();
    };
    document.addEventListener('visibilitychange', fire);
    // 安卓 WebView / iOS 上 visibilitychange 偶发不触发，用 pagehide/pagehow 与 blur/focus 兜底
    window.addEventListener('pagehide', toBackground);
    window.addEventListener('pageshow', toForeground);
    window.addEventListener('blur', toBackground);
    window.addEventListener('focus', toForeground);
    document.addEventListener('pause', toBackground, false);      // Cordova/Capacitor
    document.addEventListener('resume', toForeground, false);
  }
  if (document.addEventListener) watchVisibility();
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!on) return;
    var c = ac(); if (!c) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.22, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, vol, filterFreq, delay) {
    if (!on) return;
    var c = ac(); if (!c) return;
    var t0 = c.currentTime + (delay || 0);
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    var g = c.createGain(); g.gain.setValueAtTime(vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0);
  }

  /* 炸弹 / 王炸音效（独立函数，供 announce 内部复用） */
  function bombSfx() {
    duck(true); setTimeout(function () { duck(false); }, 700);
    noise(0.45, 0.5, 420); tone(90, 0.5, 'sawtooth', 0.3, 34);
    tone(150, 0.32, 'square', 0.14, 48, 0.04);
  }
  function rocketSfx() {
    duck(true); setTimeout(function () { duck(false); }, 900);
    noise(0.6, 0.4, 700); tone(1200, 0.5, 'sawtooth', 0.16, 120);
    [0, .08, .16, .26].forEach(function (d, i) { tone(700 + i * 180, 0.2, 'triangle', 0.13, 1400, d); });
  }

  /* ---------------- 出牌语音播报 ---------------- */
  var lastSpeak = 0;
  function speakText(txt) {
    if (!on || !voiceOn || !txt) return;
    try {
      if (!window.speechSynthesis) return;
      var now = Date.now();
      if (now - lastSpeak < 260) return;          // 防连续刷屏
      lastSpeak = now;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(txt);
      u.lang = 'zh-CN'; u.rate = 1.15; u.pitch = 1.02; u.volume = 0.95;
      var vs = window.speechSynthesis.getVoices() || [];
      for (var i = 0; i < vs.length; i++) {
        if (/zh|CN|Chinese/i.test(vs[i].lang || '') || /Chinese/i.test(vs[i].name || '')) { u.voice = vs[i]; break; }
      }
      window.speechSynthesis.speak(u);
    } catch (e) { }
  }
  /* 按牌型播放「音效 + 语音」 */
  function announce(info) {
    if (!on) return;
    var t = info && info.type;
    if (t === 'rocket') { rocketSfx(); speakText('王炸'); return; }
    if (t === 'bomb') { bombSfx(); speakText('炸弹'); return; }
    var name = (window.DDZ && DDZ.speak) ? DDZ.speak(info) : (info && info.name) || '';
    if (t === 'pass') { pass(); speakText('不要'); return; }
    // 不同牌型用不同音色，耳朵能分辨
    if (t === 'single') { tone(760, 0.09, 'triangle', 0.16, 980); }
    else if (t === 'pair') { tone(700, 0.08, 'triangle', 0.15, 900); tone(880, 0.09, 'triangle', 0.15, 1080, 0.07); }
    else if (t === 'triple') { [660, 780, 900].forEach(function (f, i) { tone(f, 0.09, 'triangle', 0.15, f * 1.2, i * 0.06); }); }
    else if (t === 'triple1' || t === 'triple2') { [640, 760, 880, 1000].forEach(function (f, i) { tone(f, 0.08, 'triangle', 0.14, null, i * 0.055); }); }
    else if (t === 'straight') { var n = Math.min(8, (info.len || 5)); for (var i = 0; i < n; i++) tone(520 + i * 70, 0.07, 'sine', 0.12, null, i * 0.045); }
    else if (t === 'dstraight') { for (var j = 0; j < 4; j++) { tone(560 + j * 90, 0.07, 'square', 0.09, null, j * 0.06); tone(560 + j * 90, 0.07, 'square', 0.09, null, j * 0.06 + 0.03); } }
    else if (t === 'plane' || t === 'plane1' || t === 'plane2') { tone(420, 0.28, 'sawtooth', 0.1, 1000); tone(660, 0.22, 'triangle', 0.1, 1200, 0.05); }
    else if (t === 'four2' || t === 'four2p') { [600, 700, 800, 900].forEach(function (f, i) { tone(f, 0.07, 'square', 0.1, null, i * 0.05); }); }
    else tone(720, 0.1, 'triangle', 0.14, 950);
    speakText(name);
  }

  /* ---------------- 背景音乐（程序化合成循环，无任何音频文件） ---------------- */
  /* 用 OfflineAudioContext 预渲染一段循环，再循环播放：省 CPU、不会跑调
   * 分两种场景：hall = 大厅（舒缓）；table = 牌桌（节奏更强，有棋牌房的感觉） */
  var SCENE = {
    hall:  { bpm: 104, vol: 0.17, kick: 0.26, hat: 0.045, mel: 0.11, bass: 0.14, arp: 0.045 },
    table: { bpm: 124, vol: 0.24, kick: 0.40, hat: 0.075, mel: 0.15, bass: 0.20, arp: 0.070 }
  };
  var scene = 'hall';
  var bgmBufs = {};

  function renderBgm(kind) {
    var cfg = SCENE[kind] || SCENE.hall;
    var SR = 22050, BPM = cfg.bpm, BEAT = 60 / BPM, BARS = 8, BEATS = BARS * 4;
    var len = Math.ceil(BEATS * BEAT * SR);
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) return null;
    var oc = new OC(1, len, SR);
    var master = oc.createGain(); master.gain.value = 0.5; master.connect(oc.destination);

    // 音高工具
    function hz(semi) { return 440 * Math.pow(2, (semi - 9) / 12); }
    function note(t, semi, dur, type, vol, wave) {
      var o = oc.createOscillator(), g = oc.createGain();
      o.type = type || 'triangle';
      o.frequency.setValueAtTime(hz(semi), t);
      var v = vol == null ? 0.14 : vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      var f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function bass(t, semi, dur) {
      var o = oc.createOscillator(), g = oc.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(hz(semi - 24), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(cfg.bass, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      var f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function hat(t, vol) {
      var n = Math.floor(SR * 0.045);
      var b = oc.createBuffer(1, n, SR), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      var s = oc.createBufferSource(); s.buffer = b;
      var f = oc.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
      var g = oc.createGain(); g.gain.value = vol == null ? cfg.hat : vol;
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t);
    }
    function kick(t) {
      var o = oc.createOscillator(), g = oc.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(cfg.kick, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.18);
    }

    // 轻快大调五声音阶循环（类似休闲棋牌 BGM）
    var ROOT = [0, 5, 7, 3];                     // 每小节根音（半音相对 A）
    var MEL = [                                   // [拍, 音级, 时值]
      [0, 12, 1], [1, 14, .5], [1.5, 12, .5], [2, 9, 1], [3, 7, 1],
      [4, 9, 1], [5, 12, .5], [5.5, 14, .5], [6, 16, 1], [7, 12, 1]
    ];
    for (var bar = 0; bar < BARS; bar++) {
      var bt = bar * 4 * BEAT;
      var rt = ROOT[bar % ROOT.length];
      // 鼓组
      kick(bt); kick(bt + 2 * BEAT);
      if (bar % 2 === 1) kick(bt + 3.5 * BEAT);
      if (kind === 'table') { kick(bt + 1 * BEAT); kick(bt + 2.5 * BEAT); if (bar % 4 === 3) kick(bt + 3.75 * BEAT); }
      for (var h = 0; h < 8; h++) hat(bt + h * BEAT / 2, h % 2 ? cfg.hat * 0.6 : cfg.hat);
      // 贝斯
      bass(bt, rt, BEAT * 1.6);
      bass(bt + 2 * BEAT, rt, BEAT * 1.6);
      if (bar % 4 === 3) bass(bt + 3 * BEAT, rt + 5, BEAT * 0.9);
      // 主旋律（双小节一段，交替变化避免单调）
      MEL.forEach(function (m, i) {
        var semi = m[1] + (bar % 4 >= 2 ? 0 : 0) + (bar >= 4 ? 0 : 0);
        if ((bar + i) % 8 === 7) semi += 5;
        note(bt + m[0] * BEAT, semi, m[2] * BEAT * 0.92, 'triangle', cfg.mel);
        note(bt + m[0] * BEAT, semi + 12, m[2] * BEAT * 0.8, 'sine', cfg.mel * 0.38);
      });
      // 琶音铺底
      for (var a = 0; a < 4; a++) {
        note(bt + a * BEAT + BEAT / 2, rt + a * 4 + 12, BEAT * 0.42, 'sine', cfg.arp);
      }
    }
    return oc.startRendering();
  }

  function startBgm() {
    if (!bgmOn || hidden) return;
    var c = ac(); if (!c) return;
    if (bgmSrc) return;
    if (bgmBufs[scene]) { bgmBuf = bgmBufs[scene]; return playBuf(); }
    try {
      var pr = renderBgm(scene);
      if (!pr || !pr.then) return;
      pr.then(function (buf) {
        bgmBufs[scene] = buf;
        if (!bgmOn || hidden) return;
        // 渲染期间场景可能已切换，以当前 scene 为准
        if (scene in bgmBufs) { bgmBuf = bgmBufs[scene]; playBuf(); }
      }).catch(function () { });
    } catch (e) { }
  }
  /* 切换场景（大厅 / 牌桌）：牌桌换更快节奏的曲子，让打牌有「牌房」氛围 */
  function setScene(s) {
    s = (s === 'table') ? 'table' : 'hall';
    if (s === scene && bgmSrc) return;
    scene = s;
    if (!bgmOn || hidden) return;
    stopBgm();
    bgmBuf = bgmBufs[scene] || null;
    startBgm();
  }
  function playBuf() {
    var c = ac(); if (!c || !bgmBuf) return;
    try {
      bgmSrc = c.createBufferSource();
      bgmSrc.buffer = bgmBuf; bgmSrc.loop = true;
      bgmGain = c.createGain();
      var target = (SCENE[scene] || SCENE.hall).vol;
      bgmGain.gain.value = 0;                       // 淡入
      bgmGain.gain.linearRampToValueAtTime(target, c.currentTime + 1.2);
      bgmSrc.connect(bgmGain); bgmGain.connect(c.destination);
      bgmSrc.start(0);
    } catch (e) { bgmSrc = null; }
  }
  function stopBgm() {
    if (bgmSrc) { try { bgmSrc.stop(); } catch (e) { } bgmSrc = null; }
    bgmGain = null;
  }
  function duck(on2) {                              // 出牌/炸弹时压低音乐
    if (bgmGain) {
      var target = (SCENE[scene] || SCENE.hall).vol;
      try { bgmGain.gain.value = on2 ? target * 0.3 : target; } catch (e) { }
    }
  }
  /* 出牌提示音：拍牌声 + 短促滑音，出牌/对手出牌都用它，耳朵能立刻分辨 */
  function cardDrop(strong) {
    noise(0.075, strong ? 0.42 : 0.3, 2400);
    tone(strong ? 300 : 420, 0.07, 'square', strong ? 0.16 : 0.1, strong ? 150 : 260);
    noise(0.05, 0.18, 900, 0.035);
  }

  var S = {
    unlock: function () { ac(); if (bgmOn) startBgm(); },
    set: function (v) {
      on = !!v;
      if (!on) { stopBgm(); try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { } }
      else if (bgmOn) startBgm();
    },
    setVoice: function (v) { voiceOn = !!v; if (!v) { try { speechSynthesis.cancel(); } catch (e) { } } },
    setBgm: function (v) { bgmOn = !!v; if (v) startBgm(); else stopBgm(); },
    setScene: setScene, cardDrop: cardDrop,
    bgm: startBgm, stopBgm: stopBgm, duck: duck,
    announce: announce, speak: speakText,
    tap: function () { tone(880, 0.06, 'triangle', 0.12); },
    deal: function () { noise(0.09, 0.16, 2600); },
    play: function () { cardDrop(false); tone(520, 0.09, 'triangle', 0.1, 900); },
    /* 轮到你出牌的提示音（三连上行，明确「该你了」） */
    yourTurn: function () {
      [660, 880, 1170].forEach(function (f, i) { tone(f, 0.1, 'triangle', 0.15, null, i * 0.075); });
    },
    pass: function () { tone(300, 0.13, 'sine', 0.13, 190); },
    warn: function () { tone(240, 0.16, 'square', 0.1, 170); },
    bomb: bombSfx,
    rocket: rocketSfx,
    win: function () {
      [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.3, 'triangle', 0.2, null, i * 0.1); });
      tone(1568, 0.6, 'sine', 0.12, null, 0.42);
    },
    lose: function () {
      [440, 392, 330, 262].forEach(function (f, i) { tone(f, 0.3, 'sine', 0.18, null, i * 0.11); });
    },
    msg: function () { tone(1180, 0.09, 'sine', 0.16); tone(1560, 0.11, 'sine', 0.14, null, 0.08); },
    rec: function () { tone(660, 0.12, 'sine', 0.15); },
    send: function () { tone(760, 0.08, 'triangle', 0.14, 1180); },
    tick: function () { tone(1400, 0.04, 'square', 0.07); },
    click: function () { tone(600, 0.05, 'triangle', 0.1); },
    alarm: function () { tone(880, 0.1, 'square', 0.12); tone(660, 0.14, 'square', 0.12, null, 0.12); }
  };
  return S;
})();
