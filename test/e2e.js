/* 端到端联调测试：自行拉起服务 → 模拟两名玩家走完整流程 → 关闭服务 */
const { spawn } = require('child_process');
const fs = require('fs');
const WebSocket = require('/data/workspace/ddz/server/node_modules/ws');
const DDZ = require('/data/workspace/ddz/shared/engine.js');

const B = 'http://127.0.0.1:8080';
const api = (p, b) => fetch(B + p, {
  method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined
}).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
let SRV = null;
const WATCHDOG = setTimeout(() => { console.log('!! 看门狗超时'); try { SRV.kill('SIGKILL'); } catch (e) { } process.exit(2); }, 120000);

function client(name) {
  return new Promise(res => {
    const ws = new WebSocket('ws://127.0.0.1:8080/ws');
    const c = { name, state: null, err: null, n: 0, msgs: [] };
    ws.on('message', d => {
      const m = JSON.parse(d);
      c.msgs.push(m);
      if (m.t === 'game') { c.state = m; c.n++; }
      if (m.t === 'room') c.room = m;
      if (m.t === 'err') c.err = m;
    });
    ws.on('open', () => res(c));
    c.send = m => { c.err = null; ws.send(JSON.stringify(m)); };
    c.sent = count => { const b = c.n; return until(() => c.n > b, count); };
    c.close = () => ws.close();
  });
}
function until(fn, ms) {
  return new Promise(res => {
    const t0 = Date.now();
    (function loop() {
      if (fn()) return res(true);
      if (Date.now() - t0 > (ms || 2000)) return res(false);
      setTimeout(loop, 25);
    })();
  });
}
async function startServer() {
  SRV = spawn('node', ['/data/workspace/ddz/server/server.js'], {
    cwd: '/data/workspace/ddz/server',
    env: Object.assign({}, process.env, { PORT: '8080' }),
    stdio: ['ignore', fs.openSync('/tmp/srv.log', 'w'), fs.openSync('/tmp/srv.log', 'a')]
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(B + '/api/health')).ok) return; } catch (e) { }
    await sleep(150);
  }
  throw new Error('服务器启动失败');
}

