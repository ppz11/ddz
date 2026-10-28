/* 极简 JSON 持久化：数据全部落在 data/db.json，无需数据库、无需编译原生模块 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UP_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensure() {
  fs.mkdirSync(UP_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(blank()));
}
function blank() {
  return { users: {}, messages: [], secretRooms: [], games: [], seq: 1000, uploads: {},
    hidden: {}, secretHidden: {} };
}

let db = null;
let dirty = false;
let timer = null;

function load() {
  ensure();
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { db = blank(); }
  if (!db.users) db.users = {};
  if (!db.messages) db.messages = [];
  if (!db.secretRooms) db.secretRooms = [];
  if (!db.games) db.games = [];
  if (!db.uploads) db.uploads = {};
  if (!db.seq) db.seq = 1000;
  // 单向删除：记录「谁把哪条消息 / 哪个会话藏起来了」，只影响本人
  if (!db.hidden) db.hidden = {};
  if (!db.secretHidden) db.secretHidden = {};
  return db;
}
function get() { return db || load(); }
function save() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(flush, 400);
}
function flush() {
  timer = null;
  if (!dirty) return;
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
    dirty = false;
  } catch (e) { console.error('[store] 写入失败', e.message); }
}
function nextId(p) { get().seq++; save(); return p + get().seq; }

/* 上传文件 */
function putUpload(name, mime, buf, meta) {
  const id = nextId('u');
  const ext = (path.extname(name) || '').replace(/[^\w.]/g, '').slice(0, 10);
  const file = id + ext;
  fs.writeFileSync(path.join(UP_DIR, file), buf);
  get().uploads[id] = { id, file, name, mime, size: buf.length, ts: Date.now(), meta: meta || {} };
  save();
  return get().uploads[id];
}
function getUpload(id) { return get().uploads[id]; }
function uploadPath(rec) { return path.join(UP_DIR, rec.file); }
function delUpload(id) {
  const u = get().uploads[id];
  if (!u) return false;
  try { fs.unlinkSync(path.join(UP_DIR, u.file)); } catch (e) {}
  delete get().uploads[id];
  save();
  return true;
}

module.exports = { get, save, flush, nextId, ensure, putUpload, getUpload, uploadPath, delUpload, UP_DIR, DATA_DIR };
