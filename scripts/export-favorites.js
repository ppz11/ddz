/* ============================================================
 * 收藏导出（v63）
 * 收藏条目存在 data/db.json 的 persons[pid].favs，
 * 语音 / 图片 / 视频本体存在 data/uploads/，条目里以 /api/file/<id> 引用。
 * 本脚本把两者一起复制到固定目录，并打成 tar.gz 方便 scp 到本地。
 *
 *   node scripts/export-favorites.js
 *   → /opt/ddz/export/favorites/favorites_<时间戳>/
 *   → /opt/ddz/export/favorites/ddz-favorites.tar.gz   （每次覆盖为最新）
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DB = path.join(DATA, 'db.json');
const UP = path.join(DATA, 'uploads');
const EXP = path.join(ROOT, 'export', 'favorites');

function run() {
  if (!fs.existsSync(DB)) throw new Error('找不到 ' + DB);
  const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
  const persons = db.persons || {};
  const uploads = db.uploads || {};
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const out = path.join(EXP, 'favorites_' + stamp);
  const filesDir = path.join(out, 'files');
  fs.mkdirSync(filesDir, { recursive: true });

  const items = [];
  const used = new Set();
  Object.keys(persons).forEach(pid => {
    const p = persons[pid] || {};
    (p.favs || []).forEach(it => {
      items.push(Object.assign({ _pid: pid, _person: p.nick || '' }, it));
      /* 条目里任意字段只要出现 /api/file/uXXXX 就收录对应实体文件 */
      JSON.stringify(it).replace(/\/api\/file\/([A-Za-z0-9_.-]+)/g, (_m, id) => {
        used.add(id); return _m;
      });
    });
  });

  const media = [];
  used.forEach(id => {
    const rec = uploads[id];
    if (!rec) return;
    const src = path.join(UP, String(rec.file || ''));
    if (!fs.existsSync(src)) return;
    const kind = String((rec.meta && rec.meta.kind) || rec.mime || 'file').replace(/[^A-Za-z0-9_-]/g, '_');
    const dir = path.join(filesDir, kind);
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(rec.name || 'file').replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 60);
    const dst = path.join(dir, id + '_' + safe);
    fs.copyFileSync(src, dst);
    media.push({ id, name: rec.name, mime: rec.mime, size: rec.size, kind,
                 url: '/api/file/' + id, file: path.relative(out, dst) });
  });

  const manifest = { exportedAt: new Date().toISOString(),
                     source: { db: DB, uploads: UP },
                     favorites: items, media: media };
  fs.writeFileSync(path.join(out, 'favorites.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(out, 'README.txt'), [
    'PP斗地主 · 收藏导出',
    '导出时间：' + manifest.exportedAt,
    '',
    'favorites.json  —— 全部收藏条目（文字内容、语音/图片/视频的引用与元信息）',
    'files/          —— 收藏里引用到的语音、图片、视频实体文件，按类型分目录',
    '',
    '服务器固定地址：' + EXP,
    '浏览器下载：    http://<你的服务器>:8080/api/export/favorites?key=6688',
    '拷回本地电脑：  scp -r root@<你的服务器>:' + out + ' ~/Desktop/',
    ''
  ].join('\n'));
  /* 清单同时写一份到固定位置，删软件前也能一眼找到 */
  fs.writeFileSync(path.join(EXP, 'latest-favorites.json'), JSON.stringify(manifest, null, 2));

  let tar = null;
  try {
    tar = path.join(EXP, 'ddz-favorites.tar.gz');
    cp.execFileSync('tar', ['-czf', tar, '-C', EXP, path.basename(out)], { stdio: 'ignore' });
  } catch (e) { tar = null; }
  return { dir: out, tar: tar, list: { favorites: items.length, media: media.length } };
}

if (require.main === module) {
  const r = run();
  console.log('收藏条目：' + r.list.favorites + ' 条，媒体文件：' + r.list.media + ' 个');
  console.log('导出目录：' + r.dir);
  console.log(r.tar ? ('打包文件：' + r.tar) : '（本机没有 tar，直接 scp 上面那个目录即可）');
}
module.exports = { run };
