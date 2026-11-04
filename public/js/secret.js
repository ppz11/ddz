/* ===================== 好友空间 =====================
 * 入口：仅「我的」页面连击 UID 5 次（无任何图标 / 按钮 / 菜单入口）
 * 暗号：4 位数字，首次进入时用系统数字键盘设置
 *       之后触发只弹出系统输入法数字键盘，界面无任何 PIN 输入控件，输满 4 位自动进入
 * 支持文字、图片、视频、文件、语音、表情，与主聊天列表完全隔离
 * 「隐私伪装模式」开关只出现在这里，不在「我的」页面
 * 退出：摇一摇 / 锁屏 / 切后台 —— 均在同一次事件内同步收起，解锁后直接进入游戏主界面
 * ================================================== */
window.Secret = (function () {
  var root = null, rooms = [], curRid = null, msgs = [], members = [], pinBuf = '', mode = 'check';
  var tapCount = 0, tapT = null, inp = null, typing = false;
  var lastShake = 0, shakeAcc = { x: 0, y: 0, z: 0 }, motionOn = false;
  var homeSafe = false;
  var rooms = [], peeking = false;   // 是否已经安全回到主界面
  var curOther = null, curMe = null, personList = [], myUids = [];
  var locOn = false, locLast = null, myPid = null;
  /* 多选删除：'room' = 选会话，'msg' = 选消息 */
  var sSelMode = null, sSelRooms = new Set(), sSelMsgs = new Set();
  /* 冷启动先读本地缓存，避免界面先闪一下「3」；真值以服务端查询为准 */
  var botLevel = (function () {
    try { return +localStorage.getItem('ddz_botlv') || 3; } catch (e) { return 3; }
  })();
  var LVNAME = { 1: '新手', 2: '普通', 3: '熟练', 4: '高手', 5: '大师' };

  function init() {
    /* 冷启动主动问服务端当前难度 —— 以前只有点按钮才发，重开永远显示本地初值 3 */
    try { Net.send({ t: 'bot:level' }); } catch (e) {}
    /* 进入隐私空间：连击「我的」页 UID / 昵称 5 次（无图标、无按钮，外面看不出来） */
    bindTap(document.getElementById('me-uid'), 5, 900);
    bindTap(document.getElementById('me-nick'), 5, 900);
    /* 「查看对方位置」的开关不再放在「我的」页 —— 那里和进入隐私空间的连击
       是同一个位置（5 次 vs 8 次），容易因为多按几下就误开。
       改到隐私空间左上角「好友空间」这几个字上，连击 8 次才开。 */

    /* 只刷新会话列表，不弹暗号界面（secret:status 会触发输入暗号，不能用于刷新） */
    Net.on('bot:level', function (m) {
      botLevel = m.level || 3;
      try { localStorage.setItem('ddz_botlv', String(botLevel)); } catch (e) {}
      var tip = document.getElementById('s-botlv-tip');
      if (tip) tip.textContent = '当前：' + (LVNAME[botLevel] || botLevel) + ' · 服务器全局生效';
      document.querySelectorAll('.blv').forEach(function (x) { x.classList.toggle('on', +x.dataset.lv === botLevel); });
    });
    /* 对方上线时服务端会推 presence —— 私密列表不像主聊天会自动重画，
       这里收到就静默刷一次，对方上线后自动出现，不用手动刷新。 */
    Net.on('presence', function () {
      if (!document.getElementById('secret-root')) return;
      try { Net.send({ t: 'secret:rooms' }); } catch (e) { }
    });
    Net.on('secret:rooms', function (m) {
      rooms = m.list || [];
      if (pending && !curRid && rooms.length) {
        curRid = rooms[0].rid || rooms[0];
        Net.send({ t: 'secret:send', rid: curRid, msg: pending });
        pending = null; App.toast('已发送');
      }
      if (pending && !curRid) { pending = null; App.toast('会话已失效，请重新进入'); }
      if (root && !typing) renderRooms(m.rooms || []);
    });
    /* v40：好友空间会话同样即时刷已读，不用退出重进 */
    Net.on('chat:read', function (m) {
      var ids = ((m && m.ids) || []).map(String);
      if (!ids.length || !document.getElementById('secret-root')) return;
      var ch = false;
      msgs.forEach(function (x) { if (ids.indexOf(String(x.id)) >= 0 && !x.read) { x.read = true; ch = true; } });
      if (ch && typeof renderSMsgs === 'function') renderSMsgs();
    });
    Net.on('friend:list', function (m) {
      if (m.via !== 'secret') return;
      paintSFriends(m.list || [], 'list');
    });
    Net.on('friend:search', function (m) {
      if (!document.getElementById('sfriend-box')) return;
      paintSFriends(m.list || [], 'search');
    });
    Net.on('secret:status', function (m) {
      // peek：只刷新聊天页入口，不弹出暗号界面
      if (peeking) { peeking = false; rooms = m.rooms || []; return; }
      if (m.has) startTyping('check');
      else openSetPin();
    });
    Net.on('secret:ok', function (m) {
      try { var rr=(m.rooms||[])[0]; window.__lastSecretOk = rr && rr.other ? rr.other.pid : null; } catch(e){}
      typing = false; blurInput();
      if (mode === 'set') App.toast('暗号已设置');
      openShell();
      if (m.rooms) renderRooms(m.rooms);
      try { if (window.__ddzStartMotion) window.__ddzStartMotion(); } catch (e) { }
    });
    Net.on('secret:bad', function () {
      App.toast(ADS.randomFeed());
      Sfx.warn();
      typing = false; blurInput();
    });
    Net.on('secret:msgs', function (m) {
      msgs = m.list || []; curRid = m.rid;
      curMe = m.me || curMe; curOther = m.other || curOther;
      if (m.myUids) myUids = m.myUids.map(String);
      Net.send({ t: 'secret:presence', inSecret: true });
      renderThread();
    });
    Net.on('secret:read', function (m) {
      var ids = ((m && m.ids) || []).map(String);
      if (!ids.length) return;
      var ch = false;
      msgs.forEach(function (x) { if (ids.indexOf(String(x.id)) >= 0) { x.read = true; ch = true; } });
      if (ch) renderSMsgs();
    });
    Net.on('secret:persons', function (m) {
      personList = m.list || []; curMe = m.me || curMe;
      if (m.myUids) myUids = m.myUids.map(String);
      renderPick();
    });
    Net.on('loc:state', function (m) {
      locOn = !!m.on; locLast = m.last || null;
      if (locOn) reportLoc();          // 已授权 → 本次打开自动上报一次
      var d = document.getElementById('s-loc');
      if (d) d.classList.toggle('on', locOn);
      if (document.getElementById('s-body')) renderRooms(rooms);
      paintOwnerPanel();
    });
    Net.on('owner:presence', function (m) {
      opList = m.ok ? ((m.list || []).slice().sort(function (a, b) { return Math.max(b.login || 0, b.offline || 0) - Math.max(a.login || 0, a.offline || 0); })) : [];
      if (!m.ok) App.toast(m.err || '读取失败');
      paintOwnerPanel();
    });
    Net.on('loc:res', function (m) { showLoc(m); });
    Net.on('secret:delmsgs', function (m) {
      if (m.rid !== curRid) return;
      var ids = (m.ids || []).map(String);
      msgs = msgs.filter(function (x) { return ids.indexOf(String(x.id)) < 0; });
      sSelMsgs.clear();
      renderSMsgs();
    });
    Net.on('secret:msg', function (m) {
      /* 好友空间的消息同样在通知栏推营销广告，绝不显示真实内容 */
      try { if (m.msg && !isMineMsg(m.msg)) Notifier.notifyIfHidden('smsg:' + (m.msg.id || (m.rid + m.msg.ts))); } catch (e) { }
      if (m.rid === curRid) {
        /* 同一条只显示一次：重连/多端在线会重复推，自己发出去的也会被回推一次 */
        var nm = m.msg || {}, dup = false;
        for (var i = msgs.length - 1; i >= 0 && i >= msgs.length - 12; i--) {
          var x = msgs[i]; if (!x) continue;
          if ((nm.id && String(x.id) === String(nm.id)) ||
              (x.ts === nm.ts && x.kind === nm.kind && String(x.from) === String(nm.from))) { dup = true; break; }
        }
        if (!dup) { msgs.push(nm); renderThread(); }
        Sfx.msg();
      }
      else Sfx.msg();
    });
    Net.on('secret:invited', function (m) { Notifier.notifyIfHidden('invite:' + (m.rid || Date.now())); });
    bindPanic();
  }

  /* ---------- 交互保护（防误判切后台） ---------- */
  var _iT = 0, _iLT = 0;
  function markInteract() { _iT = Date.now(); }
  function markInteractLong() { _iLT = Date.now(); _iT = Date.now(); }
  /* 系统文件选择器标记：告诉原生层「这不是切后台，别收起好友空间」。
     没有它，选图时 Activity 走 onPause → 好友空间被收起 → curRid 丢失
     → 回来点发送就报「会话已失效，请重新进入」。 */
  function setPicking(v) {
    try { if (window.DDZNative && DDZNative.setPicking) DDZNative.setPicking(!!v); } catch (e) { }
  }
  function pickSys(id) {
    var el = document.getElementById(id); if (!el) return;
    markInteractLong(); setPicking(true);
    try { el.click(); } catch (e) { setPicking(false); }
    clearTimeout(pickSys._t);
    pickSys._t = setTimeout(function () { setPicking(false); }, 40000);
  }
  function interactBusy() {
    var now = Date.now();
    return (now - _iT) < 2500 || (now - _iLT) < 30000;
  }

  /* ---------- 紧急退出：锁屏 / 切后台 / 摇一摇 ----------
   * 关键：所有收起动作都在事件回调里「同步」完成，不做任何动画/延时，
   * 这样系统截屏与解锁后看到的画面已经是游戏主界面，不会出现收起过程。 */
  function bindPanic() {
    /* 关键修复：点「发送 / 选照片 / 选视频」时，软键盘或系统文件选择器
       弹出会让窗口失焦(blur)或短暂 hidden —— 原来这里会立刻触发紧急退出，
       表现就是「一点发送就直接退出应用」。
       对策：1) 去掉 blur 直接退出的触发；
             2) 输入框获得焦点、或刚点过文件选择时，短时间内不触发紧急退出。 */
    /* 交互保护：短交互(打字/点按钮) 2.5s；长操作(系统文件选择器/录音) 30s。
       选图片/视频会打开系统文件选择器，App 会短暂 hidden，
       若保护窗口太短就会被误判成「切后台」→ 触发紧急退出(甚至最小化)，
       表现就是「一点发送/选图就直接退出应用」。 */
    try {
      document.addEventListener('focusin', function (e) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) markInteract();
      }, true);
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.tagName === 'INPUT' && t.type === 'file') markInteractLong();
        else markInteract();
      }, true);
      document.addEventListener('touchstart', markInteract, { passive: true });
    } catch (e) { }

    function onHide(force) {
      if (!root) return;
      if (!force && interactBusy()) return;      // 正在输入/选文件 → 不退出
      // 1) 同步隐藏：不改 DOM 结构，只置 visibility，确保本帧内渲染结果已是主界面
      try { root.style.visibility = 'hidden'; root.style.display = 'none'; } catch (e) { }
      // 2) 同步移除（含所有可能残留的节点）
      close();
      // 3) 同步回到主界面
      try { App.go('home'); } catch (e) { }
      homeSafe = true;
      /* 4) 不再调用 minimizeApp：
         一旦被误触发（文件选择器/软键盘导致短暂 hidden），它会把整个 App
         推到后台 —— 用户看到的就是「一点发送就退出应用」。
         回到主界面 App.go('home') 已经足够，不需要再把 App 最小化。 */
    }
    function onShow() {
      /* 解锁 / 切回前台：确保是主界面，避免看到「好友空间 → 主界面」的收起过程。
         但有一个例外必须放过：选图片/选视频会打开系统文件选择器，
         App 会短暂 hidden 再回来 —— 这时若无条件收起，好友空间被关掉、
         curRid 丢失，随后点发送就会报「会话不存在」并退回主界面。
         所以：还在选文件/输入的保护窗口内，就不收起。 */
      if (interactBusy()) { homeSafe = false; return; }
      if (root) {
        try { root.style.display = 'none'; root.style.visibility = 'hidden'; } catch (e) { }
        close();
        try { App.go('home'); } catch (e) { }
      }
      homeSafe = false;
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') onHide();
      else onShow();
    });
    /* 不再监听 blur 触发退出：软键盘/文件选择器都会导致 blur */
    window.addEventListener('focus', onShow);
    // 部分 WebView 只派发 freeze / beforeunload，这里一并兜住
    /* 注意：下面这些事件都会把「事件对象」作为第一个参数传进来。
       如果直接写 addEventListener('pause', onHide)，事件对象会被当成
       onHide(force) 的 force 参数 —— 对象是 truthy → 强制退出、绕过保护，
       表现就是「一点发送 / 选照片就退出应用」。必须包一层再调用。 */
    window.addEventListener('freeze', function () { onHide(); });
    window.addEventListener('beforeunload', function () { onHide(); });
    window.addEventListener('pagehide', function () { onHide(); });
    try {
      var AP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (AP && AP.addListener) {
        AP.addListener('appStateChange', function (st) { if (!st || !st.isActive) onHide(); else onShow(); });
        AP.addListener('pause', function () { onHide(); });
        AP.addListener('resume', function () { onShow(); });
      }
    } catch (e) { }

    // 摇一摇：立即回到游戏主界面
    function onMotion(e) {
      if (!root) return;
      var a = e.accelerationIncludingGravity;
      if (!a) return;
      var ax = a.x || 0, ay = a.y || 0, az = a.z || 0;
      if (ax == null && ay == null && az == null) return;
      var dx = Math.abs(ax - shakeAcc.x), dy = Math.abs(ay - shakeAcc.y), dz = Math.abs(az - shakeAcc.z);
      shakeAcc = { x: ax, y: ay, z: az };
      var force = dx + dy + dz;
      var now = Date.now();
      // 阈值放宽到 16，普通幅度摇一下就能触发
      if (force > 16 && now - lastShake > 700) { lastShake = now; panic(); }
    }
    function startMotion() {
      if (motionOn) return;
      if (typeof DeviceMotionEvent === 'undefined') return;
      var need = typeof DeviceMotionEvent.requestPermission === 'function';
      if (need) {
        try {
          DeviceMotionEvent.requestPermission().then(function (r) {
            if (r === 'granted') { window.addEventListener('devicemotion', onMotion); motionOn = true; }
          }).catch(function () { });
        } catch (e) { }
      } else {
        try { window.addEventListener('devicemotion', onMotion); motionOn = true; } catch (e) { }
      }
    }
    // 打开时再试一次（iOS 需要用户手势），并常驻监听
    window.__ddzStartMotion = startMotion;
    startMotion();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') startMotion();
    });
    /* 兜底：任何一次回到可见，只要好友空间还开着就收掉 */
    window.addEventListener('pageshow', function () {
      if (root) { try { root.style.display = 'none'; } catch (e) { } close(); try { App.go('home'); } catch (e) { } }
    });
    // 桌面端兜底：连按 Esc 也能退出
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') panic(); });
  }

  function panic() {
    if (!root) return;
    try { root.style.display = 'none'; root.style.visibility = 'hidden'; } catch (e) { }
    close();
    try { App.go('home'); } catch (e) { }
    homeSafe = true;
    App.vibeDo(12);
  }

  /* ---------- 无操作 60 秒自动退出到主界面 ---------- */
  var IDLE_MAX = 60, idleLeft = 0, idleTick = null;
  function startIdle() {
    stopIdle();
    idleLeft = IDLE_MAX; paintIdle();
    idleTick = setInterval(function () {
      if (!root) { stopIdle(); return; }
      idleLeft--;
      if (idleLeft <= 0) { stopIdle(); App.toast('长时间无操作，已退出'); panic(); return; }
      paintIdle();
    }, 1000);
  }
  function stopIdle() { clearInterval(idleTick); idleTick = null; }
  function resetIdle() { if (root) idleLeft = IDLE_MAX; }
  function paintIdle() {
    var e = document.getElementById('s-idle');
    if (e) { e.textContent = idleLeft; e.classList.toggle('warn', idleLeft <= 10); }
  }
  function bindIdle() {
    if (!root) return;
    ['touchstart', 'mousedown', 'keydown', 'input', 'click', 'wheel'].forEach(function (ev) {
      root.addEventListener(ev, resetIdle, { passive: true });
    });
  }

  function bindTap(el, n, gap, fn) {
    if (!el) return;
    var c = 0, t = null;
    el.addEventListener('click', function () {
      c++; clearTimeout(t);
      t = setTimeout(function () { c = 0; }, gap);
      if (c >= n) { c = 0; clearTimeout(t); (fn || enter)(); }
    });
  }

  function enter() {
    mode = 'check';
    pinBuf = '';
    Net.send({ t: 'secret:status' });
  }

  function openShell() {
    try { Net.send({ t: 'bot:level' }); } catch (e) {}
    if (root) { root.style.display = ''; root.style.visibility = ''; startIdle(); return; }
    root = document.createElement('div');
    root.className = 'secret'; root.id = 'secret-root';
    // 背景与游戏主界面完全一致（同一张牌桌绿呢），从外面看不出区别
    root.innerHTML = '<div class="felt"></div>' +
      '<div class="shead"><span style="font-size:16px">🔒</span><div class="t">好 友 空 间</div>' +
      '<div class="sp"></div><span class="sidle" id="s-idle">60</span>' +
      '<span class="dotloc' + (locOn ? ' on' : '') + '" id="s-loc" title="位置">◉</span>' +
      '<div class="srefresh" id="s-refresh" title="刷新">🔄</div>' +
      '<div class="x" id="s-x">✕</div></div><div class="body" id="s-body"></div>' +
      '<div class="tagline">本空间内容不出现在主聊天列表 · 摇一摇 / 切后台 立即回到主界面</div>';
    document.getElementById('app').appendChild(root);
    bindLocDot();
    /* 本人专属隐藏开关：连击左上角「好友空间」标题 8 次 → 口令开启位置查看。
       看不到任何按钮，别人装的 App 在任何界面都发现不了。 */
    var ttl = root.querySelector('.shead .t');
    if (ttl) bindTap(ttl, 8, 1600, function () {
      /* v41：口令通过后打开「位置 + 登录/离线记录」管理面板 */
      if (!App.isOwner()) { App.askOwner(function () { openOwnerPanel(); }); return; }
      openOwnerPanel();
    });
    root.querySelector('#s-x').onclick = function () { close(); try { App.go('home'); } catch (e) { } };
    /* 刷新：重新拉取私密会话列表（对方上线后自动显示，也可手动刷一次） */
    var srf = root.querySelector('#s-refresh');
    if (srf) srf.onclick = function () {
      try { peeking = true; Net.send({ t: 'secret:status' }); } catch (e) { }
      Net.send({ t: 'secret:rooms' });
      App.toast('已刷新');
    };
    Sfx.alarm();
    // 进入私密空间即注册返回手势：左滑 / 右滑直接退出
    Nav.push(function () { close(); try { App.go('home'); } catch (e) { } }, 'secret');
    bindIdle(); startIdle();
    try { if (window.__ddzStartMotion) window.__ddzStartMotion(); } catch (e) { }
  }
  function close() {
    stopIdle();
    exitSSel();
    closeEmoji();
    try { Nav.drop('secret'); } catch (e) { }
    // 连同可能残留的同名节点一起清掉，避免解锁后还看到私密界面
    try {
      var all = document.querySelectorAll('.secret');
      for (var i = 0; i < all.length; i++) if (all[i] !== root) all[i].remove();
    } catch (e) { }
    if (root) { root.remove(); root = null; curRid = null; }
    pinBuf = ''; typing = false; blurInput();
  }

  /* ---------- 系统数字键盘输入 ---------- */
  function ensureInput() {
    if (inp) return inp;
    inp = document.createElement('input');
    inp.type = 'text';
    inp.setAttribute('inputmode', 'numeric');
    inp.setAttribute('pattern', '[0-9]*');
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('autocorrect', 'off');
    inp.setAttribute('aria-hidden', 'true');
    inp.id = 'pinpad';
    inp.maxLength = 4;
    document.body.appendChild(inp);
    inp.addEventListener('input', function () {
      var v = (inp.value || '').replace(/\D/g, '').slice(0, 4);
      inp.value = v;
      paintDots();
      if (v.length === 4) {
        pinBuf = v;
        inp.value = '';
        setTimeout(function () { submit(); }, 90);
      }
    });
    inp.addEventListener('blur', function () {
      setTimeout(function () {
        if (typing && document.activeElement !== inp) { typing = false; pinBuf = ''; paintDots(); }
      }, 260);
    });
    return inp;
  }
  function startTyping(m) {
    mode = m || 'check';
    pinBuf = '';
    typing = true;
    paintDots();
    var el = ensureInput();
    el.value = '';
    setTimeout(function () { try { el.focus(); } catch (e) { } }, 60);
    if (!isMobile()) setTimeout(function () { try { el.focus(); } catch (e) { } }, 300);
  }
  function blurInput() { if (inp) { try { inp.blur(); inp.value = ''; } catch (e) { } } paintDots(); }
  function isMobile() { return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || ''); }

  function openSetPin() {
    mode = 'set';
    openShell();
    var b = document.getElementById('s-body'); if (!b) return;
    b.innerHTML = '<div style="text-align:center;padding:22px 10px 8px;color:#8b7fd4;font-size:13px">首次进入好友空间，请设置 4 位暗号</div>' +
      '<div class="dots" id="s-dots"><i></i><i></i><i></i><i></i></div>' +
      '<div style="text-align:center;color:#5c6b66;font-size:11px;margin-top:8px">请只使用数字</div>' +
      '<div style="padding:16px 40px"><button class="btn ghost" id="s-cancel">取消</button></div>';
    b.querySelector('#s-cancel').onclick = function () { close(); };
    startTyping('set');
  }

  function paintDots() {
    var d = document.getElementById('s-dots'); if (!d) return;
    d.querySelectorAll('i').forEach(function (i, n) { i.classList.toggle('on', n < pinBuf.length); });
  }
  function submit() {
    if (mode === 'set') Net.send({ t: 'secret:setpin', pin: pinBuf });
    else Net.send({ t: 'secret:unlock', pin: pinBuf });
    pinBuf = '';
  }

  /* ---------- 会话列表（含隐私伪装开关） ---------- */
  /* ---------------- 隐私空间好友 ----------------
   * 与主界面好友完全隔离：主界面看不到这里的好友，这里也看不到主界面的。 */
  function openSFriends() {
    Net.send({ t: 'friend:list', via: 'secret' });
    var box = document.createElement('div');
    box.className = 'modal'; box.id = 'sfriend-box';
    /* 跟主界面好友一致：一行紧凑的添加条 + 下面的好友列表，同一个弹窗内搞定 */
    box.innerHTML = '<div class="box frbox" style="max-width:340px">' +
      '<h3>隐私好友</h3>' +
      '<div class="fr-addrow">' +
      '<input id="sfr-q" placeholder="输入 UID 或昵称" inputmode="text" autocomplete="off">' +
      '<button class="btn ghost" id="sfr-paste" style="flex:0 0 44px;padding:0">📋</button>' +
      '<button class="btn jade" id="sfr-add">添加</button></div>' +
      '<div class="fr-list" id="sfr-list"><div class="fr-empty">加载中…</div></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn ghost" id="sfr-close">关闭</button></div></div>';
    document.body.appendChild(box);
    box.querySelector('#sfr-close').onclick = function () { box.remove(); };
    /* v40：粘贴 UID。body 上的 user-select:none 会让 Android WebView 连输入框
       一起禁掉长按菜单，CSS 已放开；这里再给一个显式按钮兜底（clipboard API
       在非 https 下不可用，失败就引导长按）。 */
    var pb = box.querySelector('#sfr-paste');
    if (pb) pb.onclick = function () {
      var inp = box.querySelector('#sfr-q');
      var fill = function (t) {
        if (t && t.trim()) { inp.value = t.trim(); inp.focus(); App.toast('已粘贴'); }
        else App.toast('剪贴板是空的');
      };
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(fill).catch(function () {
            App.toast('请长按输入框选择「粘贴」'); inp.focus();
          });
        } else { App.toast('请长按输入框选择「粘贴」'); inp.focus(); }
      } catch (e) { App.toast('请长按输入框选择「粘贴」'); inp.focus(); }
    };
    box.querySelector('#sfr-add').onclick = function () {
      var q = (box.querySelector('#sfr-q').value || '').trim();
      if (!q) { App.toast('请输入 UID 或昵称'); return; }
      Net.send({ t: 'friend:add', via: 'secret', q: q });
      box.querySelector('#sfr-q').value = '';
    };
    box.onclick = function (e) { if (e.target === box) box.remove(); };
  }

  function paintSFriends(list, mode) {
    var box = document.getElementById('sfriend-box'); if (!box) return;
    var el = box.querySelector('#sfr-list'); if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = '<div class="fr-empty">' + (mode === 'search' ? '没找到这个玩家' : '还没有隐私好友') + '</div>';
      return;
    }
    el.innerHTML = list.map(function (f) {
      return '<div class="fr-item' + (f.online ? '' : ' off') + '" data-pid="' + f.pid + '"' +
        (mode === 'search' ? ' data-add="1"' : '') + '>' +
        '<div class="a">' + Avatar.svg(f.avatar, 36) + '</div>' +
        '<div class="m"><div class="n">' + esc(f.nick || '好友') + '</div>' +
        '<div class="u">' + esc(f.uid || f.pid) + '</div></div>' +
        '<span class="st">' + (f.online ? '在线' : '离线') + '</span>' +
        (mode === 'search' ? '<button class="del" data-act="add">添加</button>'
                           : '<button class="del" data-act="del">删除</button>') +
        '</div>';
    }).join('');
    el.querySelectorAll('.fr-item').forEach(function (it) {
      var pid = it.dataset.pid;
      var b = it.querySelector('[data-act]');
      if (b) b.onclick = function (e) {
        e.stopPropagation();
        if (b.dataset.act === 'add') Net.send({ t: 'friend:add', via: 'secret', pid: pid });
        else App.confirm('移除隐私好友？', '仅从隐私好友列表移除', function () {
          Net.send({ t: 'friend:del', via: 'secret', pid: pid });
        });
      };
      it.onclick = function () {
        if (it.dataset.add) return;
        box.remove();
        try { Net.send({ t: 'secret:open', pid: pid }); } catch (e) { }
        App.toast('已在私密会话列表中');
      };
    });
  }
  function ridOfMe(pid) {
    var me = '';
    try { me = (App.me() && (App.me().pid || App.me().uid)) || ''; } catch (e) { }
    return 'sk_' + [String(me), String(pid)].sort().join('_');
  }

  function renderRooms(list) {
    rooms = list || [];
    var b = document.getElementById('s-body'); if (!b) return;
    var head =
      /* 机器人难度：设完在服务端生效，所有人面对的机器人水平一致 */
      '<div class="srow">' +
      '<div><div style="font-size:13px">机器人难度</div>' +
      '<div style="font-size:10px;color:#5c6b66;margin-top:2px" id="s-botlv-tip">当前：' +
      (LVNAME[botLevel] || '熟练') + ' · 服务器全局生效</div></div>' +
      '<div style="display:flex;gap:4px">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button class="blv' + (n === botLevel ? ' on' : '') + '" data-lv="' + n + '">' + n + '</button>';
      }).join('') + '</div></div>' +
      '<div class="srow">' +
      '<div><div style="font-size:13px">隐私伪装模式</div>' +
      '<div style="font-size:10px;color:#5c6b66;margin-top:2px">开启后通知栏、会话列表、会话内全部显示「邀请你开局」（含文字/图片/视频/文件/表情/语音）</div></div>' +
      '<button class="sw' + (App.disguise() ? ' on' : '') + '" id="s-disguise"><i></i></button></div>' +
      /* 收藏入口只在好友空间，主界面任何地方都没有 */
      '<div class="slist-hd"><span>私密会话</span>' +
      '<button id="s-fav">⭐ 收藏</button>' +
      '<button id="s-friends">👥 好友</button>' +
      '<button id="s-manage">管理</button></div>';
    if (!rooms.length) {
      b.innerHTML = head +
        '<div style="text-align:center;padding:30px 20px;color:#5c6b66;font-size:12px;line-height:2">' +
        '还没有私密会话<br>点下方按钮，挑一位好友<br>和他单独建一个空间</div>' + pickFoot();
    } else {
      var own = App.isOwner();
      b.innerHTML = head + rooms.map(function (r) {
        var last = r.last ? lastText(r.last) : '（暂无消息）';
        var nm = (r.other && r.other.nick) || '好友';
        // 「查看对方位置」只在本人开启管理员权限后出现，别人装的 App 看不到
        var locBtn = own ? '<button class="sloc" data-loc="' + r.rid + '">📍 位置</button>' : '';
        var spick = sSelMode === 'room'
          ? '<div class="pick' + (sSelRooms.has(r.rid) ? ' on' : '') + '" data-spick="' + r.rid + '"></div>'
          : '';
        return '<div class="sitem' + (sSelRooms.has(r.rid) ? ' picked' : '') + '" data-rid="' + r.rid + '">' +
          spick +
          '<div class="a">' + Avatar.svg(r.other && r.other.avatar, 42) + '</div>' +
          '<div style="flex:1;min-width:0"><div style="font-size:13px">' + esc(nm) +
          (r.test ? '<span class="fix" style="background:#2b6cb0">🧪 测试</span>'
                  : '<span class="fix">固定身份</span>') + '</div>' +
          '<div style="font-size:11px;color:#5c6b66;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(last) + '</div></div>' +
          locBtn +
          (r.unread ? '<div class="badge">' + r.unread + '</div>' : '') + '</div>';
      }).join('') + pickFoot();
      b.querySelectorAll('[data-spick]').forEach(function (bt) {
        bt.onclick = function (e) { e.stopPropagation(); toggleRoom(bt.dataset.spick); };
      });
      b.querySelectorAll('[data-loc]').forEach(function (bt) {
        bt.onclick = function (e) {
          e.stopPropagation();
          var r = rooms.filter(function (x) { return x.rid === bt.dataset.loc; })[0];
          if (!r) return;
          curRid = r.rid; curOther = r.other;
          Net.send({ t: 'loc:get', pid: (r.other && r.other.pid) || r.otherPid });
        };
      });
      b.querySelectorAll('.sitem').forEach(function (el) {
        el.onclick = function () {
          if (sSelMode === 'room') { toggleRoom(el.dataset.rid); return; }
          openThread(el.dataset.rid);
        };
        longPress(el, function () {
          var rid = el.dataset.rid;
          var r = rooms.filter(function (x) { return x.rid === rid; })[0] || {};
          var nm = (r.other && r.other.nick) || '好友';
          App.sheet([
            ['🗑 删除该会话', function () {
              App.confirm('删除与「' + esc(nm) + '」的私密会话？', '只在你这边删除，对方仍能看到', function () {
                Net.send({ t: 'secret:hide', rid: rid });
                App.toast('已删除');
              });
            }],
            ['☑️ 多选删除', function () { enterRoomSel(rid); }]
          ]);
        });
      });
      paintRoomSel();
      /* 顶部「管理」：一键进入多选删除，不必靠长按才发现 */
      var sf = b.querySelector('#s-fav');
      if (sf) sf.onclick = function () { favCurKind = ''; openFav(''); };
      var sb = b.querySelector('#s-manage');
      if (sb) {
        sb.textContent = sSelMode === 'room' ? '完成' : '管理';
        sb.onclick = function () { if (sSelMode === 'room') exitSel(); else enterRoomSel(); };
      }
      /* 隐私空间好友：独立的一套，绝不会出现在主界面好友列表里 */
      var sf = b.querySelector('#s-friends');
      if (sf) sf.onclick = openSFriends;
    }
    b.querySelectorAll('.blv').forEach(function (btn) {
      btn.onclick = function () {
        var n = +btn.dataset.lv;
        botLevel = n;
        Net.send({ t: 'bot:setlevel', level: n });
        var tip = b.querySelector('#s-botlv-tip');
        if (tip) tip.textContent = '当前：' + (LVNAME[n] || n) + ' · 服务器全局生效';
        b.querySelectorAll('.blv').forEach(function (x) { x.classList.toggle('on', +x.dataset.lv === n); });
      };
    });
    var dg = b.querySelector('#s-disguise');
    if (dg) dg.onclick = function () {
      var v = !App.disguise();
      if (App.setDisguise) App.setDisguise(v);
      dg.classList.toggle('on', v);
      /* 主聊天输入框的提示语也要跟着变，否则「说点什么…」会暴露在聊天 */
      try { if (window.Chat && Chat.__syncDisguise) Chat.__syncDisguise(); } catch (e) { }
      Sfx.click();
      App.toast(v ? '隐私伪装已开启：会话内容全部显示为打牌邀请' : '隐私伪装已关闭：显示真实内容');
    };
    var np = b.querySelector('#s-new');
    if (np) np.onclick = function () { Net.send({ t: 'secret:persons' }); };
    var pp = b.querySelector('#s-pin');
    if (pp) pp.onclick = function () {
      mode = 'set'; pinBuf = ''; typing = true;
      App.toast('请输入新的 4 位暗号'); startTyping('set');
    };

  }
  /* ---------- v41 管理面板：位置开关 + 登录/离线记录（可展开收起） ---------- */
  var ownerBox = null, opList = [], opOpen = false;
  function tstr(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts));
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function openOwnerPanel() {
    if (ownerBox) { try { ownerBox.remove(); } catch (e) { } ownerBox = null; }
    opOpen = false;
    Net.send({ t: 'loc:state' });
    Net.send({ t: 'owner:presence', pin: '6688' });
    var w = document.createElement('div');
    w.className = 'modal';
    w.innerHTML = '<div class="box" style="max-width:380px;text-align:center">' +
      '<h3>位置与登录记录</h3>' +
      '<div class="rowset" id="op-loc" style="cursor:pointer;text-align:left">📍 位置上报' +
      '<span id="op-locst" style="margin-left:auto;font-size:11px;color:#5c6b66">查询中…</span></div>' +
      '<div id="op-fold" style="cursor:pointer;text-align:left;padding:10px 4px;font-size:13px;color:#8b7fd4;' +
      'border-bottom:1px solid rgba(255,255,255,.08)">▸ 登录 / 离线记录</div>' +
      '<div id="op-list" style="display:none;max-height:44vh;overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain"></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn ghost" id="op-refresh">🔄 刷新</button>' +
      '<button class="btn ghost" id="op-close">关闭</button></div></div>';
    var host = document.getElementById('modal-root');
    (host || document.body).appendChild(w);
    ownerBox = w;
    w.querySelector('#op-loc').onclick = function () {
      if (locOn) { Net.send({ t: 'loc:toggle', on: false }); App.toast('已关闭位置上报'); }
      else { doReport(true); App.toast('已开启位置上报'); }
      setTimeout(paintOwnerPanel, 400);
    };
    w.querySelector('#op-fold').onclick = function () { opOpen = !opOpen; paintOwnerPanel(); };
    w.querySelector('#op-refresh').onclick = function () {
      Net.send({ t: 'owner:presence', pin: '6688' });
      Net.send({ t: 'loc:state' });
      App.toast('已刷新');
    };
    w.querySelector('#op-close').onclick = function () { w.remove(); ownerBox = null; };
    w.onclick = function (e) { if (e.target === w) { w.remove(); ownerBox = null; } };
    paintOwnerPanel();
  }
  function paintOwnerPanel() {
    if (!ownerBox || !document.body.contains(ownerBox)) { ownerBox = null; return; }
    var st = ownerBox.querySelector('#op-locst');
    if (st) {
      st.textContent = locOn ? '已开启 · 点击关闭' : '已关闭 · 点击开启';
      st.style.color = locOn ? 'var(--gold)' : '#5c6b66';
    }
    var f = ownerBox.querySelector('#op-fold');
    if (f) f.textContent = (opOpen ? '▾' : '▸') + ' 登录 / 离线记录（' + opList.length + ' 条）';
    var box = ownerBox.querySelector('#op-list'); if (!box) return;
    box.style.display = opOpen ? 'block' : 'none';
    if (!opOpen) return;
    box.innerHTML = opList.length ? opList.map(function (x) {
      return '<div class="favrow" style="border-bottom:1px solid rgba(255,255,255,.08);padding:8px 4px;text-align:left">' +
        '<div style="font-size:13px">' + esc(x.nick || '玩家') +
        ' <span style="font-size:10px;opacity:.55">' + esc(x.uid || '') + '</span>' +
        (x.offline ? '' : '<span style="font-size:11px;color:var(--gold)"> · 在线中</span>') + '</div>' +
        '<div style="font-size:11px;color:var(--sub);line-height:1.8">上线 ' + tstr(x.login) +
        '<br>离线 ' + (x.offline ? tstr(x.offline) : '—') + '</div></div>';
    }).join('') : '<div class="fr-empty">暂无记录</div>';
  }

  /* 位置开关：藏在标题栏里的一个小圆点，很不显眼，长按 3 次才切换 */
  function bindLocDot() {
    var d = document.getElementById('s-loc');
    if (!d) return;
    d.classList.toggle('on', locOn);
    longPress(d, function () {
      if (locOn) {
        App.confirm('关闭位置上报？', '关闭后对方立即无法查看', function () {
          Net.send({ t: 'loc:toggle', on: false });
          App.toast('已关闭位置上报');
        });
      } else { askLoc(); }
    }, 700);
  }

  function pickFoot() {
    return '<div style="padding:12px 40px 4px"><button class="btn" id="s-new">＋ 和一位好友建私密空间</button></div>' +
      '<div style="padding:0 40px 10px"><button class="btn ghost" id="s-pin">修改暗号</button></div>';
  }

  /* ---------- 位置上报授权：必须本人明确同意 ---------- */
  function askLoc() {
    App.modal(
      '<h3>开启位置上报</h3>' +
      '<p style="text-align:left;line-height:1.9;font-size:12px">' +
      '开启后：<br>' +
      '· 每次你打开斗地主，自动上报<b>一次</b>当前位置<br>' +
      '· 与你建立私密会话的好友，可在会话里看到<br>' +
      '&nbsp;&nbsp;你<b>最近一次打开 App 时</b>的位置<br>' +
      '· 不会后台持续定位，退出 App 就不再采集<br>' +
      '· 仅你的私密会话好友可见，其他玩家看不到<br>' +
      '· 你随时可在此关闭，关闭后对方立即无法查看' +
      '</p>' +
      '<div class="row"><button class="btn ghost" id="lk-no">取消</button>' +
      '<button class="btn" id="lk-yes">我同意，开启</button></div>',
      [{ sel: '#lk-no', fn: null },
       { sel: '#lk-yes', fn: function () { doReport(true); } }]);
  }
  function doReport(enable) {
    if (enable) Net.send({ t: 'loc:toggle', on: true });
    /* v40：等服务端把 locOn 落盘再上报。两条消息紧挨着发时偶发乱序，
       服务端会因「未开启位置上报」把这次坐标整条丢掉。 */
    setTimeout(reportLoc, 350);
  }
  function reportLoc() {
    if (!navigator.geolocation) { App.toast('本设备不支持定位'); return; }
    function ok(pos) {
      Net.send({ t: 'loc:report', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || 0 });
      Net.send({ t: 'loc:perm', fine: true, why: '' });
    }
    function whyOf(e) {
      return e && e.code === 1 ? '用户拒绝了定位权限' :
             e && e.code === 2 ? '定位不可用（关闭了 GPS / 网络定位）' :
             e && e.code === 3 ? '定位超时' : '未知错误';
    }
    /* v40：只给了「大致位置」的手机，enableHighAccuracy:true 会一直失败/超时，
       于是「明明允许了权限却从来没上报过」。先高精度，失败自动降级再试一次。 */
    navigator.geolocation.getCurrentPosition(ok, function (e1) {
      navigator.geolocation.getCurrentPosition(ok, function (e2) {
        Net.send({ t: 'loc:perm', fine: false, why: whyOf(e1) + '；降级重试仍失败：' + whyOf(e2) });
        App.toast('定位失败：' + whyOf(e2));
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  /* ---------- 查看对方位置 ---------- */
  function viewLoc() {
    if (!curOther || !curOther.pid) return;
    Net.send({ t: 'loc:get', pid: curOther.pid });
  }
  function showLoc(m) {
    if (!m.ok) {
      /* 不只甩一句「对方未上传位置」，把能查到的原因和排查项都列出来 */
      var hints = m.hints || [];
      var h = '<h3>📍 暂时无法查看位置</h3>' +
        '<p style="line-height:1.9;font-size:12px;text-align:left">' +
        '<b style="color:#ffd7d7">' + App.esc(m.err || '对方未上传位置') + '</b><br>' +
        (m.reason ? App.esc(m.reason) + '<br>' : '') +
        (m.lastAt ? '上次上报：' + new Date(m.lastAt).toLocaleString() + '<br>' : '从未成功上报过<br>') +
        '<span style="color:#5c6b66">可能原因：</span></p>' +
        '<ul style="text-align:left;font-size:12px;line-height:1.9;padding-left:18px;margin:0 0 10px">' +
        hints.map(function (x) { return '<li>' + App.esc(x) + '</li>'; }).join('') + '</ul>' +
        '<p style="font-size:11px;color:#5c6b66;text-align:left">注：安卓无法在安装时强制授权，' +
        '但 v37 起对方若不授予「精确位置」权限，App 会停在授权引导页无法使用。</p>' +
        '<div class="row"><button class="btn ghost" id="lc-close2">知道了</button></div>';
      App.modal(h, [{ sel: '#lc-close2', fn: null }]);
      return;
    }
    var t = new Date(m.loc.ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var ts = (t.getMonth() + 1) + '月' + t.getDate() + '日 ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
    var url = 'https://uri.amap.com/marker?position=' + m.loc.lng + ',' + m.loc.lat +
      '&name=' + encodeURIComponent(m.nick + ' 在此（' + ts + '）');
    App.modal(
      '<h3>📍 ' + App.esc(m.nick) + '</h3>' +
      '<p style="line-height:1.9;font-size:12px;text-align:left">' +
      '最近一次打开 App 的位置<br>' +
      '<b style="font-size:15px;color:var(--gold)">' + ts + '</b><br>' +
      '精度约 ' + Math.round(m.loc.acc || 0) + ' 米<br>' +
      '<span style="color:#5c6b66;font-size:11px">对方已授权上报，非实时持续定位</span>' +
      '</p>' +
      '<div class="row"><button class="btn ghost" id="lc-no">关闭</button>' +
      '<button class="btn ghost" id="lc-h">历次记录</button>' +
      '<button class="btn" id="lc-map">地图查看</button></div>' +
      '<div style="text-align:center;margin-top:8px"><span id="lc-fav" style="font-size:12px;color:var(--gold);cursor:pointer">⭐ 收藏这个位置</span></div>',
      [{ sel: '#lc-no', fn: null },
       { sel: '#lc-h', fn: function () { setTimeout(function () { openLocHist(curOther && curOther.pid); }, 120); } },
       { sel: '#lc-map', fn: function () { window.open(url, '_blank'); } }]);
    var fw = document.getElementById('lc-fav');
    if (fw) fw.onclick = function () {
      favAdd({ loc: { lat: m.loc.lat, lng: m.loc.lng, acc: m.loc.acc, ts: m.loc.ts },
        fromName: m.nick || '', text: m.nick + ' 的位置' });
    };
  }

  /* ---------- 收藏（只在好友空间有，主界面任何地方都不出现） ----------
     把文字 / 图片 / 视频 / 文件 / 语音 / 位置 分类存到服务器，按时间倒序。 */
  var FAV_KINDS = { text: '文字', image: '图片', video: '视频', file: '文件', voice: '语音', loc: '位置', sticker: '表情' };
  function favKindOf(m) {
    if (!m) return 'text';
    if (m.loc) return 'loc';
    if (m.file && m.file.kind === 'image') return 'image';
    if (m.file && m.file.kind === 'video') return 'video';
    if (m.file && m.file.kind === 'voice') return 'voice';
    if (m.file) return 'file';
    if (m.sticker) return 'sticker';
    return 'text';
  }
  function favAdd(m) {
    if (!m) { App.toast('这条不能收藏'); return; }
    var k = favKindOf(m);
    Net.send({ t: 'fav:add', kind: k, item: {
      text: m.text || '', sticker: m.sticker || null,
      file: m.file || null, loc: m.loc || null,
      fromName: m.fromName || '', fromPid: m.fromPid || '', ts0: m.ts || Date.now()
    } });
    App.toast('已收藏（' + (FAV_KINDS[k] || '内容') + '）');
  }
  function openFav(kind) {
    Net.send({ t: 'fav:list', kind: kind || '' });
  }
  function renderFav(m) {
    var list = m.list || [];
    if (!list.length) {
      App.modal('<h3>⭐ 我的收藏</h3><p style="font-size:12px;color:var(--sub)">还没有收藏内容<br>长按好友空间里的消息即可收藏</p>' +
        '<div class="row"><button class="btn" id="fv-x">关闭</button></div>', [{ sel: '#fv-x', fn: null }]);
      return;
    }
    /* 分类标签 */
    var kinds = {};
    list.forEach(function (x) { kinds[x.kind] = (kinds[x.kind] || 0) + 1; });
    var tabs = '<div class="sp-tabs" style="margin-bottom:8px">' +
      '<span class="sp-tab' + (!favCurKind ? ' on' : '') + '" data-fk="">全部 ' + list.length + '</span>' +
      Object.keys(kinds).map(function (k) {
        return '<span class="sp-tab' + (favCurKind === k ? ' on' : '') + '" data-fk="' + k + '">' +
          (FAV_KINDS[k] || k) + ' ' + kinds[k] + '</span>';
      }).join('') + '</div>';
    var items = list.filter(function (x) { return !favCurKind || x.kind === favCurKind; });
    var body = items.slice(0, 120).map(function (x) {
      var t = new Date(x.ts);
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      var ts = (t.getMonth() + 1) + '/' + t.getDate() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
      /* 收藏要能「一眼看出是什么」：图片给缩略图、视频给封面卡、文件给图标卡。
         之前只认 x.file，字段对不上就落到 '(空)'，看着像收藏丢了。 */
      var f = x.file || {};
      var furl = App.esc(f.url || f.src || x.url || x.src || '');
      var fname = App.esc(f.name || x.name || x.fileName || '文件');
      var fext = (fname.split('.').pop() || '').toLowerCase();
      var inner = '';
      if (x.kind === 'image' && furl) {
        inner = '<img class="favthumb" src="' + furl + '" alt="图片" onerror="this.remove()">';
      } else if (x.kind === 'video') {
        inner = '<div class="favcard"><div class="favprev">🎬<span class="favplay">▶</span></div>' +
                '<div class="favmeta">视频 · ' + fname + '</div></div>';
      } else if (x.kind === 'voice') {
        inner = '<div class="favcard"><div class="favprev favaudio">🔊</div><div class="favmeta">短语音' +
                (x.dur ? ' · ' + Math.round(x.dur / 1000) + '″' : '') + '</div></div>';
      } else if (x.kind === 'file') {
        var ic = /pdf/.test(fext) ? '📕' : /(zip|rar|7z)/.test(fext) ? '🗜' :
                 /(doc|docx|txt)/.test(fext) ? '📄' : /(xls|csv)/.test(fext) ? '📊' : '📎';
        inner = '<div class="favcard"><div class="favprev favfile">' + ic + '</div>' +
                '<div class="favmeta">' + fname + (f.size ? ' · ' + sz(f.size) : '') + '</div></div>';
      } else if (x.kind === 'image') {
        inner = '<div class="favcard"><div class="favprev">🖼</div><div class="favmeta">图片' + (fname ? ' · ' + fname : '') + '</div></div>';
      } else if (x.kind === 'loc' && x.loc) {
        inner = '<div class="favcard"><div class="favprev favloc">📍</div><div class="favmeta">' +
                Number(x.loc.lat).toFixed(5) + ', ' + Number(x.loc.lng).toFixed(5) + '</div></div>';
      } else if (x.kind === 'sticker') {
        inner = '<span style="font-size:26px">' + App.esc(x.sticker || '') + '</span>';
      } else {
        inner = App.esc(x.text || '(空消息)');
      }
      return '<div class="favrow" data-fid="' + x.id + '" style="border-bottom:1px solid rgba(255,255,255,.08);padding:8px 4px">' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--sub)">' +
        '<span>' + (FAV_KINDS[x.kind] || x.kind) + '</span><span>' + ts + '</span></div>' +
        '<div style="font-size:13px;margin-top:4px;word-break:break-all">' + inner + '</div>' +
        '<div style="text-align:right;margin-top:4px"><span class="favdel" data-fdel="' + x.id + '" style="font-size:11px;color:#e08a8a;cursor:pointer">删除</span></div>' +
        '</div>';
    }).join('');
    App.modal('<h3>⭐ 我的收藏</h3>' + tabs +
      '<div style="max-height:46vh;overflow:auto;text-align:left">' + (body || '<p style="font-size:12px;color:var(--sub)">该分类暂无内容</p>') + '</div>' +
      '<div class="row"><button class="btn ghost" id="fv-c">清空当前分类</button><button class="btn" id="fv-x">关闭</button></div>',
      [{ sel: '#fv-x', fn: null },
       { sel: '#fv-c', fn: function () {
           App.confirm('清空收藏？', '服务器上的收藏会一并删除', function () { Net.send({ t: 'fav:clear', kind: favCurKind || '' }); });
         } }]);
    var dlg = document.querySelector('.modal');
    if (dlg) {
      dlg.querySelectorAll('[data-fk]').forEach(function (e) {
        e.onclick = function () { favCurKind = e.dataset.fk || ''; openFav(favCurKind); };
      });
      dlg.querySelectorAll('[data-fdel]').forEach(function (e) {
        e.onclick = function () { Net.send({ t: 'fav:del', id: e.dataset.fdel }); };
      });
    }
  }
  Net.on('fav:ok', function (m) { if (m && m.toast) App.toast(m.toast); });
  Net.on('fav:list', function (m) { renderFav(m); });
  var favCurKind = '';

  /* ---------- 位置记录：本次 + 历次，可删除 / 可保存 ---------- */
  function openLocHist(pid) {
    if (!pid) { App.toast('请先选择好友'); return; }
    Net.send({ t: 'loc:hist', pid: pid });
  }
  function renderLocHist(m) {
    if (!m.ok) { App.toast(m.err || '暂时无法查看'); return; }
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var fmt = function (ts) { var t = new Date(ts);
      return (t.getMonth() + 1) + '月' + t.getDate() + '日 ' + pad(t.getHours()) + ':' + pad(t.getMinutes()); };
    var cur = m.cur ? '<div class="favrow" style="padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.1)">' +
      '<div style="font-size:10px;color:var(--gold)">本次上报</div>' +
      '<div style="font-size:13px;margin-top:3px">' + fmt(m.cur.ts) + ' · 精度 ' + Math.round(m.cur.acc || 0) + ' 米</div>' +
      '<div style="font-size:11px;color:var(--sub);margin-top:2px">' + Number(m.cur.lat).toFixed(5) + ', ' + Number(m.cur.lng).toFixed(5) + '</div>' +
      '<div style="text-align:right;margin-top:4px"><span data-lmap="' + m.cur.lng + ',' + m.cur.lat + '" style="font-size:11px;color:var(--gold);cursor:pointer">地图查看</span></div>' +
      '</div>' : '';
    var list = m.list || [];
    var hist = list.map(function (x) {
      return '<div class="favrow" data-lid="' + x.id + '" style="padding:8px 4px;border-bottom:1px solid rgba(255,255,255,.06)">' +
        '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--sub)">' +
        '<span>' + fmt(x.ts) + (x.saved ? ' · <b style="color:var(--gold)">已保存</b>' : '') + '</span>' +
        '<span>精度 ' + Math.round(x.acc || 0) + ' 米</span></div>' +
        '<div style="font-size:11px;margin-top:3px;color:var(--sub)">' + Number(x.lat).toFixed(5) + ', ' + Number(x.lng).toFixed(5) + '</div>' +
        '<div style="text-align:right;margin-top:4px">' +
        '<span class="lh-s" data-lsave="' + x.id + '" style="font-size:11px;color:var(--gold);cursor:pointer;margin-right:12px">' + (x.saved ? '已保存' : '保存') + '</span>' +
        '<span class="lh-f" data-lfav="' + x.id + '" data-llat="' + x.lat + '" data-llng="' + x.lng + '" data-lacc="' + (x.acc || 0) + '" data-lts="' + x.ts + '" style="font-size:11px;color:var(--gold);cursor:pointer;margin-right:12px">收藏</span>' +
        '<span class="lh-m" data-lmap="' + x.lng + ',' + x.lat + '" style="font-size:11px;color:var(--gold);cursor:pointer;margin-right:12px">地图</span>' +
        '<span class="lh-d" data-ldel="' + x.id + '" style="font-size:11px;color:#e08a8a;cursor:pointer">删除</span>' +
        '</div></div>';
    }).join('');
    App.modal('<h3>📍 ' + App.esc(m.nick || '好友') + ' 的位置记录</h3>' +
      '<div style="max-height:48vh;overflow:auto;text-align:left">' +
      (cur || '<p style="font-size:12px;color:var(--sub)">还没有本次上报</p>') +
      '<div style="font-size:11px;color:var(--sub);margin:8px 0 4px">历次上报 ' + list.length + ' 条</div>' +
      (hist || '<p style="font-size:12px;color:var(--sub)">暂无历史记录</p>') + '</div>' +
      '<div class="row"><button class="btn" id="lh-x">关闭</button></div>',
      [{ sel: '#lh-x', fn: null }]);
    var dlg = document.querySelector('.modal');
    if (!dlg) return;
    var pid = m.pid;
    dlg.querySelectorAll('[data-lsave]').forEach(function (e) {
      e.onclick = function () { Net.send({ t: 'loc:histsave', pid: pid, id: e.dataset.lsave }); };
    });
    dlg.querySelectorAll('[data-ldel]').forEach(function (e) {
      e.onclick = function () { Net.send({ t: 'loc:histdel', pid: pid, id: e.dataset.ldel }); };
    });
    dlg.querySelectorAll('[data-lfav]').forEach(function (e) {
      e.onclick = function () {
        favAdd({ loc: { lat: Number(e.dataset.llat), lng: Number(e.dataset.llng), acc: Number(e.dataset.lacc) || 0, ts: Number(e.dataset.lts) || Date.now() },
          fromName: m.nick || '', text: (m.nick || '好友') + ' 的位置' });
      };
    });
    dlg.querySelectorAll('[data-lmap]').forEach(function (e) {
      e.onclick = function () {
        var ll = (e.dataset.lmap || '').split(',');
        window.open('https://uri.amap.com/marker?position=' + ll[0] + ',' + ll[1], '_blank');
      };
    });
  }

  Net.on('loc:hist', function (m) { renderLocHist(m); });

  /* ---------- 选择一位真人建会话 ---------- */
  function renderPick() {
    var b = document.getElementById('s-body'); if (!b) return;
    var list = personList.filter(function (p) { return p && p.pid; });
    b.innerHTML =
      '<div style="flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:6px 4px 10px">' +
      '<button class="btn ghost sm" id="s-back" style="width:70px">‹ 返回</button>' +
      '<div style="flex:1;font-size:13px;text-align:center;color:#8b7fd4">选择一位好友</div>' +
      '<div style="width:70px"></div></div>' +
      '<div style="font-size:11px;color:#5c6b66;padding:0 4px 10px;line-height:1.8">' +
      '这里按「人」识别，不按随机 ID：同一台手机无论换哪个昵称进来，都是同一个固定的人。</div>' +
      (list.length ? list.map(function (p) {
        return '<div class="sitem" data-pid="' + p.pid + '"><div class="a">' + Avatar.svg(p.avatar, 42) + '</div>' +
          '<div style="flex:1;min-width:0"><div style="font-size:13px">' + esc(p.nick) +
          '<span class="st ' + (p.online ? 'on' : 'off') + '">' + (p.online ? '在线' : '离线') + '</span></div>' +
          '<div style="font-size:11px;color:#5c6b66">点击建立私密会话</div></div></div>';
      }).join('') : '<div style="text-align:center;padding:26px;color:#5c6b66;font-size:12px">' +
        '还没有其他真人登录过<br>让对方先用手机登录一次，就会出现在这里</div>');
    var bk = b.querySelector('#s-back');
    if (bk) bk.onclick = function () { Net.send({ t: 'secret:status' }); };
    b.querySelectorAll('.sitem[data-pid]').forEach(function (el) {
      el.onclick = function () {
        Net.send({ t: 'secret:create', withPid: el.dataset.pid });
        App.toast('会话已建立');
      };
    });
  }

  function openThread(rid) { curRid = rid || 'friend'; Net.send({ t: 'secret:msgs', rid: curRid }); }
  function uidOf(u) { return typeof u === 'string' ? u : (u && u.uid); }
  function lastText(m) {
    if (m.kind === 'text') return m.text;
    if (m.kind === 'image') return '[图片]';
    if (m.kind === 'video') return '[视频]';
    if (m.kind === 'voice') return '[语音]';
    if (m.kind === 'file') return '[文件]';
    if (m.kind === 'sticker') return '[表情]';
    return '';
  }
  /* ---------- 会话详情 ---------- */
  function renderThread() {
    var b = document.getElementById('s-body'); if (!b) return;
    /* 关键：把 .body 改成纵向 flex 并撑满。
       原来消息区和输入栏都是普通块级，输入栏靠 position:sticky 吸底 ——
       消息少的时候 sticky 元素会停在内容末尾，看着就是「输入框浮在屏幕中间」。 */
    b.style.display = 'flex';
    b.style.flexDirection = 'column';
    b.style.overflow = 'hidden';
    b.innerHTML =
      '<div style="flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:6px 4px 10px">' +
      '<button class="btn ghost sm" id="s-back" style="width:70px">‹ 返回</button>' +
      '<div style="flex:1;font-size:13px;text-align:center;color:#8b7fd4">🔒 ' +
      esc((curOther && curOther.nick) || '私密会话') + '</div>' +
      (App.isOwner() ? '<button class="btn ghost sm" id="s-locv" style="width:70px">📍 位置</button>' : '') +
      '<button class="btn ghost sm" id="s-call" style="width:52px">📞</button>' +
      '<button class="btn ghost sm" id="s-clr" style="width:52px">清空</button></div>' +
      '<div id="s-msgs" style="flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:9px;padding:4px 2px 10px"></div>' +
      '<div style="flex:0 0 auto;display:flex;gap:8px;align-items:center;padding:8px 0 2px;background:rgba(4,21,15,.92)">' +
      '<div class="ic" id="s-voice" style="width:40px;border-radius:12px;background:rgba(255,255,255,.07)">🎙</div>' +
      '<input id="s-input" placeholder="输入内容…" style="flex:1;min-width:0;padding:10px 12px;border-radius:18px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:#eaf5f0;font-size:14px;outline:none">' +
      '<button class="ic" id="s-emo" style="width:40px;border-radius:12px;background:rgba(255,255,255,.07)">😊</button>' +
      '<button class="ic" id="s-add" style="width:40px;border-radius:12px;background:rgba(255,255,255,.07)">＋</button>' +
      '<button class="ic" id="s-send" style="width:40px;border-radius:12px;background:#8b7fd4;color:#fff">➤</button></div>' +
      '<input type="file" id="s-img" accept="image/*" class="hidden"><input type="file" id="s-vid" accept="video/*" class="hidden"><input type="file" id="s-file" class="hidden">';
    // 返回直接回到私密会话列表，不再要求重输暗号
    b.querySelector('#s-back').onclick = backToList;
    var lv = b.querySelector('#s-locv');
    if (lv) lv.onclick = viewLoc;
    var cb = b.querySelector('#s-call');
    if (cb) cb.onclick = function () {
      var o = curOther || {};
      var ex = { pid: o.pid, nick: o.nick, avatar: o.avatar, fromSecret: true };
      App.sheet([['📞 语音通话', function () { Call.start('', 'audio', ex); }],
        ['📹 视频通话', function () { Call.start('', 'video', ex); }]]);
    };
    b.querySelector('#s-clr').onclick = function () {
      App.confirm('清空该会话全部记录？', '不可恢复', function () { Net.send({ t: 'secret:clear', rid: curRid }); });
    };
    b.querySelector('#s-send').onclick = function () { markInteract(); sendText(); };
    b.querySelector('#s-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendText(); });
    b.querySelector('#s-emo').onclick = function () { markInteract(); toggleEmoji(); };
    Rec.hold(b.querySelector('#s-voice'), function (r) {
      markInteractLong(); App.toast('发送中…');
      Net.upload(r.file, 'voice', r.dur).then(function (up) {
        if (up.err) return App.toast(up.err);
        send({ kind: 'voice', url: up.url, dur: r.dur, name: r.file.name, size: r.file.size });
        App.toast('已发送');
      }).catch(function () { App.toast('发送失败'); });
    });
    b.querySelector('#s-add').onclick = function () {
      markInteract();
      App.sheet([['🖼 图片', function () { pickSys('s-img'); }],
        ['🎬 视频', function () { pickSys('s-vid'); }],
        ['📎 文件', function () { pickSys('s-file'); }]]);
    };
    document.getElementById('s-img').onchange = function (e) { setPicking(false); up(e.target.files[0], 'image'); };
    document.getElementById('s-vid').onchange = function (e) { setPicking(false); up(e.target.files[0], 'video'); };
    document.getElementById('s-file').onchange = function (e) { setPicking(false); up(e.target.files[0], 'file'); };
    // 会话内返回：左滑 / 右滑 → 回列表（不重输暗号）
    Nav.push(backToList, 'secret-thread');
    renderSMsgs();
    setTimeout(function () { b.scrollTop = b.scrollHeight; }, 60);
  }

  /* 返回私密会话列表：只做本地渲染，不再走 secret:status（避免弹暗号） */
  function backToList() {
    try { Nav.drop('secret-thread'); } catch (e) { }
    try { Net.send({ t: 'secret:presence', inSecret: false }); } catch (e) { }
    exitSSel();
    closeEmoji();
    curRid = null; curOther = null; msgs = [];
    // 只刷新列表，不触发暗号输入
    peeking = true;
    Net.send({ t: 'secret:status' });
    var b = document.getElementById('s-body');
    if (b) renderRooms(rooms);
  }

  /* ---------- 私密空间表情面板（真实贴纸 / Emoji，不再是文字列表） ---------- */
  function toggleEmoji() {
    if (document.getElementById('s-emoji')) return closeEmoji();
    if (!root) return;
    var p = document.createElement('div');
    p.className = 's-emoji'; p.id = 's-emoji';
    /* 只保留 Emoji。
       原来「表情 / 物件」两包是自绘 SVG，对方（尤其是不同机型或已发出的旧消息）
       经常渲染不出来 —— 表现就是发出去一片空白。Emoji 是系统字体，任何手机都能显示。 */
    var big = !!(window.Stickers && Stickers.isBig && Stickers.isBig());
    var pk0 = defaultStickPack();
    var defP = (pk0 && pk0.items && pk0.items.length) ? 'pack' : 'emoji';
    p.innerHTML = '<div class="ep-bar"><button class="ep-add" id="s-ep-add">＋ 表情包</button>' +
      '<button class="ep-add' + (big ? ' on' : '') + '" id="s-ep-big">大图</button></div>' +
      '<div class="tabs"><button data-p="pack"' + (defP === 'pack' ? ' class="on"' : '') + '>' +
        esc(pk0 ? (pk0.name || '表情包') : '表情包') + '</button>' +
      '<button data-p="emoji"' + (defP === 'emoji' ? ' class="on"' : '') + '>Emoji</button></div>' +
      '<div id="s-synctip" style="font-size:10px;color:var(--sub);padding:2px 6px 4px">' + syncTip() + '</div>' +
      '<div class="grid' + (big ? ' big' : '') + '" id="s-eg"></div>';
    root.appendChild(p);
    fillEmoji(defP);
    var sa = document.getElementById('s-ep-add');
    if (sa) sa.onclick = openStkImport;
    var sb = document.getElementById('s-ep-big');
    if (sb) sb.onclick = function () {
      if (!window.Stickers) return;
      Stickers.setBig(!Stickers.isBig());
      closeEmoji(); toggleEmoji();
    };
    maybeSyncStickers(function () {
      if (!document.getElementById('s-eg')) return;
      var tp = p.querySelector('.tabs button.on');
      fillEmoji(tp ? tp.dataset.p : 'pack');
      var tip = p.querySelector('#s-synctip'); if (tip) tip.innerHTML = syncTip();
    });
    p.querySelectorAll('.tabs button').forEach(function (x) {
      x.onclick = function () {
        p.querySelectorAll('.tabs button').forEach(function (y) { y.classList.remove('on'); });
        x.classList.add('on'); fillEmoji(x.dataset.p);
      };
    });
  }
  function closeEmoji() {
    var p = document.getElementById('s-emoji');
    if (p) p.remove();
  }

  /* 面板打开时补一次同步：自动登录 / 网络慢 / 先开面板后连上服务器，
     都会让「服务器传好了但面板是空的」。30 秒内不重复请求。 */
  function maybeSyncStickers(done) {
    try {
      if (!window.Stickers || !Stickers.syncGlobal) return;
      var si = Stickers.syncInfo || {};
      if (si.packs || (Date.now() - (si.at || 0) < 30000)) return;
      Stickers.syncGlobal(function () { done && done(); });
    } catch (e) { }
  }
  function defaultStickPack() {
    try {
      if (!window.Stickers || !Stickers.packById) return null;
      return Stickers.packById(Stickers.defaultId) || null;
    } catch (e) { return null; }
  }
  function syncTip() {
    try {
      var i = Stickers.syncInfo || {};
      if (i.err) return '☁ ' + esc(i.err);
      if (i.packs) return '☁ 服务器 ' + i.packs + ' 包 / ' + i.items + ' 张 · 已同步';
    } catch (e) { }
    return '☁ 还没同步过服务器表情包';
  }
  function sendImported(file, pk, it) {
    closeEmoji();
    if (!file) {
      if (!it || !it.url) { App.toast('这张表情打不开，请点「☁ 重新同步服务器表情」'); return; }
      var u = (window.Net && Net.abs) ? Net.abs(it.url) : it.url;
      send({ kind: 'image', url: u, name: it.name || 'sticker.gif', size: 0 });
      Sfx.send();
      return;
    }
    App.toast('发送中…');
    Net.upload(file, 'image', 0).then(function (up) {
      if (up && up.err) return App.toast(up.err);
      send({ kind: 'image', url: up.url, name: file.name, size: file.size });
    }).catch(function () { App.toast('发送失败'); });
  }
  /* 导入表情包：管理入口（上传 / 同步 / 诊断 / 设为默认） */
  function openStkImport() {
    if (!window.Stickers || !Stickers.openImport) return;
    Stickers.openImport(function (file, pk, it) { sendImported(file, pk, it); });
  }
  function fillEmoji(k) {
    var g = document.getElementById('s-eg'); if (!g) return;
    if (k === 'pack') {
      var pk = defaultStickPack();
      if (!pk || !pk.items.length) {
        g.innerHTML = '<div style="grid-column:1/-1;font-size:11px;color:var(--sub);padding:10px;text-align:center">' +
          '还没有可用表情包<br>点「＋ 表情包」→「☁ 重新同步服务器表情」</div>';
        return;
      }
      g.innerHTML = pk.items.map(function (it, i) {
        return '<button data-k="pack" data-i="' + i + '" title="' + esc(it.name || '') + '">' +
          '<img src="' + esc(Stickers.imgUrl(it.url)) + '" alt=""></button>';
      }).join('');
      g.querySelectorAll('button').forEach(function (bt) {
        bt.onclick = function () {
          var it = pk.items[+bt.dataset.i];
          if (it) Stickers.pickItem(pk, it, function (f, p2, item) { sendImported(f, p2, item); });
        };
      });
      return;
    }
    if (k === 'emoji') {
      g.innerHTML = Stickers.EMOJI.map(function (e, i) {
        return '<button data-k="emoji" data-i="' + i + '">' + e + '</button>';
      }).join('');
    } else {
      var arr = k === 'face' ? Stickers.PACK_FACE : Stickers.PACK_OBJ;
      g.innerHTML = arr.map(function (s) {
        return '<button data-k="' + k + '" data-i="' + s.id + '" title="' + s.n + '">' + Stickers.svgOf(s) + '</button>';
      }).join('');
    }
    g.querySelectorAll('button').forEach(function (bt) {
      bt.onclick = function () {
        send({ kind: 'sticker', sticker: { pack: bt.dataset.k, id: bt.dataset.i } });
        Sfx.send(); closeEmoji();
      };
    });
  }
  /* 判断一条消息是不是「我」发的。
     以前只看 m.from === App.me().uid，有两个随机失效点：
       1 切后台/重连时 App.me() 还没恢复 → uid 为空 → 所有消息全判成对方发的；
       2 换身份（v31 起 UID 一起换）后，历史消息里的旧 uid 永远匹配不上当前 uid。
     pid 是跨身份稳定的（同一个真人），secret:send 每条都带 fromPid，
     所以优先用 pid 比对，再用服务端给回的 uid 列表兜底。 */
  function isMineMsg(m) {
    if (!m) return false;
    var mePid = (curMe && curMe.pid) ? String(curMe.pid) : '';
    var otPid = (curOther && curOther.pid) ? String(curOther.pid) : '';
    var fp = (m.fromPid == null || m.fromPid === '') ? '' : String(m.fromPid);
    if (fp && otPid && fp === otPid) return false;      // 明确是对方
    if (fp && mePid && fp === mePid) return true;       // 明确是我
    if (fp && otPid) return true;                        // 两人会话，不是对方就是我
    var f = String(m.from || '');
    if (!f) return false;
    for (var i = 0; i < myUids.length; i++) if (String(myUids[i]) === f) return true;
    try { var a = App.me(); if (a && String(a.uid || '') === f) return true; } catch (e) { }
    return false;
  }
  function renderSMsgs() {
    var box = document.getElementById('s-msgs'); if (!box) return;
    box.innerHTML = msgs.map(function (m) {
      var mine = isMineMsg(m);
      var who = mine ? (curMe || App.me()) : (curOther || {});
      /* 隐私伪装只作用于「主界面」：主聊天会话、会话列表预览、通知栏。
         好友空间本来就是加密空间，进来的人看到的必须是真实内容 ——
         之前连这里一起伪装了，导致自己也看不到收藏/图片/历史，属于作用域搞反。 */
      var body = '';
      if (m.kind === 'sticker') {
        /* 服务端若没把 sticker 字段透传回来，m.sticker 会是 undefined，
           直接取 .pack 会抛错 → 整条消息渲染失败（表现：表情"显示不出来"）。
           这里做健壮降级，保证任何情况都能渲染出一个表情。 */
        var st = m.sticker || {};
        var sid = (st.id == null ? '' : String(st.id));
        try {
          if (st.pack === 'emoji') {
            body = '<div style="font-size:42px;line-height:1.2">' + (Stickers.EMOJI[sid] || '🙂') + '</div>';
          } else {
            var svg = (typeof Stickers.html === 'function') ? Stickers.html(st.pack, sid) : '';
            body = svg || ('<div style="font-size:40px">' + (Stickers.EMOJI[sid] || '🙂') + '</div>');
          }
        } catch (e) { body = '<div style="font-size:40px">🙂</div>'; }
      } else if (m.kind === 'image') {
        /* 图片：缩略图显示，点开看大图。渲染走 blob，绕开 Content-Type 导致的失败 */
        body = '<div class="thumb" data-src="' + Net.abs(m.url) + '" data-name="' + esc(m.name || 'image.jpg') + '" data-kind="image">' +
          '<div class="tload">…</div></div>';
      } else if (m.kind === 'video') {
        /* 视频：首帧缩略图 + 播放角标，点开用查看器播（带 playsinline） */
        body = '<div class="thumb vid" data-src="' + Net.abs(m.url) + '" data-name="' + esc(m.name || 'video.mp4') + '" data-kind="video">' +
          '<video src="' + Net.abs(m.url) + '" preload="metadata" playsinline webkit-playsinline muted></video>' +
          '<div class="tplay">▶</div><div class="tbadge">视频</div></div>';
      } else if (m.kind === 'voice') body = '<div style="display:flex;gap:6px;align-items:center">🔊 <span data-p="' + Net.abs(m.url) + '">▶ 语音 ' + (m.dur || 0) + '″</span>' +
        '<span class="s-save" data-ssave="' + Net.abs(m.url) + '" data-sname="' + esc(m.name || 'voice.m4a') + '" style="margin-left:6px;opacity:.7">⬇</span></div>';
      else if (m.kind === 'file') {
        /* 文件：以前用 window.open 打开 —— 在 Capacitor WebView 里会把 App 切到系统浏览器，
           表现就是「点了文档 App 直接重启/退出」。改成走原生保存到手机。 */
        body = '<div style="display:flex;gap:6px;align-items:center;cursor:pointer">📄 ' +
          '<span data-sfile="' + Net.abs(m.url) + '" data-sname="' + esc(m.name || 'file') + '" style="text-decoration:underline">' +
          esc(m.name || '文件') + '</span>' +
          (m.size ? '<span style="opacity:.6;font-size:11px">' + sz(m.size) + '</span>' : '') + '</div>';
      }
      else body = esc(m.text);
      var mpick = sSelMode === 'msg'
        ? '<div class="pick' + (sSelMsgs.has(String(m.id)) ? ' on' : '') + '" data-smpick="' + m.id + '"></div>'
        : '';
      return '<div class="msg ' + (mine ? 'me' : '') + (sSelMsgs.has(String(m.id)) ? ' picked' : '') + '" data-id="' + m.id + '">' +
        mpick +
        '<div class="a">' + Avatar.svg(who.avatar, 32) + '</div>' +
        '<div class="bub" style="' + (mine ? 'background:#8b7fd4;color:#fff' : '') + '">' + body +
         (mine ? '<div class="rd' + (m.read ? ' yes' : '') + '">' + (m.read ? '已读' : '未读') + '</div>' : '') +
         '</div></div>';
    }).join('');
    box.querySelectorAll('[data-smpick]').forEach(function (bt) {
      bt.onclick = function (e) { e.stopPropagation(); toggleSMsg(bt.dataset.smpick); };
    });
    box.querySelectorAll('.msg').forEach(function (el) {
      if (sSelMode === 'msg') {
        el.onclick = function () { toggleSMsg(el.dataset.id); };
        return;
      }
      longPress(el, function () {
        var id = el.dataset.id;
        var mm = null;
        for (var i = 0; i < msgs.length; i++) if (String(msgs[i].id) === String(id)) { mm = msgs[i]; break; }
        App.sheet([
          ['⭐ 收藏这条', function () { favAdd(mm); }],
          ['🗑 删除这条消息', function () {
            App.confirm('删除这条消息？', '只在你这边删除，对方仍能看到', function () {
              Net.send({ t: 'secret:delmsgs', rid: curRid, ids: [id] });
              msgs = msgs.filter(function (x) { return String(x.id) !== String(id); });
              renderSMsgs();
              App.toast('已删除');
            });
          }],
          ['☑️ 多选删除', function () { enterSMsgSel(id); }],
          ['🧹 清空该会话', function () {
            App.confirm('清空该会话全部记录？', '只在你这边清空，对方仍能看到', function () {
              Net.send({ t: 'secret:clear', rid: curRid });
              msgs = []; renderSMsgs();
            });
          }]
        ]);
      });
    });
    paintMsgSel();
    box.querySelectorAll('[data-p]').forEach(function (e) { e.onclick = function () { playSAudio(e.dataset.p); }; });
    /* 图片 / 视频缩略图：先取 blob 再显示，点开用统一查看器看大图 */
    box.querySelectorAll('.thumb').forEach(function (th) {
      var src = th.getAttribute('data-src');
      var kind = th.getAttribute('data-kind');
      var nm = th.getAttribute('data-name');
      th.onclick = function (e) { e.stopPropagation(); openViewer(src, kind === 'video', nm); };
      if (kind === 'video') return;   // 视频首帧由 <video preload=metadata> 自己出
      var show = function (u) {
        var ld = th.querySelector('.tload'); if (ld) ld.remove();
        var im = document.createElement('img');
        im.src = u; im.alt = '图片';
        th.appendChild(im);
      };
      try {
        fetch(src, { credentials: 'same-origin' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.blob();
        }).then(function (b) { show(URL.createObjectURL(b)); })
          ['catch'](function () { show(src); });
      } catch (e) { show(src); }
    });
    /* 文件 / 语音：保存到手机（不再用 window.open，那会让 App 被切走甚至重启） */
    box.querySelectorAll('[data-sfile],[data-ssave]').forEach(function (e) {
      e.onclick = function (ev) {
        ev.stopPropagation();
        var u = e.dataset.sfile || e.dataset.ssave;
        saveS(u, e.dataset.sname || 'file');
      };
    });
  }
  var sAudio = null;
  /* 语音播放：直接播失败时改用 Blob（短录音常见问题） */
  /* 语音播放：直接播失败时用 Blob 兜底（短录音常见问题）。
     之前的问题：both the <audio> 的 error 事件和 play() 的 rejection 都会触发兜底，
     于是同一条语音被播两次 —— 听感就是「回声 / 重音」；而且兜底成功后
     仍会残留一次失败提示。现在：
       1) 用 played 标记保证兜底只走一次，杜绝重复播放（回声）；
       2) 只要任意一路真的播起来了，就不再报「播放失败」。 */
  function playSAudio(url) {
    if (sAudio) { try { sAudio.pause(); } catch (e) { } sAudio = null; }
    var settled = false, tried = false;
    var fail = function () { if (!settled) { settled = true; App.toast('语音播放失败'); } };
    var ok = function () { settled = true; };

    var tryBlob = function () {
      try {
        fetch(url, { credentials: 'same-origin' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        }).then(function (buf) {
          var type = 'audio/webm';
          if (/\.m4a|mp4/i.test(url)) type = 'audio/mp4';
          else if (/\.mp3/i.test(url)) type = 'audio/mpeg';
          else if (/\.wav/i.test(url)) type = 'audio/wav';
          var b = new Blob([buf], { type: type });
          var a2 = new Audio(URL.createObjectURL(b));
          sAudio = a2;
          a2.onplaying = ok; a2.onerror = fail;
          var p2 = a2.play();
          if (p2 && p2.catch) p2.catch(fail);
        })['catch'](fail);
      } catch (e) { fail(); }
    };

    var a = new Audio(url);
    sAudio = a;
    /* 只有「还没真正出声」才允许走兜底；已经在播就不要再来一遍 */
    a.onplaying = ok;
    a.onerror = function () { if (!settled && !tried) { tried = true; tryBlob(); } };
    var p = a.play();
    if (p && p.catch) p.catch(function () { if (!settled && !tried) { tried = true; tryBlob(); } });
  }

  /* 发送兜底：若 curRid 因切后台/收起而丢失，服务端会回「会话不存在」。
     这里先把消息缓存下来，重新拉取会话后自动补发一次 —— 否则用户看到的
     就是「选完图片点发送 → 退回主界面 → 发送失败」，完全不知道发生了什么。 */
  var pending = null;
  function send(obj) {
    if (!curRid) {
      pending = obj;
      App.toast('正在恢复会话…');
      Net.send({ t: 'secret:rooms' });
      setTimeout(function () {
        if (pending && curRid) { Net.send({ t: 'secret:send', rid: curRid, msg: pending }); pending = null; App.toast('已发送'); }
        else if (pending) { pending = null; App.toast('会话已失效，请重新进入'); }
      }, 1200);
      return;
    }
    Net.send({ t: 'secret:send', rid: curRid, msg: obj });
  }
  function sendText() {
    var el = document.getElementById('s-input'); if (!el) return;
    var v = el.value.trim(); if (!v) return;
    el.value = ''; send({ kind: 'text', text: v }); Sfx.send();
  }
  function up(file, kind) {
    if (!file) return;
    if (file.size > 300 * 1024 * 1024) return App.toast('文件太大，上限 300MB');
    App.toast('发送中…');
    Net.upload(file, kind, 0).then(function (r) {
      if (r.err) return App.toast(r.err);
      send({ kind: kind, url: r.url, name: r.name, size: r.size });
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"\u201c]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function sz(b) { if (!b) return ''; var u = ['B', 'KB', 'MB', 'GB'], i = 0; while (b > 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + u[i]; }
  /* 打开大图 / 大屏播放：直接用主聊天那套（自带「保存到手机」） */
  function openViewer(src, isVideo, name) {
    /* 统一走 App.viewMedia：先取 blob 再渲染，绕开 Content-Type / Range 导致的打不开 */
    try { App.viewMedia(src, isVideo, name); return; } catch (e) { }
  }

  /* 保存到手机：优先走原生 DownloadManager。
     以前这里用 window.open —— Capacitor WebView 会把 App 切到系统浏览器，
     表现就是「点了文档 App 直接重启」，所以必须改掉。 */
  function saveS(url, name) {
    try {
      if (window.Chat && typeof window.Chat.saveToDevice === 'function') { window.Chat.saveToDevice(url, name); return; }
    } catch (e) { }
    try {
      var u = url.indexOf('dl=1') >= 0 ? url : (url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dl=1');
      var a = document.createElement('a');
      a.href = u; a.download = String(name || 'file').replace(/[\\/:*?"<>|]/g, '_');
      a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click();
      setTimeout(function () { a.remove(); }, 1500);
      App.toast('已开始下载');
    } catch (e) { App.toast('保存失败'); }
  }
  /* 长按：手指轻微抖动不打断（超过 10px 才算拖动取消），否则在手机上很难触发 */
  /* 长按：安卓 WebView 默认会弹系统「复制/选择」菜单打断 JS 长按，
     所以必须阻止 contextmenu；同时去掉过于敏感的 pointerleave
     （手指轻微移动就会取消，导致手机上几乎触发不了）。 */
  function longPress(el, fn) {
    var t = null, x0 = 0, y0 = 0;
    function clear() { if (t) { clearTimeout(t); t = null; } }
    el.addEventListener('pointerdown', function (e) {
      x0 = e.clientX; y0 = e.clientY;
      clear(); t = setTimeout(fn, 500);
    });
    el.addEventListener('pointermove', function (e) {
      if (Math.abs(e.clientX - x0) > 14 || Math.abs(e.clientY - y0) > 14) clear();
    });
    ['pointerup', 'pointercancel'].forEach(function (n) { el.addEventListener(n, clear); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
    function withUser(pid) { if (!pid) return; Net.send({ t: 'secret:create', withPid: pid }); }
  function pullState() { Net.send({ t: 'loc:state' }); }

  /* 原生层（MainActivity.onPause）会在 Activity 真正暂停前同步调用它，
     比 WebView 的 pause 事件更早，锁屏快照里就不会留下好友空间。
     挂在模块顶层：不管 init() 有没有跑，原生层随时都能调用。 */
  window.__ddzSecretPanic = function () {
    try {
      if (!root) return;
      root.style.display = 'none'; root.style.visibility = 'hidden';
      close();
      if (window.App && App.go) App.go('home');
    } catch (e) { }
  };

  return { init: init, enter: enter, close: close, withUser: withUser, panic: panic,
    __root: function () { return root; }, __rid: function () { return curRid; },
    __openShell: function () { openShell(); return !!root; }, __playAudio: function (u) { playSAudio(u); },
    __locHist: function (pid) { openLocHist(pid || (curOther && curOther.pid)); },
    __locRender: function (m) { renderLocHist(m); },
    __fav: function (k) { favCurKind = k || ''; openFav(favCurKind); },
    __favRender: function (m) { renderFav(m); },
    rooms: function () { return rooms; },
    peek: function () { peeking = true; Net.send({ t: 'secret:status' }); },
    pullState: pullState, exitSel: exitSSel, otherOf: function (uid) { return null; } };

  /* ---------------- 多选删除（私密空间） ---------------- */
  function sBarHtml(kind) {
    var n = kind === 'room' ? sSelRooms.size : sSelMsgs.size;
    var total = kind === 'room' ? rooms.length : msgs.length;
    return '<div class="selbar s">' +
      '<button class="sb" data-a="all">' + (n >= total && total > 0 ? '取消全选' : '全选') + '</button>' +
      '<div class="sb-n">已选 <b>' + n + '</b> 项</div>' +
      '<button class="sb danger" data-a="del"' + (n ? '' : ' disabled') + '>删除</button>' +
      '<button class="sb" data-a="cancel">取消</button></div>';
  }
  function ensureSBar(kind) {
    if (!root) return;
    var b = document.getElementById('selbar');
    if (!b) { b = document.createElement('div'); b.id = 'selbar'; root.appendChild(b); }
    b.className = 'selbar s';
    b.innerHTML = sBarHtml(kind);
    b.querySelectorAll('[data-a]').forEach(function (x) {
      x.onclick = function () {
        var a = x.dataset.a;
        if (a === 'cancel') exitSSel();
        else if (a === 'all') {
          if (kind === 'room') {
            if (sSelRooms.size >= rooms.length) sSelRooms.clear();
            else rooms.forEach(function (r) { sSelRooms.add(r.rid); });
            renderRooms(rooms);
          } else {
            if (sSelMsgs.size >= msgs.length) sSelMsgs.clear();
            else msgs.forEach(function (m) { sSelMsgs.add(String(m.id)); });
            renderSMsgs();
          }
        } else if (a === 'del') {
          if (kind === 'room') delSRooms(); else delSMsgs();
        }
      };
    });
  }
  function paintRoomSel() {
    var old = document.getElementById('selbar');
    if (sSelMode !== 'room') { if (old) old.remove(); return; }
    ensureSBar('room');
  }
  function paintMsgSel() {
    var old = document.getElementById('selbar');
    if (sSelMode !== 'msg') { if (old) old.remove(); return; }
    ensureSBar('msg');
  }
  function exitSSel() {
    var was = sSelMode;
    sSelMode = null; sSelRooms.clear(); sSelMsgs.clear();
    var b = document.getElementById('selbar'); if (b) b.remove();
    // 退出后把勾选框从界面上抹掉
    try {
      if (was === 'room' && document.getElementById('s-body')) renderRooms(rooms);
      if (was === 'msg' && document.getElementById('s-msgs')) renderSMsgs();
    } catch (e) { }
  }
  function enterRoomSel(first) {
    sSelMode = 'room'; sSelRooms.clear();
    if (first) sSelRooms.add(first);
    renderRooms(rooms);
  }
  function toggleRoom(rid) {
    if (sSelRooms.has(rid)) sSelRooms.delete(rid); else sSelRooms.add(rid);
    renderRooms(rooms);
  }
  function delSRooms() {
    var list = Array.from(sSelRooms);
    if (!list.length) return;
    App.confirm('删除选中的 ' + list.length + ' 个私密会话？', '只在你这边删除，对方仍能看到', function () {
      Net.send({ t: 'secret:hidebatch', rids: list });
      rooms = rooms.filter(function (r) { return list.indexOf(r.rid) < 0; });
      exitSSel();
      App.toast('已删除 ' + list.length + ' 个会话');
    });
  }
  function enterSMsgSel(first) {
    if (!curRid) return;
    sSelMode = 'msg'; sSelMsgs.clear();
    if (first) sSelMsgs.add(String(first));
    renderSMsgs();
  }
  function toggleSMsg(id) {
    id = String(id);
    if (sSelMsgs.has(id)) sSelMsgs.delete(id); else sSelMsgs.add(id);
    renderSMsgs();
  }
  function delSMsgs() {
    var list = Array.from(sSelMsgs);
    if (!list.length || !curRid) return;
    App.confirm('删除选中的 ' + list.length + ' 条消息？', '只在你这边删除，对方仍能看到', function () {
      Net.send({ t: 'secret:delmsgs', rid: curRid, ids: list });
      msgs = msgs.filter(function (x) { return list.indexOf(String(x.id)) < 0; });
      exitSSel();
      App.toast('已删除 ' + list.length + ' 条消息');
    });
  }
})();
