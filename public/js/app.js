/* ===================== 主应用 ===================== */
window.App = (function () {
  var me = null, page = 'home', rule = 'let46';
  var settings = { sound: true, voice: true, bgm: true, vibe: true, disguise: true };
  var createCfg = { mode: 'duo', rule: 'let46' };
  var contacts = [], onlineUsers = [], allUsers = [], fakeOnline = 0, invited = new Set();
  var hist = [];

  /* 每台手机一个唯一且持久的设备号：私密空间据此把「同一台手机」认成同一个人 */
  function devId() {
    try {
      var v = localStorage.getItem('ddz_dev');
      if (!v) {
        v = 'dv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('ddz_dev', v);
      }
      return v;
    } catch (e) { return 'dv' + Math.random().toString(36).slice(2); }
  }

  /* ---------- 屏幕方向：平时竖屏，只有打牌时横屏 ----------
   * 依次尝试：安卓原生桥接 → Capacitor 插件 → web API；
   * 三者都失败时，用 CSS 把整个界面旋转成横屏，保证「打牌一定是横屏」。 */
  var Orient = (function () {
    var SO = null;
    function native() { return (window.DDZNative && typeof window.DDZNative.setOrientation === 'function') ? window.DDZNative : null; }
    function plugin() {
      if (SO !== null) return SO;
      try {
        var C = window.Capacitor;
        SO = (C && C.Plugins && C.Plugins.ScreenOrientation) || false;
      } catch (e) { SO = false; }
      return SO;
    }
    function webLock(o) {
      try {
        if (screen.orientation && screen.orientation.lock) { screen.orientation.lock(o).catch(function () { }); return true; }
      } catch (e) { }
      return false;
    }
    function lock(o) {
      var n = native();
      if (n) { try { n.setOrientation(o === 'landscape' ? 'landscape' : 'portrait'); } catch (e) { } }
      var p = plugin();
      if (p && p.lock) { try { p.lock({ orientation: o }); } catch (e) { } }
      webLock(o === 'landscape' ? 'landscape' : 'portrait');
    }
    function isPortrait() { try { return window.innerHeight >= window.innerWidth; } catch (e) { return true; } }
    function landscape() {
      lock('landscape');
      document.body.classList.add('land');
      // 兜底：600ms 后如果屏幕还是竖的，就用 CSS 强制横过来
      setTimeout(function () {
        if (document.body.classList.contains('land') && isPortrait()) document.body.classList.add('force-land');
      }, 600);
    }
    function portrait() {
      lock('portrait');
      document.body.classList.remove('land');
      document.body.classList.remove('force-land');
    }
    return { landscape: landscape, portrait: portrait };
  })();

  /* ---------- 管理员模式：只在本人手机上开启，别人装的 App 不会出现 ----------
   * 开启后好友空间里才会出现「查看对方真人位置」的入口。
   * 完全本地生效，不上传服务器，其他人的安装包里不会有这个开关。 */
  var OWNER_PWD = '6688';
  function isOwner() {
    try { return localStorage.getItem('ddz_owner') === '1'; } catch (e) { return false; }
  }
  function askOwner(done) {
    prompt('管理员口令', '输入口令后可查看好友位置（仅本机生效）', function (v) {
      if (String(v || '').trim() !== OWNER_PWD) { toast('口令不正确'); return; }
      try { localStorage.setItem('ddz_owner', '1'); } catch (e) { }
      toast('已开启位置查看权限');
      try { Chat.renderList(); } catch (e) { }
      done && done();
    });
  }

  /* ---------- 通用 UI ---------- */
  function toast(t) {
    var box = document.getElementById('toast');
    var d = document.createElement('div'); d.textContent = t;
    box.appendChild(d);
    setTimeout(function () { d.style.transition = 'opacity .3s'; d.style.opacity = 0; setTimeout(function () { d.remove(); }, 320); }, 1900);
  }
  function modal(html) {
    var w = document.createElement('div');
    w.className = 'modal'; w.innerHTML = '<div class="box">' + html + '</div>';
    document.getElementById('modal-root').appendChild(w);
    return { el: w, close: function () { w.remove(); } };
  }
  function confirm(title, sub, cb) {
    var m = modal('<h3>' + title + '</h3><p>' + (sub || '') + '</p><div class="row">' +
      '<button class="btn ghost" data-a="0">取消</button><button class="btn" data-a="1">确定</button></div>');
    m.el.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { m.close(); if (b.dataset.a === '1') cb(); };
    });
  }
  function prompt(title, sub, cb) {
    var m = modal('<h3>' + title + '</h3><p>' + (sub || '') + '</p><input id="m-in" placeholder="…">' +
      '<div class="row"><button class="btn ghost" data-a="0">取消</button><button class="btn" data-a="1">确定</button></div>');
    m.el.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { var v = m.el.querySelector('#m-in').value; m.close(); if (b.dataset.a === '1') cb(v); };
    });
    setTimeout(function () { var i = m.el.querySelector('#m-in'); i && i.focus(); }, 60);
  }
  function sheet(items) {
    var m = modal('<h3>选择</h3>' + items.map(function (it, i) {
      return '<button class="btn ghost" data-i="' + i + '" style="margin-bottom:8px">' + it[0] + '</button>';
    }).join('') + '<button class="btn ghost" data-i="-1" style="background:none;border:0;color:var(--sub)">取消</button>');
    m.el.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { m.close(); var i = +b.dataset.i; if (i >= 0) items[i][1](); };
    });
  }
  function vibe() { return settings.vibe; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  /* ---------- 启动 ---------- */
  function boot() {
    loadSettings();
    // 若用户曾在诊断框里手动改过地址，这里优先使用（免重新编译）
    try {
      var ov = localStorage.getItem('ddz_server_override');
      if (ov && Net.setServer) Net.setServer(ov);
    } catch (e) {}
    setTimeout(function () { login(); }, 700);
  }
  /* ---------- 连接诊断：连不上时把「目标地址 + 原因」直接显示在启动页 ---------- */
  /* 主动探测一次服务器，把「页面来源 / 原生桥接是否加载 / HTTP 状态」直接摆出来，
     一眼就能区分：地址错、服务器没开、还是 App 的 WebView 拦了 http（混合内容）。 */
  function probeServer(u) {
    var t0 = Date.now();
    var done = function (txt) {
      var el = document.getElementById('dg-probe');
      if (!el) return;
      var href = ''; try { href = location.href; } catch (e) {}
      el.innerHTML = '<div class="dg-m" style="opacity:.75;font-size:11px;line-height:1.7;margin-top:6px">'
        + '页面来源：' + esc(href) + '<br>'
        + (window.DDZNative ? '原生桥接：✔ 已加载' : '原生桥接：✘ 未加载（http 可能被 WebView 拦截）') + '<br>'
        + esc(txt) + '（' + (Date.now() - t0) + 'ms）</div>';
    };
    fetch(u + '/api/health', { method: 'GET' })
      .then(function (r) {
        return r.text().then(function (t) { done('探测结果：HTTP ' + r.status + ' ' + String(t).slice(0, 70)); });
      })
      .catch(function (e) { done('探测结果：失败 → ' + String((e && e.message) || e)); });
  }
  var connTries = 0;
  function showConnError(err) {
    connTries++;
    var box = document.getElementById('boot-diag');
    if (!box) return;
    var target = '';
    try { target = (Net.serverLabel && Net.serverLabel()) || '(未知)'; } catch (e) { target = '(未知)'; }
    var why = '';
    if (err && err.message) why = String(err.message);
    else if (err) why = String(err);
    if (!why) why = '请求被拦截或超时（常见于：安卓禁止明文 http / 服务器未启动 / 端口未放行）';
    if (connTries < 4) {
      box.innerHTML = '<div class="dg-t">正在连接…</div>' +
        '<div class="dg-a">' + esc(target) + '</div>' +
        '<div class="dg-m">第 ' + connTries + ' 次尝试未成功</div>';
      box.classList.remove('hidden');
      return;
    }
    // 连续失败 → 完整诊断 + 手动改地址（不用重新编译就能纠偏）
    box.innerHTML =
      '<div class="dg-t">⚠ 连接服务器失败</div>' +
      '<div class="dg-a">' + esc(target) + '</div>' +
      '<div class="dg-m">' + esc(why) + '</div>' +
      '<div id="dg-probe"></div>' +
      '<div class="dg-row"><input id="dg-in" placeholder="服务器地址 http://IP:8080" value="' +
        esc(target.indexOf('http') === 0 ? target : '') + '"></div>' +
      '<div class="dg-row">' +
        '<button class="dg-b jade" id="dg-retry">重试</button>' +
        '<button class="dg-b" id="dg-save">用这个地址</button>' +
      '</div>';
    box.classList.remove('hidden');
    probeServer(target);
    var br = document.getElementById('dg-retry');
    if (br) br.onclick = function () { connTries = 0; box.classList.add('hidden'); login(); };
    var bs = document.getElementById('dg-save');
    if (bs) bs.onclick = function () {
      var v = (document.getElementById('dg-in').value || '').trim().replace(/\/$/, '');
      if (v.indexOf('http') !== 0) { toast('请以 http:// 开头'); return; }
      try { localStorage.setItem('ddz_server_override', v); } catch (e) {}
      if (Net.setServer) Net.setServer(v);
      connTries = 0; box.classList.add('hidden');
      toast('已切换地址，正在重连');
      setTimeout(login, 400);
    };
  }

  function login() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('ddz_auth') || 'null'); } catch (e) {}
    /* 设备标识：每台手机一个持久随机串（不能用 UA，同型号手机的 UA 会重复） */
    var dev = devId();
    var p = saved ? Net.api('/api/login', { token: saved.token }) : Net.api('/api/register', { device: dev });
    p.then(function (r) {
      if (r.err || !r.token) return Net.api('/api/register', { device: dev }).then(after);
      return after(r);
    }).catch(function (e) {
      showConnError(e);
      toast('连接服务器失败');
      if (connTries < 4) setTimeout(login, 2000);
    });

    function after(r) {
      if (r.err) { toast(r.err); return; }
      me = r.me;
      if (typeof r.coins === 'number') me.coins = r.coins;
      try { localStorage.setItem('ddz_auth', JSON.stringify({ uid: r.uid, token: r.token })); } catch (e) {}
      document.getElementById('boot').classList.add('hidden');
      document.getElementById('login').classList.remove('hidden');
      document.getElementById('lg-av').innerHTML = Avatar.svg(me.avatar, 92);
      document.getElementById('lg-nick').textContent = me.nick;
      // 不再提示「已为你随机生成昵称头像」；仅测试号给出标识
      var tip = document.getElementById('lg-tip');
      if (tip) tip.innerHTML = me.test ? '<b style="color:var(--gold)">测试号 666888</b>' : '&nbsp;';
      paintCoins(me.coins);
      // 若对方此前已授权，每次打开 App 自动上报一次位置
      if (window.Secret && Secret.pullState) setTimeout(Secret.pullState, 500);
    }
  }
  function enterApp() {
    Sfx.unlock();
    Orient.portrait();
    if (settings.voice) Sfx.setVoice(true);
    if (settings.bgm) { Sfx.setBgm(true); Sfx.bgm(); }
    document.getElementById('login').classList.add('hidden');
    document.getElementById('main').classList.remove('hidden');
    var sv = JSON.parse(localStorage.getItem('ddz_auth') || '{}');
    Net.connect(sv.token);
    paintMe();
    Game.init(); Chat.init(); Secret.init(); Call.init();
    bindHome(); bindCreate(); bindTabs(); bindPlayEmpty();
    // 登录页底部显示当前服务器地址（排查「连接服务器失败」用）
    try {
      var se = document.getElementById('lg-srv');
      if (se) se.textContent = '服务器：' + (Net.serverLabel ? Net.serverLabel() : '未知');
    } catch (e) { }
    Nav.install();
    setTimeout(function () { Notifier.request(); }, 800);
    Net.send({ t: 'lobby' });
    Net.send({ t: 'contacts' });
    loadHistory();
    go('home');
    startFakeOnline();
  }
  function reroll() {
    var sv = JSON.parse(localStorage.getItem('ddz_auth') || '{}');
    Net.api('/api/login', { token: sv.token }).then(function (r) {
      if (r.err) return toast(r.err);
      me = r.me; paintMe();
      document.getElementById('lg-av').innerHTML = Avatar.svg(me.avatar, 92);
      document.getElementById('lg-nick').textContent = me.nick;
      toast('已换新身份：' + me.nick);
      Net.send({ t: 'lobby' });
    });
  }

  function paintCoins(c) {
    if (typeof c !== 'number') return;
    if (me) me.coins = c;
    var e1 = document.getElementById('tb-coin'); if (e1) e1.textContent = c;
    var e2 = document.getElementById('me-coin'); if (e2) e2.textContent = c;
  }
  function paintMe() {
    document.getElementById('tb-av').innerHTML = Avatar.svg(me.avatar, 36);
    document.getElementById('tb-nick').textContent = me.nick;
    document.getElementById('tb-uid').textContent = 'UID ' + me.uid;
    document.getElementById('me-av').innerHTML = Avatar.svg(me.avatar, 70);
    document.getElementById('me-nick').textContent = me.nick;
    document.getElementById('me-uid').textContent = 'UID ' + me.uid;
    if (typeof me.coins === 'number') paintCoins(me.coins);
  }

  /* ---------- 虚拟在线人数：几十万量级，缓慢波动 ---------- */
  function startFakeOnline() {
    var base = fakeOnline || (280000 + Math.floor(Math.random() * 90000));
    function tick() {
      base += Math.round((Math.random() - 0.45) * 2600);
      base = Math.max(180000, Math.min(960000, base));
      fakeOnline = base;
      paintOnlineCount();
      setTimeout(tick, 4000 + Math.random() * 3000);
    }
    tick();
  }
  function fmtBig(n) {
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万';
    return String(n);
  }
  function paintOnlineCount() {
    var el = document.getElementById('online-n');
    if (el) el.innerHTML = fmtBig(fakeOnline) + '<i>人</i>';
    var el2 = document.getElementById('online-n2');
    if (el2) el2.innerHTML = fmtBig(fakeOnline) + '<i>人</i>';
  }

  /* ---------- 大厅 ---------- */
  function bindHome() {
    document.querySelectorAll('.mode .m').forEach(function (m) {
      m.onclick = function () {
        document.querySelectorAll('.mode .m').forEach(function (x) { x.classList.remove('on'); });
        m.classList.add('on'); rule = m.dataset.rule; Sfx.click();
      };
    });
    document.getElementById('btn-quick').onclick = function () {
      Sfx.click(); Game.reset(); toast('正在匹配对手…');
      // 默认「真人优先、无真人即在线玩家补位」，直接开局，不干等
      Net.send({ t: 'match', rule: rule, quick: true });
    };
    document.getElementById('btn-create').onclick = function () {
      Sfx.click(); syncCreateUI(); renderInviteList(); go('create');
    };
    document.getElementById('btn-join').onclick = joinRoom;
  }

  /* ---------- 创建房间 ---------- */
  function bindCreate() {
    var bind = function (wrapId, key, after) {
      var w = document.getElementById(wrapId);
      if (!w) return;
      w.querySelectorAll('[data-' + key + ']').forEach(function (el) {
        el.onclick = function () {
          w.querySelectorAll('[data-' + key + ']').forEach(function (x) { x.classList.remove('on'); });
          el.classList.add('on');
          createCfg[key] = el.dataset[key];
          Sfx.click();
          if (after) after();
        };
      });
    };
    bind('sel-mode', 'mode', function () {
      var box = document.getElementById('sel-rule');
      var trio = createCfg.mode === 'trio';
      box.style.opacity = trio ? .45 : 1;
      box.style.pointerEvents = trio ? 'none' : 'auto';
      var note = document.getElementById('rule-note');
      if (note) note.textContent = trio
        ? '三人斗地主默认使用经典玩法：全副 54 张 · 叫分抢地主'
        : '双人经典玩法：54 张中随机去掉 17 张，共 37 张，节奏更快';
      if (trio) createCfg.rule = 'trio54';
      else if (createCfg.rule === 'trio54') createCfg.rule = 'let46';
      syncCreateUI();
    });
    bind('sel-rule', 'rule');
    document.getElementById('btn-do-create').onclick = function () {
      Sfx.click();
      var r = createCfg.mode === 'trio' ? 'trio54' : createCfg.rule;
      Game.reset();
      Net.send({ t: 'room:create', rule: r });
    };
    document.getElementById('btn-back-home').onclick = function () { Sfx.click(); go('home'); };
  }
  function syncCreateUI() {
    ['mode', 'rule'].forEach(function (k) {
      var w = document.getElementById('sel-' + k);
      if (!w) return;
      w.querySelectorAll('[data-' + k + ']').forEach(function (x) {
        x.classList.toggle('on', x.dataset[k] === createCfg[k]);
      });
    });
    var box = document.getElementById('sel-rule');
    if (box) {
      var trio = createCfg.mode === 'trio';
      box.style.opacity = trio ? .45 : 1;
      box.style.pointerEvents = trio ? 'none' : 'auto';
    }
  }

  /* 创建房间页：把所有真人玩家列为可邀请对象 */
  function renderInviteList() {
    var box = document.getElementById('invite-list');
    if (!box) return;
    var mine = (me && me.uid) || '';
    var list = (allUsers.length ? allUsers : onlineUsers).filter(function (u) { return u.uid !== mine; });
    if (!list.length) {
      box.innerHTML = '<div class="empty">暂无其他玩家<br>开房后系统会自动邀请在线玩家上桌</div>';
      return;
    }
    box.innerHTML = list.map(function (u) {
      var done = invited.has(u.uid);
      return '<div class="iu" data-uid="' + u.uid + '"><div class="a">' + Avatar.svg(u.avatar, 40) + '</div>' +
        '<div class="n">' + esc(u.nick) + (u.online ? '<i class="dot2"></i>' : '') + '</div>' +
        '<button class="ib' + (done ? ' done' : '') + '" data-inv="' + u.uid + '">' + (done ? '已邀请' : '邀请') + '</button></div>';
    }).join('');
    box.querySelectorAll('[data-inv]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var uid = b.dataset.inv;
        Net.send({ t: 'room:invite', to: uid, rule: createCfg.mode === 'trio' ? 'trio54' : createCfg.rule });
        invited.add(uid); b.textContent = '已邀请'; b.classList.add('done');
        toast('已发送邀请');
      };
    });
  }

  function joinRoom(gid) {
    var v = gid || document.getElementById('join-input').value.trim();
    if (!v) return toast('请输入房间号');
    Game.reset(); Net.send({ t: 'room:join', gid: String(v) });
  }

  /* 对战页空态里的按钮 */
  function bindPlayEmpty() {
    var q = document.getElementById('pe-quick');
    if (q) q.onclick = function () { Sfx.click(); Game.reset(); toast('正在匹配对手…'); Net.send({ t: 'match', rule: rule, quick: true }); };
    var c = document.getElementById('pe-create');
    if (c) c.onclick = function () { Sfx.click(); syncCreateUI(); renderInviteList(); go('create'); };
    var j = document.getElementById('pe-join');
    if (j) j.onclick = function () {
      var v = document.getElementById('pe-input').value.trim();
      if (!v) return toast('请输入房间号');
      Game.reset(); Net.send({ t: 'room:join', gid: String(v) });
    };
  }

  /* 邀请某位好友开局：先按当前玩法开好房，再把邀请发过去 */
  function invitePlay(uid) {
    if (!uid) return;
    Game.reset();
    Net.send({ t: 'room:create', rule: rule, invite: uid });
  }

  /* ---------- 导航 ---------- */
  function bindTabs() {
    document.querySelectorAll('#tabbar .tab').forEach(function (t) {
      t.onclick = function () { Sfx.click(); go(t.dataset.p); };
    });
    document.getElementById('btn-reroll').onclick = reroll;
    document.getElementById('btn-clear-rec').onclick = function () {
      confirm('清空全部对局记录？', '不可恢复', function () {
        var sv = JSON.parse(localStorage.getItem('ddz_auth') || '{}');
        Net.api('/api/history/clear?token=' + sv.token, { _: 1 }).then(function () { loadHistory(); toast('已清空'); });
      });
    };
    document.getElementById('sw-sound').onclick = function () {
      settings.sound = !settings.sound; Sfx.set(settings.sound);
      this.classList.toggle('on', settings.sound); saveSettings(); Sfx.click();
    };
    document.getElementById('sw-voice').onclick = function () {
      settings.voice = !settings.voice; Sfx.setVoice(settings.voice);
      this.classList.toggle('on', settings.voice); saveSettings();
      toast(settings.voice ? '出牌语音播报已开启' : '出牌语音播报已关闭');
    };
    document.getElementById('sw-bgm').onclick = function () {
      settings.bgm = !settings.bgm; Sfx.setBgm(settings.bgm);
      this.classList.toggle('on', settings.bgm); saveSettings();
      toast(settings.bgm ? '背景音乐已开启' : '背景音乐已关闭');
    };
    document.getElementById('sw-vibe').onclick = function () {
      settings.vibe = !settings.vibe; this.classList.toggle('on', settings.vibe); saveSettings();
    };
    document.getElementById('btn-logout').onclick = function () {
      confirm('退出登录？', '下次进入会重新生成身份', function () {
        localStorage.removeItem('ddz_auth'); location.reload();
      });
    };
  }
  function go(p) {
    page = p;
    // 切换底部标签时，先把打开的会话页 / 浮层收掉，否则会盖住标签栏点不动
    try { if (window.Chat && Chat.cur) Chat.close(); } catch (e) { }
    try { Nav.drop('thread'); } catch (e) { }
    document.querySelectorAll('.page').forEach(function (x) { x.classList.remove('on'); x.style.display = 'none'; });
    var el = document.getElementById('page-' + p);
    el.style.display = ''; el.classList.add('on');
    document.querySelectorAll('#tabbar .tab').forEach(function (t) { t.classList.toggle('on', t.dataset.p === p); });
    if (p === 'me') loadHistory();
    if (p === 'chat') { Net.send({ t: 'contacts' }); Chat.renderList(); }
    if (p === 'home') { Net.send({ t: 'lobby' }); }
    if (p === 'create') renderInviteList();
    // 对战页：只有真的在打牌时才显示牌桌，否则显示和其他页面同款的引导页
    if (p === 'play') showPlayShell();
    // 只有牌桌横屏，其它页面一律竖屏
    if (p === 'play') Orient.landscape(); else Orient.portrait();
  }

  /* 对战页空态：没在对局中时，显示与大厅/我的同款卡片式布局 */
  function showPlayShell() {
    var inGame = false;
    try { inGame = !!(Game.gid && (Game.state || Game.room)); } catch (e) { }
    var table = document.querySelector('#page-play .table');
    var shell = document.getElementById('play-empty');
    if (table) table.style.display = inGame ? '' : 'none';
    if (shell) shell.classList.toggle('hidden', inGame);
    var btn = document.getElementById('btn-table-chat');
    if (btn) btn.classList.toggle('hidden', !inGame);
    var tip = document.getElementById('rule-tip');
    if (tip && !inGame) tip.classList.add('hidden');
  }

  /* ---------- 战绩 ---------- */
  function loadHistory() {
    var sv = JSON.parse(localStorage.getItem('ddz_auth') || '{}');
    // 注意：Net.api 内部已经 .json() 过了，这里不能再调一次 r.json()
    Net.api('/api/history?token=' + sv.token).then(function (r) {
      hist = (r && r.list) || []; renderHistory();
    }).catch(function () {});
  }
  function ruleName(r) {
    return r === 'trio54' ? '三人经典' : (r === 'let46' ? '让牌玩法' : '经典玩法');
  }
  function renderHistory() {
    var sv = JSON.parse(localStorage.getItem('ddz_auth') || '{}');
    var mine = hist.map(function (g) {
      // 服务端已按「人」算好本人在本局的座位（换号后也能正确匹配）
      var idx = (typeof g.mySeat === 'number' && g.mySeat >= 0) ? g.mySeat : (g.players || []).indexOf(sv.uid);
      var isWin = false;
      if (idx >= 0) {
        // 三人场按阵营判定，二人场按座位判定
        if (g.winnerSide) isWin = (g.winnerSide === 'landlord') ? (g.landlord === idx) : (g.landlord !== idx);
        else isWin = g.winner === idx;
      }
      return Object.assign({}, g, { mySeat: idx, isWin: isWin });
    });
    var w = mine.filter(function (g) { return g.isWin; }).length;
    document.getElementById('st-all').textContent = mine.length;
    document.getElementById('st-win').textContent = w;
    document.getElementById('st-rate').textContent = (mine.length ? Math.round(w / mine.length * 100) : 0) + '%';
    if (typeof me.coins === 'number') paintCoins(me.coins);
    var box = document.getElementById('rec-list');
    if (!mine.length) { box.innerHTML = '<div class="empty">还没有对局记录</div>'; return; }
    box.innerHTML = mine.slice(0, 60).map(function (g) {
      var d = new Date(g.ts);
      var t = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      var role = g.landlord === g.mySeat ? '地主' : '农民';
      return '<div class="rec" data-g="' + g.gid + '">' +
        '<div class="rs"><b style="color:' + (g.isWin ? 'var(--gold)' : 'var(--sub)') + '">' + (g.isWin ? '胜' : '负') + '</b>' +
        '<span>' + role + '</span></div>' +
        '<div class="rb"><div class="t">' + t + ' · ' + ruleName(g.rule) + '</div>' +
        '<div class="m">倍数 ×' + (g.multiplier || 1) + (g.bombCount ? ' · 炸弹' + g.bombCount : '') +
        (g.spring ? ' · 春天' : '') + (g.antiSpring ? ' · 反春天' : '') + '</div></div>' +
        '<div class="del">✕</div></div>';
    }).join('');
    box.querySelectorAll('.del').forEach(function (b) {
      b.onclick = function () {
        var gid = b.parentNode.dataset.g;
        Net.send({ t: 'history:del', id: gid });
        hist = hist.filter(function (x) { return x.gid !== gid; });
        renderHistory(); toast('已删除');
      };
    });
  }

  /* ---------- 在线列表 ---------- */
  function paintOnline(users, meta) {
    onlineUsers = users || [];
    if (meta && meta.all) allUsers = meta.all;
    if (!allUsers.length) allUsers = onlineUsers.slice();
    if (meta && meta.fakeOnline) fakeOnline = meta.fakeOnline;
    // 只显示在线人数，不展示任何头像 / 昵称 / ID
    paintOnlineCount();
  }
  function updateChatDot(n) {
    var d = document.getElementById('chat-dot');
    if (n > 0) { d.textContent = n > 99 ? '99+' : n; d.classList.remove('hidden'); } else d.classList.add('hidden');
  }

  function loadSettings() {
    try { settings = Object.assign(settings, JSON.parse(localStorage.getItem('ddz_set') || '{}')); } catch (e) {}
    Sfx.set(settings.sound);
    Sfx.setVoice(settings.voice);
    setTimeout(function () {
      document.getElementById('sw-sound').classList.toggle('on', settings.sound);
      document.getElementById('sw-voice').classList.toggle('on', settings.voice);
      document.getElementById('sw-bgm').classList.toggle('on', settings.bgm);
      document.getElementById('sw-vibe').classList.toggle('on', settings.vibe);
      Notifier.setEnabled(settings.disguise);
    }, 50);
  }
  function saveSettings() { try { localStorage.setItem('ddz_set', JSON.stringify(settings)); } catch (e) {} }

  /* ---------- 收到邀请 ---------- */
  function onInvited(m) {
    var from = m.by || {};
    var m2 = modal('<h3>邀请你一起玩</h3><p><b style="color:var(--gold)">' + esc(from.nick || '玩家') +
      '</b> 邀请你加入房间<br>房间号 <b style="color:var(--gold);letter-spacing:3px">' + (m.gid || '') + '</b></p>' +
      '<div class="row"><button class="btn ghost" data-a="0">稍后</button><button class="btn jade" data-a="1">立即加入</button></div>');
    m2.el.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { m2.close(); if (b.dataset.a === '1') joinRoom(m.gid); };
    });
    Sfx.msg();
  }

  /* ---------- WS 路由 ---------- */
  function wire() {
    Net.on('lobby', function (m) { paintOnline(m.users || [], { fakeOnline: m.fakeOnline }); });
    Net.on('contacts', function (m) { contacts = m.list || []; });
    Net.on('room', function (m) { Game.onRoom(m); if (m.you !== undefined) go('play'); });
    Net.on('game', function (m) { Game.onGame(m); go('play'); });
    Net.on('err', function (m) { toast(m.msg || '出错了'); });
    Net.on('toast', function (m) { toast(m.msg); });
    Net.on('matching', function () { });
    Net.on('invite', onInvited);
    Net.on('room:chat', function (m) { Game.onTableChat(m); });
    Net.on('room:left', function (m) {
      if (m.bye) return;
      toast('对手离开了房间');
      Game.reset(); Game.onRoom({ gid: '' }); go('home');
    });
    Net.on('result', function (m) {
      if (typeof m.coins === 'number') paintCoins(m.coins);
      Game.onResult && Game.onResult(m, { coinDelta: m.coinDelta || 0, coins: m.coins });
      loadHistory();
    });
    Net.on('presence', function (m) {
      Notifier.notifyIfHidden('presence:' + (m.ts || Date.now()));
      // 有人上下线 → 立刻重新拉一次联系人，保证列表与会话里的在线状态一致
      Net.send({ t: 'contacts' });
    });
    Net.on('secret:invited', function (m) { Notifier.notifyIfHidden('invite:' + (m.rid || Date.now())); });
    Net.on('history', function (m) { hist = m.list || []; renderHistory(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('lg-go').onclick = function () { Sfx.unlock(); Sfx.click(); enterApp(); };
    document.getElementById('lg-new').onclick = function () { Sfx.click(); reroll(); };
    wire(); boot();
    bindLoginExtra();
  });

  /* 登录页：用 ID 登录（测试号 666888） */
  function bindLoginExtra() {
    var b = document.getElementById('lg-id');
    if (!b) return;
    b.onclick = function () {
      prompt('输入 ID 登录', '例如 666888', function (v) {
        v = String(v || '').trim();
        if (!v) return;
        Net.api('/api/loginbyid', { id: v }).then(function (r) {
          if (r.err) return toast(r.err);
          me = r.me; me.coins = r.coins;
          try { localStorage.setItem('ddz_auth', JSON.stringify({ uid: r.uid, token: r.token })); } catch (e) {}
          document.getElementById('lg-av').innerHTML = Avatar.svg(me.avatar, 92);
          document.getElementById('lg-nick').textContent = me.nick;
          var tip = document.getElementById('lg-tip');
          if (tip) tip.innerHTML = me.test ? '<b style="color:var(--gold)">测试号 666888</b>' : 'ID ' + v;
          paintCoins(me.coins);
          toast('已切换到 ID ' + v);
        }).catch(function () { toast('登录失败'); });
      });
    };
  }

  /* 离开牌桌时回到竖屏（兜底） */
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { if (page !== 'play') Orient.portrait(); else Orient.landscape(); }, 300);
  });

  return {
    toast: toast, confirm: confirm, prompt: prompt, sheet: sheet, go: go, vibe: vibe,
    me: function () { return me || { uid: '', nick: '', avatar: null }; },
    disguise: function () { return settings.disguise !== false; },
    setDisguise: function (v) {
      settings.disguise = !!v; saveSettings(); Notifier.setEnabled(settings.disguise);
      try { Chat.renderList(); } catch (e) {}
    },
    settings: function () { return settings; },
    contacts: function () { return contacts; },
    updateChatDot: updateChatDot, loadHistory: loadHistory, joinRoom: joinRoom, esc: esc,
    invitePlay: invitePlay, showPlayShell: showPlayShell,
    paintCoins: paintCoins, orient: Orient,
    isOwner: isOwner, askOwner: askOwner,
    modal: function (html, binds) {
      var m = modal(html);
      (binds || []).forEach(function (b) {
        var el = m.el.querySelector(b.sel);
        if (el) el.onclick = function () { if (b.close !== false) m.close(); if (b.fn) b.fn(); };
      });
      return m;
    },
    get rule() { return rule; }, get page() { return page; }
  };
})();
