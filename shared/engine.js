/* ============================================================
 *  斗地主核心规则引擎（服务端 / 前端共用同一份）
 *  支持三种玩法：
 *    let46     二人 46 张（去掉 3、4），抢地主让牌机制
 *    duo37     二人 37 张（54 张随机去掉 17 张），叫分抢地主，先出完者胜
 *    trio54    三人 54 张，叫分抢地主，农民一方出完即胜
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDZ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUITS = ['S', 'H', 'C', 'D'];
  var SUIT_CHAR = { S: '♠', H: '♥', C: '♣', D: '♦', J: '' };
  var RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  var RANK_VAL = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15, 'w': 16, 'W': 17 };

  function makeDeck(rule, rnd) {
    rnd = rnd || Math.random;
    var cards = [], id = 0;
    RANKS.forEach(function (r) {
      if (rule === 'let46' && (r === '3' || r === '4')) return;
      SUITS.forEach(function (s) {
        cards.push({ id: 'c' + (id++), r: r, s: s, v: RANK_VAL[r], red: (s === 'H' || s === 'D') });
      });
    });
    cards.push({ id: 'c' + (id++), r: 'w', s: 'J', v: 16, red: false, joker: 'small' });
    cards.push({ id: 'c' + (id++), r: 'W', s: 'J', v: 17, red: true, joker: 'big' });
    // 双人经典玩法：54 张随机去掉 17 张 → 37 张（17+17+3 底牌）
    // 这里保留完整 54 张，由 newGame 发牌后把剩下的 17 张归入 dead（结算时公开为「封印废牌」）
    return cards;
  }
  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function sortCards(cards) {
    return cards.slice().sort(function (a, b) { return b.v - a.v || a.s.localeCompare(b.s); });
  }
  function byId(hand, ids) {
    var m = {}; hand.forEach(function (c) { m[c.id] = c; });
    return ids.map(function (i) { return m[i]; }).filter(Boolean);
  }
  function counts(cards) {
    var m = {};
    cards.forEach(function (c) { m[c.v] = (m[c.v] || 0) + 1; });
    return m;
  }

  /* ---------------- 牌型识别 ---------------- */
  function parse(cards) {
    if (!cards || !cards.length) return null;
    var n = cards.length, cnt = counts(cards), i, j;
    var vals = Object.keys(cnt).map(Number).sort(function (a, b) { return a - b; });

    if (n === 2 && cnt[16] === 1 && cnt[17] === 1) return { type: 'rocket', main: 100, len: 2, name: '王炸' };
    if (n === 4 && vals.length === 1) return { type: 'bomb', main: vals[0], len: 4, name: '炸弹' };
    if (vals.length === 1) {
      if (n === 1) return { type: 'single', main: vals[0], len: 1, name: '单张' };
      if (n === 2 && vals[0] < 16) return { type: 'pair', main: vals[0], len: 2, name: '对子' };
      if (n === 3) return { type: 'triple', main: vals[0], len: 3, name: '三张' };
    }
    if (n === 4 && vals.length === 2) {
      for (i = 0; i < 2; i++) if (cnt[vals[i]] === 3) return { type: 'triple1', main: vals[i], len: 4, name: '三带一' };
    }
    if (n === 5 && vals.length === 2) {
      for (i = 0; i < 2; i++) if (cnt[vals[i]] === 3) return { type: 'triple2', main: vals[i], len: 5, name: '三带一对' };
    }
    if (n >= 5 && vals.length === n && isRun(vals) && vals[vals.length - 1] <= 14)
      return { type: 'straight', main: vals[vals.length - 1], len: n, name: '顺子' };
    if (n >= 6 && n % 2 === 0 && vals.length === n / 2 && allEq(cnt, vals, 2) && isRun(vals) && vals[vals.length - 1] <= 14)
      return { type: 'dstraight', main: vals[vals.length - 1], len: n, name: '连对' };
    if (n >= 6 && n % 3 === 0 && vals.length === n / 3 && allEq(cnt, vals, 3) && isRun(vals) && vals[vals.length - 1] <= 14)
      return { type: 'plane', main: vals[vals.length - 1], len: n, name: '飞机' };

    var triples = vals.filter(function (v) { return cnt[v] >= 3 && v <= 14; });
    var quads = vals.filter(function (v) { return cnt[v] === 4; });
    if (quads.length === 1) {
      var q = quads[0], rest = n - 4;
      if (rest === 2) return { type: 'four2', main: q, len: 6, name: '四带二' };
      if (rest === 4) {
        var others = vals.filter(function (v) { return v !== q; });
        if (others.length === 2 && others.every(function (v) { return cnt[v] === 2; }))
          return { type: 'four2p', main: q, len: 8, name: '四带两对' };
      }
    }
    if (triples.length >= 2) {
      var best = null;
      for (i = 0; i < triples.length; i++) {
        var run = [triples[i]];
        for (j = i + 1; j < triples.length; j++) {
          if (triples[j] === run[run.length - 1] + 1) run.push(triples[j]); else break;
        }
        if (!best || run.length > best.length) best = run;
      }
      if (best && best.length >= 2) {
        var k = best.length, wing = n - 3 * k, okS = true, okP = true;
        if (wing === k) {
          vals.forEach(function (v) { if (best.indexOf(v) < 0 && cnt[v] > 2) okS = false; });
          if (okS) return { type: 'plane1', main: best[k - 1], len: n, name: '飞机带单' };
        }
        if (wing === 2 * k) {
          vals.forEach(function (v) {
            if (best.indexOf(v) < 0) { if (cnt[v] !== 2) okP = false; }
            else { if (cnt[v] - 3 !== 0) okP = false; }
          });
          if (okP) return { type: 'plane2', main: best[k - 1], len: n, name: '飞机带对' };
        }
      }
    }
    return null;
  }
  /* ---------------- 牌型播报文案（用于出牌语音提示） ---------------- */
  var RANK_NAME = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王' };
  function rankName(v) { return RANK_NAME[v] || String(v); }
  /* 返回适合朗读的中文短语，如「一张 5」「对 K」「三带一」「5 到 10 的顺子」 */
  function speak(info, cards) {
    if (!info) return '过';
    var n = info.name, t = info.type, m = info.main;
    if (t === 'rocket') return '王炸';
    if (t === 'bomb') return '炸弹';
    if (t === 'single') return (m >= 16 ? '' : '一张 ') + rankName(m);
    if (t === 'pair') return '对' + rankName(m);
    if (t === 'triple') return '三张' + rankName(m);
    if (t === 'triple1') return '三带一';
    if (t === 'triple2') return '三带一对';
    if (t === 'four2') return '四带二';
    if (t === 'four2p') return '四带两对';
    if (t === 'straight') {
      var lo = m - info.len + 1;
      return rankName(lo) + '到' + rankName(m) + '的顺子';
    }
    if (t === 'dstraight') {
      var lo2 = m - info.len / 2 + 1;
      return rankName(lo2) + '到' + rankName(m) + '的连对';
    }
    if (t === 'plane') return '飞机';
    if (t === 'plane1') return '飞机带单';
    if (t === 'plane2') return '飞机带对';
    return n || '';
  }

  function isRun(v) { for (var i = 1; i < v.length; i++) if (v[i] !== v[i - 1] + 1) return false; return true; }
  function allEq(cnt, vals, num) { return vals.every(function (v) { return cnt[v] === num; }); }

  function beats(cur, prev) {
    if (!cur) return false;
    if (!prev) return true;
    if (cur.type === 'rocket') return true;
    if (prev.type === 'rocket') return false;
    if (cur.type === 'bomb' && prev.type !== 'bomb') return true;
    if (prev.type === 'bomb' && cur.type !== 'bomb') return false;
    if (cur.type === 'bomb' && prev.type === 'bomb') return cur.main > prev.main;
    return cur.type === prev.type && cur.len === prev.len && cur.main > prev.main;
  }

  /* ---------------- 枚举可出的牌 ---------------- */
  function allMoves(hand) {
    var res = [], i, len, j;
    var cnt = counts(hand);
    var vals = Object.keys(cnt).map(Number).sort(function (a, b) { return a - b; });
    function pick(v, n) {
      var out = [], got = 0;
      for (var x = 0; x < hand.length && got < n; x++) if (hand[x].v === v) { out.push(hand[x].id); got++; }
      return got === n ? out : null;
    }
    function rest(ex, num) {
      var pool = hand.filter(function (c) { return ex.indexOf(c.v) < 0; });
      var c2 = counts(pool);
      var safe = pool.filter(function (c) { return c2[c.v] < 4; });
      var use = safe.length >= num ? safe : pool;
      use = use.sort(function (a, b) { return a.v - b.v || (cnt[a.v] - cnt[b.v]); });
      return use.slice(0, num).map(function (c) { return c.id; });
    }
    vals.forEach(function (v) {
      if (cnt[v] >= 1) res.push(pick(v, 1));
      if (cnt[v] >= 2 && v < 16) res.push(pick(v, 2));
      if (cnt[v] >= 3) res.push(pick(v, 3));
      if (cnt[v] === 4) res.push(pick(v, 4));
      if (cnt[v] >= 3 && v <= 14) {
        var t = pick(v, 3), w1 = rest([v], 1), w2 = null;
        var pv = vals.filter(function (x) { return x !== v && cnt[x] >= 2 && x < 16; })[0];
        if (pv) w2 = pick(pv, 2);
        if (w1 && w1.length === 1) res.push(t.concat(w1));
        if (w2) res.push(t.concat(w2));
      }
    });
    if (cnt[16] && cnt[17]) res.push([pick(16, 1)[0], pick(17, 1)[0]]);
    var uniq = vals.filter(function (v) { return v <= 14; });
    for (i = 0; i < uniq.length; i++) {
      for (len = 5; len <= 12; len++) {
        var seg = [];
        for (j = 0; j < len; j++) { if (uniq.indexOf(uniq[i] + j) < 0) break; seg.push(uniq[i] + j); }
        if (seg.length === len && uniq[i] + len - 1 <= 14) {
          res.push(seg.map(function (v) { return pick(v, 1)[0]; }));
          if (seg.every(function (v) { return cnt[v] >= 2; })) res.push(seg.reduce(function (a, v) { return a.concat(pick(v, 2)); }, []));
          if (seg.every(function (v) { return cnt[v] >= 3; })) res.push(seg.reduce(function (a, v) { return a.concat(pick(v, 3)); }, []));
        }
      }
    }
    return res.filter(function (m) { return m && m.length && parse(byId(hand, m)); });
  }
  /* 候选打分：越小越优先（兼顾「不拆牌 / 不大材小用 / 能顺出去」） */
  function moveCost(hand, m, info, prev) {
    var cnt = counts(hand);
    var use = {};
    m.forEach(function (id) {
      for (var i = 0; i < hand.length; i++) if (hand[i].id === id) { use[hand[i].v] = (use[hand[i].v] || 0) + 1; break; }
    });
    var s = 0;
    // 拆牌惩罚
    Object.keys(use).forEach(function (v) {
      var have = cnt[v], take = use[v];
      if (have === 2 && take === 1) s += 14;
      if (have === 3 && take < 3) s += 20;
      if (have === 4 && take < 4) s += 70;          // 绝不轻易拆炸弹
      if (have >= 3 && take === 1 && have - take >= 2) s += 6;
    });
    var t = info.type, main = info.main;
    if (t === 'bomb') s += 260;                      // 炸弹压到最后
    if (t === 'rocket') s += 400;
    if (main >= 16) s += 46;                         // 小王
    if (main === 17) s += 26;                        // 大王
    if (main === 15) s += 18;                        // 2
    if (main === 14) s += 8;                         // A
    s += main * 1.6;                                 // 先出小牌
    if (t === 'straight' || t === 'dstraight' || t === 'plane' || t === 'plane1' || t === 'plane2') s -= m.length * 4.5;
    if (t === 'triple1' || t === 'triple2' || t === 'four2' || t === 'four2p') s -= 3;
    // 跟牌时：刚好压过最好，差距越大越亏
    if (prev && prev.type === t) s += Math.max(0, (main - prev.main)) * 3.2;
    return s;
  }

  /* 返回按「推荐程度」排序的候选列表（最好的在最前） */
  function hintOptions(hand, prev) {
    var ok = [];
    allMoves(hand).forEach(function (m) {
      var p = parse(byId(hand, m));
      if (!p || !beats(p, prev)) return;
      ok.push({ ids: m, info: p, cost: moveCost(hand, m, p, prev) });
    });
    if (!ok.length) return [];
    ok.sort(function (a, b) {
      if (a.cost !== b.cost) return a.cost - b.cost;
      if (a.info.main !== b.info.main) return a.info.main - b.info.main;
      return a.ids.length - b.ids.length;
    });
    return ok;
  }

  /* 智能提示
   * ctx = { cycle: 第几次按提示（用于轮换候选）, urgent: 对手快赢了（可动用炸弹） }
   */
  function hint(hand, prev, ctx) {
    ctx = ctx || {};
    var ok = hintOptions(hand, prev);
    if (!ok.length) return null;
    // 不紧急时，把炸弹/王炸挪到最后，避免一按提示就甩炸
    if (!ctx.urgent) {
      var noBoom = ok.filter(function (x) { return x.info.type !== 'bomb' && x.info.type !== 'rocket'; });
      if (noBoom.length) ok = noBoom.concat(ok.filter(function (x) { return x.info.type === 'bomb' || x.info.type === 'rocket'; }));
    }
    var i = Math.max(0, Math.min(ok.length - 1, ctx.cycle || 0));
    return ok[i];
  }
  function hasMove(hand, prev) { return !!hint(hand, prev); }

  /* ---------------- 对局状态 ---------------- */
  function seatCount(rule) { return rule === 'trio54' ? 3 : 2; }

  function newGame(rule, rnd) {
    rnd = rnd || Math.random;
    var n = seatCount(rule);
    var deck = shuffle(makeDeck(rule), rnd);
    var hands = [], i;
    for (i = 0; i < n; i++) hands.push(sortCards(deck.slice(i * 17, i * 17 + 17)));
    var bottom = deck.slice(n * 17, n * 17 + 3);
    var dead = deck.slice(n * 17 + 3);
    var openSeat = Math.floor(rnd() * n);
    var openCard = hands[openSeat][Math.floor(rnd() * hands[openSeat].length)];
    var g = {
      rule: rule, seats: n, hands: hands, bottom: bottom, dead: dead, deadCount: dead.length,
      openCard: openCard, firstBidder: openSeat,
      phase: 'bid', bid: null, landlord: -1, bidTurn: openSeat, bidSeq: [],
      doubleSeats: [], doubleIdx: 0, doubled: [],
      grabCount: 0, letCount: rule === 'let46' ? 1 : 0, multiplier: 1,
      turn: -1, last: null, lastSeat: [], passFlag: 0, bidPasses: 0,
      playedCount: [], bombCount: 0, spring: false, antiSpring: false,
      winner: -1, winnerSide: null, result: null, bots: []
    };
    for (i = 0; i < n; i++) { g.playedCount.push(0); g.lastSeat.push(null); }
    return g;
  }

  /* ---------------- 叫地主 / 抢地主 ---------------- */
  function applyBid(g, seat, act) {
    if (g.phase !== 'bid') return { err: '当前不是叫地主阶段' };
    var n = g.seats;
    if (g.rule === 'trio54' || g.rule === 'duo37') {
      // 叫分制：每人一次机会，从明牌者开始轮流；叫 3 分立即定地主
      var bidCount = g.bidSeq.filter(function (b) { return b.act === 'bid'; }).length;
      if (act.type === 'bid') {
        if (!g.bid || act.score > g.bid.score) g.bid = { score: act.score, by: seat };
        g.bidSeq.push({ seat: seat, act: 'bid', score: act.score });
        if (act.score >= 3) {
          /* 叫满 3 分直接定地主，叫分就提前结束了。
             规则：此时「还没轮到叫分」的人有权选择是否加倍（他们没机会表达过意见）；
             「已经叫过分」的人没有这个权力。
             所以 eligible = 从头到尾没在 bidSeq 里出现过的座位。 */
          var acted = {};
          g.bidSeq.forEach(function (b) { acted[b.seat] = 1; });
          g.doubleSeats = [];
          for (var di = 0; di < n; di++) if (!acted[di]) g.doubleSeats.push(di);
          var fr = finishBid(g);
          if (fr.err) return fr;
          if (g.doubleSeats.length) {
            g.phase = 'double'; g.doubleIdx = 0; g.doubled = [];
            return { ok: true, needDouble: true };
          }
          return fr;
        }
      } else {
        g.bidSeq.push({ seat: seat, act: 'pass' });
      }
      if (g.bidSeq.length >= n) {
        if (g.bid) return finishBid(g);
        return { redeal: true };
      }
      g.bidTurn = (seat + 1) % n;
      return { ok: true };
    }
    // let46 让牌玩法
    if (g.landlord < 0) {
      if (act.type === 'bid') {
        g.landlord = seat; g.letCount = 1; g.grabCount = 0;
        g.bidTurn = 1 - seat;
        g.bidSeq.push({ seat: seat, act: 'bid' });
        return { ok: true, needGrab: 1 - seat };
      }
      g.bidSeq.push({ seat: seat, act: 'pass' });
      if (g.bidSeq.length >= 2) return { redeal: true };
      g.bidTurn = 1 - seat;
      return { ok: true };
    }
    if (act.type === 'grab') {
      if (seat === g.landlord) return { err: '不能抢自己的地主' };
      if (g.grabCount >= 4) return { err: '已达最大抢地主次数' };
      g.landlord = seat; g.grabCount++;
      g.letCount = 1 + g.grabCount;
      g.multiplier = [1, 1, 2, 3, 4, 5][g.grabCount] || g.grabCount;
      g.bidTurn = 1 - seat;
      g.bidSeq.push({ seat: seat, act: 'grab' });
      return { ok: true, needGrab: 1 - seat };
    }
    g.bidSeq.push({ seat: seat, act: 'pass' });
    return finishBid(g);
  }

  /* ---------------- 加倍 ----------------
   * 触发条件：有人叫 3 分直接当上地主，叫分提前结束。
   * 只有「没轮到叫分」的人能选加倍；加倍则总倍数 ×2。 */
  function applyDouble(g, seat, yes) {
    if (g.phase !== 'double') return { err: '当前不是加倍阶段' };
    var q = g.doubleSeats || [];
    if (!q.length) { g.phase = 'play'; return { ok: true, started: true }; }
    if (q[g.doubleIdx] !== seat) return { err: '还没轮到你加倍' };
    if (yes) { g.multiplier = (g.multiplier || 1) * 2; (g.doubled = g.doubled || []).push(seat); }
    g.doubleIdx++;
    if (g.doubleIdx >= q.length) { g.phase = 'play'; return { ok: true, started: true }; }
    return { ok: true };
  }
  /* 加倍阶段当前该谁决定 */
  function doubleTurn(g) {
    if (g.phase !== 'double') return -1;
    var q = g.doubleSeats || [];
    return (g.doubleIdx < q.length) ? q[g.doubleIdx] : -1;
  }

  function finishBid(g) {
    if (g.rule === 'let46') {
      if (g.landlord < 0) return { redeal: true };
    } else {
      if (!g.bid) return { redeal: true };
      g.landlord = g.bid.by;
      g.multiplier = g.bid.score || 1;
      g.letCount = 0;
    }
    g.hands[g.landlord] = sortCards(g.hands[g.landlord].concat(g.bottom));
    g.phase = 'play';
    g.turn = g.landlord;
    g.last = null;
    return { ok: true, started: true };
  }

  /* ---------------- 出牌 ---------------- */
  function applyPlay(g, seat, ids) {
    if (g.phase !== 'play') return { err: '当前不是出牌阶段' };
    if (seat !== g.turn) return { err: '还没轮到你' };
    var hand = g.hands[seat];
    var cards = byId(hand, ids);
    if (cards.length !== ids.length) return { err: '手牌中没有这些牌' };
    var info = null;
    if (ids.length > 0) {
      info = parse(cards);
      if (!info) return { err: '牌型不合法' };
      var need = (g.last && g.last.by !== seat) ? g.last.info : null;
      if (!beats(info, need)) return { err: '打不过上家' };
    } else if (!g.last) {
      return { err: '你是先手，必须出牌' };
    }
    if (ids.length > 0) {
      var set = {}; ids.forEach(function (i) { set[i] = 1; });
      g.hands[seat] = hand.filter(function (c) { return !set[c.id]; });
      g.playedCount[seat]++;
      if (info.type === 'bomb' || info.type === 'rocket') g.bombCount++;
      g.last = { ids: ids, info: info, by: seat, cards: cards };
      g.lastSeat[seat] = { ids: ids, info: info, by: seat, cards: cards };
      g.passFlag = 0;
    } else {
      g.passFlag++;
      /* 记录这一家「过」：牌桌上要在他出牌的位置写上「过」，
         否则别人只知道他没出牌，看不出是主动过还是还没轮到。 */
      g.lastSeat[seat] = { by: seat, pass: true };
      if (g.passFlag >= g.seats - 1) { g.last = null; g.lastSeat = g.lastSeat.map(function () { return null; }); g.passFlag = 0; }
    }
    // 胜负
    var i, farmerDone = false;
    for (i = 0; i < g.seats; i++) {
      if (i === g.landlord) continue;
      if (g.hands[i].length === 0) farmerDone = true;
    }
    if (g.rule === 'let46') {
      var farmer = 1 - g.landlord;
      if (g.hands[g.landlord].length === 0) g.winner = g.landlord;
      else if (g.hands[farmer].length <= g.letCount) g.winner = farmer;
    } else {
      if (g.hands[g.landlord].length === 0) g.winner = g.landlord;
      else if (farmerDone) {
        // 农民方胜：取第一个出完的农民座位作为代表
        for (i = 0; i < g.seats; i++) if (i !== g.landlord && g.hands[i].length === 0) { g.winner = i; break; }
      }
    }
    if (g.winner >= 0) {
      g.phase = 'over';
      var isLandlordWin = g.winner === g.landlord;
      if (g.seats === 2) {
        if (isLandlordWin && g.playedCount[1 - g.landlord] === 0) { g.spring = true; g.multiplier *= 2; }
        if (!isLandlordWin && g.playedCount[g.landlord] <= 1) { g.antiSpring = true; g.multiplier *= 2; }
      } else {
        var farmerPlayed = 0;
        for (i = 0; i < g.seats; i++) if (i !== g.landlord) farmerPlayed += g.playedCount[i];
        if (isLandlordWin && farmerPlayed === 0) { g.spring = true; g.multiplier *= 2; }
        if (!isLandlordWin && g.playedCount[g.landlord] <= 1) { g.antiSpring = true; g.multiplier *= 2; }
      }
      g.multiplier *= Math.pow(2, g.bombCount);
      g.result = {
        winner: g.winner, landlord: g.landlord, winnerSide: isLandlordWin ? 'landlord' : 'farmer',
        spring: g.spring, antiSpring: g.antiSpring, bombCount: g.bombCount,
        multiplier: g.multiplier, letCount: g.letCount
      };
      return { ok: true, over: true, result: g.result };
    }
    g.turn = (seat + 1) % g.seats;
    return { ok: true };
  }

  function farmerTarget(g) {
    if (g.rule !== 'let46' || g.landlord < 0) return 0;
    return Math.max(0, g.hands[1 - g.landlord].length - g.letCount);
  }

  return {
    SUITS: SUITS, SUIT_CHAR: SUIT_CHAR, RANKS: RANKS, RANK_VAL: RANK_VAL,
    makeDeck: makeDeck, shuffle: shuffle, sortCards: sortCards, byId: byId,
    parse: parse, beats: beats, allMoves: allMoves, hint: hint, hintOptions: hintOptions,
    moveCost: moveCost, speak: speak, rankName: rankName, hasMove: hasMove,
    newGame: newGame, applyBid: applyBid, applyPlay: applyPlay, finishBid: finishBid,
    applyDouble: applyDouble, doubleTurn: doubleTurn,
    farmerTarget: farmerTarget, seatCount: seatCount
  };
});
