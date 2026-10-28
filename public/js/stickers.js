/* ===================== 表情包系统 =====================
 * 全部为内联 SVG 手绘贴纸（无外部图片，体积极小、任意分辨率不糊）
 * 两个自定义贴纸包 + 常用 Emoji 包
 * ==================================================== */
window.Stickers = (function () {

  function face(eyes, mouth, hue, prop) {
    var g = 'hs' + hue;
    return '<defs><linearGradient id="' + g + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="hsl(' + hue + ',95%,82%)"/><stop offset="1" stop-color="hsl(' + hue + ',85%,62%)"/></linearGradient></defs>' +
      '<circle cx="50" cy="52" r="40" fill="url(#' + g + ')" stroke="rgba(0,0,0,.18)" stroke-width="2"/>' +
      '<ellipse cx="35" cy="40" rx="9" ry="7" fill="#fff" opacity=".55"/>' + eyes + mouth + (prop || '');
  }
  var E = {
    happy: '<circle cx="36" cy="45" r="4.5" fill="#2b2233"/><circle cx="64" cy="45" r="4.5" fill="#2b2233"/>',
    laugh: '<path d="M28 44q8-9 16 0" stroke="#2b2233" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M56 44q8-9 16 0" stroke="#2b2233" stroke-width="4.5" fill="none" stroke-linecap="round"/>',
    heart: '<path d="M30 46c-4-6 1-11 6-6 4-4 9-1 9 4 0-5 5-8 9-4 5-5 10 0 6 6-6 6-15 10-15 10s-9-4-15-10z" fill="#e5484d"/>',
    star: '<path d="M34 40l3 6 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1z" fill="#2b2233"/><path d="M64 40l3 6 6 1-4 5 1 6-6-3-6 3 1-6-4-5 6-1z" fill="#2b2233"/>',
    cry: '<path d="M28 40q8-7 16 2" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M56 42q8-7 16-2" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M32 52q4 8 8 0" fill="#3b82f6" opacity=".85"/><path d="M60 52q4 8 8 0" fill="#3b82f6" opacity=".85"/>',
    angry: '<path d="M28 40l14 6" stroke="#2b2233" stroke-width="4.5" stroke-linecap="round"/><path d="M72 40l-14 6" stroke="#2b2233" stroke-width="4.5" stroke-linecap="round"/>',
    shock: '<circle cx="36" cy="45" r="7" fill="#fff" stroke="#2b2233" stroke-width="2.5"/><circle cx="64" cy="45" r="7" fill="#fff" stroke="#2b2233" stroke-width="2.5"/>',
    sweat: '<path d="M30 44q6-5 12 0" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M58 44q6-5 12 0" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/>',
    dead: '<path d="M28 46h16" stroke="#2b2233" stroke-width="4.5" stroke-linecap="round"/><path d="M56 46h16" stroke="#2b2233" stroke-width="4.5" stroke-linecap="round"/>',
    cool: '<rect x="26" y="38" width="28" height="12" rx="6" fill="#2b2233"/><rect x="58" y="38" width="18" height="12" rx="6" fill="#2b2233"/><path d="M30 44h20" stroke="#fff" stroke-width="2" opacity=".5"/>',
    sleep: '<path d="M28 46q8 6 16 0" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M56 46q8 6 16 0" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/>',
    think: '<circle cx="36" cy="45" r="4.5" fill="#2b2233"/><circle cx="64" cy="45" r="4.5" fill="#2b2233"/><path d="M30 34q6-6 12 0" stroke="#2b2233" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M58 34q6-6 12 0" stroke="#2b2233" stroke-width="3.5" fill="none" stroke-linecap="round"/>'
  };
  var M = {
    smile: '<path d="M38 60q12 11 24 0" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/>',
    open: '<ellipse cx="50" cy="64" rx="12" ry="10" fill="#2b2233"/><path d="M40 62q10 6 20 0" fill="#ff7a90"/>',
    flat: '<path d="M40 64h20" stroke="#2b2233" stroke-width="4" stroke-linecap="round"/>',
    frown: '<path d="M38 68q12-11 24 0" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/>',
    o: '<circle cx="50" cy="64" r="7" fill="#2b2233"/>',
    wave: '<path d="M38 63q6 6 12 0t12 0" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/>',
    zzz: '<path d="M38 62h24" stroke="#2b2233" stroke-width="4" stroke-linecap="round"/>'
  };
  var P = {
    sweatdrop: '<path d="M76 30c-5 6-8 10-8 14a8 8 0 0 0 16 0c0-4-3-8-8-14z" fill="#4aa3ff" stroke="#2b6cb0" stroke-width="1.5"/>',
    zzz: '<text x="74" y="34" font-size="18" font-weight="800" fill="#2b2233">z</text><text x="82" y="24" font-size="13" font-weight="800" fill="#2b2233">z</text>',
    anger: '<path d="M74 22l6 10 6-10-3 12 8 4-12 4 4 10-8-8-8 8 4-10-12-4 8-4z" fill="#e5484d"/>',
    blush: '<ellipse cx="26" cy="60" rx="7" ry="4.5" fill="#ff7a90" opacity=".7"/><ellipse cx="74" cy="60" rx="7" ry="4.5" fill="#ff7a90" opacity=".7"/>',
    question: '<text x="72" y="34" font-size="20" font-weight="800" fill="#2b2233">?</text>',
    glass: '<rect x="26" y="38" width="20" height="14" rx="7" fill="none" stroke="#2b2233" stroke-width="3"/><rect x="54" y="38" width="20" height="14" rx="7" fill="none" stroke="#2b2233" stroke-width="3"/><path d="M46 45h8" stroke="#2b2233" stroke-width="3"/>'
  };

  var PACK_FACE = [
    { id: 'happy', n: '开心', h: 45, e: E.happy, m: M.smile },
    { id: 'laugh', n: '大笑', h: 30, e: E.laugh, m: M.open, p: P.blush },
    { id: 'love', n: '喜欢', h: 340, e: E.heart, m: M.smile, p: P.blush },
    { id: 'star', n: '崇拜', h: 275, e: E.star, m: M.open },
    { id: 'cry', n: '大哭', h: 210, e: E.cry, m: M.frown },
    { id: 'angry', n: '生气', h: 0, e: E.angry, m: M.frown, p: P.anger },
    { id: 'shock', n: '震惊', h: 190, e: E.shock, m: M.o },
    { id: 'sweat', n: '汗', h: 60, e: E.sweat, m: M.flat, p: P.sweatdrop },
    { id: 'dead', n: '无语', h: 250, e: E.dead, m: M.flat },
    { id: 'cool', n: '酷', h: 220, e: E.cool, m: M.smile },
    { id: 'think', n: '思考', h: 160, e: E.think, m: M.wave, p: P.question },
    { id: 'sleep', n: '困了', h: 265, e: E.sleep, m: M.zzz, p: P.zzz }
  ];

  /* -------- 物件贴纸 -------- */
  function obj(bg, inner) {
    return '<circle cx="50" cy="52" r="40" fill="' + bg + '" stroke="rgba(0,0,0,.15)" stroke-width="2"/>' + inner;
  }
  var PACK_OBJ = [
    { id: 'thumb', n: '点赞', s: obj('#ffe8b8', '<path d="M30 46h8v30h-8a4 4 0 0 1-4-4V50a4 4 0 0 1 4-4z" fill="#f3c96b" stroke="#c99a3a" stroke-width="2"/><path d="M38 46c0-12 4-18 12-18 5 0 7 3 7 8 0 4-2 5-4 8-1 2 1 4 5 4h8c4 0 6 3 6 7v13c0 4-3 6-8 6H38z" fill="#ffd98a" stroke="#c99a3a" stroke-width="2"/>') },
    { id: 'clap', n: '鼓掌', s: obj('#ffe0e6', '<circle cx="38" cy="56" r="14" fill="#ffd0d8" stroke="#e08a99" stroke-width="2"/><circle cx="62" cy="56" r="14" fill="#ffd0d8" stroke="#e08a99" stroke-width="2"/><path d="M50 26l4 8 8 1-6 5 2 8-8-4-8 4 2-8-6-5 8-1z" fill="#f3c96b"/>') },
    { id: 'ok', n: 'OK', s: obj('#d8f5e8', '<circle cx="50" cy="52" r="20" fill="none" stroke="#2fae7c" stroke-width="6"/><path d="M40 52l8 9 14-18" stroke="#2fae7c" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>') },
    { id: 'heart', n: '爱心', s: obj('#ffe0e6', '<path d="M50 80C22 62 14 44 26 33c9-8 20-2 24 8 4-10 15-16 24-8 12 11 4 29-24 47z" fill="#e5484d"/><circle cx="34" cy="40" r="5" fill="#fff" opacity=".55"/>') },
    { id: 'rose', n: '玫瑰', s: obj('#ffe8ee', '<path d="M50 80V52" stroke="#2fae7c" stroke-width="4" stroke-linecap="round"/><path d="M50 64c-8 0-12-4-14-8 6-2 12 1 14 8z" fill="#2fae7c"/><circle cx="50" cy="42" r="16" fill="#e5484d"/><circle cx="50" cy="42" r="10" fill="#ff7a90"/><circle cx="50" cy="42" r="4" fill="#c92b38"/>') },
    { id: 'bomb', n: '炸弹', s: obj('#e8e8ee', '<circle cx="48" cy="58" r="20" fill="#2f3640"/><path d="M60 42c4-6 12-6 14-12" stroke="#8a6a3a" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="75" cy="28" r="5" fill="#f3c96b"/><circle cx="76" cy="26" r="2" fill="#fff5d0"/><circle cx="41" cy="50" r="5" fill="#fff" opacity=".3"/>') },
    { id: 'cake', n: '蛋糕', s: obj('#fff0d6', '<rect x="26" y="54" width="48" height="24" rx="6" fill="#ffd0a8" stroke="#c98a5a" stroke-width="2"/><path d="M26 58q6 8 12 0t12 0 12 0 12 0v-6H26z" fill="#ffe8c8"/><rect x="47" y="38" width="6" height="16" rx="3" fill="#8ecae6"/><ellipse cx="50" cy="36" rx="4" ry="6" fill="#f3c96b"/><circle cx="50" cy="66" r="3" fill="#e5484d"/><circle cx="60" cy="70" r="3" fill="#31d8a6"/><circle cx="40" cy="70" r="3" fill="#8ecae6"/>') },
    { id: 'coffee', n: '咖啡', s: obj('#efe4d6', '<path d="M30 42h38v22a14 14 0 0 1-14 14H44a14 14 0 0 1-14-14z" fill="#fff" stroke="#8a6a4a" stroke-width="2.5"/><path d="M34 50h30v14a11 11 0 0 1-11 11h-8a11 11 0 0 1-11-11z" fill="#6b4423"/><path d="M68 48c8 0 8 14 0 14" stroke="#8a6a4a" stroke-width="4" fill="none"/><path d="M42 32c0-4 6-4 6-8" stroke="#bbb" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M54 32c0-4 6-4 6-8" stroke="#bbb" stroke-width="3" fill="none" stroke-linecap="round"/>') },
    { id: 'fire', n: '火焰', s: obj('#ffe0c0', '<path d="M50 20c8 18 22 22 18 40-2 10-9 18-18 18s-16-8-18-18c-4-18 10-22 18-40z" fill="#ff7a2f"/><path d="M50 44c4 8 10 10 8 18-1 5-4 8-8 8s-7-3-8-8c-2-8 4-10 8-18z" fill="#f3c96b"/>') },
    { id: 'bolt', n: '闪电', s: obj('#e8f0ff', '<path d="M56 18L30 56h16l-6 30 30-42H54l6-26z" fill="#f3c96b" stroke="#c99a3a" stroke-width="2"/>') },
    { id: 'gift', n: '礼物', s: obj('#ffe0ec', '<rect x="24" y="44" width="52" height="38" rx="6" fill="#e5484d"/><rect x="24" y="38" width="52" height="12" rx="4" fill="#ff7a90"/><path d="M50 38v44" stroke="#f3c96b" stroke-width="6"/><path d="M50 38c-6-10-16-10-16-2 0 5 8 6 16 2z" fill="#f3c96b"/><path d="M50 38c6-10 16-10 16-2 0 5-8 6-16 2z" fill="#f3c96b"/>') },
    { id: 'star', n: '星星', s: obj('#fff6d8', '<path d="M50 24l11 23 25 3-18 18 5 25-23-13-23 13 5-25-18-18 25-3z" fill="#f3c96b" stroke="#c99a3a" stroke-width="2"/>') }
  ];

  var EMOJI = ['😀','😄','😁','😂','🤣','😊','😍','🥰','😘','😜','🤪','🤗','🤔','😐','😑','😴','😪','😭','😤','😡','🤯','😱','🥳','😎','🤓','🧐','😏','😒','🙄','😬','😮‍💨','🤢','🤧','🤒','🥺','😳','🫠','🤡','👻','💀','👽','🤖','🎃','😺','😹','😻','🙈','🙉','🙊','💋','💌','💔','💯','💢','💥','💫','👋','🤝','👍','👎','👌','✌️','🤞','🤙','👏','🙌','🙏','💪','🫡','🫶','❤️','🧡','💛','💚','💙','💜','🖤','🤍','✨','⭐','🌟','🔥','💧','🌈','☀️','🌙','⛅','❄️','🍀','🌹','🌺','🌸','💐','🍎','🍊','🍉','🍇','🍓','🍑','🍔','🍟','🍕','🍜','🍣','🍰','🎂','🍩','🍪','🍫','🍬','🍺','🥂','🍾','☕','🧋','⚽','🏀','🎮','🎲','🃏','🎯','🎰','🏆','🥇','🎁','🎉','🎊','🎈','🚀','⚡','💣','🔔','📱','💰','🧧','👑','🎩','🧢','👀','🦄','🐶','🐱','🐼','🐯','🦊','🐻','🐨','🐷','🐸','🐙','🦋','🐝'];

  function svgOf(st) {
    return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
      (st.s ? st.s : face(st.e, st.m, st.h, st.p)) + '</svg>';
  }
  function render(kind, id) {
    if (kind === 'emoji') return EMOJI[id] || '🙂';
    var all = PACK_FACE.concat(PACK_OBJ);
    var st = all.filter(function (x) { return x.id === id; })[0];
    return st ? svgOf(st) : '';
  }
  /* 贴纸在消息里的展示：自定义包返回 SVG，emoji 返回字符 */
  function html(kind, id) {
    if (kind === 'emoji') return null;         // 交给文本渲染
    return svgOf(PACK_FACE.concat(PACK_OBJ).filter(function (x) { return x.id === id; })[0] || PACK_FACE[0]);
  }
  return {
    PACK_FACE: PACK_FACE, PACK_OBJ: PACK_OBJ, EMOJI: EMOJI,
    svgOf: svgOf, render: render, html: html
  };
})();
