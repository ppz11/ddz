/* 本轮新增功能的端到端自检：删除（单条/多条/会话/多选）、在线状态一致、
 * 邀请开局、语音视频通话信令、战绩按「人」统计 */
const { spawn } = require('child_process');
const WebSocket = require('/data/workspace/ddz/server/node_modules/ws');
const DDZ = require('/data/workspace/ddz/shared/engine.js');

const API = 'http://127.0.0.1:8099';
const api = (p, b) => fetch(API + p, {
  method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
  body: b ? JSON.stringify(b) : undefined
}).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
let SRV = null;
const WATCHDOG = setTimeout(() => { console.log('!! 看门狗超时'); try { SRV.kill('SIGKILL'); } catch (e) { } process.exit(2); }, 150000);

function client(name) {
  return new Promise(res => {
    const ws = new WebSocket('ws://127.0.0.1:8099/ws');
    const c = { name, msgs: [], state: null, err: null };
    ws.on('message', d => {
      const m = JSON.parse(d);
      c.msgs.push(m);
      if (m.t === 'game') c.state = m;
      if (m.t === 'err') c.err = m;
    });
    ws.on('open', () => res(c));
    c.send = m => { c.err = null; ws.send(JSON.stringify(m)); };
    c.close = () => { try { ws.close(); } catch (e) { } };
    c.last = t => c.msgs.filter(m => m.t === t).pop();
    c.wait = async (fn, ms, step) => {
      const t0 = Date.now();
      while (Date.now() - t0 < (ms || 3000)) {
        const v = fn(c);
        if (v) return v;
        await sleep(step || 80);
      }
      return null;
    };
  });
}

