/* ============================================================
 *  斗地主 · 服务端
 *  HTTP：静态站点 / 账号 / 上传 / 战绩
 *  WS  ：实时对战（2人·3人·人机）/ 大厅 / 私信 / 语音 / 私密空间
 * ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const store = require('./store');
const ID = require('./identity');
const DDZ = require('../shared/engine.js');
const AI = require('../shared/ai.js');
const ADS = require('../shared/ads.js');

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, '..', 'public');
const SHARED = path.join(__dirname, '..', 'shared');
/* 把任意文件名压成 header 安全的 ASCII 形式。
   - 非 ASCII（中文/emoji 等）→ '_'
   - 引号、反斜杠、控制字符 → '_'（防 header 注入）
   - 保留后缀，下载时仍是可用的文件名 */
function asciiName(nm) {
  var s = String(nm || 'file');
  var dot = s.lastIndexOf('.');
  var stem = dot > 0 ? s.slice(0, dot) : s;
  var ext = dot > 0 ? s.slice(dot) : '';
  stem = stem.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  ext = ext.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '');
  if (stem.length > 60) stem = stem.slice(0, 60);
  if (!stem) stem = 'file';
  return stem + ext;
}

const MAX_UPLOAD = 300 * 1024 * 1024;

/* ============================================================
 *  TURN 中继（语音 / 视频通话跨网络必备）
 *
 *  为什么必须有：STUN 只能帮双方「打洞」，遇到下面几种网络就穿不过去 ——
 *    · 4G/5G 的运营商 CGNAT（几乎都是对称型 NAT）
 *    · 公司 / 校园网的严格防火墙
 *    · 一方 WiFi、一方流量（最常见的失败场景）
 *  这时媒体流必须经 TURN 服务器中转，否则就是「能拨通但黑屏 / 没声音」。
 *
 *  配置方式（三选一，配了就生效，没配就只走 STUN）：
 *    export TURN_SECRET=xxx        # coturn 的 static-auth-secret（推荐，临时凭证）
 *    export TURN_URLS=turn:1.2.3.4:3478
 *  或者用静态账号：
 *    export TURN_USER=ddz  TURN_PASS=xxx  TURN_URLS=turn:...
 * ============================================================ */
