// 端到端：邀请真人 + 牌桌「正在说话」状态
process.chdir('/data/workspace/ddz');
const WS = require('/data/workspace/ddz/server/node_modules/ws');
const { spawn } = require('child_process');
const http = require('http');



function waitPort(port, t = 15000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function loop() {
      const s = require('net').createConnection(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); res(); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - t0 > t) return rej(new Error('timeout'));
        setTimeout(loop, 300);
      });
    })();
  });
}

function api(path, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body || {});
    const r = http.request({ host: '127.0.0.1', port: 8080, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (resp) => {
        let b = ''; resp.on('data', c => b += c);
        resp.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(b); } });
      });
    r.on('error', rej); r.write(data); r.end();
  });
}

function mkClient(token) {
  const ws = new WS('ws://127.0.0.1:8080');
  const inbox = [];
  const waiters = [];
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    inbox.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].t === m.t) { waiters[i].res(m); waiters.splice(i, 1); }
    }
  });
  return {
    ws,
    send: o => ws.send(JSON.stringify(o)),
    wait: (t, ms = 6000) => new Promise((res, rej) => {
      const hit = inbox.find(m => m.t === t);
      if (hit) return res(hit);
      const w = { t, res }; waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1);
        rej(new Error('wait timeout: ' + t));
      }, ms);
    }),
    find: t => inbox.find(m => m.t === t),
    clear: () => { inbox.length = 0; }
  };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const a = await api('/api/register', { device: 'e2e-A' });
  const b = await api('/api/register', { device: 'e2e-B' });

  const ca = mkClient(); const cb = mkClient();
  await new Promise(r => ca.ws.on('open', r));
  await new Promise(r => cb.ws.on('open', r));
  ca.send({ t: 'auth', token: a.token });
  cb.send({ t: 'auth', token: b.token });
  await ca.wait('authed'); await cb.wait('authed');
  await sleep(400);

  // A 创建房间
  ca.send({ t: 'room:create', rule: 'trio54' });
  const roomMsg = await ca.wait('room');
  const gid = roomMsg.gid;
  console.log('A 创建房间 gid=', gid);

  // A 补一个机器人，凑够人数以便测试 speaking（speaking 需要同房间）
  ca.send({ t: 'room:joinbot', gid });

  // A 批量邀请 B（真人）
  ca.send({ t: 'room:invitemany', gid, tos: [b.uid] });
  const invited = await cb.wait('invite').catch(e => null);
  console.log('B 收到邀请:', invited ? ('✔ from=' + (invited.by && invited.by.nick) + ' gid=' + invited.gid) : '✘ 没收到');

  // B 加入房间
  cb.send({ t: 'invite:join', gid });
  await sleep(600);
  const rb = cb.find('room');
  console.log('B 加入房间:', rb ? '✔' : '✘');

  // A 发「正在说话」→ B 应收到
  ca.send({ t: 'table:speaking', gid, on: true });
  const sp = await cb.wait('table:speaking').catch(e => null);
  console.log('B 收到「正在说话」:', sp ? ('✔ on=' + sp.on + ' seat=' + sp.seat) : '✘ 没收到');

  cb.clear();                                  // 清掉缓存，避免取到上一条 on=true
  ca.send({ t: 'table:speaking', gid, on: false });
  const sp2 = await cb.wait('table:speaking').catch(e => null);
  console.log('B 收到「停止说话」:', sp2 ? ('✔ on=' + sp2.on) : '✘ 没收到');

  ca.ws.close(); cb.ws.close();

  console.log('--- 完成 ---');
})().catch(e => { console.log('✘', e.message); process.exit(1); });
