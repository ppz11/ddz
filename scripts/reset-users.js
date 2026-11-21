/* ============================================================
 * 清空历史留存的用户数据（v63）
 *
 * 删除：账号 users、聊天消息 messages、牌局 games、单向隐藏记录、
 *       私密会话 secretRooms、上下线记录 presenceLog、在线表
 * 保留：persons（真人档案 + 金币 + 收藏 favs）、uploads（语音/图片/视频）、
 *       表情包 stickers.js 自己的数据 —— 这些是「删软件前要导出的东西」
 *
 * 用法（必须显式加 --yes，防止误跑）：
 *   node scripts/reset-users.js --yes
 * 执行前自动把整个 db.json 备份到 data/db.backup.<时间戳>.json，可随时还原。
 * 注意：跑完请 systemctl restart ddz，已登录的 App 会走 v60 自愈重新注册。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const DB = path.join(__dirname, '..', 'data', 'db.json');

if (process.argv.indexOf('--yes') < 0) {
  console.log('这是清空用户数据的操作。确认请先导出收藏，再执行：');
  console.log('  node scripts/export-favorites.js');
  console.log('  node scripts/reset-users.js --yes');
  process.exit(0);
}
if (!fs.existsSync(DB)) { console.error('找不到 ' + DB); process.exit(1); }
const raw = fs.readFileSync(DB, 'utf8');
const bak = DB.replace(/db\.json$/, 'db.backup.' + Date.now() + '.json');
fs.writeFileSync(bak, raw);
const db = JSON.parse(raw);
const persons = db.persons || {}, uploads = db.uploads || {};
Object.keys(persons).forEach(pid => {
  if (!persons[pid]) return;
  delete persons[pid].cur;
  /* users 已清空，档案里指向旧 uid / 旧 device 的引用也要清掉，
     否则好友空间「按 pid 找当前 uid」会拿到不存在的账号 */
  persons[pid].uids = [];
  /* devices 必须保留：新账号用同一台设备登录时靠它找回真人档案，
     否则收藏会挂到新档案上、看起来「丢了」 */
});

const next = {
  users: {}, messages: [], secretRooms: [], games: [],
  seq: db.seq || 1000,
  uploads: uploads,
  hidden: {}, secretHidden: {}, presenceLog: [],
  /* v80：UID 永不复用 —— 即使清空所有账号，历史 UID 也不能再发给新用户 */
  usedUids: db.usedUids || {},
  persons: persons,
  /* 收藏、隐私好友、位置、表情包等业务数据一律保留 */
  sfriends: db.sfriends || {},
  friends: db.friends || {},
  stickers: db.stickers || undefined,
  favs: db.favs || undefined
};
Object.keys(db).forEach(k => {
  if (!(k in next)) next[k] = db[k];          // 其它自定义字段原样保留，别误删
});
Object.keys(next).forEach(k => { if (next[k] === undefined) delete next[k]; });
fs.writeFileSync(DB + '.tmp', JSON.stringify(next));
fs.renameSync(DB + '.tmp', DB);
console.log('已备份：' + bak);
console.log('已清空 users/messages/games/secretRooms/presenceLog，保留 persons(含收藏) 与 uploads');
console.log('请执行： systemctl restart ddz');