const TURN_SECRET = process.env.TURN_SECRET || '';
const TURN_USER = process.env.TURN_USER || '';
const TURN_PASS = process.env.TURN_PASS || '';
let TURN_URLS = (process.env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
let TURN_HOST = '';                    // 未显式配置时按请求来源推断
function guessTurnHost(req) {
  try {
    var h = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
    if (!h || h === 'localhost' || h === '127.0.0.1') return '';
    return h;
  } catch (e) { return ''; }
}
function iceConfig(req) {
  var ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  var urls = TURN_URLS.slice();
  if (!urls.length) {
    var host = TURN_HOST || guessTurnHost(req);
    if (host) urls = ['turn:' + host + ':3478', 'turn:' + host + ':3478?transport=tcp'];
  }
  if (!urls.length) return { iceServers: ice, relay: false };
  var cred;
  if (TURN_SECRET) {
    // 临时凭证（coturn use-auth-secret）：用户名 = 过期时间戳:标识，密码 = HMAC-SHA1
    var ttl = 24 * 3600;
    var user = Math.floor(Date.now() / 1000 + ttl) + ':ddz';
    var pass = crypto.createHmac('sha1', TURN_SECRET).update(user).digest('base64');
    cred = { username: user, credential: pass };
  } else if (TURN_USER && TURN_PASS) {
    cred = { username: TURN_USER, credential: TURN_PASS };
  } else {
    return { iceServers: ice, relay: false };
  }
  ice.push({ urls: urls, username: cred.username, credential: cred.credential });
  return { iceServers: ice, relay: true };
}

store.ensure();
const db = store.get();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.zip': 'application/zip'
};
function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}
function body(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => {
      n += c.length;
      if (n > (limit || MAX_UPLOAD)) { reject(new Error('TOO_BIG')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const uid = () => 'u' + crypto.randomBytes(5).toString('hex');
const tok = () => crypto.randomBytes(12).toString('hex');
const mid = () => 'm' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

/* ---------------- 账号 ---------------- */
/* ---------- 真人身份（pid）：同一台手机 = 同一个人 ----------
   私密空间按 pid 建会话：无论这个真人换了哪个随机 ID，
   在好友空间里始终是同一个固定的人、同一个会话。 */
function personOf(u) {
  if (!db.persons) db.persons = {};
  let p = u.pid && db.persons[u.pid];
  if (!p && u.device) {
    p = Object.values(db.persons).find(x => (x.devices || []).indexOf(u.device) >= 0);
  }
  if (!p) {
    p = { pid: 'p' + crypto.randomBytes(5).toString('hex'), nick: ID.nick(), avatar: ID.avatar(),
          devices: [], uids: [], locOn: false, loc: null, coins: randomCoins() };
    db.persons[p.pid] = p;
  }
  if (p.locOn === undefined) p.locOn = false;
  if (p.loc === undefined) p.loc = null;
  if (typeof p.coins !== 'number') p.coins = randomCoins();
  /* 兜底：老数据或手动构造的 person 可能缺这两个数组，
     缺了会在下面 indexOf 时直接抛错（表现为服务端 500 / 列表拉不出来） */
  if (!Array.isArray(p.uids)) p.uids = [];
  if (!Array.isArray(p.devices)) p.devices = [];
  if (u.pid !== p.pid) { u.pid = p.pid; }
  if (u.device && p.devices.indexOf(u.device) < 0) p.devices.push(u.device);
  if (p.uids.indexOf(u.uid) < 0) p.uids.push(u.uid);
  store.save();
  return p;
}
const pubPerson = p => ({ pid: p.pid, nick: p.nick, avatar: p.avatar, locOn: !!p.locOn });

/* ------------------------- */

/* 初始金币：几千左右随机 */
const COIN_MIN = 2000, COIN_MAX = 8000;
function randomCoins() { return Math.round((COIN_MIN + Math.random() * (COIN_MAX - COIN_MIN)) / 10) * 10; }

/* 固定测试号 666888：昵称头像长期不变，方便两台设备对照调试 */
const TEST_ID = '666888';
function ensureTestUser() {
  let u = db.users[TEST_ID];
  if (!u) {
    u = { uid: TEST_ID, token: tok(), device: 'test', createdAt: Date.now(), lastLogin: Date.now(),
          cur: null, test: true, coins: randomCoins() };
    db.users[TEST_ID] = u;
    refreshIdentity(u, true);
    personOf(u);
    u.coins = coinsOf(u);
    store.save();
  }
  return u;
}
ensureTestUser();

function createUser(device) {
  const u = { uid: uid(), token: tok(), device: device || '', createdAt: Date.now(), lastLogin: Date.now(), cur: null, coins: randomCoins() };
  db.users[u.uid] = u;
  refreshIdentity(u);
  personOf(u);
  u.coins = coinsOf(u);
  store.save();
  return u;
}
/* 测试号每次登录保持同一昵称头像；普通号每次登录换新昵称新头像 */
function refreshIdentity(u, keep) {
  if (keep && u.cur) { u.lastLogin = Date.now(); store.save(); return; }
  u.cur = { nick: ID.nick(), avatar: ID.avatar() }; u.lastLogin = Date.now(); store.save();
}
/* 金币挂在「人」上：换随机 ID / 重装后只要是同一个人，金币不清零 */
function coinsOf(u) {
  const p = u ? personOf(u) : null;
  if (!p) return 0;
  if (typeof p.coins !== 'number') p.coins = randomCoins();
  return p.coins;
}
function addCoins(u, d) {
  const p = personOf(u);
  if (typeof p.coins !== 'number') p.coins = (typeof u.coins === 'number' ? u.coins : randomCoins());
  p.coins = Math.max(0, p.coins + d);
  if (u) u.coins = p.coins;      // 镜像，便于旧逻辑读取
  store.save();
  return p.coins;
}
function userByToken(t) {
  if (!t) return null;
  for (const k in db.users) if (db.users[k].token === t) return db.users[k];
  return null;
}
const pub = u => ({ uid: u.uid, nick: u.cur.nick, avatar: u.cur.avatar, coins: coinsOf(u) | 0, test: !!u.test });
/* 战绩同一真人共享：随机 ID 变了也照样能看到 */
function myGames(u) {
  const pid = personOf(u).pid;
  return db.games.filter(g =>
    (g.players || []).indexOf(u.uid) >= 0 || (g.pids || []).indexOf(pid) >= 0
  ).sort((a, b) => b.ts - a.ts).slice(0, 200).map(g => {
    // 换号后 uid 可能已不在本局名单里，回退到按「人」匹配座位
    let seat = (g.players || []).indexOf(u.uid);
    if (seat < 0) seat = (g.pids || []).indexOf(pid);
    return Object.assign({}, g, { mySeat: seat, minePid: pid });
  });
}

/* ---------------- 机器人 ---------------- */
function makeBot() {
  const b = { uid: 'b' + crypto.randomBytes(4).toString('hex'), bot: true, cur: { nick: ID.nick(), avatar: ID.avatar() } };
  return b;
}
const pubOf = s => s ? { uid: s.uid, nick: s.cur.nick, avatar: s.cur.avatar, bot: !!s.bot } : null;

/* ---------------- HTTP ---------------- */
/* CORS：App 里页面跑在 https://localhost（Capacitor 源），请求 http://服务器:8080 属于跨域。
   POST + Content-Type: application/json 会触发 OPTIONS 预检，
   服务器必须明确允许，否则浏览器直接报 Failed to fetch（而 GET /api/health 却能通，就是这个原因）。 */
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  applyCors(req, res);
  // 预检请求直接返回，不进入业务逻辑
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (p === '/api/health') return json(res, 200, { ok: true, users: Object.keys(db.users).length, ts: Date.now() });
    /* 语音/视频通话的 ICE 配置：带 TURN 中继才能保证跨网络（WiFi↔4G）也能连通 */
    if (p === '/api/ice') { var ic = iceConfig(req); return json(res, 200, { ok: true, relay: ic.relay, iceServers: ic.iceServers }); }
    if (p === '/api/register' && req.method === 'POST') {
      const b = JSON.parse((await body(req, 4096)).toString() || '{}');
      /* 一台手机 = 一个账号：同一 device 再次注册时复用原有 uid，
         重装、退出登录、清缓存后回来仍是同一个人，聊天/战绩/私密空间都还在 */
      const dev = String(b.device || '').trim();
      let u = dev ? Object.values(db.users).find(x => x.device === dev && !x.bot && !x.test) : null;
      if (!u) u = createUser(dev);
      else { u.lastLogin = Date.now(); personOf(u); u.coins = coinsOf(u); store.save(); }
      return json(res, 200, { uid: u.uid, token: u.token, me: pub(u), coins: u.coins | 0 });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const b = JSON.parse((await body(req, 4096)).toString() || '{}');
      const u = userByToken(b.token);
      if (!u) return json(res, 401, { err: '登录已失效，请重新进入' });
      refreshIdentity(u, u.test); personOf(u); u.coins = coinsOf(u);
      return json(res, 200, { uid: u.uid, token: u.token, me: pub(u), coins: u.coins | 0 });
    }
    if (p === '/api/loginbyid' && req.method === 'POST') {
      const b = JSON.parse((await body(req, 4096)).toString() || '{}');
      const id = String(b.id || '').trim();
      const u = (id === TEST_ID) ? ensureTestUser() : db.users[id];
      if (!u) return json(res, 404, { err: '该 ID 不存在' });
      refreshIdentity(u, !!u.test); personOf(u); u.coins = coinsOf(u);
      return json(res, 200, { uid: u.uid, token: u.token, me: pub(u), coins: u.coins | 0 });
    }
    if (p === '/api/me') {
      const u = userByToken(url.searchParams.get('token'));
      return u ? json(res, 200, { me: pub(u) }) : json(res, 401, { err: 'no' });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString() || '{}');
      if (!b.data) return json(res, 400, { err: 'empty' });
      const buf = Buffer.from(b.data, 'base64');
      if (buf.length > MAX_UPLOAD) return json(res, 413, { err: '文件太大（上限 300MB）' });
      const rec = store.putUpload(b.name || 'file', b.mime || 'application/octet-stream', buf, { kind: b.kind, dur: b.dur });
      return json(res, 200, { id: rec.id, url: '/api/file/' + rec.id, name: rec.name, size: rec.size, mime: rec.mime });
    }
    /* 文件服务：必须支持 HTTP Range（206 Partial Content）。
       Android WebView / Chrome 的音视频播放器会先发 Range 请求，
       服务器不支持 206 时，语音听不了、视频播不动 —— 此前就是缺这一块。
       另外：?dl=1 时用 attachment 触发下载/保存。 */
    if (p.startsWith('/api/file/')) {
      const rec = store.getUpload(p.slice('/api/file/'.length));
      if (!rec) return json(res, 404, { err: 'not found' });
      const fp = store.uploadPath(rec);
      let size = 0;
      try { size = fs.statSync(fp).size; } catch (e) { return json(res, 404, { err: '文件已失效' }); }
      let mime = rec.mime || 'application/octet-stream';
      // 语音/视频统一按「后缀对应的真实容器类型」返回。
      // 关键：m4a 是 AAC 装在 MP4 容器里，必须返回 audio/mp4；
      //      之前统一成 audio/mpeg(MP3) 会让 Chromium 解码失败 → 语音听不了。
      const nm = String(rec.name || '').toLowerCase();
      const audioByExt = /\.(mp3)$/.test(nm) ? 'audio/mpeg'
        : /\.(m4a|aac)$/.test(nm) ? 'audio/mp4'
        : /\.(ogg|opus)$/.test(nm) ? 'audio/ogg'
        : /\.(wav)$/.test(nm) ? 'audio/wav'
        : /\.(amr)$/.test(nm) ? 'audio/amr'
        : /\.(webm)$/.test(nm) ? 'audio/webm'
        : /\.(3gp)$/.test(nm) ? 'audio/3gpp'
        : '';
      const videoByExt = /\.(mp4|m4v|mov)$/.test(nm) ? 'video/mp4'
        : /\.(webm)$/.test(nm) ? 'video/webm'
        : /\.(mkv)$/.test(nm) ? 'video/x-matroska'
        : /\.(avi)$/.test(nm) ? 'video/x-msvideo'
        : /\.(3gp)$/.test(nm) ? 'video/3gpp'
        : '';
      /* 图片同样要按后缀兜底。
         真机（尤其是相机拍完直接发、或从相册拿到的文件）常有 type 为空的情况，
         上传时记下来的 mime 就是 application/octet-stream ——
         WebView 收到这个类型会直接拒绝渲染 <img>，表现就是「图片加载失败」。 */
      const imageByExt = /\.(png)$/.test(nm) ? 'image/png'
        : /\.(jpe?g)$/.test(nm) ? 'image/jpeg'
        : /\.(gif)$/.test(nm) ? 'image/gif'
        : /\.(webp)$/.test(nm) ? 'image/webp'
        : /\.(bmp)$/.test(nm) ? 'image/bmp'
        : /\.(heic|heif)$/.test(nm) ? 'image/heic'
        : /\.(svg)$/.test(nm) ? 'image/svg+xml'
        : '';
      // webm / 3gp 既可能是音频也可能是视频 → 用上传时的 kind 来定
      const kind = String((rec.meta && rec.meta.kind) || '');
      const isVoice = (kind === 'voice');
      const isVideo = (kind === 'video');
      if (isVoice && audioByExt) mime = audioByExt;
      else if (isVideo && videoByExt) mime = videoByExt;
      else if (imageByExt) mime = imageByExt;
      else if (videoByExt && !audioByExt) mime = videoByExt;
      else if (audioByExt) mime = audioByExt;
      else if (videoByExt) mime = videoByExt;
      const dl = url.searchParams.get('dl') === '1';
      /* Content-Disposition 里不能直接放中文。
         Node 的 header 值只接受 latin1，遇到「不得不夸下我老公了.docx」这种名字会直接抛
         "Invalid character in header content" —— 表现就是点下载/打开弹一段 JSON 报错。
         做法：filename= 只放 ASCII 安全版本（中文和特殊符号换成 _），
               真名通过 filename*=UTF-8''<urlencode> 给（浏览器/下载器都认这个）。 */
      const disp = (dl ? 'attachment' : 'inline')
        + '; filename="' + asciiName(rec.name) + '"; filename*=UTF-8\'\'' + encodeURIComponent(rec.name || 'file');
      const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Disposition': disp };
      const range = req.headers.range;
      if (range) {
        const m2 = /bytes=(\d*)-(\d*)/.exec(range);
        if (m2) {
          let start = m2[1] ? parseInt(m2[1], 10) : 0;
          let end = m2[2] ? parseInt(m2[2], 10) : size - 1;
          if (isNaN(start)) start = 0;
          if (isNaN(end) || end >= size) end = size - 1;
          if (start > end || start >= size) {
            res.writeHead(416, Object.assign({}, base, { 'Content-Range': 'bytes */' + size }));
            return res.end();
          }
          res.writeHead(206, Object.assign({}, base, {
            'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
            'Content-Length': end - start + 1
          }));
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(fp, { start: start, end: end }).pipe(res);
        }
      }
      res.writeHead(200, Object.assign({}, base, { 'Content-Length': size }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(fp).pipe(res);
    }
    if (p === '/api/history') {
      const u = userByToken(url.searchParams.get('token'));
      if (!u) return json(res, 401, { err: 'no' });
      return json(res, 200, { list: myGames(u) });
    }
    if (p === '/api/history/clear' && req.method === 'POST') {
      const u = userByToken(url.searchParams.get('token'));
      if (!u) return json(res, 401, { err: 'no' });
      const pid = personOf(u).pid;
      db.games = db.games.filter(g =>
        (g.players || []).indexOf(u.uid) < 0 && (g.pids || []).indexOf(pid) < 0);
      store.save();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/coins') {
      const u = userByToken(url.searchParams.get('token'));
      if (!u) return json(res, 401, { err: 'no' });
      return json(res, 200, { coins: coinsOf(u) | 0 });
    }
    if (p === '/api/ads') return json(res, 200, { list: ADS.ALL });

    let file = null;
    if (p === '/' || p === '/index.html') file = path.join(PUBLIC, 'index.html');
    else if (p.startsWith('/shared/')) file = path.join(SHARED, path.basename(p));
    else file = path.join(PUBLIC, p.replace(/^\/+/, ''));
    if (!file.startsWith(PUBLIC) && !file.startsWith(SHARED)) return json(res, 403, { err: 'no' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    const ext = path.extname(file).toLowerCase();
    const buf = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-cache' });
    res.end(buf);
  } catch (e) {
    console.error('[http]', e.message);
    try { json(res, 500, { err: e.message }); } catch (x) { }
  }
});

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server, maxPayload: 32 * 1024 * 1024 });
const clients = new Map();
const online = new Map();
const rooms = new Map();
const queue = [];
/* 通话状态：谁在通话中、谁在跟谁通话 */
const busy = new Set();
const callPeer = new Map();

const send = (ws, o) => { try { ws.send(JSON.stringify(o)); } catch (e) { } };

/* 大厅展示用的虚拟在线人数（几十万量级，缓慢波动） */
let FAKE_ONLINE = 260000 + Math.floor(Math.random() * 140000);
setInterval(() => {
  FAKE_ONLINE += Math.round((Math.random() - 0.45) * 12000);
  FAKE_ONLINE = Math.max(150000, Math.min(980000, FAKE_ONLINE));
}, 5000);
const sendTo = (u, o) => { const ws = online.get(u); if (ws) send(ws, o); };
function broadcastLobby() {
  const list = [...online.keys()].map(k => db.users[k]).filter(Boolean).map(pub);
  // 全体近期登录的真人玩家（供「邀请在线好友」使用，最多 80 人）
  const all = Object.values(db.users)
    .filter(x => !x.bot)
    .sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0))
    .slice(0, 80)
    .map(u => ({ ...pub(u), online: online.has(u.uid) }));
  clients.forEach((c, ws) => send(ws, { t: 'lobby', users: list, all: all, fakeOnline: FAKE_ONLINE }));
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  clients.set(ws, { u: null });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const st = clients.get(ws); if (!st) return;
    if (m.t !== 'auth' && !st.u) return send(ws, { t: 'err', msg: '未登录' });
    try { handle(ws, st, m); } catch (e) { console.error('[ws]', m.t, e.message); send(ws, { t: 'err', msg: '服务器开小差了' }); }
  });
  ws.on('close', () => {
    const st = clients.get(ws); clients.delete(ws);
    if (st && st.u) {
      online.delete(st.u.uid);
      busy.delete(st.u.uid); callPeer.delete(st.u.uid);
      for (const [k, v] of callPeer) if (v === st.u.uid) callPeer.delete(k);
      leaveRoom(st.u, true); broadcastLobby(); broadcastContacts();
    }
  });
});
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false; try { ws.ping(); } catch (e) { }
  });
}, 25000);

