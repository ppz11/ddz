/* ============================================================
 *  机器人 AI（服务端托管，前端完全感知不到是机器）
 *  支持 2 人 / 3 人，行为拟人：有思考延迟、偶尔犹豫、会犯错
 *
 * v75 强化：五档参数全部真正参与决策（此前 lookahead / count 只是摆设），
 *   - 记牌：服务端把真实打出的牌记到 g.seenCards，AI 据此判断「顶张」；
 *   - 手数：高难度领出时评估「出完这手还剩几手碎牌」，不再无脑先出小单张；
 *   - 地主：对手快出完时不失误、不藏牌、不送小单张、不玩随机次优；
 *   - 农民：地主剩牌少时强制拦截，队友牌少时坚决让路，不再压真人队友；
 *   - 叫分 / 加倍：高难度提高叫地主门槛，牌不够硬不乱叫、不乱加倍。
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
   * mistake  = 非紧急时的看走眼概率
   * lookahead= 是否评估「出完这手后的剩余手数」（>=2 启用，>=3 跟牌也挑最优）
   * count    = 是否用已出牌记牌判断顶张（>=1 启用）
   * greed    = 舍得出大牌的程度
   * split    = 残局拆牌求一手走完的程度
   * trap     = 上家出小牌时故意藏牌的程度
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

  /* ---------- 记牌 / 手牌结构 ---------- */
  function copies(v) { return v >= 16 ? 1 : 4; }              // 大小王各 1 张
  function countMap(hand) {
    var c = {}; (hand || []).forEach(function (x) { c[x.v] = (c[x.v] || 0) + 1; });
    return c;
  }
  /* 已见牌 = 真实打出的牌 + 公开的底牌（地主已收进手牌，对外也算已知） */
  function seenMap(g) {
    var m = {}, i;
    if (g && g.seenCards) for (i = 0; i < g.seenCards.length; i++) {
      var v = g.seenCards[i].v; m[v] = (m[v] || 0) + 1;
    }
    if (g && g.landlord >= 0 && g.bottom) for (i = 0; i < g.bottom.length; i++) {
      var bv = g.bottom[i].v; m[bv] = (m[bv] || 0) + 1;
    }
    return m;
  }
  /* 这张牌是不是「外面已经没有更大的牌」：高难度据此放心出/压，不再无脑藏牌 */
  function isTop(v, hand, g) {
    var mine = countMap(hand), seen = seenMap(g), unseen = 0;
    for (var hv = Number(v) + 1; hv <= 17; hv++) {
      var left = copies(hv) - (mine[hv] || 0) - (seen[hv] || 0);
      if (left > 0) unseen += left;
    }
    return unseen <= 0;
  }
  /* 剩余手牌的「碎度」：单张越多越差，炸弹/对子越多越好。数值越小越好。 */
  function fragility(hand) {
    var c = countMap(hand), singles = 0, pairs = 0, bombs = 0;
    Object.keys(c).forEach(function (v) {
      var n = c[v];
      if (+v <= 14 && n === 1) singles++;
      if (n === 2) pairs++;
      if (n === 4) bombs++;
    });
    return singles * 1.8 + (hand || []).length * 0.12 - bombs * 1.2 - pairs * 0.4;
  }
  function restOf(hand, cards) {
    var set = {}; cards.forEach(function (c) { set[c.id] = 1; });
    return hand.filter(function (c) { return !set[c.id]; });
  }
  /* 对手最小剩牌数：地主看所有农民；农民只盯地主，绝不把队友当敌人 */
  function oppMin(g, seat, isLandlord) {
    var m = 99;
    (g.hands || []).forEach(function (h, i) {
      if (i === seat || !h) return;
      if (isLandlord || i === g.landlord) m = Math.min(m, h.length);
    });
    return m;
  }

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
    /* v75 真因修复：旧代码用「能组成的牌型数量」当惩罚，可牌越好组合越多，
       强牌反而被扣到 20 分以下，机器人拿王炸三条还不敢叫地主 —— 这就是
       「机器人当地主老输」的源头。改成按剩余单张/碎度扣分，才符合牌理。 */
    s -= Math.min(12, fragility(hand) * 0.6);
    return Math.max(0, s);
  }

  /* ---------- 叫分 / 叫地主决策 ----------
     高难度不再拿一手平庸牌抢地主（这是「机器人当地主老输」的源头之一）。 */
  function bid(g, seat) {
    var h = g.hands[seat], s = strength(h), L = getLevel();
    var cur = g.bid ? g.bid.score : 0;
    var t = L.id >= 4 ? [26, 40, 50] : [18, 32, 44];
    var want = s >= t[2] ? 3 : s >= t[1] ? 2 : s >= t[0] ? 1 : 0;
    // 拟人：先表态的人偶尔愿意叫 1 分试水，避免总是流局；高难度更克制
    if (want === 0 && g.bidSeq.length === 0 && Math.random() < (L.id >= 4 ? 0.18 : 0.55)) want = 1;
    // 兜底：最后一位表态且全场无人叫 → 叫 1 分，避免流局
    var nobodyBid = g.bidSeq.every(function (b) { return b.act === 'pass'; });
    if (want === 0 && nobodyBid && g.bidSeq.length === g.seats - 1) want = 1;
    if (Math.random() < 0.12) want += (Math.random() < 0.5 ? 1 : -1);
    var score = Math.min(3, want);
    if (score <= cur || score <= 0) return { type: 'pass' };
    return { type: 'bid', score: score };
  }

  /* v75 加倍决策：牌不够硬不乱加倍（原来只数 2/A/王，太容易翻倍送分） */
  function double(g, seat) {
    var h = g.hands[seat] || [], s = strength(h), c = countMap(h), L = getLevel();
    var bomb = Object.keys(c).some(function (v) { return c[v] === 4; });
    var rocket = !!(c[17] && c[16]);
    if (rocket) return true;
    if (bomb && s >= 30) return true;
    return s >= (L.id >= 4 ? 40 : 46);
  }

  /* v46 减牌竞叫决策：牌越强越敢叫大数字 */
  function cut(g, seat) {
    var s = strength(g.hands[seat]);
    var opts = DDZ.cutOptions(g);
    var want = s >= 52 ? 2 : s >= 30 ? 1 : 0;
    if (want === 0 && !g.cutSeq.length && Math.random() < 0.5) want = 1;
    if (want === 0) return { type: 'pass' };
    var idx = Math.min(want - 1, opts.length - 1);
    var n = opts[idx];
    if (n > g.hands[seat].length) return { type: 'pass' };
    return { type: 'cut', count: n };
  }

  /* ---------- 抢地主（旧让牌玩法，v46 起不再触发，保留兼容） ---------- */
  function grab(g, seat) {
    var s = strength(g.hands[seat]);
    if (g.grabCount >= 3) return { type: 'pass' };
    var threshold = 30 + g.grabCount * 9;
    return s >= threshold ? { type: 'grab' } : { type: 'pass' };
  }

  /* ---------- 出牌决策 ---------- */
  function play(g, seat) {
    var hand = g.hands[seat];
    var last = g.last;
    var needBeat = (last && last.by !== seat) ? last.info : null;
    if (!needBeat) return freePlay(g, seat, hand);
    return follow(g, seat, hand, needBeat, last);
  }

  function freePlay(g, seat, hand) {
    var i, L = getLevel();
    // 一手走完
    var all = DDZ.allMoves(hand);
    var finish = all.filter(function (m) { return m.length === hand.length; });
    if (finish.length) return { ids: finish[0] };

    var isLandlord = seat === g.landlord;
    var oppLast = oppMin(g, seat, isLandlord);
    var c = countMap(hand);
    var mine = all.map(function (m) {
      var cards = DDZ.byId(hand, m);
      return { ids: m, info: DDZ.parse(cards), cards: cards };
    }).filter(function (x) { return x.info; });
    if (!mine.length) return { ids: [] };

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
      var cc = countMap(x.cards);
      Object.keys(cc).forEach(function (v) {
        if (c[v] === 2 && cc[v] === 1) s += 8;
        if (c[v] === 3 && cc[v] < 3) s += 12;
        if (c[v] === 4 && cc[v] < 4) s += 40;
      });
      /* v75：高难度看「出完这手还剩几手碎牌」，优先选让剩余手牌更整齐的一手。
         这是 lookahead 参数第一次真正生效，也是地主不再把牌权白送出去的关键。 */
      if (L.lookahead >= 2) {
        var rest = restOf(hand, x.cards);
        s += fragility(rest) * (1.2 + L.lookahead * 0.35);
        if (rest.length === 0) s -= 200;
      }
      /* v75：对手快出完时，别再出小单张送牌权；长牌型一次多走几张更实在 */
      if (oppLast <= 4) {
        if (t === 'single' && x.info.main <= 10) s += 22;
        if (x.ids.length >= 5) s -= 10;
      }
      /* v75：记牌判定为「外面已无更大牌」的顶张，果断走掉，不再当宝贝攥着 */
      if (L.count >= 1 && t === 'single' && isTop(x.info.main, hand, g)) s -= 7;
      return s;
    }
    mine.sort(function (a, b) { return score(a) - score(b); });
    // 拟人：90% 选最优，10% 选次优；对手快赢时不玩花样
    var idx = (oppLast <= 4 || Math.random() < 0.9 || mine.length === 1) ? 0 : 1;
    return { ids: mine[Math.min(idx, mine.length - 1)].ids };
  }

  function follow(g, seat, hand, needBeat, last) {
    var lastBy = last.by;
    var isLandlord = seat === g.landlord;
    var teammate = !isLandlord && lastBy !== g.landlord && lastBy !== seat;  // 队友出的牌
    var L = getLevel();
    /* v72：三人场原来用「所有其他家最小牌数」当对手，把队友也算进去了 ——
       队友只剩 2 张时 urgent=true，机器人会去压队友，最终把农民方拖输。
       现在只认地主的牌数。 */
    var oppLast = oppMin(g, seat, isLandlord);
    if (oppLast === 99) oppLast = (g.hands[1 - seat] || []).length;   // 二人兜底

    /* 农民配合：以前「队友出的牌」92% 直接放过，叠加跟牌保守策略后，
       经常表现成「一家一直出、另一家一整局都不出」，看着像挂机。
       现在：队友快赢一定让路；自己能一手走完就接管收尾；
       其余一律让路（v72 撤掉「每让 2 次必接管」，不再压真人队友）。 */
    if (teammate) {
      var mateLeft = (g.hands[lastBy] || []).length;
      var all0 = DDZ.allMoves(hand);
      var finish0 = all0.filter(function (m) {
        if (m.length !== hand.length) return false;
        var inf = DDZ.parse(DDZ.byId(hand, m));
        return inf && DDZ.beats(inf, needBeat);
      });
      if (finish0.length) return { ids: finish0[0] };       // 自己能一手走完 → 接管收尾
      if (mateLeft <= 6) return { ids: [] };
      if (mateLeft > 10 && hand.length <= 3 && Math.random() < 0.25) {
        var take = null;
        for (var ti = 0; ti < all0.length && !take; ti++) {
          var inf2 = DDZ.parse(DDZ.byId(hand, all0[ti]));
          if (inf2 && DDZ.beats(inf2, needBeat)) take = all0[ti];
        }
        if (take) return { ids: take };
      }
      return { ids: [] };
    }

    var all = DDZ.allMoves(hand);
    var can = [];
    all.forEach(function (m) {
      var cards = DDZ.byId(hand, m);
      var info = DDZ.parse(cards);
      if (info && DDZ.beats(info, needBeat)) can.push({ ids: m, info: info, cards: cards });
    });
    if (!can.length) return { ids: [] };

    /* v75：地主快出完时农民必须尽力拦截；地主自己也要压住快赢的农民。
       阈值随难度提高，且紧急局面下一律不失误、不藏牌、不挑次优。 */
    var urgent = oppLast <= (L.id >= 4 ? 4 : (L.id >= 3 ? 3 : 2));
    var mustStop = !isLandlord && oppLast <= (L.id >= 4 ? 5 : 4);

    // 一手走完
    var finish = can.filter(function (x) { return x.ids.length === hand.length; });
    if (finish.length) return { ids: finish[0].ids };

    var c = countMap(hand);
    function cost(x) {
      var s = 0, t = x.info.type;
      s += x.info.main * 1.0;
      if (t === 'bomb') s += 90;
      if (t === 'rocket') s += 160;
      if (x.info.main >= 15) s += 20;      // 2 和王
      var cc = countMap(x.cards);
      Object.keys(cc).forEach(function (v) {
        if (c[v] === 2 && cc[v] === 1) s += 9;
        if (c[v] === 3 && cc[v] < 3) s += 14;
        if (c[v] === 4 && cc[v] < 4) s += 60;
      });
      /* 高难度：同样能压，优先选「压完剩牌最整齐」的那一手 */
      if (L.lookahead >= 3) s += fragility(restOf(hand, x.cards)) * 0.8;
      return s;
    }
    can.sort(function (a, b) { return cost(a) - cost(b); });
    var best = can[0];

    // 失误率：低难度会「看走眼」放过本该压的牌；紧急时不许失误
    if (!urgent && !mustStop && Math.random() < L.mistake * 0.5) return { ids: [] };

    // 记牌：确认自己这张已是顶张，就不再无脑藏牌
    var confident = L.count >= 1 && isTop(best.info.main, hand, g);

    // 不紧急时，小牌才跟；大牌则放过（难度越高越会忍）
    if (!urgent && !mustStop && !confident) {
      var tooBig = best.info.main >= 15 || best.info.type === 'bomb' || best.info.type === 'rocket';
      var gap = best.info.main - needBeat.main;
      var holdBack = 0.72 - L.greed * 0.45;          // 高手更舍得出大牌
      if (!isLandlord) holdBack *= 0.6;                 // v59：农民别过度忍让
      if (tooBig && needBeat.main <= 12 && Math.random() < holdBack) return { ids: [] };
      // 高手会「藏牌」，但只在开局（对手牌还多）留关键牌；中残局一律积极压制
      if (L.trap > 0 && oppLast > 8 && needBeat.main <= 8 && Math.random() < L.trap * 0.5) return { ids: [] };
      if (gap > 6 && Math.random() < (0.35 - L.greed * 0.2)) return { ids: [] };
    }
    // 地主时更积极；高难度会挑「最省牌型」而不是随便出；紧急时不玩花样
    if (isLandlord && !urgent && Math.random() < 0.12 && can.length > 1) return { ids: can[1].ids };
    // 高手懂得拆牌：手上剩牌少时优先走能一口气出完的
    if (L.split > 0 && hand.length <= 6) {
      var finisher = can.filter(function (x) { return x.cards.length >= hand.length - 1; });
      if (finisher.length && Math.random() < L.split) return { ids: finisher[0].ids };
    }
    return { ids: best.ids };
  }

  /* ---------- 思考延迟（毫秒），拟人 ----------
     出牌固定 3 秒左右；叫分约 3 秒，加倍约 2 秒，均在限时内。 */
  function thinkTime(g, seat) {
    var base = 2700 + Math.random() * 600;
    if (g.phase === 'bid') base = 2700 + Math.random() * 600;
    else if (g.phase === 'double') base = 1800 + Math.random() * 500;
    return Math.round(base);
  }

  return {
    strength: strength, bid: bid, cut: cut, grab: grab, play: play, double: double,
    thinkTime: thinkTime, setLevel: setLevel, getLevel: getLevel, LEVELS: LEVELS,
    fragility: fragility, isTop: isTop
  };
});
