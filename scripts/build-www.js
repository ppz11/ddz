#!/usr/bin/env node
/* 生成 App 用的 www 目录：复制前端静态资源，并注入服务器地址 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const SERVER = (process.env.APP_SERVER || '').trim().replace(/\/$/, '');

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmrf(WWW);
fs.mkdirSync(WWW, { recursive: true });
copyDir(path.join(ROOT, 'public'), WWW);
// shared 目录（规则引擎 / 广告文案）前端也要用
copyDir(path.join(ROOT, 'shared'), path.join(WWW, 'shared'));
// 服务端与账号相关代码不打包进 App
rmrf(path.join(WWW, 'data'));

// 注入服务器地址
const htmlPath = path.join(WWW, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace('<head>', '<head>\n<script>window.APP_SERVER = ' + JSON.stringify(SERVER) + ';</script>');
fs.writeFileSync(htmlPath, html);

console.log('www 已生成：' + WWW);
console.log('服务器地址：' + (SERVER || '（未指定，将使用同源地址）'));
