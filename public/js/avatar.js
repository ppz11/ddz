/* 随机头像渲染：SVG 程序化生成，无外部图片，体积极小 */
window.Avatar = (function () {
  function rnd(seed, n) {
    var x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  function faces(f, dark) {
    var c = dark ? '#12202a' : '#241c2e';
    var eyeY = 46, out = '';
    if (f === 0) out = '<circle cx="35" cy="' + eyeY + '" r="5" fill="' + c + '"/><circle cx="65" cy="' + eyeY + '" r="5" fill="' + c + '"/>';
    else if (f === 1) out = '<path d="M28 45q7-8 14 0" stroke="' + c + '" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M58 45q7-8 14 0" stroke="' + c + '" stroke-width="4.5" fill="none" stroke-linecap="round"/>';
    else if (f === 2) out = '<rect x="29" y="41" width="12" height="8" rx="4" fill="' + c + '"/><rect x="59" y="41" width="12" height="8" rx="4" fill="' + c + '"/>';
    else if (f === 3) out = '<path d="M29 48l12-6" stroke="' + c + '" stroke-width="4.5" stroke-linecap="round"/><path d="M71 48l-12-6" stroke="' + c + '" stroke-width="4.5" stroke-linecap="round"/>';
    else out = '<circle cx="35" cy="46" r="6" fill="#fff"/><circle cx="36" cy="47" r="3" fill="' + c + '"/><circle cx="65" cy="46" r="6" fill="#fff"/><circle cx="66" cy="47" r="3" fill="' + c + '"/>';
    var mo = ['M40 62q10 9 20 0', 'M42 64q8-7 16 0', 'M41 63h18', 'M39 60q11 12 22 0', 'M43 64q7 5 14 0'];
    out += '<path d="' + mo[f] + '" stroke="' + c + '" stroke-width="4" fill="none" stroke-linecap="round"/>';
    out += '<ellipse cx="26" cy="58" rx="6" ry="4" fill="#ff7a90" opacity=".45"/><ellipse cx="74" cy="58" rx="6" ry="4" fill="#ff7a90" opacity=".45"/>';
    return out;
  }
  function deco(style, seed, h1, h2) {
    var s = '', i;
    if (style === 0) {
      for (i = 0; i < 5; i++) s += '<circle cx="' + (6 + rnd(seed, i) * 88).toFixed(1) + '" cy="' + (6 + rnd(seed, i + 40) * 88).toFixed(1) + '" r="' + (7 + rnd(seed, i + 80) * 20).toFixed(1) + '" fill="#fff" opacity="' + (0.07 + rnd(seed, i + 9) * 0.10).toFixed(2) + '"/>';
    } else if (style === 1) { // 星球环
      s += '<ellipse cx="50" cy="82" rx="52" ry="14" fill="none" stroke="#fff" stroke-width="4" opacity=".35"/>';
      s += '<circle cx="18" cy="20" r="5" fill="#fff" opacity=".7"/><circle cx="84" cy="30" r="3.5" fill="#fff" opacity=".6"/>';
    } else if (style === 2) { // 像素
      for (i = 0; i < 7; i++) s += '<rect x="' + (rnd(seed, i) * 90).toFixed(0) + '" y="' + (rnd(seed, i + 30) * 90).toFixed(0) + '" width="16" height="16" rx="3" fill="#fff" opacity="' + (0.05 + rnd(seed, i + 5) * 0.1).toFixed(2) + '"/>';
    } else if (style === 3) { // 波浪
      s += '<path d="M-5 70 q25 -22 50 0 t50 0 t50 0 v60 h-150z" fill="#fff" opacity=".13"/>';
      s += '<path d="M-5 84 q25 -22 50 0 t50 0 t50 0 v60 h-150z" fill="#fff" opacity=".10"/>';
    } else if (style === 4) { // 三角
      s += '<path d="M0 100 L40 18 L80 100z" fill="#fff" opacity=".10"/>';
      s += '<path d="M30 100 L66 26 L100 100z" fill="#fff" opacity=".09"/>';
    } else { // 花瓣
      for (i = 0; i < 6; i++) {
        var a = i * 60 * Math.PI / 180;
        s += '<ellipse cx="' + (50 + Math.cos(a) * 34).toFixed(1) + '" cy="' + (50 + Math.sin(a) * 34).toFixed(1) + '" rx="22" ry="14" fill="#fff" opacity=".09" transform="rotate(' + (i * 60) + ' ' + (50 + Math.cos(a) * 34).toFixed(1) + ' ' + (50 + Math.sin(a) * 34).toFixed(1) + ')"/>';
      }
    }
    return s;
  }
  function accessory(a, h2) {
    var i = a % 5;
    if (i === 0) return '';
    if (i === 1) return '<path d="M16 30q34-26 68 0" stroke="#fff" stroke-width="6" fill="none" opacity=".9" stroke-linecap="round"/><circle cx="50" cy="14" r="5" fill="hsl(' + h2 + ',95%,70%)"/>';
    if (i === 2) return '<path d="M18 26l14 20l18-16z" fill="#fff" opacity=".92"/><path d="M82 26l-14 20l-18-16z" fill="#fff" opacity=".55"/>';
    if (i === 3) return '<rect x="30" y="16" width="40" height="10" rx="5" fill="#fff" opacity=".92"/><rect x="46" y="12" width="8" height="18" rx="4" fill="#fff" opacity=".92"/>';
    return '<circle cx="50" cy="15" r="9" fill="#fff" opacity=".92"/><circle cx="50" cy="15" r="4.5" fill="hsl(' + h2 + ',90%,62%)"/>';
  }
  function svg(a, size, extraClass) {
    if (!a) return '';
    a = typeof a === 'string' ? JSON.parse(a) : a;
    var seed = (a.seed || 1) / 100 + 1;
    var h1 = a.hue || 200, h2 = a.hue2 || ((a.hue || 200) + 60) % 360;
    var style = (a.style || 0) % 6, f = (a.face || 0) % 5;
    var dark = (a.hue > 200 && a.hue < 260);
    var id = 'av' + (a.seed || 0) + '_' + Math.random().toString(36).slice(2, 6);
    return '<svg viewBox="0 0 100 100" width="' + (size || 48) + '" height="' + (size || 48) + '" class="' + (extraClass || '') + '">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="hsl(' + h1 + ',88%,66%)"/><stop offset="1" stop-color="hsl(' + h2 + ',78%,46%)"/>' +
      '</linearGradient><clipPath id="c' + id + '"><circle cx="50" cy="50" r="50"/></clipPath></defs>' +
      '<g clip-path="url(#c' + id + ')"><rect width="100" height="100" fill="url(#' + id + ')"/>' +
      deco(style, seed, h1, h2) +
      '<ellipse cx="50" cy="54" rx="31" ry="30" fill="#fff" opacity="' + (0.13 + rnd(seed, 3) * 0.10).toFixed(2) + '"/>' +
      faces(f, dark) + accessory(a.acc || 0, h2) +
      '</g>' + (a.ring === 1 ? '<circle cx="50" cy="50" r="47" fill="none" stroke="#fff" stroke-width="3.5" opacity=".85"/>' : '') +
      '</svg>';
  }
  function el(a, size) {
    var d = document.createElement('div');
    d.innerHTML = svg(a, size);
    return d.firstChild;
  }
  return { svg: svg, el: el };
})();
