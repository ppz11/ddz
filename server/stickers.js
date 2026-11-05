/* 服务器统一表情包：房主上传一次，所有玩家的手机上自动出现同样的包。
   数据落在 data/stickers.json，图片本体走 /api/upload（存 uploads/）。
   客户端登录后拉 /api/stickers 拉取，本地不需要再手动导入。 */
const fs = require('fs');
const path = require('path');

const F = path.join(__dirname, '..', 'data', 'stickers.json');
let packs = null;

function load() {
  if (packs) return packs;
  try { packs = JSON.parse(fs.readFileSync(F, 'utf8')) || []; }
  catch (e) { packs = []; }
  if (!Array.isArray(packs)) packs = [];
  return packs;
}
function save() {
  try {
    fs.mkdirSync(path.dirname(F), { recursive: true });
    const tmp = F + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(packs));
    fs.renameSync(tmp, F);
  } catch (e) { console.error('[stickers] 写入失败', e.message); }
}
function list() { return load().slice(); }
function get(id) { return load().filter(function (x) { return x.id === id; })[0]; }

/* 新增或覆盖。items: [{id,name,label,url,anim,mime}] —— label 是房主写的简短说明，url 是 /api/file/xxx 相对路径，
   客户端按自己连的服务器地址补全，换服务器不用重新传图。 */
function upsert(p) {
  load();
  const id = String(p.id || ('sp' + Date.now().toString(36)));
  const rec = {
    id: id,
    name: String(p.name || '表情包').slice(0, 30),
    items: (Array.isArray(p.items) ? p.items : []).slice(0, 300).map(function (it) {
      return {
        id: String(it.id || ('s' + Math.random().toString(36).slice(2, 8))),
        name: String(it.name || '').slice(0, 60),
        /* v44：房主在上传工具里给每张动图写的简短说明（如「走了 再也不理你了」），
           随包存服务器，所有手机同步后显示在预览图下面。 */
        label: String(it.label || '').slice(0, 24),
        url: String(it.url || ''),
        mime: String(it.mime || ''),
        anim: !!it.anim
      };
    }).filter(function (it) { return it.url; }),
    ts: Date.now()
  };
  const i = packs.findIndex(function (x) { return x.id === id; });
  if (i >= 0) packs[i] = rec; else packs.push(rec);
  if (p.top && i >= 0) { const r = packs.splice(i, 1)[0]; packs.unshift(r); }
  else if (p.top) { packs.unshift(packs.pop()); }
  save();
  return rec;
}
function del(id) {
  load();
  const i = packs.findIndex(function (x) { return x.id === id; });
  if (i < 0) return false;
  packs.splice(i, 1);
  save();
  return true;
}

module.exports = { load, list, get, upsert, del };
