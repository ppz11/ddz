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
  /* ===================== 用户导入的表情包 =====================
   * 支持两种来源：
   *   1) 直接选多张图片 → 自动打包成一组
   *   2) 上传 JSON 配置 → 网上下载的通用表情包格式
   *      { "name":"包名", "items":[ {"name":"笑","url":"https://..."} ] }
   *      也兼容 "stickers" / "list" 作为 items 的别名
   * 导入后存 localStorage，并把新包设为默认，方便马上使用。
   * ============================================================ */
  var LS_KEY = 'ddz_sticker_packs', LS_DEF = 'ddz_sticker_default', LS_BIG = 'ddz_sticker_big';
  var USER_PACKS = [];
  var DEFAULT_PACK = '';

  var BIG = false;
  function isBig() { return BIG; }
  function setBig(v) { BIG = !!v; try { localStorage.setItem(LS_BIG, BIG ? '1' : '0'); } catch (e) { } }

  function loadPacks() {
    try {
      USER_PACKS = JSON.parse(localStorage.getItem(LS_KEY) || '[]') || [];
    } catch (e) { USER_PACKS = []; }
    try { BIG = localStorage.getItem(LS_BIG) === '1'; } catch (e) { BIG = false; }
    try { DEFAULT_PACK = localStorage.getItem(LS_DEF) || ''; } catch (e) { DEFAULT_PACK = ''; }
    if (DEFAULT_PACK && !packById(DEFAULT_PACK)) DEFAULT_PACK = '';
    if (!DEFAULT_PACK && USER_PACKS.length) DEFAULT_PACK = USER_PACKS[0].id;
  }
  function savePacks() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(USER_PACKS));
      localStorage.setItem(LS_DEF, DEFAULT_PACK || '');
    } catch (e) { }
  }
  function packById(id) {
    for (var i = 0; i < USER_PACKS.length; i++) if (USER_PACKS[i].id === id) return USER_PACKS[i];
    return null;
  }
  function newId() { return 'up' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* 新增一包，并把它设为默认（用户要求：新增的作为默认表情包） */
  function addPack(name, items, cb) {
    items = (items || []).filter(Boolean);
    if (!items.length) { cb && cb('没有可用的表情'); return null; }
    var pk = { id: newId(), name: String(name || '我的表情').slice(0, 20), items: items, ts: Date.now() };
    USER_PACKS.push(pk);
    DEFAULT_PACK = pk.id;                 // 新增即默认
    savePacks();
    cb && cb(null, pk);
    return pk;
  }
  function removePack(id) {
    USER_PACKS = USER_PACKS.filter(function (x) { return x.id !== id; });
    if (DEFAULT_PACK === id) DEFAULT_PACK = USER_PACKS.length ? USER_PACKS[0].id : '';
    savePacks();
  }
  function setDefault(id) { DEFAULT_PACK = id; savePacks(); }

  /* ---------- 动态表情识别 ----------
   * GIF / APNG / 动态 WebP 一律不压缩：canvas 绘制只会留下第一帧，动图会变死图。
   * 判断方式直接读文件字节，不依赖浏览器解码。 */
  function isAnimated(file, buf, cb) {
    var t = String(file.type || '').toLowerCase();
    var nm = String(file.name || '').toLowerCase();
    if (t === 'image/gif' || /\.gif$/.test(nm)) return cb(true);
    if (t === 'image/apng') return cb(true);
    var fr = new FileReader();
    fr.onload = function () {
      var b = new Uint8Array(fr.result || new ArrayBuffer(0));
      if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50) {
        for (var i = 8; i + 4 <= b.length - 4; i++) {
          var tag = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
          if (tag === 'IDAT') break;
          if (tag === 'acTL') return cb(true);
        }
        return cb(false);
      }
      var head = '';
      for (var j = 0; j < Math.min(b.length, 64); j++) head += String.fromCharCode(b[j]);
      if (head.indexOf('RIFF') === 0 && head.indexOf('WEBP') === 8) {
        var all = '';
        for (var k = 0; k < Math.min(b.length, 4096); k++) all += String.fromCharCode(b[k]);
        return cb(all.indexOf('ANIM') >= 0 || all.indexOf('ANMF') >= 0);
      }
      cb(false);
    };
    fr.onerror = function () { cb(false); };
    fr.readAsArrayBuffer(file.slice(0, 4096));
  }
  /* 动图原样存：只做体积上限保护，绝不走 canvas */
  var ANIM_MAX = 2.5 * 1024 * 1024;
  function keepOriginal(file, cb) {
    if (file.size > ANIM_MAX) { cb(null, '动图超过 2.5MB，请换小一点的'); return; }
    var fr = new FileReader();
    fr.onload = function () { cb(String(fr.result), null); };
    fr.onerror = function () { cb(null, '读取失败'); };
    fr.readAsDataURL(file);
  }

  /* 图片压缩到 160px 再存，避免 localStorage 被几十张大图撑爆 */
  function shrink(file, max, cb) {
    max = max || 160;
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var sc = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        try { cb(cv.toDataURL('image/png')); } catch (e) { cb(null); }
      };
      img.onerror = function () { cb(null); };
      img.src = fr.result;
    };
    fr.onerror = function () { cb(null); };
    fr.readAsDataURL(file);
  }

  /* 从一组图片文件建包：动图原样保留，静图压缩 */
  function fromFiles(files, cb) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return f && (/^image\//.test(f.type) || /\.(gif|png|webp|jpg|jpeg)$/i.test(f.name || ''));
    });
    if (!list.length) { cb && cb('请选择图片文件'); return; }
    var items = [], done = 0, animCnt = 0, note = '';
    list.forEach(function (f, i) {
      var nm = (f.name || '').replace(/\.[^.]+$/, '').slice(0, 12);
      isAnimated(f, null, function (anim) {
        var finish = function (url, err) {
          done++;
          if (url) {
            items.push({ id: 'i' + i, name: nm, url: url, anim: !!anim,
                         mime: (f.type || (anim ? 'image/gif' : 'image/png')) });
            if (anim) animCnt++;
          } else if (err) note = err;
          if (done === list.length) {
            items.sort(function (a, b) { return a.id > b.id ? 1 : -1; });
            var pn = list.length > 1 ? ('导入表情(' + items.length + ')') : (items[0] && items[0].name);
            addPack(pn, items, function (e, pk) {
              cb && cb(note || e, pk, animCnt);
            });
          }
        };
        if (anim) keepOriginal(f, finish);
        else shrink(f, 160, function (u) { finish(u, u ? null : '图片读取失败'); });
      });
    });
  }

  /* 从 JSON 配置建包：兼容几种常见写法 */
  function fromJSON(text, cb) {
    var o = null;
    try { o = JSON.parse(text); } catch (e) { cb && cb('不是合法的 JSON 文件'); return; }
    if (!o || typeof o !== 'object') { cb && cb('配置内容为空'); return; }
    var name = o.name || o.title || o.pack || '导入表情';
    var raw = o.items || o.stickers || o.list || o.emojis || (Array.isArray(o) ? o : null);
    if (!Array.isArray(raw)) { cb && cb('配置里没有表情列表'); return; }
    var items = [];
    raw.forEach(function (x, i) {
      if (typeof x === 'string') {
        items.push({ id: 'j' + i, name: '', url: x, anim: /^data:image\/gif|\.gif(\?|$)/i.test(x) });
        return;
      }
      if (x && (x.url || x.src || x.image || x.file)) {
        var u = x.url || x.src || x.image || x.file;
        items.push({ id: x.id || ('j' + i), name: x.name || x.title || '', url: u,
                     anim: (x.anim !== undefined ? !!x.anim : /^data:image\/(gif|apng)|\.gif(\?|$)/i.test(u)) });
      }
    });
    if (!items.length) { cb && cb('没解析出任何表情'); return; }
    addPack(name, items, cb);
  }

  /* 取某一包里某个表情的可显示内容 */
  function packItemHTML(id, idx) {
    var pk = packById(id); if (!pk) return '';
    var it = pk.items[idx]; if (!it) return '';
    return '<img src="' + it.url + '" alt="' + (it.name || '') + '">';
  }
  /* 整包预览（用于面板列表） */
  function packThumb(id) {
    var pk = packById(id); if (!pk || !pk.items.length) return '';
    return '<img src="' + pk.items[0].url + '">';
  }

  /* dataURL → File，便于走上传接口把表情发给对方 */
  function dataURLtoFile(url, name, mime) {
    try {
      var a = url.split(',');
      mime = mime || (a[0].match(/:(.*?);/) || [])[1] || 'image/png';
      var bin = atob(a[1] || ''), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new File([arr], name || 'sticker.png', { type: mime });
    } catch (e) { return null; }
  }

  /* 导入界面：选图片 / 上传 JSON，并管理已导入的包 */
  function openImport(onPick) {
    var box = document.createElement('div');
    box.className = 'modal'; box.id = 'stk-import';
    function packsHTML() {
      if (!USER_PACKS.length) return '<div style="text-align:center;color:var(--sub);font-size:12px;padding:10px 0">还没有导入的表情包</div>';
      return USER_PACKS.map(function (pk) {
        var on = (pk.id === DEFAULT_PACK) ? ' on' : '';
        return '<div class="spk' + on + '" data-id="' + pk.id + '">' +
          '<div class="th"><img src="' + pk.items[0].url + '"></div>' +
          '<div class="nm">' + (pk.name || '我的表情') + '（' + pk.items.length + '）</div>' +
          '<div class="op"><button data-a="def">设为默认</button><button data-a="del">删除</button></div></div>';
      }).join('');
    }
    function gridHTML() {
      var pk = packById(DEFAULT_PACK);
      if (!pk) return '<div style="text-align:center;color:var(--sub);font-size:12px;padding:14px 0">先导入一个表情包</div>';
      return pk.items.map(function (it, i) {
        return '<button class="stk" data-i="' + i + '">' +
          '<img src="' + it.url + '" alt="' + (it.name || '') + '">' +
          (it.anim ? '<span class="gif">GIF</span>' : '') + '</button>';
      }).join('');
    }
    box.innerHTML = '<div class="box" style="max-width:340px">' +
      '<h3>表情包</h3>' +
      '<p style="margin-bottom:8px">导入后自动设为默认<br>' +
      '<span style="font-size:11px;opacity:.75">支持多选图片，或上传 JSON 配置</span></p>' +
      '<div class="row" style="margin-bottom:10px">' +
      '<button class="btn" id="sk-img">选图片</button>' +
      '<button class="btn" id="sk-json">上传配置</button>' +
      '<button class="btn' + (BIG ? ' jade' : '') + '" id="sk-big">大图</button></div>' +
      '<div class="spk-list" id="sk-list" style="max-height:22vh;overflow-y:auto;-webkit-overflow-scrolling:touch">' +
      packsHTML() + '</div>' +
      '<div class="sk-grid" id="sk-grid" style="margin-top:10px;max-height:34vh;overflow-y:auto;-webkit-overflow-scrolling:touch">' +
      gridHTML() + '</div>' +
      '<div class="row" style="margin-top:12px"><button class="btn ghost" id="sk-close">关闭</button></div></div>';
    document.body.appendChild(box);

    /* 挂在弹窗内部并给固定 id：挂到 body 上会和聊天页的图片选择框撞车，
       导致选了图却导入不进去。 */
    var fi = document.createElement('input');
    fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true; fi.style.display = 'none';
    fi.id = 'sk-fi';
    var fj = document.createElement('input');
    fj.type = 'file'; fj.accept = '.json,application/json'; fj.style.display = 'none';
    fj.id = 'sk-fj';
    box.appendChild(fi); box.appendChild(fj);

    fi.onchange = function () {
      fromFiles(fi.files, function (err, pk) {
        fi.value = '';
        if (err) { (window.App && App.toast) ? App.toast(err) : 0; return; }
        refresh();
        (window.App && App.toast) && App.toast('已导入，并设为默认');
      });
    };
    fj.onchange = function () {
      var f = fj.files && fj.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        fj.value = '';
        fromJSON(String(fr.result), function (err, pk) {
          if (err) { (window.App && App.toast) ? App.toast(err) : 0; return; }
          refresh();
          (window.App && App.toast) && App.toast('已导入，并设为默认');
        });
      };
      fr.readAsText(f);
    };

    function refresh() {
      var l = box.querySelector('#sk-list'); if (l) l.innerHTML = packsHTML();
      var g = box.querySelector('#sk-grid'); if (g) { g.innerHTML = gridHTML(); g.classList.toggle('big', BIG); }
      bindList(); bindGrid();
    }
    var skRefresh = refresh;
    function bindList() {
      box.querySelectorAll('.spk').forEach(function (el) {
        el.querySelectorAll('.op button').forEach(function (b) {
          b.onclick = function (e) {
            e.stopPropagation();
            var id = el.dataset.id;
            if (b.dataset.a === 'def') { setDefault(id); refresh(); }
            else { removePack(id); refresh(); }
          };
        });
        el.onclick = function () { setDefault(el.dataset.id); refresh(); };
      });
    }
    function bindGrid() {
      box.querySelectorAll('.stk').forEach(function (b) {
        var tm = null, moved = false;
        var fire = function () {
          var pk = packById(DEFAULT_PACK); if (!pk) return;
          var it = pk.items[+b.dataset.i]; if (!it) return;
          onPick && onPick(dataURLtoFile(it.url, (it.name || 'sticker') + (it.anim ? '.gif' : '.png'), it.mime), pk, it);
          close();
        };
        b.onclick = function () { if (moved) { moved = false; return; } fire(); };
        /* 长按 → 大图预览：先看清楚再决定发不发 */
        b.addEventListener('touchstart', function () {
          moved = false; tm = setTimeout(function () { moved = true; preview(b.querySelector('img').src); }, 420);
        }, { passive: true });
        b.addEventListener('touchend', function () { clearTimeout(tm); }, { passive: true });
        b.addEventListener('touchmove', function () { clearTimeout(tm); }, { passive: true });
        b.addEventListener('contextmenu', function (e) { e.preventDefault(); preview(b.querySelector('img').src); });
      });
    }
    /* 大图预览浮层：点任意处关闭 */
    function preview(src) {
      var ov = document.createElement('div');
      ov.className = 'stk-preview';
      ov.innerHTML = '<img src="' + src + '">';
      ov.onclick = function () { ov.remove(); };
      document.body.appendChild(ov);
    }
    function close() { box.remove(); }
    box.querySelector('#sk-big').onclick = function () {
      setBig(!BIG);
      box.querySelector('#sk-big').className = 'btn' + (BIG ? ' jade' : '');
      skRefresh();
    };
    box.querySelector('#sk-img').onclick = function () { fi.click(); };
    box.querySelector('#sk-json').onclick = function () { fj.click(); };
    box.querySelector('#sk-close').onclick = close;
    box.onclick = function (e) { if (e.target === box) close(); };
    bindList(); bindGrid();
  }

  loadPacks();

  return {
    PACK_FACE: PACK_FACE, PACK_OBJ: PACK_OBJ, EMOJI: EMOJI,
    svgOf: svgOf, render: render, html: html,
    /* 导入相关 */
    get packs() { return USER_PACKS; },
    get defaultId() { return DEFAULT_PACK; },
    addPack: addPack, removePack: removePack, setDefault: setDefault,
    fromFiles: fromFiles, fromJSON: fromJSON, packById: packById,
    packItemHTML: packItemHTML, packThumb: packThumb, reload: loadPacks,
    openImport: openImport, dataURLtoFile: dataURLtoFile,
    isBig: isBig, setBig: setBig
  };
})();