/* ---------------- 房间 ---------------- */
function seatCountOf(rule) { return DDZ.seatCount(rule === 'classic54' ? 'duo37' : rule); }
function newRoomId() { let s; do { s = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(s)); return s; }
function makeRoom(rule) {
  if (rule === 'classic54') rule = 'duo37';
  const gid = newRoomId();
  const n = seatCountOf(rule);
  const room = { gid, rule, n, seats: new Array(n).fill(null), game: null, ts: Date.now(), botTimers: [] };
  rooms.set(gid, room);
  return room;
}
function seatOf(room, u) { return room.seats.findIndex(s => s && s.uid === u.uid); }
function clearBotTimersOf(u) { const r = findRoom(u); if (r) clearBotTimers(r); }
function clearBotTimers(room) { (room.botTimers || []).forEach(t => clearTimeout(t)); room.botTimers = []; }
function leaveRoom(u, silent) {
  rooms.forEach((room, gid) => {
    const i = seatOf(room, u);
    if (i >= 0) {
      clearBotTimers(room);
      room.seats[i] = null;
      room.seats.forEach(s => { if (s && !s.bot) { const w = online.get(s.uid); if (w) send(w, { t: 'room:left', gid, who: u.uid }); } });
      if (room.seats.every(s => !s || s.bot)) rooms.delete(gid);
    }
  });
  const qi = queue.findIndex(q => q.u.uid === u.uid);
  if (qi >= 0) queue.splice(qi, 1);
}
function roomView(room) {
  return { gid: room.gid, rule: room.rule, n: room.n, seats: room.seats.map(pubOf), phase: room.game ? room.game.phase : 'wait' };
}
function pushRoom(room) {
  room.seats.forEach((s, i) => {
    if (!s || s.bot) return;
    const w = online.get(s.uid); if (!w) return;
    send(w, { t: 'room', ...roomView(room), you: i });
  });
}
function cardDTO(c) { return { id: c.id, r: c.r, s: c.s, v: c.v, red: c.red, joker: c.joker }; }
function gameView(g, seat, room) {
  const isOver = g.phase === 'over';
  const v = {
    rule: g.rule, n: g.seats, phase: g.phase, seat: seat,
    hand: g.hands[seat].map(cardDTO),
    counts: g.hands.map(h => h.length),
    landlord: g.landlord, turn: g.turn,
    bottom: g.phase === 'bid' ? null : g.bottom.map(cardDTO),
    deadCount: g.dead.length,
    dead: isOver ? g.dead.map(cardDTO) : null,
    openCard: cardDTO(g.openCard),
    bidTurn: g.bidTurn, firstBidder: g.firstBidder, bid: g.bid,
    doubleTurn: (g.phase === 'double') ? DDZ.doubleTurn(g) : -1,
    doubleSeats: g.doubleSeats || [], doubled: g.doubled || [],
    grabCount: g.grabCount, letCount: g.letCount, multiplier: g.multiplier,
    last: g.last ? { ids: g.last.ids, info: g.last.info, by: g.last.by, cards: g.last.cards.map(cardDTO) } : null,
    lastSeat: g.lastSeat.map(function (x) {
      if (!x) return null;
      if (x.pass) return { pass: true, by: x.by };
      return { info: x.info, by: x.by, cards: x.cards.map(cardDTO) };
    }),
    seats: room.seats.map(pubOf),
    result: g.result,
    farmerNeed: (g.rule === 'let46' && g.landlord >= 0 && g.phase === 'play')
      ? Math.max(0, g.hands[1 - g.landlord].length - g.letCount) : null
  };
  return v;
}
function pushGame(room) {
  const g = room.game; if (!g) return;
  room.seats.forEach((s, i) => {
    if (!s || s.bot) return;
    const w = online.get(s.uid); if (!w) return;
    send(w, { t: 'game', gid: room.gid, ...gameView(g, i, room) });
  });
}
function pushResult(room) {
  const g = room.game; if (!g) return;
  const delta = settleCoins(room);
  room.seats.forEach((s, i) => {
    if (!s || s.bot) return;
    const w = online.get(s.uid); if (!w) return;
    send(w, { t: 'result', gid: room.gid, seat: i, landlord: g.landlord, winner: g.winner, result: g.result,
      coinDelta: delta[s.uid] || 0, coins: s.coins | 0 });
  });
}

/* 机器人驱动 */
function scheduleBots(room) {
  clearBotTimers(room);
  const g = room.game; if (!g || g.phase === 'over') return;
  const seat = (g.phase === 'bid') ? g.bidTurn
    : (g.phase === 'double') ? DDZ.doubleTurn(g) : g.turn;
  const who = room.seats[seat];
  if (process.env.DDZ_DEBUG) console.log('[sched] seat', seat, 'isBot', !!(who && who.bot), 'phase', g.phase, 'seats', room.seats.map(x => x ? (x.bot ? 'BOT' : 'P') : '-').join(','));
  if (!who || !who.bot) return;
  const delay = AI.thinkTime(g, seat);
  const t = setTimeout(() => botAct(room, seat), delay);
  room.botTimers.push(t);
}
function botAct(room, seat) {
  const g = room.game; if (!g || g.phase === 'over') return;
  const who = room.seats[seat]; if (!who || !who.bot) return;
  try {
    if (g.phase === 'double') {
      // 机器人加倍策略：手牌越有把握越倾向加倍
      const strong = (g.hands[seat] || []).filter(c => c.v >= 15 || c.v === 14).length;
      const yes = strong >= 2 || (g.hands[seat] || []).some(c => c.v >= 16);
      DDZ.applyDouble(g, seat, yes);
      pushGame(room);
      scheduleBots(room);
      return;
    }
    if (g.phase === 'bid') {
      let act;
      if (g.rule === 'let46') act = g.landlord < 0 ? AI.bid(g, seat) : AI.grab(g, seat);
      else act = AI.bid(g, seat);
      const r = DDZ.applyBid(g, seat, act);
      if (r.redeal) {
        room.game = DDZ.newGame(room.rule);
        room.game.bidTurn = room.game.firstBidder;
        room.seats.forEach(s => { if (!s || !s.bot) return; const w = online.get(s.uid); if (w) send(w, { t: 'toast', msg: '无人叫地主，重新发牌' }); });
        pushGame(room); scheduleBots(room); return;
      }
      if (r.err) { console.error('[bot bid]', r.err, g.rule, JSON.stringify(act)); }
      pushGame(room);
    } else if (g.phase === 'play') {
      const a = AI.play(g, seat);
      const r = DDZ.applyPlay(g, seat, a.ids || []);
      if (r.err) { console.error('[bot play]', r.err); DDZ.applyPlay(g, seat, []); }
      pushGame(room);
      if (g.phase === 'over') { saveGame(room); pushResult(room); return; }
    }
  } catch (e) { console.error('[bot]', e.message); }
  scheduleBots(room);
}
/* 加倍阶段真人超时兜底：4 秒不做决定视为「不加倍」。
   没有这个兜底，一旦有人掉线/切后台，整桌都会卡在加倍界面。 */
const doubleTimers = new Map();
function clearDoubleTimer(gid) {
  const t = doubleTimers.get(gid);
  if (t) { clearTimeout(t); doubleTimers.delete(gid); }
}
function armDoubleTimeout(room) {
  clearDoubleTimer(room.gid);
  const g = room.game;
  if (!g || g.phase !== 'double') return;
  const seat = DDZ.doubleTurn(g);
  if (seat < 0) return;
  const who = room.seats[seat];
  if (!who || who.bot) return;                 // 机器人由 scheduleBots 驱动
  const t = setTimeout(() => {
    doubleTimers.delete(room.gid);
    if (!room.game || room.game.phase !== 'double') return;
    if (DDZ.doubleTurn(room.game) !== seat) return;
    DDZ.applyDouble(room.game, seat, false);
    pushGame(room);
    if (room.game.phase === 'double') { scheduleBots(room); armDoubleTimeout(room); }
    else scheduleBots(room);
  }, 4000);
  doubleTimers.set(room.gid, t);
}

