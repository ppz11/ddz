#!/usr/bin/env node
/* v84：物理删除 46 张玩法（let46）的全部战绩记录。
   46 张模式已彻底下线，用户要求「删掉所有记录」，不是只在界面隐藏。

   用法（必须先停服务，否则内存里的旧 db 会把文件覆盖回去）：
     systemctl stop ddz
     node /opt/ddz/scripts/purge-let46.js
     systemctl start ddz

   也可指定路径：node scripts/purge-let46.js /path/to/db.json
   执行前自动备份成 db.json.bak-let46-<时间戳>；幂等，可重复执行。 */
'use strict';
const fs = require('fs');
const path = require('path');

const dbPath = process.argv[2] || process.env.DDZ_DB ||
  path.resolve(__dirname, '..', 'data', 'db.json');

if (!fs.existsSync(dbPath)) {
  console.log('未找到 db.json，无需处理：' + dbPath);
  process.exit(0);
}
const raw = fs.readFileSync(dbPath, 'utf8');
let db;
try { db = JSON.parse(raw); }
catch (e) { console.error('db.json 解析失败，未做任何改动：' + e.message); process.exit(1); }

const before = (db.games || []).length;
const removed = (db.games || []).filter(g => g && g.rule === 'let46').length;
const backup = dbPath + '.bak-let46-' + Date.now();
fs.writeFileSync(backup, raw);

db.games = (db.games || []).filter(g => !(g && g.rule === 'let46'));

/* 兼容个别旧版本把战绩放在 db.history 里的情况 */
let removed2 = 0;
if (Array.isArray(db.history)) {
  const b2 = db.history.length;
  db.history = db.history.filter(g => !(g && g.rule === 'let46'));
  removed2 = b2 - db.history.length;
}

/* 与 server/store.js 的 flush() 完全一致：先写临时文件再原子替换 */
const tmp = dbPath + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(db));
fs.renameSync(tmp, dbPath);

console.log('数据库：' + dbPath);
console.log('备份：' + backup);
console.log('games：' + before + ' -> ' + db.games.length + '，物理删除 ' + removed + ' 条 let46 战绩');
console.log('history：物理删除 ' + removed2 + ' 条 let46 记录');
console.log('完成，请重新启动服务。');
