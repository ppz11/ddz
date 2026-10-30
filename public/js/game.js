/* ===================== 牌桌界面与交互（支持双人 / 三人 / 在线玩家补位） ===================== */
window.Game = (function () {
  var S = null, sel = {}, gid = null, rule = 'let46', dealAnim = false, mySeat = 0;
  var timer = null, left = 0, over = false, myRoom = null;
  var hintCycle = 0, lastHintKey = '';
  var tcMsgs = [], tcOpen = false, tcRec = null, tcChunks = [], tcStream = null, tcStart = 0, tcCancel = false;

  var SUIT = { S: '♠', H: '♥', C: '♣', D: '♦' };
  /* 服务端广播的真人玩家名单（lobby.all），供「邀请在线好友」选择框使用。
     以前「邀请在线玩家」直接补一个机器人，真人根本没被通知到。 */
  var roster = [];

  /* 大王小王：手绘 SVG 皇冠 + 角标 + 描边大字。
     原来用 ♛♕ 字符，不同手机上字体渲染差异很大（有的显示成方块），看着就丑。
     改成内联 SVG，任何手机都是同一个精致造型。 */
  var CROWN_SVG =
    '<svg class="jk-crown" viewBox="0 0 24 18" aria-hidden="true">' +
    '<defs><linearGradient id="ckg" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#c9962f"/>' +
    '</linearGradient></defs>' +
    '<path d="M2.2 15.5 L3.6 5.2 L7.6 10.2 L12 2.6 L16.4 10.2 L20.4 5.2 L21.8 15.5 Z" ' +
    'fill="url(#ckg)" stroke="#8a6318" stroke-width="0.7" stroke-linejoin="round"/>' +
    '<rect x="1.6" y="15.2" width="20.8" height="2.1" rx="0.9" fill="url(#ckg)" stroke="#8a6318" stroke-width="0.7"/>' +
    '<circle cx="12" cy="1.2" r="1.1" fill="#ffe9a8" stroke="#8a6318" stroke-width="0.5"/>' +
    '<circle cx="3.6" cy="4.2" r="1" fill="#ffe9a8" stroke="#8a6318" stroke-width="0.5"/>' +
    '<circle cx="20.4" cy="4.2" r="1" fill="#ffe9a8" stroke="#8a6318" stroke-width="0.5"/>' +
    '</svg>';
  function jokerInner(c, small) {
    var big = c.joker === 'big';
    var tag = big ? '大' : '小';
    if (small) {
      /* 小尺寸（出牌区 / 底牌）：皇冠 + 一个「王」字 + 左上角标 */
      return '<div class="ctr jk-mini' + (big ? ' b' : '') + '">' +
        '<span class="jk-tag">' + tag + '</span>' +
        '<span class="jk-w">王</span></div>';
    }
    return '<div class="ctr jk-full' + (big ? ' b' : '') + '">' +
      '<span class="jk-corner">' + tag + '</span>' +
      CROWN_SVG +
      '<div class="jk-w">王</div>' +
      '<div class="jk-en">JOKER</div></div>';
  }
  function cardHTML(c, cls) {
    if (!c) return '';
    var col = c.red ? 'red' : 'black';
    if (c.joker) {
      var small = cls && (cls.indexOf('mini') >= 0 || cls.indexOf('tiny') >= 0);
      return '<div class="pc joker ' + col + ' ' + (cls || '') + '" data-id="' + c.id + '">' + jokerInner(c, small) + '</div>';
    }
    return '<div class="pc ' + col + ' ' + (cls || '') + '" data-id="' + c.id + '">' +
      '<div class="rk">' + c.r + '</div><div class="su">' + SUIT[c.s] + '</div>' +
      '<div class="big">' + SUIT[c.s] + '</div><div class="ctr" style="opacity:0"></div></div>';
  }
  /* 打出的牌像真牌一样叠着放：牌越多叠得越紧，绝不撑破屏幕。
     尺寸跟着屏幕高度走 —— 牌太小看不清点数，太大又会挤爆牌桌。 */
  function rowHTML(cards, cls) {
    if (!cards || !cards.length) return '';
    var n = cards.length;
    var vh = 0;
    try { vh = window.innerHeight || 0; } catch (e) { }
    if (!vh) vh = 640;
    var sz;
    if (vh < 380) sz = n > 6 ? 'tiny' : 'mini';        // 矮屏：牌多时用小号，避免挤爆
    else sz = n > 14 ? 'tiny' : 'mini';
    /* 叠放比例（相对牌宽）。
       原来写死 15/20px：大屏牌宽 49px 时只压掉 15px，看着像「单张散开」；
       小屏牌宽 27px 时又压掉大半张。不同屏幕观感完全不一致。
       改成按比例：牌越多叠得越紧，任何分辨率下都是同一副「叠牌」的样子。 */
    var ovr = n <= 2 ? 0.28 : n <= 5 ? 0.40 : n <= 9 ? 0.52 : n <= 14 ? 0.62 : 0.72;
    return '<div class="prow stack" data-n="' + n + '" style="--ovr:-' + ovr + '">' +
      cards.map(function (c) { return cardHTML(c, sz); }).join('') + '</div>';
  }
  /* 手牌尺寸：同时受「宽度」和「高度」约束。
     以前只按宽度算，卡片能到 74px 宽（高 105px），
     在 360/320 高的矮屏上会把整手牌顶出屏幕底部 —— 这就是「牌溢出屏幕没法打牌」的根因。
     现在按屏高反推一个上限，保证手牌区永远完整落在屏幕内。 */
  function fitHand(n) {
    var wrap = document.querySelector('.handwrap');
    var cw = wrap ? wrap.clientWidth : 0;
    // 首帧容器可能还没布局（宽度 0）→ 回退到窗口宽度，否则手牌会缩成最小尺寸
    var avail = (cw > 40) ? (cw - 8) : ((window.innerWidth || 640) - 60);
    var wByW = (avail - 4) / (0.38 * n + 0.62);
    var vh = 0;
    try { vh = window.innerHeight || 0; } catch (e) { }
    if (!vh) vh = (document.documentElement && document.documentElement.clientHeight) || 640;
    /* 用「手牌区顶边到屏幕底部」的真实剩余高度做上限：
       叫分阶段按钮区更高、矮屏更挤，这里都能自动让出手牌的高度，绝不把牌顶出屏幕。 */
    var r0 = wrap ? wrap.getBoundingClientRect() : null;
    var top = r0 ? r0.top : 0;
    var availH = (top > 8) ? (vh - top - 6) : (vh * 0.29);
    /* 手牌放大：原来上限 108 偏小，选牌时手指容易点错。
       提到 124，同时 w 上限 74→84；仍受 availH 约束，不会溢出屏幕。 */
    var maxH = Math.max(56, Math.min(124, availH));
    /* 扣掉手牌区真实的上内边距（选中牌上抬需要空间），而不是写死 14 */
    var padT = 14;
    try {
      var hd0 = document.getElementById('hand');
      if (hd0) { var pv = parseFloat(getComputedStyle(hd0).paddingTop); if (pv > 0) padT = pv; }
    } catch (e) { }
    var wByH = (maxH - padT) / 1.42;
    var w = Math.max(36, Math.min(84, wByW, wByH));
    var h = document.getElementById('hand');
    function apply(w0) {
      if (!h) return;
      h.style.setProperty('--card-w', Math.round(w0) + 'px');
      h.style.setProperty('--card-h', Math.round(w0 * 1.42) + 'px');
      h.style.setProperty('--ov', '-' + Math.round(w0 * 0.62) + 'px');
    }
    apply(w);
    /* 渲染后再量一次：上面是估算，遇到窄屏 / 牌特别多时会偏大。
       实测内容超出容器就按比例收回，保证最后一张牌一定完整露出来
       —— 手牌放大后这道校准更不能少。 */
    requestAnimationFrame(function () {
      var hd = document.getElementById('hand');
      if (!hd) return;
      var need = hd.scrollWidth, have = hd.clientWidth;
      if (have > 20 && need > have + 2) {
        apply(Math.max(34, Math.floor(w * have / need) - 1));
      }
    });
  }

  /* ---------- 牌桌短语音：按住说话，松手自动发送 ----------
     按住期间会广播「正在说话」，对方麦克风按钮上出现声波提示，
     这样忽然听到声音不会觉得突兀。 */
  var speaking = false;
  function bindTableVoice() {
    var btn = document.getElementById('btn-table-voice');
    if (!btn || !window.Rec) return;
    function flag(on) {
      if (speaking === on) return;
      speaking = on;
      Net.send({ t: 'table:speaking', gid: gid, on: on });
    }
    window.Rec.hold(btn, function (r) {
      flag(false);
      Net.upload(r.file, 'voice', r.dur).then(function (up) {
        if (up && up.err) { toast(up.err); return; }
        Net.send({ t: 'room:chat', msg: { kind: 'voice', url: up.url, dur: r.dur, name: r.file.name, size: r.file.size } });
        Sfx.send();
      }).catch(function () { toast('发送失败'); });
    });
    /* hold 内部只绑了 up/down，这里再挂一层用来广播状态 */
    function down() { flag(true); }
    function up() { flag(false); }
    btn.addEventListener('touchstart', down, { passive: true });
    btn.addEventListener('touchend', up, { passive: true });
    btn.addEventListener('touchcancel', up, { passive: true });
    btn.addEventListener('mousedown', down);
    btn.addEventListener('mouseup', up);
  }
  /* 收到别人的「正在说话」：在自己的麦克风按钮上显示声波 */
  function onSpeaking(m) {
    var btn = document.getElementById('btn-table-voice');
    if (!btn) return;
    if (m.on) btn.classList.add('speaking'); else btn.classList.remove('speaking');
  }

  function init() {
    bindHand();
    bindTableVoice();
    /* 保存真人名单：选择框要列出这些玩家 */
    try {
      Net.on('lobby', function (m) { roster = m.all || m.users || []; });
    } catch (e) { }
    var b = document.getElementById('btn-table-chat');
    if (b) b.onclick = toggleTableChat;
  }
  function reset() {
    sel = {}; over = false; dealAnim = true; S = null; myRoom = null; gid = null;
    hintCycle = 0; lastHintKey = ''; tcMsgs = []; closeTableChat(true);
    tipShownFor = '';
    clearInterval(timer);
    var rt = document.getElementById('rule-tip'); if (rt) rt.classList.add('hidden');
  }

  /* ---------- 连选手牌：按下后横向滑动可一次选多张 ---------- */
  function bindHand() {
    var wrap = document.getElementById('hand');
    var dragging = false, mode = 1, touched = {};

    function cardAt(x, y) {
      var el = document.elementFromPoint(x, y);
      return el && el.closest ? el.closest('.pc') : null;
    }
    function apply(el) {
      if (!el || touched[el.dataset.id]) return;
      touched[el.dataset.id] = 1;
      if (mode) sel[el.dataset.id] = 1; else delete sel[el.dataset.id];
      Sfx.tap(); renderHand(); updateActions();
    }
    wrap.addEventListener('pointerdown', function (e) {
      if (!S || S.phase !== 'play' || S.turn !== mySeat) return;
      var el = e.target.closest ? e.target.closest('.pc') : null;
      if (!el) return;
      e.preventDefault();
      dragging = true; touched = {};
      mode = sel[el.dataset.id] ? 0 : 1;      // 起点已选中 → 本次拖动为取消
      apply(el);
      try { wrap.setPointerCapture(e.pointerId); } catch (x) {}
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var el = cardAt(e.clientX, e.clientY);
      if (el && wrap.contains(el)) apply(el);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      wrap.addEventListener(ev, function () { dragging = false; });
    });
  }

  function onRoom(m) {
    myRoom = m;
    gid = m.gid; rule = m.rule;
    if (!m.phase || m.phase === 'wait') { renderWaiting(m); showRuleTip(m); return; }
  }
  var prevBidTurn = -1;
  function onGame(m) {
    var prevTurn = S ? S.turn : -1;
    var prevLast = (S && S.last) ? (S.last.by + ':' + (S.last.cards || []).map(function (c) { return c.id; }).join(',')) : '';
    S = m; mySeat = m.seat; gid = m.gid; rule = m.rule;
    document.getElementById('mid-notice').classList.add('hidden');
    /* 出牌 / 不出的提示音：对手的牌型还要语音播报 */
    var nowLast = m.last ? (m.last.by + ':' + (m.last.cards || []).map(function (c) { return c.id; }).join(',')) : '';
    if (nowLast && nowLast !== prevLast) {
      var byMe = m.last.by === mySeat;
      if ((m.last.cards || []).length) {
        var big = m.last.info && (m.last.info.type === 'bomb' || m.last.info.type === 'rocket');
        Sfx.cardDrop(big);
        if (!byMe && m.last.info) Sfx.announce(m.last.info);   // 自己的牌在 play() 里已播报
      } else if (!byMe) {
        Sfx.pass();
        if (App.settings().voice) Sfx.speak('过');
      }
    }
    // 轮到我出牌 → 明确提示音
    if (m.phase === 'play' && m.turn === mySeat && prevTurn !== mySeat) Sfx.yourTurn();
    /* 叫分阶段轮到我 → 也要提示音（原来只有出牌阶段有，叫分时静悄悄） */
    if (m.phase === 'bid') {
      var nowBid = m.bidTurn;
      if (nowBid === mySeat && prevBidTurn !== mySeat) Sfx.yourTurn();
      prevBidTurn = nowBid;
    }
    render();
    showRuleTip(m);
    if (m.phase === 'over' && !over) { over = true; showResult(m); }
  }
  var lastResultMeta = { coinDelta: 0, coins: null };
  function onResult(m, meta) {
    if (meta) lastResultMeta = meta;
    if (!over) { over = true; showResult(S); }
  }

  /* 玩法提示：进入房间时弹一次，点 ✕ 关掉后本局不再出现（不再每局常驻占位） */
  var tipShownFor = '';
  function showRuleTip(m) {
    var el = document.getElementById('rule-tip'); if (!el) return;
    var g = (m && m.gid) || gid || '';
    // 同一个房间只提示一次；用户关掉后写入 tipShownFor，后续不再打扰
    if (!g || tipShownFor === g) return;
    tipShownFor = g;
    var r = (m && m.rule) || rule;
    var txt = r === 'trio54' ? '三人经典 · 54 张 · 叫分抢地主 · 农民一方出完即胜'
      : r === 'let46' ? '双人让牌 · 46 张 · 抢地主让牌 · 农民打剩到让牌数即胜'
        : '双人经典 · 37 张 · 叫分抢地主 · 先出完手牌者胜';
    /* 首次进入房间用弹窗（带关闭按钮），看得清也好关 */
    if (App.firstTipOf) {
      App.firstTipOf('本局玩法', txt, function () { });
    } else {
      el.textContent = '本局玩法：' + txt;
      el.classList.remove('hidden');
    }
    setTimeout(hideRuleTip, 6000);                   // 兜底：6 秒后自动收起
  }
  function hideRuleTip() {
    var el = document.getElementById('rule-tip');
    if (el) el.classList.add('hidden');
  }

  /* ---------------- 统一尺度 ----------------
   * 牌桌里所有元素都乘 --k：基准机型 844×390（k=1）。
   * 高分屏 k 变大、低分屏 k 变小，这样同一张牌在不同手机上
   * 占屏幕的比例基本一致，不会「分辨率高的显得小、低的显得大」。 */
  var BASE_H = 390, BASE_W = 844;
  function setScale() {
    var vh = 390, vw = 844;
    try {
      vh = window.innerHeight || document.documentElement.clientHeight || 390;
      vw = window.innerWidth || document.documentElement.clientWidth || 844;
    } catch (e) { }
    var k;
    if (vh > vw) {
      /* 竖屏：宽度才是约束，按宽度定尺度（基准竖屏宽 390） */
      k = vw / 390;
      k = Math.max(0.85, Math.min(1.18, k));
    } else {
      /* 横屏：高度是主要约束、宽度次要修正 */
      k = (vh / BASE_H) * 0.65 + (vw / BASE_W) * 0.35;
      k = Math.max(0.78, Math.min(1.22, k));
    }
    try { document.documentElement.style.setProperty('--k', k.toFixed(3)); } catch (e) { }
    return k;
  }

  /* ---------------- 渲染 ---------------- */
  /* 身份徽标：地主用皇冠、农民用麦穗。
     以前只有「地主/农民」四个小字，混在昵称后面根本分辨不出来，
     现在是带底色的一块，一眼能看到谁是谁。 */
  function roleTag(i) {
    if (!S || S.landlord < 0) return '';
    return i === S.landlord
      ? '<span class="rl lord" title="地主">👑 地主</span>'
      : '<span class="rl farmer" title="农民">🌾 农民</span>';
  }
  /* 昵称最多 8 个字：保证左右信息块宽度稳定，不会被超长昵称撑爆 */
  function shortName(u, def) {
    var s = (u && u.nick) ? String(u.nick) : (def || '玩家');
    return s.length > 8 ? s.slice(0, 8) : s;
  }
  function render() {
    if (!S) return;
    setScale();
    var me = mySeat, n = S.n || 2;
    var meU = S.seats[me];
    var ls = S.lastSeat || [];

    /* 某人打出的牌 */
    function playedOf(i) {
      var x = ls[i];
      if (x && x.cards && x.cards.length) {
        return '<div class="pmine"><div class="pcards">' + rowHTML(x.cards) + '</div></div>';
      }
      /* 这一家主动「过」：用行楷写一个洒脱的「过」字，比干巴巴一个「—」清楚得多 */
      if (x && x.pass) {
        return '<div class="pmine"><div class="pcards passed"><span class="pass-word">过</span></div></div>';
      }
      if (S.last && S.last.by === i && i !== me) {
        return '<div class="pmine"><div class="pcards">' + rowHTML(S.last.cards) + '</div></div>';
      }
      return '<div class="pmine"><div class="pcards pass">—</div></div>';
    }
    function seatHTML(i, cls) {
      var u = S.seats[i];
      var cnt = S.counts[i];
      var needTxt = '剩 ' + cnt + ' 张';
      if (S.rule === 'let46' && S.landlord >= 0 && S.phase === 'play') {
        var need = Math.max(0, cnt - S.letCount);
        needTxt = '剩 ' + cnt + ' · 再出 ' + need + ' 张胜';
      }
      var act = (S.phase === 'play' && S.turn === i) ? ' act' : '';
      return '<div class="ts' + act + (cls ? ' ' + cls : '') + '">' +
        '<div class="av">' + (u ? Avatar.svg(u.avatar, 26) : '') + '</div>' +
        '<div class="ts-i"><div class="nm">' + (u ? esc(shortName(u, '空位')) : '空位') + roleTag(i) + '</div>' +
        '<div class="cnt">' + needTxt + '</div></div>' +
        (act ? '<div class="clock"><b>' + left + '</b></div>' : '') +
        '</div>';
    }
    /* 我在右侧时的信息块（两人场用） */
    function mySeatHTML() {
      var cnt = S.counts[me];
      var act = (S.phase === 'play' && S.turn === me) ? ' act' : '';
      return '<div class="ts me' + act + '">' +
        '<div class="av">' + Avatar.svg(meU && meU.avatar, 26) + '</div>' +
        '<div class="ts-i"><div class="nm">' + esc(shortName(meU, '我')) + roleTag(me) + '</div>' +
        '<div class="cnt">剩 ' + cnt + ' 张</div></div>' +
        (act ? '<div class="clock"><b>' + left + '</b></div>' : '') +
        '</div>';
    }
    /* 一列 = 信息块 + 打出的牌。左侧：信息块在左、牌向右展开；
       右侧：牌在左、信息块在右（都朝牌桌中间，不会顶到屏幕边缘）。 */
    function colHTML(seatHtml, playedHtml, side) {
      return '<div class="seatcol ' + side + '">' + seatHtml + playedHtml + '</div>';
    }
    function myPlayedHTML() {
      var myRow = '';
      if (ls[me] && ls[me].cards && ls[me].cards.length) myRow = rowHTML(ls[me].cards);
      else if (S.last && S.last.by === me) myRow = rowHTML(S.last.cards);
      return myRow || '';
    }

    var elL = document.getElementById('seat-left');
    var elR = document.getElementById('seat-right');
    var elT = document.getElementById('seat-top');
    var elMy = document.getElementById('my-info');
    var elMyP = document.getElementById('my-played');

    if (n === 3) {
      // 三人：另外两家分居左右，我在下方
      /* 出牌转圈方向：引擎是 turn = (seat + 1) % n，即「我 → 下家 → 下下家 → 我」。
         以前把 (me+1) 显示在左边，于是变成「我 → 左 → 右 → 我」，
         轮到的是「右家出完才到我」，方向看着是反的。
         这里把 (me+1) 放到右边：我 → 右 → 左 → 我，
         正好符合「左上方的人出完就该我出」。 */
      var lI = (me + 2) % 3, rI = (me + 1) % 3;
      elL.innerHTML = colHTML(seatHTML(lI, ''), playedOf(lI), 'left');
      elR.innerHTML = colHTML(seatHTML(rI, 'right'), playedOf(rI), 'right');
      elT.innerHTML = '';
      elMy.classList.remove('hidden2');
      elMyP.classList.remove('hidden2');
      elMy.innerHTML =
        '<div class="av">' + Avatar.svg(meU && meU.avatar, 28) + '</div>' +
        '<div><div class="nm">' + esc(shortName(meU, '我')) + roleTag(me) + '</div>' +
        '<div class="cnt">剩 ' + S.counts[me] + ' 张</div></div><div class="sp"></div>' +
        '<div class="mult">×' + S.multiplier + (S.letCount ? ' · 让' + S.letCount : '') + '</div>';
      var myRow3 = myPlayedHTML();
      elMyP.innerHTML = '<div class="pcards center">' + (myRow3 || '<span class="pass">—</span>') + '</div>';
    } else {
      // 两人：对手在最左，我在最右，各自的牌朝中间展开
      var oI = me === 0 ? 1 : 0;
      elL.innerHTML = colHTML(seatHTML(oI, ''), playedOf(oI), 'left');
      elR.innerHTML = colHTML(mySeatHTML(),
        '<div class="pmine"><div class="pcards">' + (myPlayedHTML() || '<span class="pass">—</span>') + '</div></div>',
        'right');
      elT.innerHTML = '';
      // 两人场「我」已经在右侧，隐藏底部那一行的个人信息
      elMy.classList.add('hidden2');
      elMyP.classList.add('hidden2');
      elMy.innerHTML = '';
      elMyP.innerHTML = '';
    }

    /* 底牌区：除了三张底牌，还要显示「最终叫了几分」和「是否加倍」。
       以前只有底牌，打牌过程中完全看不到这局是多少分、有没有人加倍。 */
    var bb = document.getElementById('bottom-bar');
    var bidTxt = '';
    if (S.landlord >= 0) {
      var score = (S.bid && S.bid.score) || 0;
      if (S.rule === 'let46') bidTxt = '<span class="btag">让 ' + (S.letCount || 0) + ' 张</span>';
      else if (score) bidTxt = '<span class="btag">叫 ' + score + ' 分</span>';
      else bidTxt = '<span class="btag">抢地主</span>';
      if (S.doubled && S.doubled.length) bidTxt += '<span class="btag dbl">已加倍 ×' + S.multiplier + '</span>';
      else if (S.phase === 'play' || S.phase === 'over') bidTxt += '<span class="btag nod">未加倍 ×' + S.multiplier + '</span>';
    }
    bb.innerHTML = (S.bottom && S.bottom.length
      ? '<span class="lbl">底牌</span><div class="bcards">' + S.bottom.map(function (c) { return cardHTML(c, 'tiny'); }).join('') + '</div>'
      : '<span class="lbl" style="opacity:.6">底牌未公开</span>') + bidTxt;

    var mid = document.getElementById('played');
    // 两人场「我」在右侧，底部没有个人信息行 → 倍数/让牌数改在牌桌中央显示
    mid.innerHTML = (n === 3) ? '' :
      '<div class="cinf">×' + S.multiplier + (S.letCount ? ' · 让 ' + S.letCount + ' 张' : '') + '</div>';

    renderHand();
    renderActions();
    startTimer();
    fitPlayed();
  }

  /* 出牌区自适应：先按比例叠好，渲染后测量一次。
     如果这一摞牌还是会超出可用宽度（牌多 + 屏幕窄），就继续加紧叠放，
     直到完全放得下 —— 绝不让它把我的手牌顶出屏幕。
     同时保证「横向一行、不换行」：上下铺开会占掉牌桌高度，手牌就被挤没了。 */
  function fitPlayed() {
    try {
      var rows = document.querySelectorAll('#page-play .prow.stack');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var host = row.parentNode;
        if (!host) continue;
        // 可用宽度：往上找有明确宽度的容器（pmine / pcards / seatcol），取最小的那个
        var avail = 0, el = row;
        for (var up = 0; up < 4 && el; up++) {
          var w = el.clientWidth;
          if (w > 30 && (!avail || w < avail)) avail = w;
          el = el.parentNode;
        }
        if (!avail) avail = window.innerWidth || 640;
        var pcs = row.querySelectorAll('.pc');
        if (!pcs.length) continue;
        var cw = pcs[0].getBoundingClientRect().width || 32;
        var n = pcs.length;
        if (n < 2) continue;
        // 需要的总宽 = 牌宽 + (n-1) * 间距，间距 = 牌宽 * (1 - 重叠比例)
        var ovr = parseFloat(row.style.getPropertyValue('--ovr')) || 0.5;
        ovr = Math.abs(ovr);
        var need = cw + (n - 1) * cw * (1 - ovr);
        if (need <= avail) continue;                    // 放得下，保持原样
        // 放不下 → 加大重叠（上限 0.86，再叠就看不清点数花色了）
        var target = 1 - (avail - cw) / ((n - 1) * cw);
        if (target > 0.86) target = 0.86;
        if (target < ovr) target = ovr;                 // 只加紧，不放松
        row.style.setProperty('--ovr', '-' + target.toFixed(3));
        row.style.setProperty('--ov', '-' + Math.round(cw * target) + 'px');
      }
    } catch (e) { }
  }

  function renderHand() {
    var wrap = document.getElementById('hand');
    if (!S) { wrap.innerHTML = ''; return; }
    fitHand(S.hand.length);
    var animate = dealAnim; dealAnim = false;
    wrap.innerHTML = S.hand.map(function (c) {
      return cardHTML(c, (sel[c.id] ? 'sel' : '') + (animate ? ' deal' : ''));
    }).join('');
    if (animate) wrap.querySelectorAll('.pc.deal').forEach(function (el, i) { el.style.animationDelay = (i * 22) + 'ms'; });
    /* 首帧 handwrap 可能还没布局完（宽度 0），下一帧按真实尺寸再校准一次，
       否则手牌会一直保持最小尺寸，看起来又小又挤。 */
    try {
      requestAnimationFrame(function () { if (S) fitHand(S.hand.length); });
    } catch (e) { }
  }

  function renderWaiting(m) {
    var n = (m && m.n) || 2;
    document.getElementById('seat-top').innerHTML = '';
    document.getElementById('seat-left').innerHTML = '';
    document.getElementById('seat-right').innerHTML = '';
    document.getElementById('my-played').innerHTML = '';
    document.getElementById('played').innerHTML = '';
    document.getElementById('bottom-bar').innerHTML = '';
    document.getElementById('hand').innerHTML = '';
    document.getElementById('my-info').innerHTML = '';
    var seats = (m && m.seats) || [];
    var cards = '';
    for (var i = 0; i < n; i++) {
      var s = seats[i];
      cards += '<div class="ss' + (s ? ' ok' : '') + '"><div class="a">' + (s ? Avatar.svg(s.avatar, 40) : '') + '</div>' +
        '<div class="n">' + (s ? esc(s.nick) : '虚位以待') + '</div></div>';
    }
    var filled = seats.filter(Boolean).length;
    var need = n - filled;
    // 不出现「机器人」字样：一律表述为「邀请在线玩家」
    var inviteBtn = need > 0
      ? '<button class="btn jade" onclick="Game.addBot()">邀请在线玩家</button>' +
      ((need > 1) ? '<button class="btn" onclick="Game.fillAll()">全部邀请</button>' : '')
      : '';
    document.getElementById('action-zone').innerHTML =
      '<div class="bidwrap" style="flex-wrap:wrap">' +
      '<button class="btn ghost" onclick="Game.leave()">离开房间</button>' + inviteBtn + '</div>';
    document.getElementById('played').innerHTML =
      '<div class="waitbox" style="margin-top:4px"><div class="st">等待玩家就位</div>' +
      '<div class="num">' + (m && m.gid ? m.gid : '') + '</div>' +
      '<div class="st">已就位 ' + filled + '/' + n + '</div>' +
      '<div class="seatsrow">' + cards + '</div>' +
      '<div style="font-size:11px;color:var(--sub);margin-top:6px">把房间号发给好友，或直接在大厅邀请在线好友</div></div>';
  }

  function selectedCards() { return S ? S.hand.filter(function (c) { return sel[c.id]; }) : []; }
  function canPlay() {
    var cs = selectedCards(); if (!cs.length) return false;
    var info = DDZ.parse(cs); if (!info) return false;
    var need = (S.last && S.last.by !== mySeat) ? S.last.info : null;
    return DDZ.beats(info, need);
  }
  function updateActions() {
    var pb = document.getElementById('btn-play');
    if (pb) { var ok = canPlay(); pb.disabled = !ok; pb.style.opacity = ok ? 1 : .38; }
  }
  /* 对手快赢了 → 允许提示动用炸弹 */
  function urgentNow() {
    if (!S || S.landlord < 0) return false;
    for (var i = 0; i < (S.n || 2); i++) {
      if (i === mySeat) continue;
      var c = S.counts[i];
      if (c <= 2) return true;
      if (S.rule === 'let46' && i !== S.landlord && c <= S.letCount + 1) return true;
    }
    return false;
  }

  function renderActions() {
    var z = document.getElementById('action-zone');
    var nt = document.getElementById('mid-notice');
    nt.classList.add('hidden');
    if (S.phase === 'bid') { z.innerHTML = bidHTML(); startBidTimer(); return; }
    if (S.phase === 'double') { z.innerHTML = doubleHTML(); bindDouble(); return; }
    if (S.phase === 'over') { z.innerHTML = ''; return; }
    if (S.turn !== mySeat) {
      z.innerHTML = '<div class="bidwrap"><div class="btn ghost" style="text-align:center;opacity:.6">等待' +
        (S.seats[S.turn] ? esc(S.seats[S.turn].nick) : '对手') + '出牌…</div>' +
        '<button class="btn ghost" style="flex:0 0 92px" onclick="Game.resign()">认输</button></div>';
      return;
    }
    var need = (S.last && S.last.by !== mySeat) ? S.last.info : null;
    z.innerHTML = '<div class="acts">' +
      '<button class="btn ghost" id="btn-pass"' + (need ? '' : ' disabled') + ' onclick="Game.pass()">' + (need ? '不出' : '首出') + '</button>' +
      '<button class="btn ghost" id="btn-hint" onclick="Game.hint()">提示</button>' +
      '<button class="btn" id="btn-play" onclick="Game.play()">出牌</button></div>';
    updateActions();
  }

  /* 加倍阶段：只有「没轮到叫分」的人会看到这个界面。
     已经叫过分的玩家没有加倍权（服务端引擎双重校验）。 */
  function doubleHTML() {
    var mine = (S.doubleTurn === mySeat);
    var who = S.seats[S.doubleTurn];
    var bidScore = (S.bid && S.bid.score) || 1;
    if (!mine) {
      return '<div class="bidwrap"><div class="btn ghost" style="text-align:center;opacity:.7">等待 ' +
        esc(who ? who.nick : '对手') + ' 决定是否加倍…</div></div>';
    }
    return '<div class="bidwrap"><div style="font-size:11px;color:var(--sub);text-align:center;line-height:1.4">' +
      '地主叫 ' + bidScore + ' 分定庄，你没轮到叫分<br>可以选择是否加倍（当前 ×' + S.multiplier + '）</div>' +
      '<div class="row2">' +
      '<button class="btn ghost" id="btn-dno">不加倍</button>' +
      '<button class="btn jade" id="btn-dyes">加倍 ×2</button></div></div>';
  }
  function doDouble(yes) {
    if (!S || S.phase !== 'double') return;
    Sfx.click();
    if (App.settings().voice) Sfx.speak(yes ? '加倍' : '不加倍');
    Net.send({ t: 'game:double', yes: !!yes });
  }
  function bindDouble() {
    var a = document.getElementById('btn-dyes');
    var b = document.getElementById('btn-dno');
    if (a) a.onclick = function () { doDouble(true); };
    if (b) b.onclick = function () { doDouble(false); };
  }

  function bidHTML() {
    var b = '';
    if (S.rule === 'let46') {
      if (S.landlord < 0) {
        if (S.bidTurn !== mySeat) return waitTxt('等待对方叫地主…');
        b = '<button class="btn ghost" onclick="Game.bid({type:\'pass\'})">不叫</button>' +
          '<button class="btn" onclick="Game.bid({type:\'bid\'})">叫地主</button>';
      } else if (S.bidTurn === mySeat) {
        b = '<button class="btn ghost" onclick="Game.bid({type:\'pass\'})">不抢</button>' +
          '<button class="btn" onclick="Game.bid({type:\'grab\'})">抢地主</button>';
      } else return waitTxt('等待对方抢地主…');
    } else {
      if (S.bidTurn !== mySeat) return waitTxt('等待其他玩家叫分…');
      var cur = S.bid ? S.bid.score : 0;
      var opts = '';
      for (var s = 1; s <= 3; s++) {
        opts += '<button class="btn' + (s === 3 ? '' : ' ghost') + '"' + (s <= cur ? ' disabled' : '') +
          ' onclick="Game.bid({type:\'bid\',score:' + s + '})">' + s + ' 分</button>';
      }
      b = '<button class="btn ghost" onclick="Game.bid({type:\'pass\'})">不叫</button>' + opts;
    }
    var tip = '';
    if (S.rule === 'let46') {
      tip = '<div style="text-align:center;font-size:11px;color:var(--sub);margin-bottom:6px;width:100%">当前让牌 <b style="color:var(--gold)">' +
        S.letCount + '</b> 张' + (S.landlord === mySeat ? '（你要出完所有牌）' : (S.landlord >= 0 ? '（你打剩 ' + S.letCount + ' 张即胜）' : '')) + '</div>';
    } else if (S.bid) {
      tip = '<div style="text-align:center;font-size:11px;color:var(--sub);margin-bottom:6px;width:100%">当前最高 <b style="color:var(--gold)">' +
        S.bid.score + ' 分</b></div>';
    }
    return '<div class="bidwrap" style="flex-wrap:wrap">' + tip + b + '</div>';
  }
  function waitTxt(t) {
    return '<div class="bidwrap"><div class="btn ghost" style="opacity:.65;text-align:center">' + t + '</div></div>';
  }

  /* ---------------- 操作 ---------------- */
  function play() {
    if (!canPlay()) { Sfx.warn(); return toast('这手牌打不过上家'); }
    var cs = selectedCards();
    var info = DDZ.parse(cs);
    // 出牌提示音（拍牌声） + 语音播报 + 牌型音效
    Sfx.cardDrop(!!(info && (info.type === 'bomb' || info.type === 'rocket')));
    if (info) Sfx.announce(info);
    if (info && (info.type === 'bomb' || info.type === 'rocket')) shake();
    if (App.vibe() && navigator.vibrate) navigator.vibrate(12);
    sel = {};
    Net.send({ t: 'game:play', ids: cs.map(function (c) { return c.id; }) });
  }
  function pass() {
    var need = (S.last && S.last.by !== mySeat) ? S.last.info : null;
    if (!need) { toast('你是先手，必须出牌'); return; }
    Sfx.pass();
    if (App.settings().voice) Sfx.speak('过');
    sel = {};
    Net.send({ t: 'game:play', ids: [] });
  }
  function hint() {
    var need = (S.last && S.last.by !== mySeat) ? S.last.info : null;
    var key = (S.counts.join(',') + '|' + (need ? need.type + need.main + need.len : 'free') + '|' + S.hand.length);
    if (key !== lastHintKey) { lastHintKey = key; hintCycle = 0; }
    var h = DDZ.hint(S.hand, need, { cycle: hintCycle, urgent: urgentNow() });
    if (!h) {
      toast('没有能压过的牌'); Sfx.warn();
      Net.send({ t: 'game:play', ids: [] }); return;
    }
    hintCycle++;
    sel = {}; h.ids.forEach(function (i) { sel[i] = 1; });
    Sfx.tap(); renderHand(); updateActions();
    var nm = DDZ.speak(h.info);
    if (nm) toast('建议：' + nm);
  }
  function bid(act) {
    /* act: 0=不叫 1/2/3=分数；也可能是 'grab'(抢) / 'nograb'(不抢) */
    var n = (act === 'grab') ? 3 : (act === 'nograb' ? 0 : (Number(act) || 0));
    Sfx.bid(n);
    /* 叫分语音播报：以前只有音效没有语音，光听声音不知道叫了几分 */
    if (App.settings().voice) {
      var txt = (act === 'grab') ? '抢地主' : (act === 'nograb' ? '不抢' : (n ? ('叫' + n + '分') : '不叫'));
      Sfx.speak(txt);
    }
    Net.send({ t: 'game:bid', act: act });
  }
  function resign() { App.confirm('确定认输吗？', '认输将直接判负', function () { Net.send({ t: 'game:resign' }); }); }
  function leave() { Net.send({ t: 'room:leave' }); App.go('home'); toast('已离开房间'); }
  /* 邀请在线好友：弹出选择框，列出真人玩家（在线的排前面），可多选。
     「全部邀请」仍然默认补机器人（fillAll 行为不变）。 */
  function addBot() { openInvitePicker(); }

  function openInvitePicker() {
    Net.send({ t: 'lobby' });                       // 先刷新名单
    var list = roster.filter(function (x) { return x && x.uid; });
    var free = 0;
    if (myRoom) free = myRoom.seats.filter(function (x) { return !x; }).length
                     + myRoom.seats.filter(function (x) { return x && x.bot; }).length;
    if (!free) free = 1;
    var picked = {};
    var box = document.createElement('div');
    box.className = 'modal';
    box.id = 'invite-picker';
    function rowHTMLOf(u) {
      var on = !!u.online;
      return '<div class="iu' + (on ? '' : ' off') + '" data-uid="' + u.uid + '">' +
        '<div class="a">' + (u.avatar && u.avatar.face != null ? '' : '🙂') + '</div>' +
        '<div class="n">' + esc(u.nick || '玩家') + '</div>' +
        '<div class="tag">' + (on ? '在线' : '离线') + '</div>' +
        '<div class="ck"></div></div>';
    }
    var body = list.length
      ? list.map(rowHTMLOf).join('')
      : '<div style="text-align:center;color:var(--sub);font-size:12px;padding:18px 0">' +
        '暂无其他真人玩家<br><span style="font-size:11px;opacity:.7">可以先用「全部邀请」凑机器人开局</span></div>';
    box.innerHTML = '<div class="box" style="max-width:340px">' +
      '<h3>邀请在线好友</h3>' +
      '<p style="margin-bottom:8px">选择要邀请的真人玩家（可多选，最多 ' + free + ' 位）<br>' +
      '<span style="font-size:11px;opacity:.75">离线的也会收到邀请卡片，上线后可直接进入</span></p>' +
      '<div class="invite-list" id="ip-list" style="max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch">' +
      body + '</div>' +
      '<div class="row" style="margin-top:12px">' +
      '<button class="btn ghost" id="ip-cancel">取消</button>' +
      '<button class="btn" id="ip-bot">全部邀请</button>' +
      '<button class="btn jade" id="ip-ok">邀请</button></div></div>';
    document.body.appendChild(box);

    function close() { box.remove(); }
    box.querySelector('#ip-cancel').onclick = close;
    box.querySelector('#ip-bot').onclick = function () { close(); fillAll(); };
    box.querySelector('#ip-ok').onclick = function () {
      var uids = Object.keys(picked);
      close();
      if (!uids.length) { toast('还没有选择好友'); return; }
      Net.send({ t: 'room:invitemany', gid: gid, tos: uids });
      toast('已发出 ' + uids.length + ' 条邀请');
    };
    box.querySelectorAll('.iu').forEach(function (el) {
      el.onclick = function () {
        var uid = el.dataset.uid;
        if (picked[uid]) { delete picked[uid]; el.classList.remove('sel'); }
        else {
          if (Object.keys(picked).length >= free) { toast('最多邀请 ' + free + ' 位'); return; }
          picked[uid] = 1; el.classList.add('sel');
        }
        Sfx.click();
      };
    });
    box.onclick = function (e) { if (e.target === box) close(); };
  }
  function fillAll() {
    var n = myRoom ? myRoom.n : 2;
    var filled = myRoom ? myRoom.seats.filter(Boolean).length : 1;
    for (var i = 0; i < n - filled; i++) Net.send({ t: 'room:joinbot', gid: gid });
  }
  function kickBot() { Net.send({ t: 'room:kickbot', gid: gid }); }
  function rematch() { Net.send({ t: 'game:rematch' }); over = false; dealAnim = true; }
  function backHome() { App.go('home'); }
  function shake() {
    var t = document.getElementById('page-play');
    t.classList.add('shake'); setTimeout(function () { t.classList.remove('shake'); }, 420);
  }

  function startBidTimer() {
    clearInterval(timer);
    if (!S || S.phase !== 'bid' || S.bidTurn !== mySeat) return;
    var leftBid = 20;
    timer = setInterval(function () {
      leftBid--;
      if (leftBid > 0) return;
      clearInterval(timer);
      if (!S || S.phase !== 'bid' || S.bidTurn !== mySeat) return;
      if (S.rule === 'let46') Net.send({ t: 'game:bid', act: S.landlord < 0 ? { type: 'bid' } : { type: 'pass' } });
      else Net.send({ t: 'game:bid', act: { type: 'pass' } });
      toast('超时未操作，已自动处理');
    }, 1000);
  }

  function startTimer() {
    clearInterval(timer);
    if (!S || S.phase !== 'play') return;
    left = 25;
    if (S.turn === mySeat) {
      timer = setInterval(function () {
        left--;
        if (left <= 0) {
          clearInterval(timer);
          var need = (S.last && S.last.by !== mySeat) ? S.last.info : null;
          if (need) { toast('超时，自动不出'); Net.send({ t: 'game:play', ids: [] }); }
          else {
            var h = DDZ.hint(S.hand, null, { urgent: urgentNow() });
            Net.send({ t: 'game:play', ids: h ? h.ids : [] }); sel = {};
          }
        }
      }, 1000);
    }
  }

  /* ---------------- 房间内聊天（文字 / 表情 / 快捷语 / 短语音） ---------------- */
  var QUICK = ['快点儿吧，我等的花儿都谢了！', '你的牌打得也太好了', '不要走，决战到天亮',
    '别走开，马上回来', '合作愉快，双赢', '这把稳了', '好牌，佩服', '你是我的偶像'];
  function toggleTableChat() {
    var el = document.getElementById('tchat');
    tcOpen = !tcOpen;
    el.classList.toggle('hidden', !tcOpen);
    if (tcOpen) renderTableChat();
  }
  function closeTableChat(hard) {
    tcOpen = false;
    var el = document.getElementById('tchat'); if (el) el.classList.add('hidden');
  }
  function renderTableChat() {
    var el = document.getElementById('tchat'); if (!el) return;
    var mine = App.me().uid;
    el.innerHTML =
      '<div class="tc-hd">房间聊天<div class="x" id="tc-x">✕</div></div>' +
      '<div class="tc-msgs" id="tc-msgs"></div>' +
      '<div class="tc-quick" id="tc-quick">' +
      QUICK.map(function (q, i) { return '<button data-q="' + i + '">' + q + '</button>'; }).join('') +
      '</div>' +
      '<div class="tc-bar">' +
      '<div class="ic" id="tc-voice">🎙</div>' +
      '<input id="tc-in" placeholder="说点什么…">' +
      '<div class="ic" id="tc-emo">😊</div>' +
      '<div class="ic send" id="tc-send">➤</div>' +
      '</div>' +
      '<div class="tc-emoji hidden" id="tc-emoji"></div>';
    el.querySelector('#tc-x').onclick = toggleTableChat;
    el.querySelector('#tc-send').onclick = tcSendText;
    el.querySelector('#tc-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') tcSendText(); });
    el.querySelector('#tc-emo').onclick = function () {
      var p = el.querySelector('#tc-emoji');
      p.classList.toggle('hidden');
      if (!p.innerHTML) {
        p.innerHTML = Stickers.EMOJI.slice(0, 48).map(function (s, i) { return '<button data-e="' + i + '">' + s + '</button>'; }).join('');
        p.querySelectorAll('[data-e]').forEach(function (b) {
          b.onclick = function () { tcSendSticker(Stickers.EMOJI[+b.dataset.e], p); };
        });
      }
    };
    el.querySelectorAll('[data-q]').forEach(function (b) {
      b.onclick = function () { tcSend({ kind: 'text', text: QUICK[+b.dataset.q] }); };
    });
    bindTcVoice(el.querySelector('#tc-voice'));
    renderTcMsgs();
  }
  function renderTcMsgs() {
    var box = document.getElementById('tc-msgs'); if (!box) return;
    var mine = App.me().uid;
    box.innerHTML = tcMsgs.map(function (m) {
      var body = m.kind === 'sticker' ? '<div class="st">' + (m.emoji || '🙂') + '</div>'
        : m.kind === 'voice' ? '<span data-v="' + Net.abs(m.url) + '">▶ 语音 ' + (m.dur || 0) + '″</span>'
          : esc(m.text);
      return '<div class="m' + (m.from === mine ? ' me' : '') + '"><b>' + esc(m.nick || '玩家') + '：</b>' + body + '</div>';
    }).join('') || '<div class="empty" style="padding:14px;font-size:11px">还没有人说话</div>';
    box.querySelectorAll('[data-v]').forEach(function (b) {
      b.onclick = function () { new Audio(b.dataset.v).play(); };
    });
    box.scrollTop = box.scrollHeight;
  }
  function tcSend(msg) { Net.send({ t: 'room:chat', msg: msg }); }
  /* 发表情后表情栏自动收起 */
  function tcSendSticker(emoji, panel) {
    tcSend({ kind: 'sticker', emoji: emoji });
    Sfx.send();
    if (panel) panel.classList.add('hidden');
    var p2 = document.getElementById('tc-emoji');
    if (p2) p2.classList.add('hidden');
  }
  function tcSendText() {
    var el = document.getElementById('tc-in'); if (!el) return;
    var v = el.value.trim(); if (!v) return;
    el.value = ''; tcSend({ kind: 'text', text: v }); Sfx.send();
  }
  /* 自动播放收到的短语音：牌桌上不用再手动点播放 */
  var voiceQueue = [], voicePlaying = false;
  function autoPlayVoice(url) {
    if (!url) return;
    voiceQueue.push(url);
    pumpVoice();
  }
  function pumpVoice() {
    if (voicePlaying || !voiceQueue.length) return;
    var url = voiceQueue.shift();
    voicePlaying = true;
    var a = null;
    try { a = new Audio(Net.abs(url)); } catch (e) { voicePlaying = false; return; }
    a.onended = function () { voicePlaying = false; pumpVoice(); };
    a.onerror = function () { voicePlaying = false; pumpVoice(); };
    var p = a.play();
    if (p && p.catch) p.catch(function () { voicePlaying = false; pumpVoice(); });
  }

  function onTableChat(m) {
    tcMsgs.push(m.msg); if (tcMsgs.length > 200) tcMsgs.shift();
    var badge = document.getElementById('btn-table-chat');
    if (badge && !tcOpen) { badge.classList.add('new'); setTimeout(function () { badge.classList.remove('new'); }, 2600); }
    renderTcMsgs(); Sfx.msg();
    /* 语音消息直接播出来 —— 打牌时腾不出手去点播放 */
    if (m.msg && m.msg.kind === 'voice' && m.msg.url) autoPlayVoice(m.msg.url);
  }
  /* 短语音（按住说话，松开发送，最长 15 秒）—— 原生录音优先 */
  function bindTcVoice(btn) {
    if (!btn) return;
    Rec.hold(btn, function (r) {
      App.toast('发送中…');
      Net.upload(r.file, 'voice', r.dur).then(function (up) {
        if (!up.err) tcSend({ kind: 'voice', url: up.url, dur: r.dur, name: r.file.name, size: r.file.size });
        else App.toast(up.err);
      });
    });
  }

  /* ---------------- 结算 ---------------- */
  function showResult(m) {
    clearInterval(timer);
    var me = mySeat, r = m.result || {};
    var iWin;
    if (r.winnerSide) iWin = (r.winnerSide === 'landlord') ? (r.landlord === me) : (r.landlord !== me);
    else iWin = r.winner === me;
    Sfx[iWin ? 'win' : 'lose']();
    var txt = [];
    txt.push('你的身份：' + (r.landlord === me ? '地主' : '农民'));
    if ((m.n || 2) === 3) txt.push((r.winnerSide === 'landlord' ? '地主' : '农民') + '方获胜');
    if (m.rule === 'let46') txt.push('让牌 ' + r.letCount + ' 张');
    txt.push('炸弹 ' + (r.bombCount || 0) + ' 个');
    if (r.spring) txt.push('春天 ×2');
    if (r.antiSpring) txt.push('反春天 ×2');
    txt.push('总倍数 ×' + r.multiplier);
    // 金币：底分 100 × 倍数；地主在三人场输赢翻倍
    var d = lastResultMeta.coinDelta;
    var base = 100 * (r.multiplier || 1);
    if (!d) d = (iWin ? 1 : -1) * base * ((m.n || 2) === 3 && r.landlord === me ? 2 : 1);
    var coinLine = '<div class="coinline">' +
      '<span>金币</span>' +
      '<b class="' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '+' : '−') + Math.abs(d) + '</b>' +
      '<span class="sep">余额</span><b class="bal">' + (lastResultMeta.coins != null ? lastResultMeta.coins : '—') + '</b>' +
      '</div>';
    var box = document.createElement('div');
    box.className = 'result';
    box.innerHTML = '<div class="box">' +
      '<div class="big ' + (iWin ? 'win' : 'lose') + '">' + (iWin ? '🎉 你赢了' : '😢 你输了') + '</div>' +
      '<div style="font-size:12px;color:var(--sub);margin-top:2px">' + (iWin ? '+' : '-') + base + ' 积分</div>' +
      coinLine +
      '<div class="meta">' + txt.join('<br>') + '</div>' +
      '<div class="row"><button class="btn ghost" id="rs-home">返回大厅</button>' +
      '<button class="btn jade" id="rs-again">再来一局</button></div></div>';
    document.getElementById('page-play').appendChild(box);
    box.querySelector('#rs-again').onclick = function () { box.remove(); rematch(); };
    box.querySelector('#rs-home').onclick = function () { box.remove(); backHome(); };
    if (d < 0 && lastResultMeta.coins === 0) toast('金币已用完');
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function toast(t) { App.toast(t); }

  return {
    init: init, onRoom: onRoom, onGame: onGame, onResult: onResult, reset: reset,
    play: play, pass: pass, hint: hint, bid: bid, leave: leave, resign: resign, rematch: rematch,
    backHome: backHome, addBot: addBot, fillAll: fillAll, kickBot: kickBot,
    onTableChat: onTableChat, closeTableChat: closeTableChat, onSpeaking: onSpeaking,
    relayout: function () { try { setScale(); if (S) { fitHand(S.hand.length); render(); } } catch (e) { } },
    get state() { return S; }, get seat() { return mySeat; }, get gid() { return gid; }, get room() { return myRoom; }
  };
})();