function tryStart(room) {
  if (room.game) return;
  if (room.seats.every(s => s)) {
    room.game = DDZ.newGame(room.rule);
    room.game.bidTurn = room.game.firstBidder;
    pushGame(room);
    scheduleBots(room);
  }
}
/* 金币结算：底分 100 × 倍数；地主在三人场输赢翻倍 */
function settleCoins(room) {
  const g = room.game; if (!g || !g.result) return {};
  const base = 100 * (g.multiplier || 1);
  const delta = {};
  room.seats.forEach((s, i) => {
    if (!s || s.bot) return;
    if (typeof s.coins !== 'number') s.coins = randomCoins();
    const iAmLandlord = i === g.landlord;
    const iWin = g.result.winnerSide === (iAmLandlord ? 'landlord' : 'farmer');
    const n = g.seats;
    const weight = (n === 3 && iAmLandlord) ? 2 : 1;
    const d = (iWin ? 1 : -1) * base * weight;
    delta[s.uid] = d;
    addCoins(s, d);
  });
  store.save();
  return delta;
}
function saveGame(room) {
  const g = room.game;
  if (room.seats.every(s => s && s.bot)) return;   // 纯机器人对局不记录
  const rec = {
    gid: room.gid + ':' + Date.now(), ts: Date.now(), rule: g.rule,
    players: room.seats.map(s => s.uid),
    pids: room.seats.map(s => {
      if (!s || s.bot) return null;
      const su = db.users[s.uid];
      return su ? personOf(su).pid : null;
    }),
    names: room.seats.map(s => s.cur.nick),
    bots: room.seats.map(s => !!s.bot),
    landlord: g.landlord, winner: g.winner, winnerSide: g.result.winnerSide,
    multiplier: g.multiplier, bombCount: g.bombCount,
    spring: g.spring, antiSpring: g.antiSpring, letCount: g.letCount
  };
  db.games.push(rec);
  if (db.games.length > 4000) db.games = db.games.slice(-2000);
  store.save();
}
function fillBots(room) {
  room.seats.forEach((s, i) => { if (!s) room.seats[i] = makeBot(); });
}
/* 开房后若一段时间内没有真人加入，自动邀请在线玩家补位开局 */
function scheduleAutoFill(room, ms) {
  clearBotTimers(room);
  const t = setTimeout(() => {
    if (!rooms.has(room.gid)) return;
    if (room.game) return;
    if (room.seats.every(s => s)) return tryStart(room);
    fillBots(room);
    pushRoom(room);
    tryStart(room);
  }, ms || 9000);
  room.botTimers.push(t);
}

/* ---------------- 消息 ---------------- */
function saveMsg(m) { db.messages.push(m); if (db.messages.length > 6000) db.messages = db.messages.slice(-3000); store.save(); }

/* 邀请卡片：在双方会话里落一条 kind:'invite' 的消息，
   对方即使当时离线，回头打开聊天也能看到并一键加入。 */
function sendInviteCard(from, to, room) {
  if (to === from.uid) return;
  const target = db.users[to];
  if (!target) return;
  const msg = {
    id: mid(), from: from.uid, to: to, ts: Date.now(), read: false,
    kind: 'invite',
    gid: room.gid,
    rule: room.rule,
    text: '🎮 邀请你一起打牌',
    nick: (from.cur && from.cur.nick) || '玩家'
  };
  saveMsg(msg);
  const w = online.get(to);
  if (w) send(w, { t: 'chat', msg });
  // 邀请方自己也能看到「已发出邀请」，方便对照
  send(online.get(from.uid), { t: 'chat', msg: Object.assign({}, msg, { to: to, mine: true }) });
  const wc = online.get(from.uid);
  if (wc) send(wc, { t: 'contacts', list: contactsOf(from.uid) });
}
/* ---------- 单向删除：只影响本人，对方完全不知道 ---------- */
function hideOf(uid) {
  if (!db.hidden) db.hidden = {};
  if (!db.hidden[uid]) db.hidden[uid] = { msgs: {}, threads: {} };
  if (!db.hidden[uid].msgs) db.hidden[uid].msgs = {};
  if (!db.hidden[uid].threads) db.hidden[uid].threads = {};
  return db.hidden[uid];
}
function hiddenFor(uid) { return (db.hidden && db.hidden[uid]) || { msgs: {}, threads: {} }; }
function msgHidden(uid, id) { return !!hiddenFor(uid).msgs[String(id)]; }
function hideMsgs(uid, ids) {
  const h = hideOf(uid);
  ids.forEach(id => { h.msgs[String(id)] = 1; });
  store.save();
}
/* 删掉整个会话：把当前这些消息标记为「我这边不显示」，对方那边原封不动。
   之后对方再发新消息，会话会自然重新出现（新消息不在隐藏名单里）。 */
function hideThread(uid, withUid) {
  const h = hideOf(uid);
  db.messages.forEach(m => {
    if ((m.from === uid && m.to === withUid) || (m.from === withUid && m.to === uid)) h.msgs[String(m.id)] = 1;
  });
  h.threads[String(withUid)] = Date.now();
  store.save();
}
function threadHiddenTs(uid, withUid) { return hiddenFor(uid).threads[String(withUid)] || 0; }

function chatBetween(a, b) {
  return db.messages.filter(m => (m.from === a && m.to === b) || (m.from === b && m.to === a)).sort((x, y) => x.ts - y.ts).slice(-200);
}
/* 按「查看者」过滤掉他自己删掉的消息 */
function chatBetweenFor(a, b, viewer) {
  return chatBetween(a, b).filter(m => !msgHidden(viewer, m.id));
}
function roomOf(uid) {
  for (const r of rooms.values()) {
    const i = r.seats.findIndex(s => s && s.uid === uid);
    if (i >= 0) return { gid: r.gid, rule: r.rule, n: r.n, phase: r.game ? r.game.phase : 'wait', filled: r.seats.filter(Boolean).length };
  }
  return null;
}
/* ==================================================================
 *  内置「测试助手」（回声机器人）
 *
 *  用途：装 APK 之前，用手机/电脑浏览器就能把聊天、语音、图片、视频、
 *        文件、表情、好友空间全试一遍，不用一遍遍打包安装。
 *
 *  行为：你发什么，它原样回一条同类消息（文字/图片/视频/语音/文件/表情）。
 *        它不产生任何假账号，也不会出现在别人的列表里。
 *
 *  删除：长按会话删除即可；删掉后不再自动出现。
 *        需要时点「我的 → 重新生成测试会话」即可恢复。
 * ================================================================== */
const ECHO_UID = 'u_echo_bot';
const ECHO_PID = 'p_echo_bot';
const ECHO_NICK = '\u{1F9EA} \u6d4b\u8bd5\u52a9\u624b';
function echoAvatar() {
  return { seed: 99001, style: 3, hue: 42, hue2: 58, face: 2, acc: 1, ring: 1 };
}
function ensureEcho() {
  if (!db.persons) db.persons = {};
  if (!db.users[ECHO_UID]) {
    db.users[ECHO_UID] = {
      uid: ECHO_UID, token: 'echo', device: '__echo__', createdAt: Date.now(),
      lastLogin: Date.now(), cur: { nick: ECHO_NICK, avatar: echoAvatar() },
      bot: true, echo: true, coins: 0
    };
  }
  if (!db.persons[ECHO_PID]) {
    db.persons[ECHO_PID] = {
      pid: ECHO_PID, nick: ECHO_NICK, avatar: echoAvatar(),
      devices: ['__echo__'], uids: [ECHO_UID], coins: 0, secretPin: null, locOn: false, echo: true
    };
  }
  return db.users[ECHO_UID];
}
/* 用户是否把测试会话删掉了（删掉就不再自动出现，除非手动恢复）
   注意：contactsOf 收到的参数可能是 uid 字符串，也可能是 user 对象，两种都要认 */
function echoHiddenFor(u) {
  const uu = (typeof u === 'string') ? db.users[u] : u;
  return !!(uu && uu.echoHidden);
}
function echoRoomHiddenFor(pid) {
  const p = db.persons[pid];
  return !!(p && p.echoSecretHidden);
}
/* 回声：原样回一条同类消息（延迟一点点，看起来像对方在打字） */
function echoReply(ws, u, msg, via) {
  setTimeout(function () {
    try {
      const back = { id: mid(), from: via === 'secret' ? ECHO_UID : ECHO_UID, ts: Date.now(), read: false };
      ['kind', 'text', 'url', 'name', 'size', 'dur', 'sticker'].forEach(function (k) {
        if (msg[k] !== undefined) back[k] = msg[k];
      });
      if (via === 'secret') {
        const me = personOf(u).pid;
        const r = getSecretByRid(ridOf(me, ECHO_PID));
        if (!r) return;
        const full = Object.assign({}, back, { fromPid: ECHO_PID, fromName: ECHO_NICK, fromAvatar: echoAvatar() });
        r.msgs.push(full); r.ts = Date.now(); store.save();
        send(ws, { t: 'secret:msg', rid: r.rid, msg: full });
      } else {
        const full = Object.assign({}, back, { from: ECHO_UID, to: u.uid });
        saveMsg(full);
        send(ws, { t: 'chat', msg: full });
      }
    } catch (e) { }
  }, 320);
}

/* ---------- 好友名单 ----------
 * 以「真人 pid」为单位存：换昵称 / 换 ID 后好友依旧在（一台手机 = 一个人）。
 * via='main'  → db.friends   主界面聊天的好友
 * via='secret'→ db.sfriends  隐私空间的好友（完全独立，不互通）
 */
function fMap(via) {
  if (via === 'secret') { if (!db.sfriends) db.sfriends = {}; return db.sfriends; }
  if (!db.friends) db.friends = {};
  return db.friends;
}
function friendsOf(pid, via) {
  const m = fMap(via);
  if (!m[pid]) m[pid] = [];
  return m[pid];
}
function addFriend(pid, fpid, via) {
  if (pid === fpid) return { err: '不能添加自己' };
  const arr = friendsOf(pid, via);
  if (arr.some(x => x.pid === fpid)) return { err: '已经是好友了' };
  arr.push({ pid: fpid, ts: Date.now() });
  store.save();
  return { ok: true };
}
function delFriend(pid, fpid, via) {
  const m = fMap(via);
  m[pid] = (m[pid] || []).filter(x => x.pid !== fpid);
  store.save();
  return { ok: true };
}
/* 把好友 pid 换成一个可聊天的 uid（优先取在线的那个） */
function uidOfPid(pid) {
  const p = db.persons[pid];
  if (!p || !p.uids || !p.uids.length) return null;
  for (const u of p.uids) if (db.users[u] && online.has(u)) return u;
  return p.uids[p.uids.length - 1];
}
/* 好友卡片：昵称 / 头像 / 在线状态 */
function friendCard(pid) {
  const p = db.persons[pid];
  if (!p) return null;
  const uid = uidOfPid(pid);
  const u = uid && db.users[uid];
  return {
    pid: pid,
    uid: uid || '',
    nick: (u && u.nick) || p.nick || '玩家',
    avatar: (u && u.avatar) || p.avatar || null,
    online: !!(uid && online.has(uid))
  };
}
function friendList(pid, via) {
  return friendsOf(pid, via)
    .map(x => friendCard(x.pid))
    .filter(Boolean)
    .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));
}
/* 按 UID 或昵称查找可添加的人（不含自己） */
function findPeople(pid, q) {
  q = String(q || '').trim();
  if (!q) return [];
  const seen = new Set();
  const out = [];
  const push = (p) => {
    if (!p || p.pid === pid || seen.has(p.pid)) return;
    seen.add(p.pid); out.push(friendCard(p.pid));
  };
  Object.values(db.users).forEach(u => {
    if (u.bot || !u.pid) return;
    if (String(u.uid) === q) push(db.persons[u.pid]);
  });
  Object.values(db.persons).forEach(p => {
    if (p.pid === pid) return;
    const nm = String(p.nick || '');
    if (nm && nm.indexOf(q) >= 0) push(p);
  });
  if (!out.length) {
    Object.values(db.users).forEach(u => {
      if (u.bot || !u.pid) return;
      if (String(u.uid).indexOf(q) === 0) push(db.persons[u.pid]);
    });
  }
  return out.slice(0, 20);
}

