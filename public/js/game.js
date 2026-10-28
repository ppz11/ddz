/* ===================== 牌桌界面与交互（支持双人 / 三人 / 在线玩家补位） ===================== */
window.Game = (function () {
  var S = null, sel = {}, gid = null, rule = 'let46', dealAnim = false, mySeat = 0;
  var timer = null, left = 0, over = false, myRoom = null;
  var hintCycle = 0, lastHintKey = '';
  var tcMsgs = [], tcOpen = false, tcRec = null, tcChunks = [], tcStream = null, tcStart = 0, tcCancel = false;

  var SUIT = { S: '♠', H: '♥', C: '♣', D: '♦' };

  /* 大王小王：精致版（皇冠 + 五角星 + 描边大字） */
  function jokerInner(c, small) {
    var big = c.joker === 'big';
    if (small) {
      return '<div class="ctr"><div class="jk' + (big ? ' b' : '') + '">' + (big ? '大' : '小') + '</div></div>';
    }
    return '<div class="ctr jk-full' + (big ? ' b' : '') + '">' +
      '<div class="jk-crown">' + (big ? '♛' : '♕') + '</div>' +
      '<div class="jk-char">' + (big ? '大' : '小') + '<span>王</span></div>' +
      '<div class="jk-star">★</div>' +
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
  function rowHTML(cards, cls) {
    if (!cards || !cards.length) return '';
    var sz = cards.length > 12 ? 'tiny' : (cards.length > 7 ? 'mini' : (cls || 'mini'));
    return '<div class="prow">' + cards.map(function (c) { return cardHTML(c, sz); }).join('') + '</div>';
  }
  function fitHand(n) {
    var wrap = document.querySelector('.handwrap');
    var avail = (wrap ? wrap.clientWidth : 640) - 8;
    var w = Math.max(30, Math.min(74, (avail - 4) / (0.38 * n + 0.62)));
    var h = document.getElementById('hand');
    if (h) {
      h.style.setProperty('--card-w', Math.round(w) + 'px');
      h.style.setProperty('--card-h', Math.round(w * 1.42) + 'px');
      h.style.setProperty('--ov', '-' + Math.round(w * 0.62) + 'px');
    }
  }

  function init() {
    bindHand();
    var b = document.getElementById('btn-table-chat');
    if (b) b.onclick = toggleTableChat;
  }
  function reset() {
    sel = {}; over = false; dealAnim = true; S = null; myRoom = null; gid = null;
    hintCycle = 0; lastHintKey = ''; tcMsgs = []; closeTableChat(true);
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
  function onGame(m) {
    var fresh = !S;
    S = m; mySeat = m.seat; gid = m.gid; rule = m.rule;
    document.getElementById('mid-notice').classList.add('hidden');
    render();
    showRuleTip(m);
    if (m.phase === 'over' && !over) { over = true; showResult(m); }
  }
  var lastResultMeta = { coinDelta: 0, coins: null };
  function onResult(m, meta) {
    if (meta) lastResultMeta = meta;
    if (!over) { over = true; showResult(S); }
  }

  /* 进入房间后顶部常驻本房间玩法提示 */
  function showRuleTip(m) {
    var el = document.getElementById('rule-tip'); if (!el) return;
    var r = (m && m.rule) || rule;
    var txt = r === 'trio54' ? '三人经典 · 54 张 · 叫分抢地主 · 农民一方出完即胜'
      : r === 'let46' ? '双人让牌 · 46 张 · 抢地主让牌 · 农民打剩到让牌数即胜'
        : '双人经典 · 37 张 · 叫分抢地主 · 先出完手牌者胜';
    el.textContent = '本局玩法：' + txt;
    el.classList.remove('hidden');
  }

  /* ---------------- 渲染 ---------------- */
  function roleTag(i) {
    if (!S || S.landlord < 0) return '';
    return i === S.landlord ? '<span class="rl">地主</span>' : '<span class="rl f">农民</span>';
  }
  function render() {
    if (!S) return;
    var me = mySeat, n = S.n || 2;
    var meU = S.seats[me];
    var ls = S.lastSeat || [];

    /* 某人打出的牌 —— 贴在 TA 的头像旁边 */
    function playedOf(i) {
      var x = ls[i];
      if (x) return '<div class="pmine"><div class="pcards">' + rowHTML(x.cards) + '</div></div>';
      if (n === 2 && S.last && S.last.by === i && i !== me) {
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
        '<div class="av">' + (u ? Avatar.svg(u.avatar, 34) : '') + '</div>' +
        '<div class="ts-i"><div class="nm">' + (u ? esc(u.nick) : '空位') + roleTag(i) + '</div>' +
        '<div class="cnt">' + needTxt + '</div></div>' +
        (act ? '<div class="clock"><b>' + left + '</b></div>' : '') +
        '</div>';
    }

    var elL = document.getElementById('seat-left');
    var elR = document.getElementById('seat-right');
    var elT = document.getElementById('seat-top');
    if (n === 3) {
      // 三人：另外两家左右分开，各自出的牌贴在自己头像下
      var lI = (me + 1) % 3, rI = (me + 2) % 3;
      elL.innerHTML = seatHTML(lI, '') + playedOf(lI);
      elR.innerHTML = seatHTML(rI, 'right') + playedOf(rI);
      elT.innerHTML = '';
    } else {
      // 两人：对手在正上方，出的牌贴在其头像下
      var oI = me === 0 ? 1 : 0;
      elT.innerHTML = seatHTML(oI, '') + playedOf(oI);
      elL.innerHTML = ''; elR.innerHTML = '';
    }

    document.getElementById('my-info').innerHTML =
      '<div class="av">' + Avatar.svg(meU && meU.avatar, 34) + '</div>' +
      '<div><div class="nm">' + esc(meU ? meU.nick : '我') + roleTag(me) + '</div>' +
      '<div class="cnt">剩 ' + S.counts[me] + ' 张</div></div><div class="sp"></div>' +
      '<div class="mult">×' + S.multiplier + (S.letCount ? ' · 让' + S.letCount : '') + '</div>';

    // 自己出的牌：贴在自己头像上方
    var myRow = '';
    if (n === 3) { if (ls[me]) myRow = rowHTML(ls[me].cards); }
    else if (S.last && S.last.by === me) myRow = rowHTML(S.last.cards);
    document.getElementById('my-played').innerHTML =
      '<div class="pcards center">' + (myRow || '<span class="pass">—</span>') + '</div>';

    var bb = document.getElementById('bottom-bar');
    bb.innerHTML = S.bottom && S.bottom.length
      ? '<span class="lbl">底牌</span><div class="bcards">' + S.bottom.map(function (c) { return cardHTML(c, 'tiny'); }).join('') + '</div>'
      : '<span class="lbl" style="opacity:.6">底牌未公开</span>';

    var mid = document.getElementById('played');
    mid.innerHTML = '';

    renderHand();
    renderActions();
    startTimer();
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
    // 出牌语音播报 + 牌型音效
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
    if (App.settings().voice) Sfx.speak('不要');
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
  function bid(act) { Sfx.click(); Net.send({ t: 'game:bid', act: act }); }
  function resign() { App.confirm('确定认输吗？', '认输将直接判负', function () { Net.send({ t: 'game:resign' }); }); }
  function leave() { Net.send({ t: 'room:leave' }); App.go('home'); toast('已离开房间'); }
  function addBot() { Net.send({ t: 'room:joinbot', gid: gid }); }
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
  function onTableChat(m) {
    tcMsgs.push(m.msg); if (tcMsgs.length > 200) tcMsgs.shift();
    var badge = document.getElementById('btn-table-chat');
    if (badge && !tcOpen) { badge.classList.add('new'); setTimeout(function () { badge.classList.remove('new'); }, 2600); }
    renderTcMsgs(); Sfx.msg();
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
    onTableChat: onTableChat, closeTableChat: closeTableChat,
    get state() { return S; }, get seat() { return mySeat; }, get gid() { return gid; }, get room() { return myRoom; }
  };
})();
