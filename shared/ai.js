/* ============================================================
 *  机器人 AI（服务端托管，前端完全感知不到是机器）
 *  支持 2 人 / 3 人，行为拟人：有思考延迟、偶尔犹豫、会犯错
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.AI = factory(root.DDZ);
})(typeof self !== 'undefined' ? self : this, function (DDZ) {
  'use strict';

  function rint(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return a[rint(a.length)]; }

  /* ---------- 难度档位 ----------
   * 1=新手 2=普通 3=熟练 4=高手 5=大师（默认 3）
   * 数值越高：失误越少、会算牌记牌、压制更果断、懂得拆牌与保留关键牌。
   * 难度由服务端统一保存，对所有人同时生效（同一局里机器人水平一致）。 */
  var LEVELS = {
    1: { name: '新手', mistake: 0.55, lookahead: 0, count: 0, greed: 0.30, split: 0.15, trap: 0.00 },
    2: { name: '普通', mistake: 0.34, lookahead: 1, count: 0, greed: 0.45, split: 0.30, trap: 0.05 },
    3: { name: '熟练', mistake: 0.18, lookahead: 2, count: 1, greed: 0.62, split: 0.50, trap: 0.15 },
    4: { name: '高手', mistake: 0.08, lookahead: 3, count: 1, greed: 0.78, split: 0.70, trap: 0.30 },
    5: { name: '大师', mistake: 0.02, lookahead: 4, count: 2, greed: 0.90, split: 0.85, trap: 0.45 }
  };
  var LV = null;
  function setLevel(n) {
    n = Math.max(1, Math.min(5, Math.round(Number(n) || 3)));
    LV = LEVELS[n]; LV.id = n;
    return LV.id;
  }
  function getLevel() { if (!LV) setLevel(3); return LV; }

  /* ---------- 手牌强度评估（0~100） ---------- */
  function strength(hand) {
    var c = {}, i, s = 0;
    hand.forEach(function (x) { c[x.v] = (c[x.v] || 0) + 1; });
    if (c[17]) s += 12;                 // 大王
    if (c[16]) s += 9;                  // 小王
    if (c[17] && c[16]) s += 8;         // 王炸
    s += (c[15] || 0) * 5;              // 2
    s += (c[14] || 0) * 2.5;            // A
    for (var v in c) if (c[v] === 4) s += 14;   // 炸弹
    // 顺子结构
    var vals = Object.keys(c).map(Number).filter(function (v) { return v <= 14; }).sort(function (a, b) { return a - b; });
    var run = 1, best = 1;
    for (i = 1; i < vals.length; i++) {
      if (vals[i] === vals[i - 1] + 1) { run++; if (run > best) best = run; } else run = 1;
    }
    if (best >= 5) s += (best - 4) * 4;
    // 牌型数量（能出的手数越多越差）
    var moves = DDZ.allMoves(hand).length;
    s -= Math.max(0, moves - 9) * 1.1;
    return Math.max(0, s);
  }

  /* ---------- 叫分 / 叫地主决策 ---------- */
  function bid(g, seat) {
    var h = g.hands[seat], s = strength(h);
    if (g.rule === 'let46') {
      return { type: 'bid' };
    }
    // 叫分制：1~3
    var cur = g.bid ? g.bid.score : 0;
    var want = s >= 50 ? 3 : s >= 36 ? 2 : s >= 22 ? 1 : 0;
    // 拟人：先表态的人往往愿意叫 1 分试水，避免总是流局
    if (want === 0 && g.bidSeq.length === 0 && Math.random() < 0.55) want = 1;
    // 兜底：最后一位表态且全场无人叫 → 叫 1 分，避免流局
    var nobodyBid = g.bidSeq.every(function (b) { return b.act === 'pass'; });
    if (want === 0 && nobodyBid && g.bidSeq.length === g.seats - 1) want = 1;
    if (Math.random() < 0.12) want += (Math.random() < 0.5 ? 1 : -1);
    if (want <= cur) return { type: 'pass' };
    if (want <= 0) return { type: 'pass' };
    return { type: 'bid', score: Math.min(3, want) };
  }

  /* ---------- 抢地主（let46） ---------- */
  function grab(g, seat) {
    var s = strength(g.hands[seat]);
    // 牌力强就抢，最多抢到让牌 4 张
    if (g.grabCount >= 3) return { type: 'pass' };
    var threshold = 30 + g.grabCount * 9;
    return s >= threshold ? { type: 'grab' } : { type: 'pass' };
  }

  /* ---------- 出牌决策 ---------- */
  function play(g, seat) {
    var hand = g.hands[seat];
    var last = g.last;
    var needBeat = (last && last.by !== seat) ? last.info : null;

    // 无人压 → 自由出牌
    if (!needBeat) return freePlay(g, seat, hand);

    // 跟牌
    return follow(g, seat, hand, needBeat, last);
  }

  function freePlay(g, seat, hand) {
    var i;
    // 一手走完
    var all = DDZ.allMoves(hand);
    var finish = all.filter(function (m) { return m.length === hand.length; });
    if (finish.length) return { ids: finish[0] };

    var isLandlord = seat === g.landlord;
    var c = {}; hand.forEach(function (x) { c[x.v] = (c[x.v] || 0) + 1; });
    var mine = all.map(function (m) {
      var cards = DDZ.byId(hand, m);
      return { ids: m, info: DDZ.parse(cards), cards: cards };
    }).filter(function (x) { return x.info; });

    // 队友（农民）只剩很少牌时，地主应压制；这里简化为：优先出长牌型
    function score(x) {
      var s = 0, t = x.info.type;
      var big = x.info.main >= 14 ? 1 : 0;
      s -= x.info.main * 1.0;                            // 先出小牌
      if (t === 'bomb' || t === 'rocket') s += 120;      // 炸弹留着
      if (big) s += 26;
      if (t === 'straight' || t === 'dstraight' || t === 'plane') s -= x.ids.length * 3.2;  // 长牌型优先
      if (t === 'triple1' || t === 'triple2') s -= 2;
      if (t === 'single' && x.info.main <= 8) s -= 3;
      // 拆牌惩罚：不要拆对子/三张
      var cc = {}; x.cards.forEach(function (k) { cc[k.v] = (cc[k.v] || 0) + 1; });
      Object.keys(cc).forEach(function (v) {
        if (c[v] === 2 && cc[v] === 1) s += 8;
        if (c[v] === 3 && cc[v] < 3) s += 12;
        if (c[v] === 4 && cc[v] < 4) s += 40;
      });
      return s;
    }
    mine.sort(function (a, b) { return score(a) - score(b); });
    // 拟人：90% 选最优，10% 选次优
    var idx = (Math.random() < 0.9 || mine.length === 1) ? 0 : 1;
    return { ids: mine[Math.min(idx, mine.length - 1)].ids };
  }

  function follow(g, seat, hand, needBeat, last) {
    var lastBy = last.by;
    var isLandlord = seat === g.landlord;
    var teammate = !isLandlord && lastBy !== g.landlord && lastBy !== seat;  // 队友出的牌
    var oppLast = g.seats === 3
      ? Math.min.apply(null, g.hands.map(function (h, i) { return i === seat ? 99 : h.length; }))
      : g.hands[1 - seat].length;

    // 队友出的牌：一般不压，偶尔手滑误压（拟人）
    if (teammate) {
      if (Math.random() < 0.08) { /* 失误，继续走压制逻辑 */ } else return { ids: [] };
    }

    var all = DDZ.allMoves(hand);
    var can = [];
    all.forEach(function (m) {
      var cards = DDZ.byId(hand, m);
      var info = DDZ.parse(cards);
      if (info && DDZ.beats(info, needBeat)) can.push({ ids: m, info: info, cards: cards });
    });
    if (!can.length) return { ids: [] };

    // 对方剩牌很少 → 必须压制
    var urgent = oppLast <= 2;
    // 对方剩牌 <= 让牌数（let46）→ 必须压制
    if (g.rule === 'let46' && !isLandlord && g.hands[1 - g.landlord].length <= g.letCount + 1) urgent = true;
    if (g.rule === 'let46' && isLandlord && g.hands[1 - g.landlord].length <= g.letCount) urgent = true;

    // 一手走完
    var finish = can.filter(function (x) { return x.ids.length === hand.length; });
    if (finish.length) return { ids: finish[0].ids };

    var c = {}; hand.forEach(function (x) { c[x.v] = (c[x.v] || 0) + 1; });
    function cost(x) {
      var s = 0, t = x.info.type;
      s += x.info.main * 1.0;
      if (t === 'bomb') s += 90;
      if (t === 'rocket') s += 160;
      if (x.info.main >= 15) s += 20;      // 2 和王
      var cc = {}; x.cards.forEach(function (k) { cc[k.v] = (cc[k.v] || 0) + 1; });
      Object.keys(cc).forEach(function (v) {
        if (c[v] === 2 && cc[v] === 1) s += 9;
        if (c[v] === 3 && cc[v] < 3) s += 14;
        if (c[v] === 4 && cc[v] < 4) s += 60;
      });
      return s;
    }
    can.sort(function (a, b) { return cost(a) - cost(b); });
    var best = can[0];

    var L = getLevel();
    // 失误率：低难度会「看走眼」，放过本该压的牌
    if (Math.random() < L.mistake * 0.5) return { ids: [] };

    // 不紧急时，小牌才跟；大牌则放过（难度越高越会忍）
    if (!urgent) {
      var tooBig = best.info.main >= 15 || best.info.type === 'bomb' || best.info.type === 'rocket';
      var gap = best.info.main - needBeat.main;
      var holdBack = 0.72 - L.greed * 0.45;          // 高手更舍得出大牌
      if (tooBig && needBeat.main <= 12 && Math.random() < holdBack) return { ids: [] };
      // 高手会「藏牌」：上家出小牌时故意不压，留着关键牌收尾
      if (L.trap > 0 && needBeat.main <= 8 && Math.random() < L.trap * 0.5) return { ids: [] };
      if (gap > 6 && Math.random() < (0.35 - L.greed * 0.2)) return { ids: [] };
    }
    // 地主时更积极；高难度会挑「最省牌型」而不是随便出
    if (isLandlord && Math.random() < 0.12 && can.length > 1) return { ids: can[1].ids };
    // 高手懂得拆牌：手上剩牌少时优先走能一口气出完的
    if (L.split > 0 && hand.length <= 6) {
      var finisher = can.filter(function (x) { return x.cards.length >= hand.length - 1; });
      if (finisher.length && Math.random() < L.split) return { ids: finisher[0].ids };
    }
    return { ids: best.ids };
  }

  /* ---------- 思考延迟（毫秒），拟人 ---------- */
  function thinkTime(g, seat) {
    var base = 600 + Math.random() * 1400;
    if (g.phase === 'bid') base = 400 + Math.random() * 900;
    return Math.round(base);
  }

  return {
    strength: strength, bid: bid, grab: grab, play: play, thinkTime: thinkTime,
    setLevel: setLevel, getLevel: getLevel, LEVELS: LEVELS
  };
});