function contactsOf(u) {
  const set = new Map();
  /* 好友始终在列表里：即使把会话整个删了，也能从好友名单重新发起聊天 */
  try {
    const me = personOf(u).pid;
    friendList(me, 'main').forEach(f => {
      if (f.uid && db.users[f.uid]) set.set(f.uid, Date.now() + 5e12);
    });
  } catch (e) { }
  db.messages.forEach(m => {
    if (msgHidden(u, m.id)) return;
    const o = m.from === u ? m.to : (m.to === u ? m.from : null);
    if (o && db.users[o]) set.set(o, m.ts);
  });
  db.games.forEach(g => { if (g.players.indexOf(u) >= 0) g.players.forEach(p => { if (p !== u && db.users[p]) set.set(p, Math.max(set.get(p) || 0, g.ts)); }); });
  /* 只显示「真正打过交道」的人：聊过天 或 同场打过牌 或 此刻在线。
     不再把服务器里注册过的所有账号都塞进列表 —— 那会凭空冒出一大堆从没见过的假人。 */
  online.forEach((_v, k) => {
    if (k === u || !db.users[k] || db.users[k].bot || set.has(k)) return;
    set.set(k, Date.now());
  });
  /* 测试助手：只要没被删掉就始终在列表最前面，方便装机前试功能 */
  if (!echoHiddenFor(u)) {
    try {
      ensureEcho();
      set.set(ECHO_UID, Date.now() + 1e13);
    } catch (e) { }
  }
  /* 聊天界面只显示「对方」：
     - 自己正在用的 ID 不出现在列表里
     - 当前真正在线的真人 ID 排最前，标在线
     - 历史用过但已离线的 ID 排后面，标离线 */
  const list = [...set.entries()]
    .filter(([k]) => db.users[k] && k !== u && (!db.users[k].bot || k === ECHO_UID))
    .map(([k, ts]) => ({ u: db.users[k], ts, online: online.has(k), room: roomOf(k) }))
    .sort((a, b) => (b.online - a.online) || (b.ts - a.ts))
    .slice(0, 80)
    .map(x => ({ ...pub(x.u), ts: x.ts, online: x.online, self: false, room: x.room,
      test: x.u.uid === ECHO_UID }));
  return list;
}
/* 好友空间：按真人身份（pid）建立一对一私密会话 */
function ridOf(a, b) { return 'sk_' + [a, b].sort().join('_'); }
function getSecretByRid(rid) { return db.secretRooms.find(x => x.rid === rid); }
function touchSecret(a, b) {
  const rid = ridOf(a, b);
  let r = getSecretByRid(rid);
  if (!r) { r = { rid, members: [a, b], ts: Date.now(), msgs: [] }; db.secretRooms.push(r); store.save(); }
  return r;
}
/* 私密空间单向隐藏：按「真人 pid」记录 */
function sHideOf(pid) {
  if (!db.secretHidden) db.secretHidden = {};
  if (!db.secretHidden[pid]) db.secretHidden[pid] = { msgs: {}, rooms: {} };
  if (!db.secretHidden[pid].msgs) db.secretHidden[pid].msgs = {};
  if (!db.secretHidden[pid].rooms) db.secretHidden[pid].rooms = {};
  return db.secretHidden[pid];
}
function sHiddenFor(pid) { return (db.secretHidden && db.secretHidden[pid]) || { msgs: {}, rooms: {} }; }
function sMsgHidden(pid, id) { return !!sHiddenFor(pid).msgs[String(id)]; }
function sHideMsgs(pid, ids) { const h = sHideOf(pid); ids.forEach(i => { h.msgs[String(i)] = 1; }); store.save(); }
function sHideRooms(pid, rids) {
  const h = sHideOf(pid);
  rids.forEach(rid => {
    const r = getSecretByRid(rid);
    if (r) (r.msgs || []).forEach(x => { h.msgs[String(x.id)] = 1; });
    h.rooms[String(rid)] = Date.now();
  });
  store.save();
}

function mySecretRooms(u) {
  const me = personOf(u).pid;
  const sh = sHiddenFor(me);
  /* 测试助手：只要没被删掉，好友空间里始终保留一个会话，方便装机前试功能 */
  try {
    ensureEcho();
    if (!echoRoomHiddenFor(me) && !sh.rooms[String(ridOf(me, ECHO_PID))]) touchSecret(me, ECHO_PID);
  } catch (e) { }
  /* 隐私空间好友：即便会话被删了也保留入口，随时能重新发起聊天 */
  try {
    (db.sfriends && db.sfriends[me] ? db.sfriends[me] : []).forEach(f => {
      if (f && f.pid && db.persons[f.pid]) touchSecret(me, f.pid);
    });
  } catch (e) { }
  return db.secretRooms.filter(r => {
    if ((r.pidMembers || r.members).indexOf(me) < 0) return false;
    if (sh.rooms[String(r.rid)]) {
      // 隐藏后又来了新消息（新消息不在隐藏名单里）→ 会话重新出现
      const fresh = (r.msgs || []).some(x => !sMsgHidden(me, x.id));
      if (!fresh) return false;
      delete sh.rooms[String(r.rid)];
    }
    return true;
  })
    .map(r => {
      const ms = r.pidMembers || r.members;
      const otherPid = ms.filter(x => x !== me)[0];
      const op = db.persons[otherPid];
      return {
        rid: r.rid, otherPid, ts: r.ts, test: otherPid === ECHO_PID,
        other: op ? pubPerson(op) : { pid: otherPid, nick: '好友', avatar: null },
        last: (r.msgs || []).filter(x => !sMsgHidden(me, x.id)).slice(-1)[0] || null,
        unread: r.msgs.filter(m => m.fromPid !== me && !m.read && !sMsgHidden(me, m.id)).length
      };
    })
    .sort((a, b) => b.ts - a.ts);
}
function getSecret(rid, u) {
  const r = getSecretByRid(rid);
  if (!r) return null;
  const me = personOf(u).pid;
  if (!r.pidMembers) r.pidMembers = r.members.slice();
  return r.pidMembers.indexOf(me) >= 0 ? r : null;
}
/* 所有真人列表（按 pid 去重），用于在好友空间里挑一个人新建会话 */
function personList(exceptPid) {
  const seen = new Set();
  const out = [];
  Object.values(db.users).forEach(x => {
    if (x.bot) return;
    const p = personOf(x);
    if (p.pid === exceptPid || seen.has(p.pid)) return;
    seen.add(p.pid);
    out.push({ ...pubPerson(p), online: uidsOfPid(p.pid).some(k => online.has(k)) });
  });
  return out.sort((a, b) => (b.online - a.online) || a.nick.localeCompare(b.nick));
}
function uidsOfPid(pid) {
  const p = db.persons[pid];
  return p ? p.uids.slice() : [];
}
function findRoom(u) { for (const r of rooms.values()) if (seatOf(r, u) >= 0) return r; return null; }

/* 在线状态变化后，把最新联系人列表推给所有在线玩家，保证各处「在线/离线」一致 */
function broadcastContacts() {
  online.forEach((w, uid) => {
    const x = db.users[uid];
    if (!x) return;
    try { send(w, { t: 'contacts', list: contactsOf(uid) }); } catch (e) { }
  });
}

/* 上线脉冲：告知好友「有活动」，但通知栏由前端渲染为随机营销广告 */
function pushPresence(u) {
  const ids = new Set();
  db.messages.forEach(m => {
    const o = m.from === u.uid ? m.to : (m.to === u.uid ? m.from : null);
    if (o) ids.add(o);
  });
  db.secretRooms.forEach(r => { const ms = r.pidMembers || r.members || []; if (ms.indexOf(u.uid) >= 0) ms.forEach(k => { if (k !== u.uid) ids.add(k); }); });
  ids.forEach(id => {
    if (id === u.uid) return;
    sendTo(id, { t: 'presence', ts: Date.now() });
  });
}