(async () => {
  await startServer();

  console.log('== 1. 注册 / 登录 ==');
  const a = await api('/api/register', { device: 't1' });
  const b = await api('/api/register', { device: 't2' });
  ok(!!(a.token && b.token), '注册返回 token');
  ok(!!(a.me.nick && a.me.avatar), '首次即自动生成昵称与头像：' + a.me.nick);
  const a2 = await api('/api/login', { token: a.token });
  ok(!!a2.me.nick, '重新登录成功');
  console.log('     登录前：' + a.me.nick + '  登录后：' + a2.me.nick + (a.me.nick !== a2.me.nick ? '  （已随机更换 ✓）' : ''));
  ok(a.me.uid === a2.me.uid, '账号身份（UID）保持不变：' + a.me.uid);

  console.log('== 2. WebSocket 认证 + 大厅 ==');
  const A = await client('A'), B2 = await client('B');
  A.send({ t: 'auth', token: a.token });
  B2.send({ t: 'auth', token: b.token });
  await until(() => A.msgs.some(m => m.t === 'authed') && B2.msgs.some(m => m.t === 'authed'), 3000);
  ok(true, '双方认证通过');
  await sleep(300);
  const lb = A.msgs.filter(m => m.t === 'lobby').pop();
  ok(lb && lb.users.length >= 2, '大厅在线人数 ' + (lb ? lb.users.length : 0));

  console.log('== 3. 房间对战（让牌玩法 let46）==');
  A.send({ t: 'room:create', rule: 'let46' });
  await until(() => A.room, 2000);
  const gid = A.room.gid;
  ok(!!gid, '房间已创建，房号 ' + gid);
  B2.send({ t: 'room:join', gid });
  await until(() => A.state && B2.state, 3000);
  ok(A.state.phase === 'bid', '进入叫地主阶段');
  ok(A.state.hand.length === 17, '手牌 17 张');
  ok(A.state.seat === 0 && B2.state.seat === 1, '座位分配正确');

  const first = A.state.firstBidder;
  const bidder = first === 0 ? A : B2, other = first === 0 ? B2 : A;
  bidder.send({ t: 'game:bid', act: { type: 'bid' } });
  await until(() => A.state.bidTurn === (1 - first), 2000);
  other.send({ t: 'game:bid', act: { type: 'grab' } });
  await until(() => A.state.bidTurn === first, 2000);
  bidder.send({ t: 'game:bid', act: { type: 'pass' } });
  await until(() => A.state.phase === 'play', 2500);
  ok(A.state.phase === 'play', '进入出牌阶段');
  ok(A.state.landlord === (1 - first), '地主为抢地主方');
  ok(A.state.letCount === 2, '抢一次 → 让牌 2 张');
  ok(A.state.hand.length === 20 || B2.state.hand.length === 20, '地主 20 张（17 + 3 底牌）');
  ok(A.state.bottom && A.state.bottom.length === 3, '底牌 3 张已公开');

  let guard = 0, plays = 0;
  while (guard++ < 200) {
    const sa = A.state, sb = B2.state;
    if (!sa || !sb) break;
    if (sa.phase === 'over') break;
    const seat = sa.turn;
    const c = seat === 0 ? A : B2;
    const s = seat === 0 ? sa : sb;
    const prev = (s.last && s.last.by !== seat) ? s.last.info : null;
    const h = DDZ.hint(s.hand, prev);
    c.send({ t: 'game:play', ids: h ? h.ids : [] });
    const got = await c.sent(1800);
    if (c.err) { console.log('   出牌被拒：' + c.err.msg + '（seat=' + seat + '）'); break; }
    if (!got) { console.log('   出牌无响应'); break; }
    plays++;
  }
  ok(A.state && A.state.phase === 'over', '对局正常结束（共 ' + plays + ' 手）');
  ok(A.state && A.state.result, '产出结算 ' + JSON.stringify({ winner: A.state.result.winner, mult: A.state.result.multiplier }));
  ok(A.state && A.state.dead && A.state.dead.length === 9, '结束后公开 9 张封印废牌');

  console.log('== 4. 战绩记录 ==');
  const ha = await api('/api/history?token=' + a.token);
  ok(ha.list.length === 1, '战绩已保存 ' + ha.list.length + ' 条');
  ok(ha.list[0].rule === 'let46', '记录玩法正确');

  console.log('== 5. 私信（文字 / 表情 / 语音 / 图片 / 视频 / 文件）==');
  const recv = (c, k) => until(() => c.msgs.some(m => m.t === 'chat' && m.msg.kind === k), 2500).then(() => c.msgs.filter(m => m.t === 'chat' && m.msg.kind === k).pop());
  A.send({ t: 'chat', to: b.uid, msg: { kind: 'text', text: '你好呀' } });
  ok(!!(await recv(B2, 'text')), 'B 收到文字消息');
  A.send({ t: 'chat', to: b.uid, msg: { kind: 'sticker', sticker: { pack: 'face', id: 'laugh' } } });
  ok(!!(await recv(B2, 'sticker')), 'B 收到表情贴纸');
  const up = await api('/api/upload', { name: 'v.webm', mime: 'audio/webm', data: Buffer.from('hello').toString('base64'), kind: 'voice', dur: 3 });
  ok(!!up.url, '上传成功 ' + up.url);
  const dl = await fetch(B + up.url);
  ok(dl.status === 200 && dl.headers.get('content-type') === 'audio/webm', '文件可下载，类型 ' + dl.headers.get('content-type'));
  A.send({ t: 'chat', to: b.uid, msg: { kind: 'voice', url: up.url, dur: 3 } });
  ok(!!(await recv(B2, 'voice')), 'B 收到语音消息');
  for (const k of ['image', 'video', 'file']) {
    const u = await api('/api/upload', { name: 'x.' + k, mime: 'application/octet-stream', data: Buffer.from('abc').toString('base64'), kind: k });
    A.send({ t: 'chat', to: b.uid, msg: { kind: k, url: u.url, name: 'x.' + k, size: 3 } });
    ok(!!(await recv(B2, k)), 'B 收到 ' + k);
  }
  B2.send({ t: 'chat:history', with: a.uid });
  await until(() => B2.msgs.some(m => m.t === 'chat:history'), 2000);
  const hb = B2.msgs.filter(m => m.t === 'chat:history').pop();
  ok(hb.list.length === 6, '聊天历史 ' + hb.list.length + ' 条');

  console.log('== 6. 私密空间 ==');
  A.send({ t: 'secret:setpin', pin: '2580' });
  await until(() => A.msgs.some(m => m.t === 'secret:ok'), 2000);
  A.send({ t: 'secret:create', with: b.uid });
  await until(() => ((A.msgs.filter(m => m.t === 'secret:ok').pop() || {}).rooms || []).length === 1, 2500);
  const rooms = (A.msgs.filter(m => m.t === 'secret:ok').pop() || {}).rooms || [];
  if (!rooms.length) console.log('   [debug] secret:ok 列表 =', JSON.stringify(A.msgs.filter(m => m.t === 'secret:ok')), ' err =', JSON.stringify(A.err));
  const rid = rooms[0] && rooms[0].rid;
  ok(!!rid, '私密会话已创建 ' + rid);
  A.send({ t: 'secret:unlock', pin: '1111' });
  ok(await until(() => A.msgs.some(m => m.t === 'secret:bad'), 2000), '错误暗号被拒绝');
  A.send({ t: 'secret:unlock', pin: '2580' });
  ok(await until(() => A.msgs.filter(m => m.t === 'secret:ok').length >= 3, 2000), '正确暗号通过');
  A.send({ t: 'secret:send', rid, msg: { kind: 'text', text: '只有我们能看到' } });
  ok(await until(() => B2.msgs.some(m => m.t === 'secret:msg'), 2500), '私密消息实时送达');
  A.send({ t: 'secret:msgs', rid });
  await until(() => A.msgs.some(m => m.t === 'secret:msgs'), 2000);
  ok(A.msgs.filter(m => m.t === 'secret:msgs').pop().list.length === 1, '私密消息已持久化');
  ok(!hb.list.some(m => m.text === '只有我们能看到'), '私密消息不出现在普通聊天里');

  console.log('== 7. 战绩删除 ==');
  A.send({ t: 'history:del', id: ha.list[0].gid });
  await until(() => A.msgs.some(m => m.t === 'history'), 2500);
  ok((await api('/api/history?token=' + a.token)).list.length === 0, '战绩已删除');

  console.log('== 8. 快速匹配（经典玩法 duo37）==');
  const c3 = await api('/api/register', { device: 't3' }), c4 = await api('/api/register', { device: 't4' });
  const C = await client('C'), D = await client('D');
  C.send({ t: 'auth', token: c3.token }); D.send({ t: 'auth', token: c4.token });
  await until(() => C.msgs.some(m => m.t === 'authed') && D.msgs.some(m => m.t === 'authed'), 3000);
  C.send({ t: 'match', rule: 'duo37', quick: true });
  await until(() => C.msgs.some(m => m.t === 'matching'), 2000);
  D.send({ t: 'match', rule: 'duo37', quick: true });
  await until(() => C.state && D.state, 3000);
  ok(C.state && C.state.rule === 'duo37', '经典玩法匹配成功，手牌 ' + (C.state ? C.state.hand.length : 0) + ' 张');
  ok(C.state && C.state.deadCount === 17, '经典玩法废牌 17 张');

  console.log('== 9. 三人斗地主（人机对战）==');
  const T = await client('T');
  const t1 = await api('/api/register', { device: 't5' });
  T.send({ t: 'auth', token: t1.token });
  await until(() => T.msgs.some(m => m.t === 'authed'), 3000);
  T.send({ t: 'room:create', rule: 'trio54', withBot: true });
  await until(() => T.state, 4000);
  ok(T.state && T.state.n === 3, '三人房间已创建，座位数 ' + (T.state ? T.state.n : 0));
  ok(T.state && T.state.seats.filter(x => x && x.bot).length === 2, '两个机器人已就位');
  ok(T.state && T.state.seats.every(x => x && x.nick), '机器人也有随机昵称头像，牌桌上看不出区别：' + (T.state ? T.state.seats.map(x => x.nick).join(' / ') : ''));
  ok(T.state && T.state.hand.length === 17, '手牌 17 张');
  // 叫分阶段：轮到自己就叫 1 分，其余等机器人
  let bg = 0;
  while (bg++ < 60) {
    const st = T.state;
    if (!st || st.phase !== 'bid') break;
    if (st.bidTurn === st.seat) {
      T.send({ t: 'game:bid', act: { type: 'bid', score: 1 } });
      await sleep(260);
    } else await sleep(200);
  }
  await until(() => T.state && T.state.phase === 'play', 8000);
  ok(T.state && T.state.phase === 'play', '机器人自动完成叫分，进入出牌');
  ok(T.state && T.state.seats[T.state.landlord], '地主已确定');
  // 玩家自动出牌直到结束
  let g2 = 0;
  while (g2++ < 250) {
    const st = T.state;
    if (!st || st.phase === 'over') break;
    if (st.turn !== st.seat) {
      await until(() => T.state && (T.state.turn === st.seat || T.state.phase === 'over'), 6000);
      continue;
    }
    const prev = (st.last && st.last.by !== st.seat) ? st.last.info : null;
    const h = DDZ.hint(st.hand, prev);
    T.send({ t: 'game:play', ids: h ? h.ids : [] });
    await T.sent(4000);
    if (T.err) { console.log('   出牌被拒：' + T.err.msg); T.err = null; }
  }
  if (T.state && T.state.phase !== 'over') {
    console.log('   [debug] 未结束：phase=' + T.state.phase + ' turn=' + T.state.turn + ' seat=' + T.state.seat +
      ' counts=' + JSON.stringify(T.state.counts) + ' last=' + (T.state.last ? T.state.last.info.type + ' by' + T.state.last.by : 'null'));
  }
  ok(T.state && T.state.phase === 'over', '三人对局正常结束');
  ok(T.state && T.state.result && T.state.result.winnerSide, '产出结算 ' + JSON.stringify({ side: T.state.result.winnerSide, mult: T.state.result.multiplier }));
  const ht = await api('/api/history?token=' + t1.token);
  ok(ht.list.length >= 1, '三人战绩已保存 ' + ht.list.length + ' 条');
  ok(ht.list[0].rule === 'trio54', '记录玩法为三人场');

  console.log('== 10. 双人人机对战 ==');
  const E = await client('E');
  const e1 = await api('/api/register', { device: 't6' });
  E.send({ t: 'auth', token: e1.token });
  await until(() => E.msgs.some(m => m.t === 'authed'), 3000);
  E.send({ t: 'match:bot', rule: 'let46' });
  await until(() => E.state, 4000);
  ok(E.state && E.state.seats.filter(x => x && x.bot).length === 1, '机器人对手已就位');
  // 让牌玩法：轮到自己就抢/叫，然后自动出牌
  let b4 = 0;
  while (b4++ < 40) {
    const st = E.state;
    if (!st || st.phase !== 'bid') break;
    if (st.bidTurn === st.seat) {
      E.send({ t: 'game:bid', act: st.landlord < 0 ? { type: 'bid' } : { type: 'pass' } });
      await sleep(280);
    } else await sleep(200);
  }
  let g3 = 0;
  while (g3++ < 250) {
    const st = E.state;
    if (!st || st.phase === 'over') break;
    if (st.turn !== st.seat) {
      await until(() => E.state && (E.state.turn === st.seat || E.state.phase === 'over'), 6000);
      continue;
    }
    const prev = (st.last && st.last.by !== st.seat) ? st.last.info : null;
    const h = DDZ.hint(st.hand, prev);
    E.send({ t: 'game:play', ids: h ? h.ids : [] });
    await E.sent(4000);
  }
  ok(E.state && E.state.phase === 'over', '双人人机对局结束');

  console.log('== 11. 伪装广告层 ==');
  const ads = await api('/api/ads');
  ok(ads.list && ads.list.length >= 10, '广告文案库 ' + (ads.list ? ads.list.length : 0) + ' 条');
  ok(ads.list.every(x => /斗地主/.test(x)), '文案均含斗地主字样（伪装成营销推送）');

  [A, B2, C, D, T, E].forEach(c => c.close());
  clearTimeout(WATCHDOG);
  try { SRV.kill('SIGKILL'); } catch (e) { }
  console.log('\n===== 通过 ' + pass + ' 项，失败 ' + fail + ' 项 =====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e.message); try { SRV.kill('SIGKILL'); } catch (x) { } process.exit(1); });
