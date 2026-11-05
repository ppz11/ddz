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
  /* 皇冠造型：大王红色、小王黑色，形状完全相同，只换配色。
     注意：同一张牌桌会同时出现多张王，SVG 的渐变 id 必须各不相同，
     否则后渲染的会覆盖前面的定义，导致两张王颜色一样。 */
  var jkSeq = 0;
  function crownSVG(big) {
    var gid = 'ckg' + (++jkSeq);
    var c1 = big ? '#ff8a8a' : '#c3c9d4';   // 高光
    var c2 = big ? '#d71f2a' : '#2b3240';   // 主色
    var c3 = big ? '#8e0f18' : '#11161f';   // 暗部
    var ln = big ? '#7d1119' : '#0b0f16';   // 描边
    return '<svg class="jk-crown" viewBox="0 0 24 18" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + c1 + '"/><stop offset=".55" stop-color="' + c2 + '"/>' +
      '<stop offset="1" stop-color="' + c3 + '"/>' +
      '</linearGradient></defs>' +
      '<path d="M2.2 15.5 L3.6 5.2 L7.6 10.2 L12 2.6 L16.4 10.2 L20.4 5.2 L21.8 15.5 Z" ' +
      'fill="url(#' + gid + ')" stroke="' + ln + '" stroke-width="0.7" stroke-linejoin="round"/>' +
      '<rect x="1.6" y="15.2" width="20.8" height="2.1" rx="0.9" fill="url(#' + gid + ')" stroke="' + ln + '" stroke-width="0.7"/>' +
      '<circle cx="12" cy="1.2" r="1.1" fill="' + c1 + '" stroke="' + ln + '" stroke-width="0.5"/>' +
      '<circle cx="3.6" cy="4.2" r="1" fill="' + c1 + '" stroke="' + ln + '" stroke-width="0.5"/>' +
      '<circle cx="20.4" cy="4.2" r="1" fill="' + c1 + '" stroke="' + ln + '" stroke-width="0.5"/>' +
      '</svg>';
  }
  function jokerInner(c, small) {
    var big = c.joker === 'big';
    var tag = big ? '大' : '小';
    if (small) {
      /* 小尺寸（出牌区 / 底牌）：皇冠 + 一个「王」字 + 左上角标 */
      return '<div class="ctr jk-mini' + (big ? ' b' : '') + '">' +
        '<span class="jk-tag">' + tag + '</span>' +
        crownSVG(big) +
        '<span class="jk-w">王</span></div>';
    }
    return '<div class="ctr jk-full' + (big ? ' b' : '') + '">' +
      '<span class="jk-corner">' + tag + '</span>' +
      crownSVG(big) +
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
    /* 手牌间距：叠 62% 时牌面只露出 38%，点数花色被下一张压住看不清。
       改成叠 50%（露出一半），宽度公式的系数同步从 0.38 提到 0.50。 */
    var OV = 0.50;
    var wByW = (avail - 4) / (OV * n + (1 - OV));
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
      h.style.setProperty('--ov', '-' + Math.round(w0 * OV) + 'px');
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
  /* 超时托管：第一次超时默认不出，之后本局由机器人代打，
     玩家一手动点「出牌/不出/提示」立刻收回控制权。 */
  var autoPlay = false;
  var speaking = false;
  function bindTableVoice() {
    var btn = document.getElementById('btn-table-voice');
    if (!btn || !window.Rec) return;
    var lastSend = 0;
    function flag(on) {
      if (speaking === on) return;
      speaking = on;
      Net.send({ t: 'table:speaking', gid: gid, on: on });
    }
    window.Rec.hold(btn, function (r) {
      /* touch + 模拟 mouse 补发会触发两次录制，900ms 内只认第一次 */
      var now = Date.now();
      if (now - lastSend < 900) return;
      lastSend = now;
      flag(false);
      Net.upload(r.file, 'voice', r.dur).then(function (up) {
        if (up && up.err) { toast(up.err); return; }
        Net.send({ t: 'room:chat', msg: { kind: 'voice', url: up.url, dur: r.dur, name: r.file.name, size: r.file.size } });
        Sfx.send();
      }).catch(function () { toast('发送失败'); });
    });
    /* hold 内部只绑了 up/down，这里再挂一层用来广播状态 */
    function down() { flag(true); btn.classList.add('speaking'); }
    function up() { flag(false); btn.classList.remove('speaking'); }
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
    if (m.on) btn.classList.add('speaking-remote'); else btn.classList.remove('speaking-remote');
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
    var q = document.getElementById('btn-table-quick');
    if (q) q.onclick = toggleQuickPanel;
    var sk = document.getElementById('btn-table-stick');
    if (sk) sk.onclick = toggleStickPanel;
    bindRailRelayout();
  }
  function reset() {
    sel = {}; over = false; autoPlay = false; dealAnim = true; S = null; myRoom = null; gid = null;
    hintCycle = 0; lastHintKey = ''; tcMsgs = []; closeTableChat(true);
    bidLog = []; v37BidTurn = -1; v37BidScore = 0; prevBidSeq = 0;
    lastActEvtKey = ''; lastBidEvtKey = ''; lastSpokenCards = '';
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
  var prevBidTurn = -1, prevBidKey = '', prevDblKey = '';
  var bidFlash = null;   // 本地缓存最近一次叫分，防止浮标一闪而过
  /* 逐条叫分日志：引擎只在「有人叫分」时更新 S.bid，pass 不写进去，
     于是「不叫」的玩家既没浮标也没语音。用轮到谁的变化把每个动作补出来，
     真人和机器人都覆盖。 */
  var bidLog = [], v37BidTurn = -1, v37BidScore = 0, prevBidSeq = 0;
  var lastActEvtKey = '', lastBidEvtKey = '', lastSpokenCards = '';
  var spokenBidSeq = {};   /* v44：按服务端 seq 统一去重，bidEvt 与 bidActs 不会重复念 */
  function onGame(m) {
    var prevTurn = S ? S.turn : -1;
    var prevLast = (S && S.last) ? (S.last.by + ':' + (S.last.cards || []).map(function (c) { return c.id; }).join(',') +
                    '|t' + S.turn + '|c' + (S.counts || []).join('.') + '|g' + (S.gid || '')) : '';
    S = m; mySeat = m.seat; gid = m.gid; rule = m.rule;
    document.getElementById('mid-notice').classList.add('hidden');
    /* v43：服务端显式下发动作事件，按 gid+seq 去重后直接播报。
       旧推断靠「turn/counts 变了就当新动作」，有人「过」时 m.last 仍是
       上上家的牌 → 又念一遍上上家出的牌；机器人叫分也会漏。 */
    var evtHandled = false, aEvt = m.actEvt || null, bEvt = m.bidEvt || null;
    var aKey = aEvt ? ((m.gid || '') + ':a' + aEvt.seq) : '';
    if (aEvt && aKey !== lastActEvtKey) {
      lastActEvtKey = aKey; evtHandled = true;
      if (aEvt.act === 'pass') {
        lastSpokenCards = '';
        if (aEvt.by !== mySeat) {
          Sfx.pass();
          if (App.settings().voice) {
            try { Sfx.cancelSpeak && Sfx.cancelSpeak(); } catch (e) { }
            Sfx.announce({ type: 'pass' });
          }
        }
      } else if (aEvt.act === 'play' && m.last && (m.last.cards || []).length) {
        var bigE = m.last.info && (m.last.info.type === 'bomb' || m.last.info.type === 'rocket');
        Sfx.cardDrop(bigE);
        if (aEvt.by !== mySeat && m.last.info) Sfx.announce(m.last.info, m.last.cards);
      }
    }
    /* v44：服务端下发权威叫分日志（每次动作一条，含「不叫」、含叫满 3 分
       直接进 play 的最后一家）。用它刷新浮标，并按 seq 补播漏掉的语音。 */
    if (Array.isArray(m.bidActs) && m.bidActs.length) {
      bidLog = m.bidActs.slice(-12).map(function (r) {
        return { i: r.by, score: r.score || 0, seq: r.seq, t: Date.now() };
      });
      var lastRec = bidLog[bidLog.length - 1];
      bidFlash = { by: lastRec.i, score: lastRec.score, t: Date.now() };
      m.bidActs.forEach(function (r) {
        var k = (m.gid || '') + ':b' + r.seq;
        if (spokenBidSeq[k]) return;
        spokenBidSeq[k] = 1;
        /* v45：以前这里的 600ms 抑制会把自己刚点完后到达的「别人叫分」也吞掉，
           正是叫分偶尔没声音的原因。按 seq 去重已经够了，只跳过自己的动作。 */
        if (r.by !== mySeat && App.settings().voice) {
          if (S.cutMode) {
            Sfx.cut(r.score || 0);
          } else {
            Sfx.bid(r.score || 0);
            Sfx.speak(r.score ? ('叫' + r.score + '分') : '不叫');
          }
        }
      });
    }
    if (bEvt) {
      var bKey = (m.gid || '') + ':b' + bEvt.seq;
      if (bKey !== lastBidEvtKey) {
        lastBidEvtKey = bKey;
        if (!Array.isArray(m.bidActs) || !m.bidActs.length) {
          bidLog.push({ i: bEvt.by, score: bEvt.score || 0, seq: bEvt.seq, t: Date.now() });
          if (bidLog.length > 12) bidLog.shift();
          bidFlash = { by: bEvt.by, score: bEvt.score || 0, t: Date.now() };
          if (!spokenBidSeq[bKey]) {
            spokenBidSeq[bKey] = 1;
            if (bEvt.by !== mySeat && App.settings().voice) {
              if (S.cutMode) Sfx.cut(bEvt.score || 0);
              else {
                Sfx.bid(bEvt.score || 0);
                Sfx.speak(bEvt.score ? ('叫' + bEvt.score + '分') : '不叫');
              }
            }
          }
        } else spokenBidSeq[bKey] = 1;
      }
    }
    /* 出牌 / 不出的提示音：对手的牌型还要语音播报 */
    /* key 里带上「轮到谁 + 各家剩余张数」：连续两次「过」时 by:cards 完全一样，
       旧逻辑会当成同一件事直接跳过，表现就是「过」有时有图标和声音、有时没有。 */
    var roundKey = '|t' + m.turn + '|c' + (m.counts || []).join('.') + '|g' + (m.gid || '');
    var nowLast = m.last ? (m.last.by + ':' + (m.last.cards || []).map(function (c) { return c.id; }).join(',') + roundKey) : '';
    if (!evtHandled && !aEvt && nowLast && nowLast !== prevLast) {
      var byMe = m.last.by === mySeat;
      if ((m.last.cards || []).length) {
        var big = m.last.info && (m.last.info.type === 'bomb' || m.last.info.type === 'rocket');
        Sfx.cardDrop(big);
        if (!byMe && m.last.info) Sfx.announce(m.last.info, m.last.cards);   // 带上牌面才能念准「三张几带一张几」
      } else if (!byMe) {
        Sfx.pass();
        /* 机器人/对手过牌也要念出来：走 announce 统一播报，
           音效与人声错开 200ms，不会互相盖掉。 */
        if (App.settings().voice) Sfx.announce({ type: 'pass' });
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
    /* 逐条推断叫分动作（含「不叫」）。bidTurn 一变说明上一个人操作完了：
       最高分涨了 = 叫分；没涨 = 不叫。不依赖引擎是否把 pass 写进 bid，
       真人和机器人都覆盖 —— 第三个玩家不叫没图标没语音就是漏在这里。 */
    /* v40：叫满 3 分时 phase 从 bid 直接跳 play/double，
       旧判断只看 m.phase==='bid'，最后一个人（含「不叫」）永远不播。 */
    if (!bEvt && (m.phase === 'bid' || (v37BidTurn >= 0 && (m.phase === 'play' || m.phase === 'double')))) {
      if (v37BidTurn >= 0 && v37BidTurn !== m.bidTurn) {
        var sc = (m.bid && m.bid.score) || 0;
        var didBid = sc > v37BidScore;
        var rec = { i: v37BidTurn, score: didBid ? sc : 0, seq: (++prevBidSeq), t: Date.now() };
        bidLog.push(rec);
        if (bidLog.length > 12) bidLog.shift();
        bidFlash = { by: rec.i, score: rec.score, t: Date.now() };
        /* 自己刚点过叫分时本地已念过，状态推断别再念第二遍；机器人/别人照常播 */
        var justMine = (rec.i === mySeat && Date.now() - lastLocalBid.t < 600);
        if (!justMine && App.settings().voice) {
          if (S.cutMode) Sfx.cut(rec.score || 0);
          else {
            Sfx.bid(rec.score || 0);
            Sfx.speak(rec.score ? ('叫' + rec.score + '分') : '不叫');
          }
        }
      }
      v37BidTurn = m.bidTurn; v37BidScore = (m.bid && m.bid.score) || 0;
      if (m.phase !== 'bid') { v37BidTurn = -1; v37BidScore = 0; }
    } else {
      v37BidTurn = -1; v37BidScore = 0;
    }
    /* 别人叫分也要念出来。以前只播自己点的那一下，
       机器人叫了 3 分你只能看字幕，听声根本不知道叫了几分。 */
    /* 加上局标识：跨局时若两人叫了同样的分，旧 key 相等会被当成旧消息吞掉。 */
    var bidKey = m.bid ? ((m.gid || '') + ':' + m.bid.by + ':' + m.bid.score) : '';
    /* 推断日志为空时才走旧逻辑兜底，避免同一条叫分念两遍 */
    if (!bEvt && !bidLog.length && bidKey && bidKey !== prevBidKey) {
      bidFlash = { by: m.bid.by, score: m.bid.score, t: Date.now() };
      var byMe2 = m.bid.by === mySeat;
      if (!byMe2 && App.settings().voice) {
        if (S.cutMode) Sfx.cut(m.bid.score || 0);
        else {
          Sfx.bid(m.bid.score || 0);
          Sfx.speak(m.bid.score ? ('叫' + m.bid.score + '分') : '不叫');
        }
      }
      prevBidKey = bidKey;
    }
    /* 别人（含机器人）加倍/不加倍也要播报：以前只在自己点的时候有，
       机器人加倍了只看得到倍数变化，听不到提示。 */
    var dblKey = (m.gid || '') + ':' + (m.doubled || []).join(',');
    if (dblKey !== prevDblKey) {
      var mine = mySeat;
      var added = (m.doubled || []).filter(function (x) {
        return prevDblKey.replace(/^[^:]*:/, '').split(',').indexOf(String(x)) < 0;
      });
      prevDblKey = dblKey;
      if (added.length && added.indexOf(mine) < 0 && App.settings().voice) {
        Sfx.announce({ type: 'double' });
      }
    }
    render();
    showRuleTip(m);
    if (m.phase === 'over' && !over) { over = true; showResult(m); }
  }
  var lastResultMeta = { coinDelta: 0, coins: null };
  var lastRest = null;
  function onResult(m, meta) {
    if (meta) lastResultMeta = meta;
    /* v48：结算消息里的剩牌先存一份，防止 game 的 over 帧先到时还没数据 */
    if (m && m.allHands && m.allHands.length) {
      lastRest = { hands: m.allHands, seats: m.seats || [], landlord: m.landlord, n: m.n || 2 };
    }
    /* 优先用 result 消息本身（带权威 result / 昵称 / 剩牌），
       否则回退到最后一帧状态——原实现固定用 S，结果先到时会算错输赢。 */
    if (!over) { over = true; showResult((m && m.result) ? m : (S || m)); }
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
    var txt = r === 'trio54' ? '三人经典 · 54 张 · 叫分 1~3 分 + 加倍 · 农民一方出完即胜'
      : r === 'cut37' ? '双人减牌 · 37 张 · 竞叫减 N 张定地主 · 农民剩 ≤N 张即胜 · 无主动加倍，春天/炸弹照常翻倍'
        : r === 'let46' ? '双人 46 张 · 叫分 1~3 分 + 加倍 · 先出完手牌者胜'
          : '双人 37 张 · 叫分 1~3 分 + 加倍 · 先出完手牌者胜';
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
  /* 叫分 / 不叫 / 抢地主 / 加倍：以前只有语音，字幕上完全看不出是谁叫的、叫了几分。
     现在在对应玩家的头像旁边挂一块浮标，作用就跟出牌时那个「过」字一样，一眼能看到。 */
  function bidTag(i) {
    if (!S) return '';
    var out = '';
    var bf = (bidFlash && Date.now() - bidFlash.t < 4000) ? bidFlash : null;
    var lastAct = null;
    for (var ai = bidLog.length - 1; ai >= 0; ai--) { if (bidLog[ai].i === i) { lastAct = bidLog[ai]; break; } }
    var shown = lastAct || ((S.bid && S.bid.by === i) ? S.bid : (bf && bf.by === i ? bf : null));
    if (shown) {
      out += '<span class="btagm">' + (S.cutMode
        ? (shown.score ? ('减 ' + shown.score + ' 张') : '不叫')
        : (shown.score ? ('叫 ' + shown.score + ' 分') : '不叫')) + '</span>';
    } else if (S.phase === 'bid' && S.bidTurn === i) {
      out += '<span class="btagm wait">' + (S.cutMode ? '竞叫中…' : '叫分中…') + '</span>';
    }
    if (S.doubled && S.doubled.indexOf(i) >= 0) {
      out += '<span class="btagm dbl">加倍</span>';
    } else if (S.phase === 'double' && S.doubleTurn === i) {
      out += '<span class="btagm wait">加倍中…</span>';
    } else if (S.phase === 'double' && (S.doubleExcluded || []).indexOf(i) >= 0) {
      /* v45：叫过分的玩家明确标出来，不再让人以为自己也能点加倍。 */
      out += '<span class="btagm wait">不可加倍</span>';
    }
    return out;
  }
  function render() {
    if (!S) return;
    document.body.classList.remove('waitroom');
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
      if (S.cutMode && S.landlord >= 0 && S.phase === 'play' && i !== S.landlord) {
        var need = Math.max(0, cnt - S.cutTarget);
        needTxt = '剩 ' + cnt + ' · 再出 ' + need + ' 张胜';
      }
      var act = (S.phase === 'play' && S.turn === i) ? ' act' : '';
      return '<div class="ts' + act + (cls ? ' ' + cls : '') + '">' +
        '<div class="av">' + (u ? Avatar.svg(u.avatar, 26) : '') + '</div>' +
        '<div class="ts-i"><div class="nm">' + (u ? esc(shortName(u, '空位')) : '空位') + '</div>' + roleTag(i) +
        '<div class="cnt">' + needTxt + '</div>' + bidTag(i) + '</div>' +
        (act ? '<div class="clock"><b>' + left + '</b></div>' : '') +
        '</div>';
    }
    /* 我在右侧时的信息块（两人场用） */
    function mySeatHTML() {
      var cnt = S.counts[me];
      var act = (S.phase === 'play' && S.turn === me) ? ' act' : '';
      return '<div class="ts me' + act + '">' +
        '<div class="av">' + Avatar.svg(meU && meU.avatar, 26) + '</div>' +
        '<div class="ts-i"><div class="nm">' + esc(shortName(meU, '我')) + '</div>' + roleTag(me) +
        '<div class="cnt">剩 ' + cnt + ' 张</div>' + bidTag(me) + '</div>' +
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
        '<div><div class="nm">' + esc(shortName(meU, '我')) + '</div>' + roleTag(me) +
        '<div class="cnt">剩 ' + S.counts[me] + ' 张</div>' + bidTag(me) + '</div><div class="sp"></div>' +
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
      if (S.cutMode) {
        bidTxt = '<span class="btag">减 ' + (S.cutTarget || 0) + ' 张 · 农民剩 ≤' + (S.cutTarget || 0) + ' 张即胜</span>';
      } else if (score) bidTxt = '<span class="btag">叫 ' + score + ' 分</span>';
      else bidTxt = '<span class="btag">抢地主</span>';
      if (S.cutMode) bidTxt += '<span class="btag nod">减牌玩法 · 无主动加倍 · 当前 ×' + S.multiplier +
        (S.bombCount ? ' · 炸弹 ' + S.bombCount + ' 个' : '') + '</span>';
      else if (S.doubled && S.doubled.length) bidTxt += '<span class="btag dbl">已加倍 ×' + S.multiplier + '</span>';
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
    renderResignBtn();
    /* 牌桌背景音乐看门狗：每次状态刷新都确认一次，
       被原生旋转/切后台打断后能自动把音乐拉回来 */
    try { Sfx.setScene('table'); Sfx.ensure(); } catch (x) { }
    startTimer();
    fitPlayed();
    /* 所有座位/手牌都渲染完后再定位快捷栏。
       注意：牌桌页可能此刻还是隐藏的（getBoundingClientRect 全是 0），
       所以要等页面真正显示出来再量 —— 用 rAF + 短延时双保险。 */
    scheduleRailLayout();
  }
  /* 快捷栏（快捷语 / 快捷表情 / 语音 / 文字）定位
     原来是死值 bottom:120px 往上排四颗按钮，实测 8 种屏有 7 种
     正好压在右侧玩家的头像昵称上。
     现在改成：先量出「右侧玩家信息块下沿」和「手牌顶部」，
     把整条栏放进这两者之间的缝里；缝不够就自动降级排布
     （竖排 → 2×2 → 横排）并缩小按钮，保证既不压对手也不压手牌。 */
  function layoutRail() {
    var rail = document.getElementById('table-rail');
    if (!rail) return;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var seat = document.querySelector('.seatcol.right .ts') ||
               document.querySelector('.seatright .ts') ||
               document.querySelector('.seatright') ||
               document.querySelector('.seatcol.right');
    var handTop = vh;
    var hw = document.querySelector('.handwrap');
    if (hw) { var hr = hw.getBoundingClientRect(); if (hr.height > 0) handTop = hr.top; }
    var seatBottom = 0;
    if (seat) { var sr = seat.getBoundingClientRect(); if (sr.height > 0) seatBottom = sr.bottom; }
    var top = Math.max(seatBottom + 8, 62);   /* 不低于顶部安全区，最上面那颗按钮不会被裁 */
    var avail = Math.max(24, handTop - top - 6);

    /* v40：一律优先 2×2（横着四个挡打牌），竖排只在 2×2 也塞不下时兜底 */
    /* v43：真机上仍退化成横排四个挡住手牌 —— 去掉竖排/横排回退，
       只保留 2×2（按 --rb 三档缩放），再靠 CSS !important 硬锁。 */
    var MODES = [
      ['grid2'], ['grid2', 'compact'], ['grid2', 'tiny']
    ];
    var pick = null, pickH = 0;
    for (var i = 0; i < MODES.length; i++) {
      rail.className = 'tablerail' + (MODES[i].length ? ' ' + MODES[i].join(' ') : '');
      var h = rail.offsetHeight || 0, w = rail.offsetWidth || 0;
      if (h > 0 && h <= avail && w <= vw - 8) { pick = MODES[i]; pickH = h; break; }
      if (h > 0 && (!pickH || h < pickH)) { pickH = h; pick = MODES[i]; }
    }
    if (!pick) pick = ['grid2', 'tiny'];
    rail.className = 'tablerail' + (pick.length ? ' ' + pick.join(' ') : '');
    var hh = rail.offsetHeight || 120;
    if (top + hh > handTop - 6) top = Math.max(seatBottom + 2, handTop - hh - 6);
    if (top + hh > vh - 4) top = Math.max(0, vh - hh - 4);
    if (top < 0) top = 0;

    /* 坐标换算：牌桌可能被整体缩放（transform: scale），而且 rail 的
       定位父元素也不是视口。直接把视口像素写进 style.top 会整体偏掉。
       这里先置 0 量一次，用「视口位移 / 缩放比」反推真正该写的 css 值。 */
    rail.style.top = '0px';
    rail.style.bottom = 'auto';
    var r0 = rail.getBoundingClientRect();
    var scale = rail.offsetHeight > 0 ? (r0.height / rail.offsetHeight) : 1;
    if (!(scale > 0.01) || !isFinite(scale)) scale = 1;
    var cssTop = (top - r0.top) / scale;
    if (!isFinite(cssTop)) cssTop = 0;
    rail.style.top = Math.round(cssTop) + 'px';
    /* 兜底：写完再量一次，偏差过大就直接按差值修正一次 */
    var r1 = rail.getBoundingClientRect();
    var diff = top - r1.top;
    if (Math.abs(diff) > 2) {
      rail.style.top = Math.round(cssTop + diff / scale) + 'px';
    }
  }

  var railTimer = null;
  function scheduleRailLayout() {
    try { layoutRail(); } catch (e) { }
    try {
      if (window.requestAnimationFrame) requestAnimationFrame(function () {
        try { layoutRail(); } catch (e) { }
      });
    } catch (e) { }
    clearTimeout(railTimer);
    railTimer = setTimeout(function () { try { layoutRail(); } catch (e) { } }, 80);
  }
  /* 页面尺寸/方向变化时重新定位 */
  function bindRailRelayout() {
    var t = null;
    var go = function () { clearTimeout(t); t = setTimeout(function () { try { layoutRail(); } catch (e) { } }, 120); };
    try { window.addEventListener('resize', go); } catch (e) { }
    try { window.addEventListener('orientationchange', go); } catch (e) { }
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
    document.body.classList.add('waitroom');
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
    /* 流程改为：先邀请真人 → 人不满再补机器人 → 点「开始游戏」才发牌。
       之前是「补满即开局」，房主还在邀请好友时牌已经发下去了。 */
    var isOwner = mySeat === 0;
    var btns = '<button class="btn ghost" onclick="Game.leave()">离开房间</button>';
    if (isOwner) {
      /* 文案统一 4 个字以内 + 不换行，高度才整齐；
         「补机器人」这个名字会暴露对手是机器人，改叫「随机邀请在线玩家」。 */
      btns += '<button class="btn" onclick="Game.addBot()">邀请好友</button>';
      if (need > 0) {
        btns += '<button class="btn" onclick="Game.fillAll()">随机邀请在线玩家</button>';
      }
      // 满员才允许开始
      btns += need === 0
        ? '<button class="btn jade" onclick="Game.startNow()">▶ 开始游戏</button>'
        : '<button class="btn jade" style="opacity:.45;pointer-events:none">▶ 差 ' + need + ' 人</button>';
    }
    document.getElementById('action-zone').innerHTML =
      '<div class="bidwrap" style="flex-wrap:wrap">' + btns + '</div>';
    var rid = (m && m.gid) ? m.gid : (gid || '');
    /* 房间号单独一行 + 复制按钮。
       以前只用一个大字横排，牌桌中间区域高度不够时会被直接裁掉，房主看不到房间号。 */
    document.getElementById('played').innerHTML =
      '<div class="waitbox" style="margin-top:2px">' +
      '<div class="st">等待玩家就位</div>' +
      '<div class="ridlabel">房间号</div>' +
      '<div class="ridrow"><span class="rid" id="rid-num">' + rid + '</span>' +
      '<button class="btn ghost sm" id="rid-copy">复制</button></div>' +
      '<div class="st">已就位 ' + filled + '/' + n + '</div>' +
      '<div class="seatsrow">' + cards + '</div>' +
      '<div class="wbtip">把房间号发给好友，或点下方「邀请好友」</div></div>';
    var cb = document.getElementById('rid-copy');
    if (cb) cb.onclick = function () {
      copyText(rid, '房间号已复制：' + rid);
    };
  }

  /* 复制房间号：优先用系统剪贴板，Web 上不可用 / 非安全上下文时回落到隐藏输入框，
     两条路都失败再提示手动复制 —— 不会点了没反应。 */
  function copyText(txt, okMsg) {
    txt = String(txt || '');
    var done = function () { try { App.toast(okMsg || ('已复制：' + txt)); } catch (e) {} };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, fallback); return;
      }
    } catch (e) {}
    fallback();
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, txt.length);
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        ta.remove();
        if (ok) { done(); return; }
      } catch (e) {}
      try { App.toast('复制失败，房间号：' + txt); } catch (e) {}
    }
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
      if (S.cutMode && i !== S.landlord && c <= S.cutTarget + 1) return true;
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
      /* 认输已移到右上角常驻按钮，不再每轮都占一次操作区的位置 */
      z.innerHTML = '<div class="bidwrap"><div class="btn ghost" style="text-align:center;opacity:.6">等待' +
        (S.seats[S.turn] ? esc(S.seats[S.turn].nick) : '对手') + '出牌…</div></div>';
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
    var eligible = Array.isArray(S.doubleSeats) ? S.doubleSeats : [];
    var excluded = Array.isArray(S.doubleExcluded) ? S.doubleExcluded : [];
    var bidders = Array.isArray(S.doubleBidders) ? S.doubleBidders : [];
    var who = S.seats[S.doubleTurn];
    var bidScore = (S.bid && S.bid.score) || 1;
    /* v45：叫过分的玩家连按钮都不给，直接说明为什么没有加倍权。 */
    if (excluded.indexOf(mySeat) >= 0) {
      return '<div class="bidwrap"><div class="btn ghost" style="text-align:center;opacity:.7">' +
        (bidders.indexOf(mySeat) >= 0 ? '你已经叫过分，本局不能加倍' : '你已经轮到叫分，本局不能加倍') +
        '</div></div>';
    }
    if (eligible.indexOf(mySeat) < 0) {
      return '<div class="bidwrap"><div class="btn ghost" style="text-align:center;opacity:.7">只有没轮到叫分的玩家可以加倍</div></div>';
    }
    if (!mine) {
      return '<div class="bidwrap"><div class="btn ghost" style="text-align:center;opacity:.7">等待 ' +
        esc(who ? who.nick : '对手') + ' 依次决定是否加倍…</div></div>';
    }
    return '<div class="bidwrap"><div style="font-size:11px;color:var(--sub);text-align:center;line-height:1.4">' +
      '地主叫 ' + bidScore + ' 分定庄，你没轮到叫分<br>只有没轮到叫分的人能加倍，叫过分的不能（当前 ×' + S.multiplier + '）</div>' +
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
    /* v46 减牌竞叫：首叫减1/减2，之后只能在上家基础上 +1 或 +2，随时可「不叫」。
       一旦有人不叫，服务端立刻定庄并直接进入出牌，没有加倍阶段。 */
    if (S.cutMode) {
      if (S.bidTurn !== mySeat) return waitTxt('等待对方竞叫减牌…');
      var copts = Array.isArray(S.cutOptions) && S.cutOptions.length ? S.cutOptions : [1, 2];
      var cb = '';
      copts.forEach(function (n, ci2) {
        cb += '<button class="btn' + (ci2 === copts.length - 1 ? '' : ' ghost') +
          '" onclick="Game.bid({type:\'cut\',count:' + n + '})">减 ' + n + ' 张</button>';
      });
      b = '<button class="btn ghost" onclick="Game.bid({type:\'pass\'})">不叫</button>' + cb;
      var hi2 = S.cutHigh || 0;
      var tip2 = '<div style="text-align:center;font-size:11px;color:var(--sub);margin-bottom:6px;width:100%">' +
        (hi2 ? ('上家减 <b style="color:var(--gold)">' + hi2 + ' 张</b> · 你只能 +1 或 +2') : '首叫：减 1 张 或 减 2 张') +
        '<br>数字是地主声称「能在农民剩 N 张之前出完」的门槛</div>';
      return '<div class="bidwrap" style="flex-wrap:wrap">' + tip2 + b + '</div>';
    }
    /* v46：46 张 / 37 张 / 三人 54 张统一走叫分制，不再有「抢地主让牌」按钮。 */
    {
      if (S.bidTurn !== mySeat) return waitTxt('等待其他玩家叫分…');
      /* v45：后叫的人只能比当前最高分更高，不能叫一样的分。
         按钮直接禁用并写明原因，服务端引擎还会再裁决一次。 */
      var cur = (S.bidHighest != null) ? S.bidHighest : (S.bid ? S.bid.score : 0);
      var opts = '';
      for (var s = 1; s <= 3; s++) {
        var ok = s > cur;
        opts += '<button class="btn' + (s === 3 ? '' : ' ghost') + '"' + (ok ? '' : ' disabled title="必须高于当前最高分"') +
          ' onclick="Game.bid({type:\'bid\',score:' + s + '})">' + s + ' 分</button>';
      }
      b = '<button class="btn ghost" onclick="Game.bid({type:\'pass\'})">不叫</button>' + opts;
    }
    var tip = '';
    {
      var hi = (S.bidHighest != null) ? S.bidHighest : (S.bid ? S.bid.score : 0);
      tip = '<div style="text-align:center;font-size:11px;color:var(--sub);margin-bottom:6px;width:100%">当前最高 <b style="color:var(--gold)">' +
        hi + ' 分</b> · 只能叫更高的分</div>';
    }
    return '<div class="bidwrap" style="flex-wrap:wrap">' + tip + b + '</div>';
  }
  function waitTxt(t) {
    return '<div class="bidwrap"><div class="btn ghost" style="opacity:.65;text-align:center">' + t + '</div></div>';
  }

  /* ---------------- 操作 ---------------- */
  function play() {
    autoPlay = false;                     // 手动操作 → 立刻解除托管
    if (!canPlay()) { Sfx.warn(); return toast('这手牌打不过上家'); }
    var cs = selectedCards();
    var info = DDZ.parse(cs);
    // 出牌提示音（拍牌声） + 语音播报 + 牌型音效
    Sfx.cardDrop(!!(info && (info.type === 'bomb' || info.type === 'rocket')));
    if (info) Sfx.announce(info, cs);
    if (info && (info.type === 'bomb' || info.type === 'rocket')) shake();
    App.vibeDo(18);   // 出牌震动：走原生 Vibrator，不再依赖常被禁用的 navigator.vibrate
    sel = {};
    Net.send({ t: 'game:play', ids: cs.map(function (c) { return c.id; }) });
  }
  function pass() {
    autoPlay = false;                     // 手动操作 → 立刻解除托管
    var need = (S.last && S.last.by !== mySeat) ? S.last.info : null;
    if (!need) { toast('你是先手，必须出牌'); return; }
    Sfx.pass();
    /* v40：走统一播报出口，会清掉排队中的上一家牌型语音 */
    if (App.settings().voice) Sfx.announce({ type: 'pass' });
    sel = {};
    Net.send({ t: 'game:play', ids: [] });
  }
  function hint() {
    var need = (S.last && S.last.by !== mySeat) ? S.last.info : null;
    var key = (S.counts.join(',') + '|' + (need ? need.type + need.main + need.len : 'free') + '|' + S.hand.length);
    if (key !== lastHintKey) { lastHintKey = key; hintCycle = 0; }
    var h = DDZ.hint(S.hand, need, { cycle: hintCycle, urgent: urgentNow() });
    if (!h) {
      /* 关键：以前这里会「顺手替玩家过牌」，手上明明有能压的牌（引擎漏枚举
         四带二 / 飞机带翅膀）时就被自动过了，等于白丢一轮。
         现在只提示，绝不代劳；要过牌请自己点「不出」。 */
      toast(need ? '没有能压过的牌，可点「不出」' : '没有可出的牌');
      Sfx.warn();
      hintCycle = 0;
      sel = {}; renderHand(); updateActions();
      return;
    }
    hintCycle++;
    sel = {}; h.ids.forEach(function (i) { sel[i] = 1; });
    Sfx.tap(); renderHand(); updateActions();
    var nm = DDZ.speak(h.info);
    if (nm) toast('建议：' + nm);
  }
  var lastLocalBid = { t: 0, seat: -1 };
  function bid(act) {
    /* v45：界面传的是对象 {type:'bid',score:n} / {type:'pass'} / {type:'grab'}。
       以前用 Number(act) 取分数，对象会变成 NaN → 本地一律念成「不叫」。 */
    var a = (act && typeof act === 'object') ? act
      : (act === 'grab' ? { type: 'grab' }
        : (act === 'nograb' ? { type: 'pass' }
          : (Number(act) > 0 ? { type: 'bid', score: Number(act) } : { type: 'pass' })));
    /* v46：46 张也走叫分制，必须一起校验严格递增；减牌走自己的选项校验 */
    if (a.type === 'bid' && S && !S.cutMode) {
      var hi = (S.bidHighest != null) ? S.bidHighest : (S.bid ? S.bid.score : 0);
      var sc = Number(a.score) || 0;
      if (!(sc > hi && sc <= 3)) {
        Sfx.warn();
        toast('只能叫比当前最高 ' + hi + ' 分更高的分');
        return;
      }
    }
    lastLocalBid = { t: Date.now(), seat: mySeat };
    var n = (a.type === 'grab') ? 3 : (a.type === 'bid' ? (Number(a.score) || 0) : 0);
    if (S && S.cutMode) {
      /* 减牌：一次性完成音效 + 「减 N 张 / 不叫」语音，不再叠加第二句 */
      Sfx.cut(a.type === 'cut' ? (Number(a.count) || 0) : 0);
    } else {
      Sfx.bid(n);
      /* 叫分语音播报：以前只有音效没有语音，光听声音不知道叫了几分 */
      if (App.settings().voice) {
        var txt = (a.type === 'grab') ? '抢地主' : (a.type === 'nograb' ? '不抢' : (n ? ('叫' + n + '分') : '不叫'));
        Sfx.speak(txt);
      }
    }
    Net.send({ t: 'game:bid', act: a });
  }
  /* 认输：右上角常驻（竖屏按钮左边），只在牌局进行中显示，
     不再每轮出牌都弹一次占地方。 */
  function renderResignBtn() {
    /* 认输放到顶部栏，金币左侧、与金币同一行 —— 不再压住右侧玩家的昵称 */
    var host = document.getElementById('topbar');
    if (!host) return;
    var b = document.getElementById('btn-resign');
    var show = !!(S && (S.phase === 'play' || S.phase === 'bid' || S.phase === 'double'));
    if (!b) {
      b = document.createElement('button');
      b.id = 'btn-resign'; b.className = 'resignbtn';
      b.textContent = '认输';
      b.onclick = function () { App.confirm('确定认输吗？', '认输将直接判负', function () { Net.send({ t: 'game:resign' }); }); };
      var coin = host.querySelector('.coin');
      if (coin) host.insertBefore(b, coin); else host.appendChild(b);
    }
    b.classList.toggle('hidden', !show);
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
    /* auto:false → 只补位，不自动开局，等房主点「开始游戏」 */
    for (var i = 0; i < n - filled; i++) Net.send({ t: 'room:joinbot', gid: gid, auto: false });
  }
  /* 房主手动开局 */
  function startNow() {
    if (!gid) return;
    Net.send({ t: 'room:start', gid: gid });
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
    /* 叫分默认 8 秒：超时一律「不叫」 */
    var leftBid = 8;
    timer = setInterval(function () {
      leftBid--;
      if (leftBid > 0) return;
      clearInterval(timer);
      if (!S || S.phase !== 'bid' || S.bidTurn !== mySeat) return;
      Net.send({ t: 'game:bid', act: { type: 'pass' } });
      toast(S.cutMode ? '超时未竞叫，默认不叫' : '超时未叫分，默认不叫');
    }, 1000);
  }

  function startTimer() {
    clearInterval(timer);
    if (!S || S.phase !== 'play') return;
    /* 出牌默认 30 秒 */
    left = 30;
    if (S.turn === mySeat) {
      timer = setInterval(function () {
        left--;
        if (left > 0) return;
        clearInterval(timer);
        var need = (S.last && S.last.by !== mySeat) ? S.last.info : null;
        /* 第一次超时：默认「不出」（先手则出最小的一手）。
           之后本局进入机器人托管，直到玩家自己再动手出牌。 */
        if (!autoPlay) {
          autoPlay = true;
          if (need) { toast('超时，默认不出'); Net.send({ t: 'game:play', ids: [] }); }
          else {
            var h0 = DDZ.hint(S.hand, null, { urgent: urgentNow() });
            Net.send({ t: 'game:play', ids: h0 ? h0.ids : [] }); sel = {};
          }
          return;
        }
        /* 托管中：由机器人按牌型自动出牌 */
        var h = (need ? DDZ.hint(S.hand, need, { urgent: urgentNow() })
                      : DDZ.hint(S.hand, null, { urgent: urgentNow() }));
        if (need && !h) { Net.send({ t: 'game:play', ids: [] }); }
        else { Net.send({ t: 'game:play', ids: h ? h.ids : [] }); sel = {}; }
      }, 1000);
    }
  }

  /* ---------------- 房间内聊天（文字 / 表情 / 快捷语 / 短语音） ---------------- */
  /* 快捷语：点一下发出去，除了显示文字还会把这句话念出来 */
  var QUICK = ['快点儿吧，我等的花儿都谢了', '你的牌打得也太好了', '不要走，决战到天亮',
    '别走开，马上回来', '合作愉快', '这把稳了', '好牌，佩服', '你是我的偶像'];
  var tcOutside = null;
  function toggleTableChat() {
    var el = document.getElementById('tchat');
    if (!el) { renderTableChat(); el = document.getElementById('tchat'); if (!el) return; }
    tcOpen = !tcOpen;
    el.classList.toggle('hidden', !tcOpen);
    if (tcOpen) {
      renderTableChat();
      setTimeout(function () {
        var i = document.getElementById('tc-in');
        if (i) { try { i.focus(); } catch (x) { } }
      }, 60);
      /* 点面板以外的空白处自动收起（含快捷语面板外的区域） */
      if (!tcOutside) {
        tcOutside = function (e) {
          var box = document.getElementById('tchat');
          if (!box || box.classList.contains('hidden')) return;
          if (box.contains(e.target)) return;
          if (e.target && e.target.closest && e.target.closest('#btn-table-chat')) return;
          toggleTableChat();
        };
        setTimeout(function () { document.addEventListener('pointerdown', tcOutside, true); }, 80);
      }
    } else if (tcOutside) {
      document.removeEventListener('pointerdown', tcOutside, true);
      tcOutside = null;
    }
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
      /* 文字面板只留「输入框 + 发送」：短语音和表情各自有独立入口（🎤 / 😀），
         面板里再塞一遍既占地方又容易误触。 */
      '<div class="tc-bar">' +
      '<input id="tc-in" placeholder="说点什么…" inputmode="text" enterkeyhint="send">' +
      '<div class="ic send" id="tc-send">➤</div>' +
      '</div>';
    el.querySelector('#tc-x').onclick = toggleTableChat;
    el.querySelector('#tc-send').onclick = tcSendText;
    el.querySelector('#tc-in').addEventListener('keydown', function (e) { if (e.key === 'Enter') tcSendText(); });
    el.querySelectorAll('[data-q]').forEach(function (b) {
      b.onclick = function () {
        var txt = QUICK[+b.dataset.q] || '';
        /* 快捷语：显示文字 + 同时用语音念出来，对方听到也看到 */
        tcSend({ kind: 'text', text: txt, quick: true, voice: txt });
        Sfx.send();
        try { Sfx.speak(txt); } catch (e) { }
        floatSay('我', txt, 'quick');
      };
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
    if (tcSendSticker._lock) return;          // 防止一次点击发两条
    tcSendSticker._lock = true;
    setTimeout(function () { tcSendSticker._lock = false; }, 350);
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
    /* 自己发的文字也在牌桌飘一次（服务端回显不再重复） */
    floatSay('我', v, 'text');
    /* 发完自动收起：不用再手动点 ✕，也不挡着看牌 */
    if (tcOpen) toggleTableChat();
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
    var mm = m.msg || {};
    /* 取自己的 uid 做「是不是我发的」判断；未登录/异常时兜空，不能让整条消息处理挂掉 */
    var myUid = '';
    try { var me = App.me(); if (me) myUid = me.uid || ''; } catch (e) { myUid = ''; }
    /* 短语音不再进聊天框：直接在房间里播出来，不占画面 */
    if (mm.kind === 'voice') {
      Sfx.msg();
      /* v40：自己发的短语音不再本机重播（回声）；只有对方才自动播放 */
      if (mm.from !== myUid) {
        if (mm.url) autoPlayVoice(Net.abs(mm.url));
        floatSay(mm.nick || '对手', '🎤 语音', 'voice');
      } else { App.toast('短语音已发送'); }
      return;
    }
    tcMsgs.push(mm); if (tcMsgs.length > 200) tcMsgs.shift();
    var badge = document.getElementById('btn-table-chat');
    if (badge && !tcOpen) { badge.classList.add('new'); setTimeout(function () { badge.classList.remove('new'); }, 2600); }
    renderTcMsgs(); Sfx.msg();
    /* 文字 / 表情 / 快捷语：对方不用点开聊天框，直接在屏幕右半边飘出来看 */
    /* 自己发的文字也要在牌桌飘出来：以前只飘对方的，发完像没发出去 */
    var isMine = String(mm.from || '') === String(myUid || '');
    /* v40：自己发的在发送入口已本地飘一次，服务端回显只入聊天框，不再重复飘屏。
       以前快捷语/表情/文字都显示两条，根因就是本地 + 回显各一次。 */
    if (!isMine) {
      if (mm.kind === 'sticker') floatSay(mm.nick || '对手', mm.emoji || '🙂', 'sticker');
      else if (mm.quick) floatSay(mm.nick || '对手', mm.text, 'quick', mm.voice);
      else floatSay(mm.nick || '对手', mm.text || '', 'text');
    }
  }

  /* ---------- 飘屏：对方发的文字/表情/快捷语直接在右半边显示 ---------- */
  var floatTimer = [];
  function floatSay(nick, text, kind, voiceUrl) {
    try {
      var layer = document.getElementById('float-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'float-layer'; layer.className = 'float-layer';
        var pg = document.getElementById('page-play');
        (pg || document.body).appendChild(layer);
      }
      var d = document.createElement('div');
      d.className = 'float-say' + (kind === 'sticker' ? ' big' : '');
      d.innerHTML = '<span class="fn">' + esc(nick) + '</span>' +
        '<span class="ft">' + (kind === 'sticker' ? text : esc(text)) + '</span>';
      layer.appendChild(d);
      // 快捷语带语音：文字飘出来的同时把话说出来
      if (voiceUrl) { try { Sfx.speak(voiceUrl); } catch (e) { } }
      var t1 = setTimeout(function () { d.classList.add('out'); }, 3200);
      var t2 = setTimeout(function () { d.remove(); }, 3900);
      floatTimer.push(t1, t2);
      while (layer.children.length > 4) layer.removeChild(layer.firstChild);
    } catch (e) { }
  }

  /* ---------- 快捷语按钮：点一下列出常用语，发出去带语音 ---------- */
  function toggleQuickPanel() {
    var old = document.getElementById('quick-panel');
    if (old) { old.remove(); return; }
    var p = document.createElement('div');
    p.id = 'quick-panel'; p.className = 'quick-panel';
    p.innerHTML = QUICK.map(function (t, i) {
      return '<button class="qk" data-i="' + i + '">' + esc(t) + '</button>';
    }).join('');
    document.getElementById('page-play').appendChild(p);
    /* 防重入：一次点击只发一条。
       以前 touch/click 双通道 + 面板未及时移除，会被触发两次，对方收到两条。 */
    p.querySelectorAll('.qk').forEach(function (b) {
      var sent = false;
      var fire = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (sent) return; sent = true;
        var txt = QUICK[+b.dataset.i] || '';
        tcSend({ kind: 'text', text: txt, quick: true, voice: txt });
        try { Sfx.send(); } catch (x) { }
        /* 快捷语要念出来：语音开关没开时给个提示，避免「以为坏了」 */
        try {
          if (App.settings().voice) Sfx.speak(txt);
          else App.toast('出牌语音播报已关闭，可在「我的」里打开');
        } catch (x) { }
        floatSay('我', txt, 'quick');
        if (p.parentNode) p.remove();
      };
      b.onclick = fire;
    });
    setTimeout(function () { if (p.parentNode) p.remove(); }, 8000);
  }

  /* 快捷表情：与快捷语分开的独立入口，点一下直接发出去 */
  var QSTICK = ['😂', '👍', '👏', '😎', '😍', '😡', '😭', '🎉', '🙏', '🤔', '💪', '❤️',
    '🤣', '😊', '🥰', '😘', '😜', '🤪', '😏', '😢', '😱', '🤗', '👌', '✌️',
    '🔥', '💯', '🌹', '🍺', '⚡', '👀', '🤝', '😴'];
  /* 快捷表情面板：Emoji + 已导入的表情包（默认包排在最前）。
     动图按动图渲染预览，预览尺寸刻意做小（34px），避免占满牌桌。 */
  function stickPacks() {
    try {
      if (!window.Stickers || !Stickers.packs) return [];
      var ps = Stickers.packs.slice();
      var def = Stickers.defaultId || '';
      ps.sort(function (a, b) {
        if (a.id === def) return -1;
        if (b.id === def) return 1;
        return 0;
      });
      return ps;
    } catch (e) { return []; }
  }
  function toggleStickPanel() {
    var old = document.getElementById('stick-panel');
    if (old) { old.remove(); return; }
    var packs = stickPacks();
    var p = document.createElement('div');
    p.id = 'stick-panel'; p.className = 'quick-panel stick';
    var tabs = '<div class="sp-tabs">' +
      '<span class="sp-tab" data-p="">Emoji</span>' +
      packs.map(function (pk) {
        return '<span class="sp-tab" data-p="' + esc(pk.id) + '">' + esc((pk.name || '表情').slice(0, 6)) + '</span>';
      }).join('') + '</div>';
    var grid = document.createElement('div');
    grid.className = 'sp-grid';
    p.innerHTML = tabs;
    p.appendChild(grid);
    function show(pid) {
      p.querySelectorAll('.sp-tab').forEach(function (t) {
        t.classList.toggle('on', (t.dataset.p || '') === (pid || ''));
      });
      if (!pid) {
        grid.innerHTML = QSTICK.map(function (e, i) {
          return '<button class="sp-e" data-i="' + i + '">' + e + '</button>';
        }).join('');
        grid.querySelectorAll('.sp-e').forEach(function (b) {
          b.onclick = function () { sendOne(QSTICK[+b.dataset.i] || '🙂'); };
        });
        return;
      }
      var pk = null;
      packs.forEach(function (x) { if (x.id === pid) pk = x; });
      var items = (pk && pk.items) || [];
      grid.innerHTML = items.map(function (it, i) {
        return '<button class="sp-i" data-i="' + i + '" title="' + esc(it.name || '') + '">' +
          (window.Stickers && Stickers.cellImg
             ? Stickers.cellImg(Stickers.imgUrl(it.url), Stickers.capOf(it, i))
             : '<img src="' + esc(it.url) + '" alt="">') + '</button>';
      }).join('') || '<div style="font-size:11px;color:var(--sub);padding:8px">这个包还是空的</div>';
      grid.querySelectorAll('.sp-i').forEach(function (b) {
        b.onclick = function () { var it = items[+b.dataset.i]; if (it) sendSticker(it); };
      });
    }
    function sendOne(em) {
      tcSend({ kind: 'text', text: em, quick: true });
      Sfx.send(); floatSay('我', em, 'sticker'); p.remove();
    }
    function sendSticker(it) {
      tcSend({ kind: 'sticker', url: it.url, name: it.name || '', anim: !!it.anim, quick: true });
      Sfx.send();
      floatSay('我', '<img src="' + esc(it.url) + '" class="fl-img">', 'sticker');
      p.remove();
    }
    p.querySelectorAll('.sp-tab').forEach(function (t) {
      t.onclick = function () { show(t.dataset.p || ''); };
    });
    document.getElementById('page-play').appendChild(p);
    /* 默认打开「默认表情包」页：服务器上传一次，所有人的打牌面板直接就能点。
       没有包时才回落到 Emoji。 */
    show(packs.length ? packs[0].id : '');
    setTimeout(function () { if (p.parentNode) p.remove(); }, 8000);
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

  /* ---------------- v48：一局结束后的「剩牌展示」 ----------------
     先把各家最后剩的牌按打牌时的方位摆出来（左 / 右 / 我中下），
     昵称和身份徽标紧挨着牌；玩家手动点「查看结算」才出原来的结算框。
     服务端没更新（没有 allHands）时自动降级：直接弹结算框，不会卡住。 */
  function pickRest(m) {
    var src = null;
    if (m && m.allHands && m.allHands.length) src = m;
    else if (S && S.allHands && S.allHands.length) src = S;
    else if (lastRest && lastRest.hands && lastRest.hands.length) src = lastRest;
    if (!src) return null;
    return {
      hands: src.hands || src.allHands,
      seats: src.seats || (S && S.seats) || [],
      landlord: (src.landlord != null) ? src.landlord : (S ? S.landlord : -1),
      n: src.n || (S && S.n) || 2
    };
  }
  function restRole(i, lord) {
    if (lord == null || lord < 0) return '';
    return i === lord
      ? '<span class="rl lord">👑 地主</span>'
      : '<span class="rl farmer">🌾 农民</span>';
  }
  /* 牌逐张摊开、点数朝左上方露出；张数多时按 --rov 叠一点，仍可左右滑动看全 */
  function restRow(cards) {
    if (!cards || !cards.length) return '<div class="rv-empty">已出完 🎉</div>';
    var n = cards.length;
    var ovr = n <= 6 ? 0 : n <= 10 ? 0.28 : n <= 14 ? 0.40 : n <= 18 ? 0.50 : 0.58;
    return '<div class="rv-cards" style="--rov:' + ovr + '">' +
      cards.map(function (c) { return cardHTML(c, 'mini'); }).join('') + '</div>';
  }
  function restBlock(rest, i, side, mine) {
    var u = (rest.seats || [])[i] || {};
    var cards = rest.hands[i] || [];
    return '<div class="rv-block ' + side + (mine ? ' mine' : '') + '">' +
      '<div class="rv-head"><b>' + esc(shortName(u, '玩家')) + (mine ? '<i>（我）</i>' : '') + '</b>' +
      restRole(i, rest.landlord) + '<span class="rv-cnt">剩 ' + cards.length + ' 张</span></div>' +
      restRow(cards) + '</div>';
  }
  function showRest(rest, done) {
    var old = document.getElementById('rest-view'); if (old) old.remove();
    var me = mySeat, n = rest.n || 2, opps = [];
    /* 与打牌时完全一致：三人局 (me+2) 在左、(me+1) 在右；两人局对手在左 */
    if (n === 3) opps = [{ i: (me + 2) % 3 }, { i: (me + 1) % 3 }];
    else opps = [{ i: me === 0 ? 1 : 0 }];
    var left = opps[0] ? restBlock(rest, opps[0].i, 'left', false) : '';
    var right = opps[1] ? restBlock(rest, opps[1].i, 'right', false)
      : '<div class="rv-block right rv-ghost">双人局 · 仅一位对手</div>';
    var box = document.createElement('div');
    box.className = 'rest-view'; box.id = 'rest-view';
    box.innerHTML =
      '<div class="rv-top"><div class="rv-title">本局剩余手牌</div>' +
      '<div class="rv-sub">昵称与身份就在牌旁边 · 剩余牌逐张摊开</div></div>' +
      '<div class="rv-mid">' + left + right + '</div>' +
      '<div class="rv-bot">' + restBlock(rest, me, 'mine', true) + '</div>' +
      '<div class="rv-foot"><button class="btn jade" id="rv-close">查看结算 →</button></div>';
    document.body.appendChild(box);
    var fired = false;
    function close() {
      if (fired) return; fired = true;
      box.remove();
      try { done && done(); } catch (e) { }
    }
    box.querySelector('#rv-close').onclick = close;
    return close;
  }

  /* ---------------- 结算 ---------------- */
  function showResult(m) {
    clearInterval(timer);
    var me = mySeat, r = m.result || {};
    var iWin;
    if (r.winnerSide) iWin = (r.winnerSide === 'landlord') ? (r.landlord === me) : (r.landlord !== me);
    else iWin = r.winner === me;
    Sfx[iWin ? 'win' : 'lose']();
    /* v48：先展示剩牌，关掉才弹结算 */
    var rest = pickRest(m);
    if (rest) { showRest(rest, function () { showResultBox(m, me, r, iWin); }); return; }
    showResultBox(m, me, r, iWin);
  }
  function showResultBox(m, me, r, iWin) {
    var txt = [];
    txt.push('你的身份：' + (r.landlord === me ? '地主' : '农民'));
    if ((m.n || 2) === 3) txt.push((r.winnerSide === 'landlord' ? '地主' : '农民') + '方获胜');
    if (r.letCount) txt.push('让牌 ' + r.letCount + ' 张');
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
    onTableChat: onTableChat, closeTableChat: closeTableChat, onSpeaking: onSpeaking, startNow: startNow,
    relayout: function () { try { setScale(); if (S) { fitHand(S.hand.length); render(); } layoutRail(); } catch (e) { } },
    get state() { return S; }, get seat() { return mySeat; }, get gid() { return gid; }, get room() { return myRoom; },
    __set: function (st) { S = st; mySeat = st.mySeat | 0; try { render(); renderHand(); } catch (e) { } },
    __showRest: function (rest, cb) { return showRest(rest, cb); },
    __showResult: function (m) { return showResult(m); },
    __quick: function () { return QUICK; }, __stick: function () { return QSTICK; },
    __layoutRail: function () { layoutRail(); }, __railRect: function () { var r = document.getElementById('table-rail'); return r ? { top: Math.round(r.getBoundingClientRect().top), h: r.offsetHeight, cls: r.className, inline: r.style.top } : null; }
  };
})();