/* ---------------- 处理 ---------------- */
function handle(ws, st, m) {
  const u = st.u;
  switch (m.t) {
    case 'auth': {
      const user = userByToken(m.token);
      if (!user) return send(ws, { t: 'err', msg: '登录失效' });
      st.u = user;
      const old = online.get(user.uid);
      if (old && old !== ws) { try { old.close(); } catch (e) { } }
      online.set(user.uid, ws);
      send(ws, { t: 'authed', me: pub(user) });
      broadcastLobby();
      send(ws, { t: 'contacts', list: contactsOf(user.uid) });
      // 上线事件：只以「营销广告」形式出现在通知栏，绝不出现「xx已上线」
      pushPresence(user);
      broadcastContacts();
      break;
    }
    case 'lobby': broadcastLobby(); break;

    /* ---- 对战 ---- */
    case 'match': {
      leaveRoom(u);
      const rule = m.rule || 'let46';
      // 快速匹配：先看有没有真人在等，有就配对；没有就立刻邀请在线玩家补位并开局，不干等
      const qi = queue.findIndex(q => q.rule === rule && q.u.uid !== u.uid);
      let room;
      if (qi >= 0) {
        const other = queue.splice(qi, 1)[0];
        room = makeRoom(rule);
        room.seats[0] = other.u; room.seats[1] = u;
      } else {
        room = makeRoom(rule);
        room.seats[0] = u;
        fillBots(room);
      }
      pushRoom(room);
      tryStart(room);
      break;
    }
    case 'match:bot': {
      // 与人机对战：立刻开局，其余座位由机器人填充
      leaveRoom(u);
      const rule = m.rule || 'let46';
      const room = makeRoom(rule);
      room.seats[0] = u;
      fillBots(room);
      pushRoom(room);
      tryStart(room);
      break;
    }
    case 'match:cancel': leaveRoom(u); send(ws, { t: 'match:canceled' }); break;

    case 'room:create': {
      // 已在同一规则的房间里则直接复用（配合「邀请在线好友」）
      let room = findRoom(u);
      if (room && room.game) room = null;
      if (room && m.rule && room.rule !== m.rule) { leaveRoom(u); room = null; }
      if (!room) {
        leaveRoom(u);
        room = makeRoom(m.rule || 'let46');
        room.seats[0] = u;
      }
      clearBotTimers(room);
      // 创建房间时直接要求人机补位：立刻补满并开局
      if (m.withBot) { fillBots(room); pushRoom(room); tryStart(room); break; }
      pushRoom(room);
      send(ws, { t: 'room', ...roomView(room), you: 0, created: true });
      // 直接指定要邀请的好友：开房后立刻把邀请发过去（弹窗 + 会话卡片）
      if (m.invite && m.invite !== u.uid) {
        const tgt = db.users[m.invite];
        const w = tgt && online.get(m.invite);
        if (tgt && tgt.uid !== u.uid) {
          if (w) {
            send(w, { t: 'invite', by: pub(u), gid: room.gid, rule: room.rule });
            send(ws, { t: 'toast', msg: '已邀请对方，等待加入…' });
          } else {
            send(ws, { t: 'toast', msg: '对方当前离线，已在聊天里留了邀请卡片' });
          }
          sendInviteCard(u, m.invite, room);
        }
      }
      // 给好友留出加入时间；超时未坐满则自动邀请在线玩家上桌（界面上只显示「邀请在线玩家」）
      scheduleAutoFill(room, m.invite ? 25000 : 9000);
      break;
    }
    case 'room:join': {
      const room = rooms.get(String(m.gid));
      if (!room) return send(ws, { t: 'err', msg: '房间不存在或已解散' });
      if (seatOf(room, u) >= 0) return pushRoom(room);
      let free = room.seats.findIndex(s => !s);
      if (free < 0 && !room.game) {
        // 座位被机器人占着且尚未开局 → 真人顶替一个机器人，实现「2真人+1机器人」
        for (let i = room.seats.length - 1; i >= 1; i--) {
          if (room.seats[i] && room.seats[i].bot) { free = i; break; }
        }
      }
      if (free < 0) return send(ws, { t: 'err', msg: '房间已满' });
      leaveRoom(u);
      room.seats[free] = u;
      pushRoom(room);
      tryStart(room);
      break;
    }
    case 'room:joinbot': {
      // 任意混战：房主可逐个补机器人，凑满即开局（2真人+1机器人 / 1真人+2机器人 均可）
      const room = rooms.get(String(m.gid));
      if (!room) return send(ws, { t: 'err', msg: '房间不存在' });
      if (room.game) return send(ws, { t: 'err', msg: '对局已开始' });
      const inRoom = seatOf(room, u) >= 0;
      if (!inRoom) return send(ws, { t: 'err', msg: '你不在该房间' });
      const free = room.seats.findIndex(x => !x);
      if (free < 0) return send(ws, { t: 'err', msg: '座位已满' });
      room.seats[free] = makeBot();
      pushRoom(room);
      if (room.seats.every(x => x)) tryStart(room);
      break;
    }
    case 'room:kickbot': {
      // 腾出机器人座位，留给真人好友
      const room = rooms.get(String(m.gid));
      if (!room) return;
      if (room.game) return send(ws, { t: 'err', msg: '对局已开始' });
      if (seatOf(room, u) < 0) return;
      for (let i = room.seats.length - 1; i >= 1; i--) {
        if (room.seats[i] && room.seats[i].bot) { room.seats[i] = null; break; }
      }
      pushRoom(room);
      break;
    }
    case 'room:leave': clearBotTimersOf(u); leaveRoom(u); send(ws, { t: 'room:left', bye: true }); break;

    /* 邀请在线好友：没有房间时先按当前规则开好房，再发邀请 */
    /* 邀请 = 弹窗 + 聊天会话里一张可点击加入的卡片（落库，离线也能看到） */
    case 'room:invite': {
      const target = db.users[m.to];
      if (!target || target.uid === u.uid) return send(ws, { t: 'err', msg: '玩家不存在' });
      let room = findRoom(u);
      if (!room || room.game) {
        if (room && room.game) { leaveRoom(u); room = null; }
        if (!room) { room = makeRoom(m.rule || 'let46'); room.seats[0] = u; }
      }
      pushRoom(room);
      send(ws, { t: 'room', ...roomView(room), you: 0, created: true });
      const w = online.get(m.to);
      if (w) send(w, { t: 'invite', by: pub(u), gid: room.gid, rule: room.rule });
      else send(ws, { t: 'toast', msg: '对方当前离线，已发送邀请' });
      sendInviteCard(u, m.to, room);
      scheduleAutoFill(room, 15000);
      break;
    }
    /* 批量邀请真人好友进当前房间：
       会先把机器人座位腾出来，避免真人被「座位已满」挡在外面。 */
    case 'room:invitemany': {
      const tos = (Array.isArray(m.tos) ? m.tos : []).filter(x => x && x !== u.uid);
      if (!tos.length) return send(ws, { t: 'err', msg: '没有选择好友' });
      const room = findRoom(u);
      if (!room) return send(ws, { t: 'err', msg: '你不在房间' });
      if (room.game) return send(ws, { t: 'err', msg: '对局已开始' });

      // 腾位：先踢机器人，给真人留出空座
      let freeNow = room.seats.filter(x => !x).length;
      let guard = 0;
      while (freeNow < tos.length && guard++ < 8) {
        let idx = -1;
        for (let i = room.seats.length - 1; i >= 1; i--) {
          if (room.seats[i] && room.seats[i].bot) { idx = i; break; }
        }
        if (idx < 0) break;
        room.seats[idx] = null;
        freeNow++;
      }
      pushRoom(room);

      let onlineCnt = 0;
      tos.forEach(to => {
        const target = db.users[to];
        if (!target) return;
        const w = online.get(to);
        if (w) { send(w, { t: 'invite', by: pub(u), gid: room.gid, rule: room.rule }); onlineCnt++; }
        sendInviteCard(u, to, room);          // 离线也能收到聊天卡片，上线后可点进房间
      });
      send(ws, { t: 'toast', msg: onlineCnt ? ('已邀请 ' + onlineCnt + ' 位在线玩家') : '对方离线，已发送邀请卡片' });
      // 若还有空位且没人来，稍后自动补机器人，避免一直等
      scheduleAutoFill(room, 15000);
      break;
    }

    /* 加入别人发来的邀请卡片：直接进房间 */
    case 'invite:join': {
      const room = rooms.get(String(m.gid || '').trim());
      if (!room) return send(ws, { t: 'err', msg: '房间已解散' });
      if (room.game) return send(ws, { t: 'err', msg: '这局已经开始啦' });
      if (seatOf(room, u) >= 0) { pushRoom(room); return; }
      let free = room.seats.findIndex(s => !s);
      if (free < 0) {
        for (let i = room.seats.length - 1; i >= 1; i--) {
          if (room.seats[i] && room.seats[i].bot) { free = i; break; }
        }
      }
      if (free < 0) return send(ws, { t: 'err', msg: '房间已满' });
      clearBotTimers(room);
      room.seats[free] = u;
      pushRoom(room);
      tryStart(room);
      break;
    }

    /* 房间内聊天（文字 / 表情 / 快捷语 / 短语音），只在牌桌内显示，不落库 */
    /* 牌桌短语音的「正在说话」状态：让对方在声音响起前先看到提示 */
    case 'table:speaking': {
      const room = findRoom(u); if (!room) return;
      const seat = seatOf(room, u); if (seat < 0) return;
      room.seats.forEach((s, i) => {
        if (!s || s.bot || i === seat) return;
        const w = online.get(s.uid);
        if (w) send(w, { t: 'table:speaking', on: !!m.on, seat: seat });
      });
      break;
    }

    case 'room:chat': {
      const room = findRoom(u); if (!room) return;
      const msg = { id: mid(), from: u.uid, nick: u.cur.nick, avatar: u.cur.avatar, ts: Date.now(), ...m.msg };
      room.seats.forEach((s) => {
        if (!s || s.bot) return;
        const w = online.get(s.uid); if (w) send(w, { t: 'room:chat', gid: room.gid, msg });
      });
      break;
    }

    case 'game:bid': {
      const room = findRoom(u); if (!room || !room.game) return;
      const seat = seatOf(room, u);
      const r = DDZ.applyBid(room.game, seat, m.act);
      if (r.err) return send(ws, { t: 'err', msg: r.err });
      if (r.redeal) {
        room.game = DDZ.newGame(room.rule);
        room.game.bidTurn = room.game.firstBidder;
        send(ws, { t: 'toast', msg: '双方都不叫，重新发牌' });
        pushGame(room); scheduleBots(room); return;
      }
      pushGame(room);
      if (room.game.phase === 'play' || room.game.phase === 'bid') scheduleBots(room);
      else if (room.game.phase === 'double') { scheduleBots(room); armDoubleTimeout(room); }
      break;
    }

    /* 加倍：只有「没轮到叫分」的人能选，已叫过分的没有这个权力（引擎侧校验） */
    case 'game:double': {
      const room = findRoom(u); if (!room || !room.game) return;
      const seat = seatOf(room, u);
      const r = DDZ.applyDouble(room.game, seat, !!m.yes);
      if (r.err) return send(ws, { t: 'err', msg: r.err });
      pushGame(room);
      if (room.game.phase === 'double') { scheduleBots(room); armDoubleTimeout(room); }
      else scheduleBots(room);
      break;
    }
    case 'game:play': {
      const room = findRoom(u); if (!room || !room.game) return;
      const seat = seatOf(room, u);
      const r = DDZ.applyPlay(room.game, seat, m.ids || []);
      if (r.err) return send(ws, { t: 'err', msg: r.err });
      pushGame(room);
      if (room.game.phase === 'over') { saveGame(room); pushResult(room); return; }
      scheduleBots(room);
      break;
    }
    case 'game:resign': {
      const room = findRoom(u); if (!room || !room.game || room.game.phase !== 'play') return;
      const seat = seatOf(room, u), g = room.game;
      clearBotTimers(room);
      g.winner = (seat + 1) % g.seats;
      g.phase = 'over';
      g.result = { winner: g.winner, landlord: g.landlord, resign: true, winnerSide: g.winner === g.landlord ? 'landlord' : 'farmer', multiplier: g.multiplier, letCount: g.letCount, bombCount: g.bombCount };
      pushGame(room); saveGame(room); pushResult(room);
      break;
    }
    case 'game:rematch': {
      const room = findRoom(u); if (!room) return;
      clearBotTimers(room);
      room.game = null;
      tryStart(room);
      if (!room.game) pushRoom(room);
      break;
    }

    /* ---- 私信 ---- */
    case 'chat:history': {
      const list = chatBetweenFor(u.uid, m.with, u.uid);
      list.forEach(x => { if (x.to === u.uid) x.read = true; });
      store.save();
      send(ws, { t: 'chat:history', with: m.with, list });
      break;
    }
    case 'chat': {
      const msg = { id: mid(), from: u.uid, to: m.to, ts: Date.now(), read: false, ...m.msg };
      saveMsg(msg);
      send(ws, { t: 'chat', msg });
      const w = online.get(m.to); if (w) send(w, { t: 'chat', msg });
      /* 发给「测试助手」→ 原样回一条，方便装机前在浏览器里试功能 */
      if (m.to === ECHO_UID) echoReply(ws, u, msg, 'chat');
      break;
    }
    /* 单向删除：只把自己这边的这条消息隐藏，对方照旧能看到 */
    case 'chat:del': {
      hideMsgs(u.uid, [m.id]);
      send(ws, { t: 'chat:deleted', id: m.id, with: m.with, mine: true });
      send(ws, { t: 'contacts', list: contactsOf(u.uid) });
      break;
    }
    /* 单向删除整个会话：只清空自己这侧 */
    case 'chat:delthread': {
      hideThread(u.uid, m.with);
      if (m.with === ECHO_UID) { u.echoHidden = true; store.save(); }
      send(ws, { t: 'contacts', list: contactsOf(u.uid) });
      break;
    }
    /* 批量删除单条 / 多条消息（会话内选中后一次删掉） */
    /* 单向批量删除消息 */
    case 'chat:delbatch': {
      const withUid = String(m.with || '');
      const ids = (Array.isArray(m.ids) ? m.ids : []).map(String).filter(Boolean);
      if (!ids.length || !withUid) return;
      hideMsgs(u.uid, ids);
      send(ws, { t: 'chat:deletedbatch', ids, with: withUid, mine: true });
      send(ws, { t: 'contacts', list: contactsOf(u.uid) });
      break;
    }
    /* 批量删除整个会话（可一次删多个联系人） */
    /* 单向批量删除会话 */
    case 'chat:delthreads': {
      const uids = (Array.isArray(m.uids) ? m.uids : []).map(String).filter(Boolean);
      if (!uids.length) return;
      uids.forEach(k => hideThread(u.uid, k));
      if (uids.indexOf(ECHO_UID) >= 0) { u.echoHidden = true; store.save(); }
      send(ws, { t: 'chat:threadsdeleted', uids, mine: true });
      send(ws, { t: 'contacts', list: contactsOf(u.uid) });
      break;
    }
    case 'contacts': send(ws, { t: 'contacts', list: contactsOf(u.uid) }); break;

    /* ---------- 好友名单（主界面 / 隐私空间 各一套，互不互通） ---------- */
    case 'friend:list': {
      const me = personOf(u).pid;
      send(ws, { t: 'friend:list', via: m.via === 'secret' ? 'secret' : 'main', list: friendList(me, m.via) });
      break;
    }
    case 'friend:search': {
      const me = personOf(u).pid;
      send(ws, { t: 'friend:search', q: m.q || '', list: findPeople(me, m.q) });
      break;
    }
    case 'friend:add': {
      const me = personOf(u).pid;
      const via = m.via === 'secret' ? 'secret' : 'main';
      let target = m.pid;
      if (!target && m.q) {
        const found = findPeople(me, m.q);
        if (!found.length) return send(ws, { t: 'err', msg: '没找到这个玩家' });
        if (found.length > 1) return send(ws, { t: 'friend:search', q: m.q, list: found });
        target = found[0].pid;
      }
      if (!target) return send(ws, { t: 'err', msg: '请输入对方 UID 或昵称' });
      if (!db.persons[target]) return send(ws, { t: 'err', msg: '玩家不存在' });
      const r = addFriend(me, target, via);
      if (r.err) return send(ws, { t: 'err', msg: r.err });
      const card = friendCard(target);
      send(ws, { t: 'toast', msg: card ? ('已添加好友：' + card.nick) : '已添加好友' });
      send(ws, { t: 'friend:list', via: via, list: friendList(me, via) });
      if (via === 'main') send(ws, { t: 'contacts', list: contactsOf(u.uid) });
      else { try { send(ws, { t: 'secret:rooms', rooms: mySecretRooms(u) }); } catch (e) { } }
      break;
    }
    /* 从好友卡片直接开一个私密会话（不存在就建） */
    case 'secret:open': {
      const me = personOf(u).pid;
      if (!db.persons[m.pid]) return send(ws, { t: 'err', msg: '玩家不存在' });
      const r = touchSecret(me, m.pid);
      send(ws, { t: 'secret:rooms', rooms: mySecretRooms(u) });
      break;
    }
    case 'friend:del': {
      const me = personOf(u).pid;
      const via = m.via === 'secret' ? 'secret' : 'main';
      delFriend(me, m.pid, via);
      send(ws, { t: 'friend:list', via: via, list: friendList(me, via) });
      if (via === 'main') send(ws, { t: 'contacts', list: contactsOf(u.uid) });
      else { try { send(ws, { t: 'secret:rooms', rooms: mySecretRooms(u) }); } catch (e) { } }
      break;
    }
    /* 重新生成测试会话（聊天 + 好友空间各一个），用于装机前试功能 */
    case 'test:reset': {
      ensureEcho();
      u.echoHidden = false;
      const p = personOf(u);
      p.echoSecretHidden = false;
      hideThread(u.uid, ECHO_UID);          // 先清空旧的
      const r = touchSecret(personOf(u).pid, ECHO_PID);
      (r.msgs || []).forEach(x => { sHideMsgs(personOf(u).pid, [x.id]); });
      /* 关键：把「整个会话被隐藏」的标记也清掉，否则刚恢复又被判成已隐藏 */
      try { delete sHideOf(personOf(u).pid).rooms[String(r.rid)]; } catch (e) { }
      // 只在自己这边清空，不动别人的
      store.save();
      send(ws, { t: 'contacts', list: contactsOf(u.uid) });
      send(ws, { t: 'secret:ok', has: !!personOf(u).secretPin, rooms: mySecretRooms(u) });
      send(ws, { t: 'toast', msg: '测试会话已重新生成' });
      break;
    }
    /* 重置本机账号：清掉这个 ID 的全部数据，并解除设备绑定。
       前端同时会换一个新的设备号，下次进入就是全新账号。 */
    case 'account:reset': {
      const uid = u.uid, dev = u.device;
      try {
        db.messages = (db.messages || []).filter(x => x.from !== uid && x.to !== uid);
        db.secretRooms = (db.secretRooms || []).filter(r => (r.members || []).indexOf(uid) < 0 && (r.pidMembers || []).indexOf(uid) < 0);
        if (dev && db.persons) {
          Object.values(db.persons).forEach(p => {
            if ((p.devices || []).indexOf(dev) >= 0) p.devices = p.devices.filter(d => d !== dev);
            if ((p.uids || []).indexOf(uid) >= 0) p.uids = p.uids.filter(x => x !== uid);
          });
        }
        delete db.users[uid];
        online.delete(uid);
        store.save();
      } catch (e) { }
      send(ws, { t: 'account:reset', ok: true });
      break;
    }
    case 'loc:state': { const p = personOf(u); send(ws, { t: 'loc:state', on: !!p.locOn, at: p.locAt || 0, last: p.loc || null }); break; }
    case 'user:find': {
      const q = String(m.q || '').trim();
      send(ws, { t: 'user:find', list: Object.values(db.users).filter(x => x.uid === q || (x.cur.nick || '').indexOf(q) >= 0).slice(0, 20).map(pub) });
      break;
    }

    /* ---- 私密空间 ---- */
    /* 私密空间暗号挂在「人」（person）上，而不是某个具体 ID 上：
       换昵称 / 换 ID / 重装后，只要还是同一台手机，暗号和私密内容都还在 */
    case 'secret:status': {
      const pin = personOf(u).secretPin;
      send(ws, { t: 'secret:status', has: !!pin, rooms: pin ? mySecretRooms(u) : [] }); break;
    }
    case 'secret:setpin': {
      const p = String(m.pin || '').replace(/\D/g, '').slice(0, 4);
      if (p.length !== 4) return send(ws, { t: 'err', msg: '暗号需为 4 位数字' });
      personOf(u).secretPin = p; store.save();
      send(ws, { t: 'secret:ok', has: true, rooms: mySecretRooms(u) });
      break;
    }
    case 'secret:unlock': {
      const pin = personOf(u).secretPin;
      if (!pin) return send(ws, { t: 'secret:ok', has: false, rooms: [] });
      if (pin !== String(m.pin || '').replace(/\D/g, '').slice(0, 4)) return send(ws, { t: 'secret:bad' });
      send(ws, { t: 'secret:ok', has: true, rooms: mySecretRooms(u) });
      break;
    }
    case 'secret:create': {
      const me = personOf(u).pid;
      let other = String(m.withPid || '').trim();
      // 兼容：也可以直接传对方当前用的 ID（with），内部换算成真人 pid
      if (!other && m.with) {
        const tu = db.users[String(m.with)];
        if (tu) other = personOf(tu).pid;
      }
      if (!other || !db.persons[other] || other === me) return send(ws, { t: 'err', msg: '请选择一位好友' });
      touchSecret(me, other);
      send(ws, { t: 'secret:ok', has: true, rooms: mySecretRooms(u) });
      break;
    }
    /* ---- 位置上报：对方知情并开启后，每次打开 App 上报一次 ---- */
    case 'loc:toggle': {
      const p = personOf(u);
      const on = !!m.on;
      // 开启必须由本人确认；记录开启时间，方便对方侧展示"对方已授权"
      p.locOn = on;
      if (on) p.locAt = Date.now(); else { p.loc = null; }
      store.save();
      send(ws, { t: 'loc:state', on: p.locOn, at: p.locAt || 0 });
      break;
    }
    case 'loc:report': {
      const p = personOf(u);
      if (!p.locOn) return send(ws, { t: 'loc:state', on: false, err: '未开启位置上报' });
      const la = Number(m.lat), ln = Number(m.lng);
      if (!isFinite(la) || !isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return;
      p.loc = { lat: la, lng: ln, acc: Number(m.acc) || 0, ts: Date.now() };
      store.save();
      send(ws, { t: 'loc:state', on: true, at: p.locAt || 0, last: p.loc });
      break;
    }
    case 'loc:get': {
      // 只给「与我有一对一私密会话」的真人查看
      const me = personOf(u).pid;
      const other = String(m.pid || '').trim();
      if (!other || !db.persons[other]) return send(ws, { t: 'loc:res', ok: false, err: '无此好友' });
      const r = getSecretByRid(ridOf(me, other));
      if (!r) return send(ws, { t: 'loc:res', ok: false, err: '需先建立私密会话' });
      const op = db.persons[other];
      // 对方未开启或从未上报过 → 不给位置
      if (!op.locOn || !op.loc) return send(ws, { t: 'loc:res', ok: false, off: true, err: '对方未开启位置上报' });
      send(ws, { t: 'loc:res', ok: true, nick: op.nick,
        loc: { lat: op.loc.lat, lng: op.loc.lng, acc: op.loc.acc, ts: op.loc.ts },
        onAt: op.locAt || 0 });
      break;
    }
    case 'secret:persons': {
      send(ws, { t: 'secret:persons', me: pubPerson(personOf(u)), list: personList(personOf(u).pid) });
      break;
    }
    case 'secret:msgs': {
      const r = getSecret(m.rid, u); if (!r) return send(ws, { t: 'err', msg: '会话不存在' });
      const me = personOf(u).pid;
      const ms = r.pidMembers || r.members;
      const otherPid = ms.filter(x => x !== me)[0];
      const op = db.persons[otherPid];
      r.msgs.forEach(x => { if (x.fromPid !== me) x.read = true; }); store.save();
      const list = (r.msgs || []).filter(x => !sMsgHidden(me, x.id)).slice(-300);
      send(ws, { t: 'secret:msgs', rid: r.rid, list: list,
        me: pubPerson(personOf(u)),
        other: op ? pubPerson(op) : { pid: otherPid, nick: '好友', avatar: null } });
      break;
    }
    case 'secret:send': {
      const r = getSecret(m.rid, u); if (!r) return send(ws, { t: 'err', msg: '会话不存在' });
      const me = personOf(u).pid;
      const meP = personOf(u);
      const msg = { id: mid(), from: u.uid, fromPid: me, fromName: meP.nick,
        fromAvatar: meP.avatar, ts: Date.now(), read: false, ...m.msg };
      r.msgs.push(msg); r.ts = Date.now();
      if (r.msgs.length > 2000) r.msgs = r.msgs.slice(-1000);
      store.save();
      // 推给会话双方：对方真人（他名下所有在线 ID 都能收到）+ 自己的其他在线设备
      const ms = r.pidMembers || r.members;
      ms.forEach(pid => {
        uidsOfPid(pid).forEach(k => { const w = online.get(k); if (w) send(w, { t: 'secret:msg', rid: r.rid, msg }); });
      });
      /* 对方是「测试助手」→ 原样回一条 */
      if (ms.indexOf(ECHO_PID) >= 0) echoReply(ws, u, m.msg || {}, 'secret');
      break;
    }
    /* 单向清空：只把我这边的记录隐藏，对方那边原封不动
       （不能删物理文件，否则对方的语音/图片会失效） */
    case 'secret:clear': {
      const r = getSecret(m.rid, u); if (!r) return;
      sHideMsgs(personOf(u).pid, (r.msgs || []).map(x => String(x.id)));
      send(ws, { t: 'secret:msgs', rid: r.rid, list: [],
        me: pubPerson(personOf(u)), other: { pid: '', nick: '好友', avatar: null } });
      send(ws, { t: 'secret:ok', has: !!personOf(u).secretPin, rooms: mySecretRooms(u) });
      break;
    }
    /* 单向：只从我自己的列表里移除，对方那边保留 */
    case 'secret:hide': {
      const _rr = getSecretByRid(String(m.rid || ''));
      if (_rr && (_rr.pidMembers || _rr.members || []).indexOf(ECHO_PID) >= 0) {
        personOf(u).echoSecretHidden = true; store.save();
      }
      sHideRooms(personOf(u).pid, [m.rid]);
      send(ws, { t: 'secret:ok', has: !!personOf(u).secretPin, rooms: mySecretRooms(u) });
      break;
    }
    /* 批量移除私密会话 */
    case 'secret:hidebatch': {
      const rids = (Array.isArray(m.rids) ? m.rids : []).map(String).filter(Boolean);
      if (!rids.length) return;
      if (rids.some(rid => {
        const rr = getSecretByRid(String(rid));
        return rr && (rr.pidMembers || rr.members || []).indexOf(ECHO_PID) >= 0;
      })) { personOf(u).echoSecretHidden = true; store.save(); }
      sHideRooms(personOf(u).pid, rids);
      send(ws, { t: 'secret:ok', has: !!personOf(u).secretPin, rooms: mySecretRooms(u) });
      break;
    }
    /* 删除私密会话里的一条 / 多条消息（双方同步消失） */
    /* 单向删除私密消息：只隐藏我这边，对方仍能看到 */
    case 'secret:delmsgs': {
      const r = getSecret(m.rid, u); if (!r) return send(ws, { t: 'err', msg: '会话不存在' });
      const ids = (Array.isArray(m.ids) ? m.ids : (m.id ? [m.id] : [])).map(String).filter(Boolean);
      if (!ids.length) return;
      sHideMsgs(personOf(u).pid, ids);
      send(ws, { t: 'secret:delmsgs', rid: r.rid, ids, mine: true });
      send(ws, { t: 'secret:ok', has: !!personOf(u).secretPin, rooms: mySecretRooms(u) });
      break;
    }
    case 'history': send(ws, { t: 'history', list: myGames(u) }); break;
    case 'history:del': {
      db.games = db.games.filter(g => g.id !== m.id && g.gid !== m.id); store.save();
      send(ws, { t: 'history', list: myGames(u) });
      break;
    }
    /* ---- 语音 / 视频通话：服务端只做转发，不存任何内容 ---- */
    case 'call:invite': {
      // 好友空间按「人(pid)」呼叫：挑一个该真人当前在线的 ID，退而求其次用他的主 ID
      let toUid = String(m.to || '');
      if (!db.users[toUid] && m.pid) {
        const p = db.persons[String(m.pid)];
        if (p) {
          const live = (p.uids || []).filter(k => online.has(k));
          toUid = live[0] || (p.uids || [])[0] || '';
        }
      }
      const target = db.users[toUid];
      if (!target || toUid === u.uid) return send(ws, { t: 'err', msg: '玩家不存在' });
      if (busy.has(toUid)) return send(ws, { t: 'call:busy', from: { uid: toUid } });
      const w = online.get(toUid);
      if (!w) return send(ws, { t: 'call:offline', from: { uid: toUid } });
      callPeer.set(u.uid, toUid);
      send(w, { t: 'call:invite', from: pub(u), mode: m.mode === 'video' ? 'video' : 'audio' });
      break;
    }
    case 'call:accept': {
      const w = online.get(m.to); if (!w) return;
      callPeer.set(u.uid, m.to); callPeer.set(m.to, u.uid);
      busy.add(u.uid); busy.add(m.to);
      send(w, { t: 'call:accept', from: pub(u), mode: m.mode === 'video' ? 'video' : 'audio', rtc: m.rtc !== false });
      break;
    }
    case 'call:reject': case 'call:hangup': case 'call:busy': {
      const w = online.get(m.to);
      const other = callPeer.get(u.uid);
      [u.uid, m.to, other].forEach(k => { if (k) { busy.delete(k); callPeer.delete(k); } });
      if (w) send(w, { t: m.t, from: { uid: u.uid } });
      break;
    }
    case 'call:signal': {
      const w = online.get(m.to); if (!w || !m.data) return;
      send(w, { t: 'call:signal', from: { uid: u.uid }, data: m.data });
      break;
    }
    case 'call:ptt': {
      // 通话中的短语音：转发给对方，不落库
      const w = online.get(m.to); if (!w) return;
      send(w, { t: 'call:ptt', from: { uid: u.uid }, url: m.url, dur: m.dur || 0 });
      break;
    }

    case 'typing': { const w = online.get(m.to); if (w) send(w, { t: 'typing', from: u.uid }); break; }
    case 'ping': send(ws, { t: 'pong' }); break;
    default: break;
  }
}

server.listen(PORT, '0.0.0.0', () => console.log('  斗地主服务已启动  http://0.0.0.0:' + PORT));
process.on('SIGINT', () => { store.flush(); process.exit(0); });
process.on('SIGTERM', () => { store.flush(); process.exit(0); });
