/* 音效：全部用 WebAudio 实时合成，不打包任何音频文件（省 3~8MB 体积）
 * 新增：出牌语音播报（说出牌型） + 循环背景音乐（程序化合成，无需音频文件）
 * 修复：App 切到后台时立即静音并挂起音频（此前后台仍在响）
 */
window.Sfx = (function () {
  var ctx = null, on = true, voiceOn = true, bgmOn = true;
  var bgmSrc = null, bgmGain = null, bgmBuf = null, bgmCtx = null;
  /* 后台状态：切后台 → 停 BGM + 挂起 AudioContext；回前台 → 恢复 */
  var hidden = false, wasPlaying = false;

  /* 总线：所有音源先汇总到 busIn，经过「削高频 + 限幅」再输出。
     以前各音源直连 destination，多个音同时响会叠加削波 → 刺耳的杂音/爆音。 */
  var busIn = null, busComp = null, busTone = null;
  function buildBus(c) {
    if (busIn) return busIn;
    try {
      busIn = c.createGain(); busIn.gain.value = 1;
      // 轻微削掉 12kHz 以上的毛刺（手机扬声器上就是"沙沙"声）
      busTone = c.createBiquadFilter();
      busTone.type = 'lowpass'; busTone.frequency.value = 12000; busTone.Q.value = 0.7;
      // 限幅：防止叠加过载
      busComp = c.createDynamicsCompressor();
      busComp.threshold.value = -10; busComp.knee.value = 12;
      busComp.ratio.value = 6; busComp.attack.value = 0.004; busComp.release.value = 0.18;
      busIn.connect(busTone); busTone.connect(busComp); busComp.connect(c.destination);
    } catch (e) { busIn = null; }
    return busIn;
  }
  function out() {                       // 统一输出节点（没有总线时退回 destination）
    var c = ac();
    if (!c) return null;
    return buildBus(c) || c.destination;
  }
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
    /* 方波/锯齿波谐波很硬，直接播出就是"刺啦"声 —— 串一个低通柔化 */
    var dst = out();
    if ((type === 'square' || type === 'sawtooth') && c.createBiquadFilter) {
      try {
        var lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.max(900, Math.min(5200, (freq || 440) * 5));
        lp.Q.value = 0.4;
        g.connect(lp); lp.connect(dst || c.destination);
      } catch (e) { g.connect(dst || c.destination); }
    } else {
      g.connect(dst || c.destination);
    }
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
    /* 低通（原 filterFreq）后再串一个高通，去掉低频"轰轰"的浑浊，只留干净的打击感 */
    src.connect(f);
    try {
      var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380;
      f.connect(hp); hp.connect(g); g.connect(out() || c.destination);
    } catch (e) { f.connect(g); g.connect(out() || c.destination); }
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
  /* 语音播报增强：
     1) 语速放慢（原来 1.15 太快，中文 TTS 会吞字）
     2) 音量拉满
     3) 播报时把背景音乐压低（闪避），说完再恢复 —— 否则 BGM 盖住人声
     4) 排队播报，不自己 cancel 自己 */
  function duckBgm(low) {
    try {
      if (bgmGain && bgmCtx) bgmGain.gain.setTargetAtTime(low ? 0.06 : 0.16, bgmCtx.currentTime, 0.05);
    } catch (e) { }
  }
  function speakText(txt) {
    if (!on || !voiceOn || !txt) return;
    try {
      if (!window.speechSynthesis) return;
      var u = new SpeechSynthesisUtterance(String(txt));
      u.lang = 'zh-CN';
      u.rate = 0.92;         // 放慢，咬字清楚
      u.pitch = 1.0;
      u.volume = 1.0;        // 拉满
      var vs = window.speechSynthesis.getVoices() || [];
      var picked = null;
      for (var i = 0; i < vs.length; i++) {
        var l = String(vs[i].lang || ''), nm = String(vs[i].name || '');
        if (/^zh(-|_)?CN/i.test(l) || /Chinese|中文|普通话/i.test(nm)) { picked = vs[i]; break; }
      }
      if (!picked) for (var j = 0; j < vs.length; j++) {
        if (/zh/i.test(String(vs[j].lang || ''))) { picked = vs[j]; break; }
      }
      if (picked) u.voice = picked;
      duckBgm(true);
      u.onend = function () { duckBgm(false); };
      u.onerror = function () { duckBgm(false); };
      window.speechSynthesis.speak(u);
    } catch (e) { try { duckBgm(false); } catch (e2) { } }
  }
  /* 按牌型播放「音效 + 语音」 */
  /* 统一语音出口：音效响完 200ms 再说话，避免人声被音效盖掉 */
  function say(txt) {
    if (!txt) return;
    setTimeout(function () { speakText(txt); }, 200);
  }

  function announce(info) {
    if (!on) return;
    var t = info && info.type;
    /* 音效与语音错开 200ms：同时响的话音效会把人声盖掉，听着就是「嗡一下」 */
    var say = function (txt) { setTimeout(function () { speakText(txt); }, 200); };
    if (t === 'rocket') { rocketSfx(); say('王炸'); return; }
    if (t === 'bomb') { bombSfx(); say('炸弹'); return; }
    var name = (window.DDZ && DDZ.speak) ? DDZ.speak(info) : (info && info.name) || '';
    if (t === 'pass') { pass(); say('不要'); return; }
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
    say(name);
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

  /* ---------------- 实时节拍（BGM 兜底） ----------------
   * 有些安卓 WebView 不支持 OfflineAudioContext，或渲染 8 小节耗时太久，
   * 结果就是「打牌时完全没有背景音乐」。这里做一个不依赖离线渲染的
   * 实时循环：按拍子直接发声，任何环境都能响。 */
  var liveTimer = null, liveStep = 0, liveT0 = 0;
  function liveTick() {
    if (hidden || !bgmOn || !on) return;
    var cfg = SCENE[scene] || SCENE.hall;
    var s = liveStep % 8;                       // 一小节 8 个八分音符
    var D = duckOn ? 0.3 : 1;                   // 炸弹/出牌时压低
    // 底鼓
    if (s === 0 || s === 4 || (scene === 'table' && s === 6)) {
      tone(120, 0.14, 'sine', cfg.kick * 0.85 * D, 46);
    }
    // 踩镲
    if (s % 2 === 1) noise(0.032, cfg.hat * 1.35 * D, 6200);   // 踩镲收一点，7000Hz+高增益就是沙沙声
    // 贝斯
    if (s === 0 || s === 4) {
      var root = (s === 0) ? 55 : 62;
      tone(root, 0.22, 'triangle', cfg.bass * 0.45 * D, root);   // 锯齿波太硬，改三角波
    }
    // 主旋律（五声音阶，随机取一个音，不会跑调）
    var MEL5 = [523, 587, 659, 784, 880, 1046];
    if (s === 0 || s === 2 || s === 5) {
      var f = MEL5[(liveStep * 3 + s) % MEL5.length];
      tone(f, 0.16, 'triangle', cfg.mel * 0.9 * D);
    }
    liveStep++;
  }
  function startLiveBgm() {
    if (liveTimer) return;
    var cfg = SCENE[scene] || SCENE.hall;
    var beat = 60000 / cfg.bpm / 2;             // 八分音符间隔
    liveStep = 0;
    liveTimer = setInterval(liveTick, beat);
  }
  function stopLiveBgm() {
    if (liveTimer) { try { clearInterval(liveTimer); } catch (e) { } liveTimer = null; }
  }

  /* 渲染超时保护：离线渲染超过 3.5 秒还没完成，就直接上实时循环，
     避免用户等半天都没声音（手机上很容易踩到）。 */
  var renderPending = {};
  function startBgm() {
    if (!bgmOn || hidden) return;
    var c = ac(); if (!c) return;
    if (bgmSrc || liveTimer) return;
    if (bgmBufs[scene]) { bgmBuf = bgmBufs[scene]; return playBuf(); }
    /* 总闸：只要主音效关了 / 在后台，任何途径都不许起音乐 */
    if (!on || !bgmOn || hidden) { stopBgm(); return; }
    /* 先起实时循环，保证立刻有声音；离线渲染完成后再换成更细腻的版本 */
    startLiveBgm();
    var myScene = scene;
    try {
      var pr = renderBgm(scene);
      if (!pr || !pr.then) return;              // 不支持离线渲染 → 一直用实时循环
      var done = false;
      pr.then(function (buf) {
        done = true;
        bgmBufs[myScene] = buf;
        if (!bgmOn || hidden) return;
        if (scene !== myScene) return;          // 场景已切换，交给下次
        stopLiveBgm();
        bgmBuf = buf;
        if (!bgmSrc) playBuf();
      }).catch(function () { /* 渲染失败 → 保持实时循环 */ });
      setTimeout(function () { if (!done && scene === myScene) { /* 继续用实时循环 */ } }, 3500);
    } catch (e) { }
  }
  /* 切换场景（大厅 / 牌桌）：牌桌换更快节奏的曲子，让打牌有「牌房」氛围 */
  function setScene(s) {
    s = (s === 'table') ? 'table' : 'hall';
    if (s === scene && bgmSrc) return;
    scene = s;
    /* 主音效开关关掉后，切换界面绝不能再起音乐 —— 原来这里漏了 !on 判断 */
    if (!on || !bgmOn || hidden) { stopBgm(); return; }
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
    stopLiveBgm();
    bgmGain = null;
  }
  var duckOn = false;
  function duck(on2) {                              // 出牌/炸弹时压低音乐
    duckOn = !!on2;
    if (bgmGain) {
      var target = (SCENE[scene] || SCENE.hall).vol;
      try { bgmGain.gain.value = duckOn ? target * 0.3 : target; } catch (e) { }
    }
  }
  /* 出牌提示音：拍牌声 + 短促滑音，出牌/对手出牌都用它，耳朵能立刻分辨 */
  function cardDrop(strong) {
    noise(0.075, strong ? 0.42 : 0.3, 2400);
    tone(strong ? 300 : 420, 0.07, 'square', strong ? 0.16 : 0.1, strong ? 150 : 260);
    noise(0.05, 0.18, 900, 0.035);
  }

  var S = {
    unlock: function () { ac(); if (on && bgmOn && !hidden) startBgm(); },
    set: function (v) {
      on = !!v;
      if (!on) { stopBgm(); try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { } }
      else if (bgmOn && !hidden) startBgm();
    },
    setVoice: function (v) { voiceOn = !!v; if (!v) { try { speechSynthesis.cancel(); } catch (e) { } } },
    setBgm: function (v) { bgmOn = !!v; if (v && on && !hidden) startBgm(); else stopBgm(); },
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
    /* 叫分音效：叫分 / 抢地主 / 不叫 各一个，耳朵能立刻分辨 */
    bid: function (n, isGrab) {
      if (n === 0) { tone(260, 0.16, 'sine', 0.14, 190); say('不叫'); return; }   // 不叫：下行
      var base = 520 + (n || 1) * 90;                                 // 分数越高音越高
      [0, 1].forEach(function (i) { tone(base + i * 130, 0.11, 'triangle', 0.16, null, i * 0.08); });
      if (n >= 3) tone(base + 300, 0.18, 'square', 0.1, null, 0.17);  // 3 分额外强调
      say(isGrab ? '抢地主' : ((n || 1) + '分'));
    },
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
    alarm: function () { tone(880, 0.1, 'square', 0.12); tone(660, 0.14, 'square', 0.12, null, 0.12); },
    /* 供原生调用：App 真正退到后台时立刻静音（比 visibilitychange 可靠得多） */
    pause: function () { toBackground(); },
    resume: function () { toForeground(); }
  };

  /* ---------- 全局音频解锁 ----------
   * 安卓/iOS 都要求「用户手势之后」才能播声音。原来只在点登录那一下解锁，
   * 之后如果 AudioContext 被系统挂起（退后台、来电），就再也不响了。
   * 这里在任意一次触摸/点击时都尝试恢复，第一次成功之后就不再重复。 */
  var unlocked = false;
  function tryUnlock() {
    try {
      var c = ac();
      if (c && c.state === 'suspended' && !hidden) c.resume();
      if (!unlocked) { unlocked = true; if (bgmOn && on) startBgm(); }
    } catch (e) { }
  }
  try {
    ['touchstart', 'mousedown', 'pointerdown'].forEach(function (ev) {
      document.addEventListener(ev, tryUnlock, { passive: true });
    });
    document.addEventListener('click', tryUnlock, true);
  } catch (e) { }

  /* 原生钩子：MainActivity 的 onPause/onResume 会调用这两个全局函数。
     这是「切到后台还在响」最可靠的解法 —— WebView 里的
     visibilitychange 在有前台服务保活时经常不触发。 */
  try {
    window.__ddzPause = function () { toBackground(); };
    window.__ddzResume = function () { toForeground(); };
  } catch (e) { }
  return S;
})();
