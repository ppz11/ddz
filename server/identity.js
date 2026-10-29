/* 随机昵称 + 随机头像参数生成（每次登录都重新生成） */
const ADJ = ['暴走', '沉默', '微笑', '迷茫', '傲娇', '呆萌', '高冷', '狂野', '温柔', '忧郁', '机智', '佛系',
  '腹黑', '元气', '慵懒', '神秘', '闪电', '黑夜', '星光', '薄荷', '微醺', ' Galactic', '孤独', '深蓝', '奶油',
  '午夜', '橘子', '荔枝', '青柠', '海盐', '焦糖', '柚子', '冰镇', '晚风', '晨曦', '细雨', '偏爱', '野生'];
const NOUN = ['熊猫', '猎鹰', '狐狸', '老虎', '企鹅', '水獺', '柴犬', '布丁', '奶茶', '汤圆', '流星', '海风',
  '月亮', '森林', '沙漠', '咖啡', '棉花糖', '小行星', '猎人', '旅人', '船长', '旅鸽', '鲸鱼', '灯塔', '暖阳',
  '雪松', '橡果', '蒲公英', '银河', '琥珀', '珊瑚', '极光', '纸飞机', '小怪兽', '猫头鹰', '蜗牛', '刺猬', '海豚'];

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

function nick() {
  // 昵称控制在 8 个字以内：牌桌左右信息块宽度才稳定，不会被长昵称撑爆
  var s = pick(ADJ) + '的' + pick(NOUN);
  return s.length > 8 ? s.slice(0, 8) : s;
}

/* 头像参数：前端据此绘制 SVG，保证「精致 + 每次不同」 */
function avatar() {
  return {
    seed: Math.floor(Math.random() * 100000),
    style: Math.floor(Math.random() * 6),   // 0-5 六种绘制风格
    hue: Math.floor(Math.random() * 360),
    hue2: Math.floor(Math.random() * 360),
    face: Math.floor(Math.random() * 5),    // 表情
    acc: Math.floor(Math.random() * 5),     // 配饰
    ring: Math.floor(Math.random() * 3)
  };
}

/* 头像 SVG 字符串（服务端也可用于生成默认头像） */
function avatarSVG(a, size) {
  size = size || 96;
  const h1 = a.hue, h2 = a.hue2;
  const s = a.seed;
  const R = function (n) { return ((s * (n + 7) * 9301 + 49297) % 233280) / 233280; };
  let inner = '';
  const face = a.face % 5;
  const eyeY = 44;
  let eyes = '';
  if (face === 0) eyes = '<circle cx="36" cy="' + eyeY + '" r="4.5" fill="#2b2233"/><circle cx="64" cy="' + eyeY + '" r="4.5" fill="#2b2233"/>';
  else if (face === 1) eyes = '<path d="M30 44q6 -7 12 0" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M58 44q6 -7 12 0" stroke="#2b2233" stroke-width="4" fill="none" stroke-linecap="round"/>';
  else if (face === 2) eyes = '<rect x="31" y="40" width="10" height="7" rx="3.5" fill="#2b2233"/><rect x="59" y="40" width="10" height="7" rx="3.5" fill="#2b2233"/>';
  else if (face === 3) eyes = '<path d="M31 46l10 -5" stroke="#2b2233" stroke-width="4" stroke-linecap="round"/><path d="M69 46l-10 -5" stroke="#2b2233" stroke-width="4" stroke-linecap="round"/>';
  else eyes = '<circle cx="36" cy="44" r="5" fill="#fff"/><circle cx="37" cy="45" r="2.6" fill="#2b2233"/><circle cx="64" cy="44" r="5" fill="#fff"/><circle cx="65" cy="45" r="2.6" fill="#2b2233"/>';
  const mouths = ['M40 60q10 8 20 0', 'M42 62q8 -6 16 0', 'M42 61h16', 'M40 58q10 10 20 0', 'M43 62q7 4 14 0'];
  inner += '<ellipse cx="50" cy="52" rx="30" ry="30" fill="#fff" opacity="' + (0.16 + R(1) * 0.14).toFixed(2) + '"/>';
  inner += eyes;
  inner += '<path d="' + mouths[face] + '" stroke="#2b2233" stroke-width="3.6" fill="none" stroke-linecap="round"/>';
  inner += '<circle cx="28" cy="56" r="5" fill="#ff8fa3" opacity="0.5"/><circle cx="72" cy="56" r="5" fill="#ff8fa3" opacity="0.5"/>';
  // 配饰
  if (a.acc === 1) inner += '<path d="M20 26q30 -22 60 0" stroke="#fff" stroke-width="5" fill="none" opacity="0.85" stroke-linecap="round"/>';
  else if (a.acc === 2) inner += '<path d="M22 24l10 14l14 -12z" fill="#fff" opacity="0.9"/>';
  else if (a.acc === 3) inner += '<circle cx="50" cy="18" r="7" fill="#fff" opacity="0.9"/><circle cx="50" cy="18" r="3" fill="hsl(' + h2 + ',90%,60%)"/>';
  else if (a.acc === 4) inner += '<rect x="34" y="18" width="32" height="9" rx="4.5" fill="#fff" opacity="0.9"/>';
  // 背景形状随风格变化
  let shapes = '';
  for (let i = 0; i < 4; i++) {
    const cx = 10 + R(i + 2) * 80, cy = 10 + R(i + 9) * 80, r = 8 + R(i + 15) * 22;
    shapes += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="#fff" opacity="0.10"/>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="' + size + '" height="' + size + '">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="hsl(' + h1 + ',85%,62%)"/><stop offset="1" stop-color="hsl(' + h2 + ',80%,48%)"/>' +
    '</linearGradient><clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath></defs>' +
    '<g clip-path="url(#c)"><rect width="100" height="100" fill="url(#g)"/>' + shapes + inner + '</g>' +
    (a.ring === 1 ? '<circle cx="50" cy="50" r="47" fill="none" stroke="#fff" stroke-width="3" opacity="0.8"/>' : '') +
    '</svg>';
}

module.exports = { nick, avatar, avatarSVG, ADJ, NOUN };
