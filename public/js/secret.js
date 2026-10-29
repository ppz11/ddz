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
  var curOther = null, curMe = null, personList = [];
  var locOn = false, locLast = null, myPid = null;
  /* 多选删除：'room' = 选会话，'msg' = 选消息 */
  var sSelMode = null, sSelRooms = new Set(), sSelMsgs = new Set();

  function init() {
    bindTap(document.getElementById('me-uid'), 5, 900);
    bindTap(document.getElementById('me-nick'), 5, 900);
    // 本人专属：连击 UID 8 次 → 口令开启「查看对方位置」（只在本机生效）
    bindTap(document.getElementById('me-uid'), 8, 1400, function () {
      if (App.isOwner()) { App.toast('位置查看权限已开启'); return; }
      App.askOwner(function () { if (root) renderRooms(rooms); });
    });

    Net.on('secret:status', function (m) {
      // peek：只刷新聊天页入口，不弹出暗号界面
      if (peeking) { peeking = false; rooms = m.rooms || []; return; }
      if (m.has) startTyping('check');
      else openSetPin();
    });
    Net.on('secret:ok', function (m) {
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
      renderThread();
    });
    Net.on('secret:persons', function (m) { personList = m.list || []; curMe = m.me || curMe; renderPick(); });
    Net.on('loc:state', function (m) {
      locOn = !!m.on; locLast = m.last || null;
      if (locOn) reportLoc();          // 已授权 → 本次打开自动上报一次
      var d = document.getElementById('s-loc');
      if (d) d.classList.toggle('on', locOn);
      if (document.getElementById('s-body')) renderRooms(rooms);
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
      if (m.rid === curRid) { msgs.push(m.msg); renderThread(); Sfx.msg(); }
      else Sfx.msg();
    });
    Net.on('secret:invited', function (m) { Notifier.notifyIfHidden('invite:' + (m.rid || Date.now())); });
    bindPanic();
  }

  /* ---------- 紧急退出：锁屏 / 切后台 / 摇一摇 ----------
   * 关键：所有收起动作都在事件回调里「同步」完成，不做任何动画/延时，
   * 这样系统截屏与解锁后看到的画面已经是游戏主界面，不会出现收起过程。 */
  function bindPanic() {
    function onHide() {
      if (!root) return;
      // 1) 同步隐藏：不改 DOM 结构，只置 visibility，确保本帧内渲染结果已是主界面
      try { root.style.visibility = 'hidden'; root.style.display = 'none'; } catch (e) { }
      // 2) 同步移除（含所有可能残留的节点）
      close();
      // 3) 同步回到主界面
      try { App.go('home'); } catch (e) { }
      homeSafe = true;
      // 4) 原生环境：把 App 最小化（推到后台）
      try {
        var AP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
        if (AP && AP.minimizeApp) AP.minimizeApp();
        else if (window.DDZNative && DDZNative.minimizeApp) DDZNative.minimizeApp();
      } catch (e) { }
    }
    function onShow() {
      // 解锁 / 切回前台：确保一定是主界面，且不残留好友空间
      if (homeSafe) {
        homeSafe = false;
        close();
        try { App.go('home'); } catch (e) { }
      }
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') onHide();
      else onShow();
    });
    window.addEventListener('pagehide', onHide);
    window.addEventListener('blur', function () { setTimeout(onHide, 0); });
    window.addEventListener('focus', onShow);
    // 部分 WebView 只派发 freeze / beforeunload，这里一并兜住
    window.addEventListener('freeze', onHide);
    window.addEventListener('beforeunload', onHide);
    try {
      var AP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (AP && AP.addListener) {
        AP.addListener('appStateChange', function (st) { if (!st || !st.isActive) onHide(); else onShow(); });
        AP.addListener('pause', onHide);
        AP.addListener('resume', onShow);
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
    // 桌面端兜底：连按 Esc 也能退出
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') panic(); });
  }

  function panic() {
    if (!root) return;
    try { root.style.display = 'none'; root.style.visibility = 'hidden'; } catch (e) { }
    close();
    try { App.go('home'); } catch (e) { }
    homeSafe = true;
    if (App.vibe() && navigator.vibrate) { try { navigator.vibrate(10); } catch (e) { } }
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
    if (root) { root.style.display = ''; root.style.visibility = ''; startIdle(); return; }
    root = document.createElement('div');
    root.className = 'secret'; root.id = 'secret-root';
    // 背景与游戏主界面完全一致（同一张牌桌绿呢），从外面看不出区别
    root.innerHTML = '<div class="felt"></div>' +
      '<div class="shead"><span style="font-size:16px">🔒</span><div class="t">好 友 空 间</div>' +
      '<div class="sp"></div><span class="sidle" id="s-idle">60</span>' +
      '<span class="dotloc' + (locOn ? ' on' : '') + '" id="s-loc" title="位置">◉</span>' +
      '<div class="x" id="s-x">✕</div></div><div class="body" id="s-body"></div>' +
      '<div class="tagline">本空间内容不出现在主聊天列表 · 摇一摇 / 切后台 立即回到主界面</div>';
    document.getElementById('app').appendChild(root);
    bindLocDot();
    root.querySelector('#s-x').onclick = function () { close(); try { App.go('home'); } catch (e) { } };
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
  function renderRooms(list) {
    rooms = list || [];
    var b = document.getElementById('s-body'); if (!b) return;
    var head = '<div class="srow">' +
      '<div><div style="font-size:13px">隐私伪装模式</div>' +
      '<div style="font-size:10px;color:#5c6b66;margin-top:2px">开启后会话内容会被隐藏（含语音/图片）</div></div>' +
      '<button class="sw' + (App.disguise() ? ' on' : '') + '" id="s-disguise"><i></i></button></div>' +
      '<div class="slist-hd"><span>私密会话</span><button id="s-manage">管理</button></div>';
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
          '<span class="fix">固定身份</span></div>' +
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
      var sb = b.querySelector('#s-manage');
      if (sb) {
        sb.textContent = sSelMode === 'room' ? '完成' : '管理';
        sb.onclick = function () { if (sSelMode === 'room') exitSel(); else enterRoomSel(); };
      }
    }
    var dg = b.querySelector('#s-disguise');
    if (dg) dg.onclick = function () {
      var v = !App.disguise();
      App.setDisguise(v);
      dg.classList.toggle('on', v);
      Sfx.click();
      App.toast(v ? '隐私伪装已开启' : '隐私伪装已关闭');
    };
    var np = b.querySelector('#s-new');
    if (np) np.onclick = function () { Net.send({ t: 'secret:persons' }); };
    var pp = b.querySelector('#s-pin');
    if (pp) pp.onclick = function () {
      mode = 'set'; pinBuf = ''; typing = true;
      App.toast('请输入新的 4 位暗号'); startTyping('set');
    };

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
    reportLoc();
  }
  function reportLoc() {
    if (!navigator.geolocation) { App.toast('本设备不支持定位'); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      Net.send({ t: 'loc:report', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || 0 });
    }, function () { }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  /* ---------- 查看对方位置 ---------- */
  function viewLoc() {
    if (!curOther || !curOther.pid) return;
    Net.send({ t: 'loc:get', pid: curOther.pid });
  }
  function showLoc(m) {
    if (!m.ok) { App.toast(m.err || '暂时无法查看'); return; }
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
      '<button class="btn" id="lc-map">地图查看</button></div>',
      [{ sel: '#lc-no', fn: null },
       { sel: '#lc-map', fn: function () { window.open(url, '_blank'); } }]);
  }

  /* ---------- 选择一位真人建会话 ---------- */
  function renderPick() {
    var b = document.getElementById('s-body'); if (!b) return;
    var list = personList.filter(function (p) { return p && p.pid; });
    b.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px">' +
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
    b.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:6px 4px 10px">' +
      '<button class="btn ghost sm" id="s-back" style="width:70px">‹ 返回</button>' +
      '<div style="flex:1;font-size:13px;text-align:center;color:#8b7fd4">🔒 ' +
      esc((curOther && curOther.nick) || '私密会话') + '</div>' +
      (App.isOwner() ? '<button class="btn ghost sm" id="s-locv" style="width:70px">📍 位置</button>' : '') +
      '<button class="btn ghost sm" id="s-call" style="width:52px">📞</button>' +
      '<button class="btn ghost sm" id="s-clr" style="width:52px">清空</button></div>' +
      '<div id="s-msgs" style="display:flex;flex-direction:column;gap:9px;padding-bottom:80px"></div>' +
      '<div style="position:sticky;bottom:0;display:flex;gap:8px;padding-top:8px;background:rgba(4,21,15,.92);backdrop-filter:blur(6px)">' +
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
      var ex = { pid: o.pid, nick: o.nick, avatar: o.avatar };
      App.sheet([['📞 语音通话', function () { Call.start('', 'audio', ex); }],
        ['📹 视频通话', function () { Call.start('', 'video', ex); }]]);
    };
    b.querySelector('#s-clr').onclick = function () {
      App.confirm('清空该会话全部记录？', '不可恢复', function () { Net.send({ t: 'secret:clear', rid: curRid }); });
    };
    b.querySelector('#s-send').onclick = sendText;
    b.querySelector('#s-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendText(); });
    b.querySelector('#s-emo').onclick = toggleEmoji;
    Rec.hold(b.querySelector('#s-voice'), function (r) {
      App.toast('发送中…');
      Net.upload(r.file, 'voice', r.dur).then(function (up) {
        if (up.err) return App.toast(up.err);
        send({ kind: 'voice', url: up.url, dur: r.dur, name: r.file.name, size: r.file.size });
        App.toast('已发送');
      }).catch(function () { App.toast('发送失败'); });
    });
    b.querySelector('#s-add').onclick = function () {
      App.sheet([['🖼 图片', function () { document.getElementById('s-img').click(); }],
        ['🎬 视频', function () { document.getElementById('s-vid').click(); }],
        ['📎 文件', function () { document.getElementById('s-file').click(); }]]);
    };
    document.getElementById('s-img').onchange = function (e) { up(e.target.files[0], 'image'); };
    document.getElementById('s-vid').onchange = function (e) { up(e.target.files[0], 'video'); };
    document.getElementById('s-file').onchange = function (e) { up(e.target.files[0], 'file'); };
    // 会话内返回：左滑 / 右滑 → 回列表（不重输暗号）
    Nav.push(backToList, 'secret-thread');
    renderSMsgs();
    setTimeout(function () { b.scrollTop = b.scrollHeight; }, 60);
  }

  /* 返回私密会话列表：只做本地渲染，不再走 secret:status（避免弹暗号） */
  function backToList() {
    try { Nav.drop('secret-thread'); } catch (e) { }
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
    p.innerHTML = '<div class="tabs">' +
      '<button class="on" data-p="face">表情</button><button data-p="obj">物件</button><button data-p="emoji">Emoji</button></div>' +
      '<div class="grid" id="s-eg"></div>';
    root.appendChild(p);
    fillEmoji('face');
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
  function fillEmoji(k) {
    var g = document.getElementById('s-eg'); if (!g) return;
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
  function renderSMsgs() {
    var box = document.getElementById('s-msgs'); if (!box) return;
    var me = App.me().uid;
    box.innerHTML = msgs.map(function (m) {
      var mine = m.from === me;
      var who = mine ? (curMe || App.me()) : (curOther || {});
      var body = '';
      if (m.kind === 'sticker') {
        if (m.sticker.pack === 'emoji') {
          body = '<div style="font-size:42px;line-height:1.2">' + (Stickers.EMOJI[m.sticker.id] || '🙂') + '</div>';
        } else {
          var svg = Stickers.html(m.sticker.pack, m.sticker.id);
          body = svg || ('<div style="font-size:40px">' + (Stickers.EMOJI[m.sticker.id] || '🙂') + '</div>');
        }
      } else if (m.kind === 'image') body = '<img src="' + Net.abs(m.url) + '" style="max-width:200px;border-radius:12px">';
      else if (m.kind === 'video') body = '<video src="' + Net.abs(m.url) + '" controls playsinline style="width:200px"></video>';
      else if (m.kind === 'voice') body = '<div style="display:flex;gap:6px;align-items:center">🔊 <span data-p="' + Net.abs(m.url) + '">▶ 语音 ' + (m.dur || 0) + '″</span></div>';
      else if (m.kind === 'file') body = '<div style="display:flex;gap:6px;align-items:center">📄 <span data-d="' + m.url + '">' + esc(m.name) + '</span></div>';
      else body = esc(m.text);
      var mpick = sSelMode === 'msg'
        ? '<div class="pick' + (sSelMsgs.has(String(m.id)) ? ' on' : '') + '" data-smpick="' + m.id + '"></div>'
        : '';
      return '<div class="msg ' + (mine ? 'me' : '') + (sSelMsgs.has(String(m.id)) ? ' picked' : '') + '" data-id="' + m.id + '">' +
        mpick +
        '<div class="a">' + Avatar.svg(who.avatar, 32) + '</div>' +
        '<div class="bub" style="' + (mine ? 'background:#8b7fd4;color:#fff' : '') + '">' + body + '</div></div>';
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
        App.sheet([
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
    box.querySelectorAll('[data-p]').forEach(function (e) { e.onclick = function () { new Audio(e.dataset.p).play(); }; });
    box.querySelectorAll('[data-d]').forEach(function (e) { e.onclick = function () { window.open(e.dataset.d, '_blank'); }; });
  }
  function send(obj) { Net.send({ t: 'secret:send', rid: curRid, msg: obj }); }
  function sendText() {
    var el = document.getElementById('s-input'); if (!el) return;
    var v = el.value.trim(); if (!v) return;
    el.value = ''; send({ kind: 'text', text: v }); Sfx.send();
  }
  function up(file, kind) {
    if (!file) return;
    if (file.size > 26 * 1024 * 1024) return App.toast('文件太大');
    App.toast('发送中…');
    Net.upload(file, kind, 0).then(function (r) {
      if (r.err) return App.toast(r.err);
      send({ kind: kind, url: r.url, name: r.name, size: r.size });
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  /* 长按：手指轻微抖动不打断（超过 10px 才算拖动取消），否则在手机上很难触发 */
  function longPress(el, fn) {
    var t = null, ms = arguments.length > 2 ? arguments[2] : 550;
    var x0 = 0, y0 = 0;
    el.addEventListener('pointerdown', function (e) {
      x0 = e.clientX; y0 = e.clientY;
      clearTimeout(t); t = setTimeout(fn, ms);
    });
    el.addEventListener('pointermove', function (e) {
      if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) clearTimeout(t);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (e) { el.addEventListener(e, function () { clearTimeout(t); }); });
  }
    function withUser(pid) { if (!pid) return; Net.send({ t: 'secret:create', withPid: pid }); }
  function pullState() { Net.send({ t: 'loc:state' }); }

  return { init: init, enter: enter, close: close, withUser: withUser, panic: panic,
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