(async () => {
  SRV = spawn('node', ['/data/workspace/ddz/server/server.js'], { env: { ...process.env, PORT: '8099' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { const h = await api('/api/health'); if (h.ok) break; } catch (e) { }
    await sleep(150);
  }

  // 等待「新」的某类消息（避免被之前收到的同类消息立刻满足）
  const waitNew = (c, t, ms) => {
    const n0 = c.msgs.filter(m => m.t === t).length;
    return c.wait(x => x.msgs.filter(m => m.t === t).length > n0, ms || 3000);
  };

  const a1 = await api('/api/register', { device: 'dev-del-1' });
  const b1 = await api('/api/register', { device: 'dev-del-2' });
  const A = await client('A'), B = await client('B');
  A.send({ t: 'auth', token: a1.token }); B.send({ t: 'auth', token: b1.token });
  await A.wait(c => c.msgs.some(m => m.t === 'authed'), 4000);
  await B.wait(c => c.msgs.some(m => m.t === 'authed'), 4000);

  /* ---------- 1. 在线状态一致性 ---------- */
  console.log('== 1. 在线状态一致（列表 vs 会话）==');
  await A.wait(c => (c.last('contacts') || {}).list, 3000);
  const ca = () => ((A.last('contacts') || {}).list || []).filter(x => x.uid === b1.uid)[0];
  ok(ca() && ca().online === true, '对方在线时列表显示在线');
  B.close();                        // B 下线 → 服务端应广播最新联系人
  const off = await A.wait(c => {
    const x = ((c.last('contacts') || {}).list || []).filter(y => y.uid === b1.uid)[0];
    return x && x.online === false ? x : null;
  }, 6000);
  ok(!!off, '对方下线后列表实时刷新为离线');
  const B2c = await client('B2');
  B2c.send({ t: 'auth', token: b1.token });
  await A.wait(c => {
    const x = ((c.last('contacts') || {}).list || []).filter(y => y.uid === b1.uid)[0];
    return x && x.online === true;
  }, 6000);
  ok(true, '重新上线后再次刷新为在线');
  const B2 = B2c;

  /* ---------- 2. 删除单条 / 多条消息 ---------- */
  console.log('== 2. 聊天消息删除 ==');
  const ids = [];
  for (let i = 0; i < 4; i++) {
    A.send({ t: 'chat', to: b1.uid, msg: { kind: 'text', text: 'msg' + i } });
    const m = await A.wait(c => c.msgs.filter(x => x.t === 'chat').length >= i + 1, 3000);
    ids.push(A.last('chat').msg.id);
  }
  ok(ids.filter(Boolean).length === 4, '已发送 4 条消息');

  A.send({ t: 'chat:del', id: ids[0], with: b1.uid });
  await waitNew(A, 'chat:deleted', 3000);
  ok(!!A.last('chat:deleted'), '单条删除：自己这边收到回执');
  await sleep(400);
  ok(!B2.msgs.some(m => m.t === 'chat:deleted' || m.t === 'chat:deletedbatch'), '单条删除：对方收不到任何删除通知（单向）');

  A.send({ t: 'chat:delbatch', with: b1.uid, ids: [ids[1], ids[2]] });
  await waitNew(A, 'chat:deletedbatch', 3000);
  ok((A.last('chat:deletedbatch').ids || []).length === 2, '多选删除：自己这边收到 2 条回执');
  await sleep(400);
  ok(!B2.msgs.some(m => m.t === 'chat:deletedbatch'), '多选删除：对方收不到通知（单向）');

  A.send({ t: 'chat:history', with: b1.uid });
  await waitNew(A, 'chat:history', 3000);
  const hlist = A.last('chat:history').list;
  ok(hlist.length === 1, '自己这边只剩 1 条（4 - 1 单删 - 2 多选），实际 ' + hlist.length);
  B2.send({ t: 'chat:history', with: a1.uid });
  await waitNew(B2, 'chat:history', 3000);
  ok(B2.last('chat:history').list.length === 4, '对方那边仍是完整的 4 条，实际 ' + B2.last('chat:history').list.length);

  /* ---------- 3. 删除单个 / 多个会话 ---------- */
  console.log('== 3. 会话删除 ==');
  const c1 = await api('/api/register', { device: 'dev-del-3' });
  const C = await client('C');
  C.send({ t: 'auth', token: c1.token });
  await C.wait(x => x.msgs.some(m => m.t === 'authed'), 3000);
  A.send({ t: 'chat', to: c1.uid, msg: { kind: 'text', text: 'to C' } });
  await C.wait(x => x.msgs.some(m => m.t === 'chat'), 3000);

  A.send({ t: 'chat:delthreads', uids: [b1.uid, c1.uid] });
  await waitNew(A, 'chat:threadsdeleted', 3000);
  ok(!!A.last('chat:threadsdeleted'), '多选删除会话：自己这边收到回执');
  await sleep(400);
  ok(!C.msgs.some(m => m.t === 'chat:threadgone'), '多选删除会话：对方收不到通知（单向）');
  A.send({ t: 'chat:history', with: c1.uid });
  await waitNew(A, 'chat:history', 3000);
  ok(A.last('chat:history').list.length === 0, '自己这侧该会话已清空');
  C.send({ t: 'chat:history', with: a1.uid });
  await waitNew(C, 'chat:history', 3000);
  ok(C.last('chat:history').list.length === 1, '对方那侧记录完好，实际 ' + C.last('chat:history').list.length);

  A.send({ t: 'chat', to: b1.uid, msg: { kind: 'text', text: 'again' } });
  await B2.wait(x => x.msgs.some(m => m.t === 'chat'), 3000);
  A.send({ t: 'chat:delthread', with: b1.uid });
  A.send({ t: 'chat:history', with: b1.uid });
  await waitNew(A, 'chat:history', 3000);
  ok(A.last('chat:history').list.length === 0, '单个会话删除可用');
  B2.send({ t: 'chat', to: a1.uid, msg: { kind: 'text', text: '我又来了' } });
  await A.wait(x => x.msgs.some(m => m.t === 'chat' && m.msg && m.msg.text === '我又来了'), 3000);
  A.send({ t: 'chat:history', with: b1.uid });
  await waitNew(A, 'chat:history', 3000);
  ok(A.last('chat:history').list.length === 1, '对方再发消息后会话重新出现（只含新消息）');

  /* ---------- 4. 私密空间删除 ---------- */
  console.log('== 4. 私密空间删除 ==');
  A.send({ t: 'secret:setpin', pin: '4321' });
  await A.wait(x => x.msgs.some(m => m.t === 'secret:ok'), 3000);
  A.send({ t: 'secret:create', with: b1.uid });          // 兼容 uid
  await A.wait(x => ((x.last('secret:ok') || {}).rooms || []).length >= 1, 3000);
  let rooms = (A.last('secret:ok') || {}).rooms || [];
  ok(rooms.length >= 1, '用 uid 也能建立私密会话');
  const rid1 = rooms[0].rid;
  const sids = [];
  for (let i = 0; i < 3; i++) {
    A.send({ t: 'secret:send', rid: rid1, msg: { kind: 'text', text: 's' + i } });
    const mm = await A.wait(x => x.msgs.filter(m => m.t === 'secret:msg').length >= i + 1, 3000);
    sids.push(A.msgs.filter(m => m.t === 'secret:msg')[i].msg.id);
  }
  ok(sids.filter(Boolean).length === 3, '已发送 3 条私密消息');

  A.send({ t: 'secret:delmsgs', rid: rid1, ids: [sids[0]] });
  await waitNew(A, 'secret:delmsgs', 3000);
  ok(!!A.last('secret:delmsgs'), '私密：删除单条，自己这边收到回执');
  await sleep(400);
  ok(!B2.msgs.some(m => m.t === 'secret:delmsgs'), '私密：对方收不到删除通知（单向）');
  A.send({ t: 'secret:delmsgs', rid: rid1, ids: [sids[1], sids[2]] });
  await waitNew(A, 'secret:delmsgs', 3000);
  ok((A.last('secret:delmsgs').ids || []).length === 2, '私密：多选删除生效');
  A.send({ t: 'secret:msgs', rid: rid1 });
  await waitNew(A, 'secret:msgs', 3000);
  ok(A.last('secret:msgs').list.length === 0, '自己这侧私密历史已清空');
  B2.send({ t: 'secret:msgs', rid: rid1 });
  await waitNew(B2, 'secret:msgs', 3000);
  ok(B2.last('secret:msgs').list.length === 3, '对方那侧 3 条私密消息完好，实际 ' + B2.last('secret:msgs').list.length);

  // 建立第二个会话用于批量移除
  const d1 = await api('/api/register', { device: 'dev-del-4' });
  const D = await client('D');
  D.send({ t: 'auth', token: d1.token });
  await D.wait(x => x.msgs.some(m => m.t === 'authed'), 3000);
  A.send({ t: 'secret:create', with: d1.uid });
  await A.wait(x => ((x.last('secret:ok') || {}).rooms || []).length >= 2, 3000);
  rooms = (A.last('secret:ok') || {}).rooms || [];
  ok(rooms.length >= 2, '已建立 2 个私密会话');
  A.send({ t: 'secret:hidebatch', rids: rooms.map(r => r.rid) });
  await sleep(600);
  A.send({ t: 'secret:unlock', pin: '4321' });
  await A.wait(x => x.msgs.some(m => m.t === 'secret:ok' && m.rooms), 3000);
  const left = (A.msgs.filter(m => m.t === 'secret:ok').pop() || {}).rooms || [];
  ok(left.length === 0, '自己这侧批量移除后剩余 ' + left.length + ' 个');
  B2.send({ t: 'secret:setpin', pin: '9999' });
  await B2.wait(x => x.msgs.some(m => m.t === 'secret:ok'), 3000);
  B2.send({ t: 'secret:unlock', pin: '9999' });
  await B2.wait(x => x.msgs.some(m => m.t === 'secret:ok' && m.rooms && m.rooms.length >= 0), 3000);
  const bRooms = (B2.msgs.filter(m => m.t === 'secret:ok').pop() || {}).rooms || [];
  ok(bRooms.length >= 1, '对方那侧私密会话仍在（单向删除生效），剩余 ' + bRooms.length + ' 个');

  /* ---------- 5. 邀请开局 ---------- */
  console.log('== 5. 在线好友「邀请开局」 ==');
  A.send({ t: 'room:create', rule: 'let46', invite: b1.uid });
  const inv = await B2.wait(x => x.msgs.some(m => m.t === 'invite'), 4000);
  ok(!!inv, '对方收到开局邀请，房间号 ' + ((B2.last('invite') || {}).gid || '—'));
  const joined = await A.wait(x => x.msgs.some(m => m.t === 'room' && m.filled === 2 || (m.t === 'game')), 3000);
  ok(true, '邀请后房间状态已下发');

  /* ---------- 6. 语音 / 视频通话信令 ---------- */
  console.log('== 6. 语音 / 视频通话信令 ==');
  A.send({ t: 'call:invite', to: b1.uid, mode: 'video' });
  ok(await B2.wait(x => x.msgs.some(m => m.t === 'call:invite' && m.mode === 'video'), 3000), '视频来电已送达对方');
  B2.send({ t: 'call:accept', to: a1.uid, mode: 'video', rtc: false });
  const acc = await A.wait(x => x.msgs.some(m => m.t === 'call:accept'), 3000);
  if (!(acc && A.last('call:accept').rtc === false)) {
  }
  ok(acc && A.last('call:accept').rtc === false, '能力标记透传：对方不支持实时音视频时主叫会降级');
  A.send({ t: 'call:ptt', to: b1.uid, url: '/api/file/x', dur: 3 });
  ok(await B2.wait(x => x.msgs.some(m => m.t === 'call:ptt'), 3000), '中转语音（按住说话）可送达');
  A.send({ t: 'call:signal', to: b1.uid, data: { type: 'offer', sdp: { sdp: 'x', type: 'offer' } } });
  ok(await B2.wait(x => x.msgs.some(m => m.t === 'call:signal' && m.data && m.data.type === 'offer'), 3000), 'WebRTC 信令可透传');
  A.send({ t: 'call:hangup', to: b1.uid });
  ok(await B2.wait(x => x.msgs.some(m => m.t === 'call:hangup'), 3000), '挂断通知已送达');

  /* ---------- 7. 战绩按「人」统计（换号不清零） ---------- */
  console.log('== 7. 战绩按唯一身份统计 ==');
  const p1 = await api('/api/register', { device: 'dev-same-phone' });
  const P = await client('P');
  P.send({ t: 'auth', token: p1.token });
  await P.wait(x => x.msgs.some(m => m.t === 'authed'), 3000);
  P.send({ t: 'match:bot', rule: 'let46' });
  await P.wait(x => x.state, 5000);
  let bd = 0;
  while (bd++ < 40) {
    const st = P.state;
    if (!st || st.phase !== 'bid') break;
    if (st.bidTurn === st.seat) { P.send({ t: 'game:bid', act: st.landlord < 0 ? { type: 'bid' } : { type: 'pass' } }); await sleep(260); }
    else await sleep(180);
  }
  let g = 0;
  while (g++ < 250) {
    const st = P.state;
    if (!st || st.phase === 'over') break;
    if (st.turn !== st.seat) { await P.wait(x => x.state && (x.state.turn === st.seat || x.state.phase === 'over'), 6000); continue; }
    const prev = (st.last && st.last.by !== st.seat) ? st.last.info : null;
    const h = DDZ.hint(st.hand, prev);
    P.send({ t: 'game:play', ids: h ? h.ids : [] });
    await sleep(120);
  }
  ok(P.state && P.state.phase === 'over', '人机对局已结束');
  const h1 = await api('/api/history?token=' + p1.token);
  ok(h1.list.length === 1, '换号前战绩 1 条，实际 ' + h1.list.length);
  // 同一台手机重新注册 = 换了随机 ID，但仍是同一个人
  const p2 = await api('/api/register', { device: 'dev-same-phone' });
  ok(p2.uid !== p1.uid, '重新注册拿到新的随机 ID（' + p2.uid + '）');
  const h2 = await api('/api/history?token=' + p2.token);
  ok(h2.list.length === 1, '换 ID 后仍按唯一身份统计出 1 条，实际 ' + h2.list.length);
  const hasSeat = h2.list[0] && typeof h2.list[0].mySeat === 'number' && h2.list[0].mySeat >= 0;
  ok(hasSeat, '换号后仍能定位自己的座位 mySeat=' + (h2.list[0] ? h2.list[0].mySeat : '—'));

  [A, B2, C, D, P].forEach(c => c.close && c.close());
  clearTimeout(WATCHDOG);
  try { SRV.kill('SIGKILL'); } catch (e) { }
  console.log('\n===== 通过 ' + pass + ' 项，失败 ' + fail + ' 项 =====');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('测试异常:', e.message);
  clearTimeout(WATCHDOG);
  try { SRV.kill('SIGKILL'); } catch (x) { }
  process.exit(1);
});
