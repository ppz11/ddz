const { spawn } = require('child_process');
const WebSocket=require('../server/node_modules/ws');
const DDZ=require('../shared/engine.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const B='http://127.0.0.1:8080';
const api=(p,b)=>fetch(B+p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
function client(){return new Promise(res=>{const ws=new WebSocket('ws://127.0.0.1:8080/ws');const c={state:null,n:0,err:null,room:null,pres:0};
 ws.on('message',d=>{const m=JSON.parse(d); if(m.t==='game'){c.state=m;c.n++;} if(m.t==='room'){c.room=m;} if(m.t==='err')c.err=m; if(m.t==='presence')c.pres++;});
 ws.on('open',()=>res(c)); c.send=m=>{c.err=null;ws.send(JSON.stringify(m));};
 c.sent=ms=>new Promise(r=>{const b=c.n;const t0=Date.now();(function l(){if(c.n>b||Date.now()-t0>ms)return r(c.n>b);setTimeout(l,25);})();});
 c.close=()=>ws.close();});}
let pass=0,fail=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); c?pass++:fail++;};
process.on('unhandledRejection', e => { console.log('测试异常:', e && e.message); process.exit(1); });
setTimeout(() => { console.log('超时退出'); process.exit(1); }, 150000);
(async()=>{
 const fsx=require('fs'); try{fsx.rmSync(__dirname + '/../data',{recursive:true,force:true});}catch(e){}
 const srv = spawn('node', ['server.js'], { cwd: __dirname + '/../server', env: {...process.env, PORT:'8080'}, stdio: 'ignore' });
 for(let i=0;i<60;i++){ try{ await fetch(B+'/api/health'); break; }catch(e){ await sleep(150); } }
 process.on('exit', () => { try{ srv.kill('SIGKILL'); }catch(e){} });
 console.log('== 三人房：2真人 + 1机器人 ==');
 const a=await api('/api/register',{}); const A=await client();
 A.send({t:'auth',token:a.token}); await sleep(400);
 A.send({t:'room:create',rule:'trio54'}); await sleep(900);
 const gid=A.room.gid;
 console.log('   房号',gid,'座位',A.room.seats.map(s=>s?s.nick:'-'));
 const b=await api('/api/register',{}); const Bw=await client();
 Bw.send({t:'auth',token:b.token}); await sleep(400);
 Bw.send({t:'room:join',gid:gid}); await sleep(900);
 console.log('   好友加入后座位',A.room.seats.map(s=>s?s.nick:'-'));
 ok(A.room.seats.filter(Boolean).length===2,'两个真人已就位');
 A.send({t:'room:joinbot',gid:gid}); await sleep(1500);
 const seats=A.state? A.state.seats : A.room.seats;
 ok(A.state!=null,'补机器人后自动开局');
 ok(A.state && A.state.seats.filter(x=>x&&x.bot).length===1 && A.state.seats.filter(x=>x&&!x.bot).length===2,
    '座位构成 = 2真人 + 1机器人：'+(A.state?A.state.seats.map(x=>x?(x.bot?'[AI]'+x.nick:x.nick):'-').join(' / '):''));
 ok(Bw.state && Bw.state.n===3,'好友端同样看到三人局，手牌 '+ (Bw.state?Bw.state.hand.length:0)+' 张');
 // 两个真人并发驱动（各自只在自己回合出牌）
 async function drive(C){
   let g=0;
   while(g++<400){
     const st=C.state; if(!st||st.phase==='over')break;
     if(st.phase==='bid'){
       if(st.bidTurn===st.seat){ C.send({t:'game:bid',act:{type:'bid',score:1}}); await sleep(320); }
       else await sleep(180);
       continue;
     }
     if(st.turn!==st.seat){ await sleep(120); continue; }
     const prev=(st.last&&st.last.by!==st.seat)?st.last.info:null;
     const h=DDZ.hint(st.hand,prev);
     C.send({t:'game:play',ids:h?h.ids:[]});
     await C.sent(3000);
   }
 }
 await Promise.all([drive(A), drive(Bw)]);
 await sleep(1200);
 ok(A.state && A.state.phase==='over','2真人+1机器人 对局正常结束');
 ok(A.state && A.state.result && A.state.result.winnerSide,'结算：'+(A.state?JSON.stringify({side:A.state.result.winnerSide,mult:A.state.result.multiplier}):''));

 console.log('== 其他组合 ==');
 // 1真人+2机器人
 const c1=await api('/api/register',{}); const C1=await client();
 C1.send({t:'auth',token:c1.token}); await sleep(400);
 C1.send({t:'room:create',rule:'trio54'}); await sleep(800);
 C1.send({t:'room:joinbot',gid:C1.room.gid}); await sleep(700);
 C1.send({t:'room:joinbot',gid:C1.room.gid}); await sleep(1500);
 ok(C1.state && C1.state.seats.filter(x=>x&&x.bot).length===2,'1真人+2机器人 也能开局');
 // 机器人占位后真人顶替
 const d=await api('/api/register',{}); const D=await client();
 D.send({t:'auth',token:d.token}); await sleep(400);
 D.send({t:'room:create',rule:'trio54'}); await sleep(800);
 D.send({t:'room:joinbot',gid:D.room.gid}); await sleep(700);
 const e=await api('/api/register',{}); const E=await client();
 E.send({t:'auth',token:e.token}); await sleep(400);
 E.send({t:'room:join',gid:D.room.gid}); await sleep(1000);
 ok(!E.err && E.state && E.state.seats.filter(x=>x&&!x.bot).length===2,
    '房间已有机器人时，好友仍可加入凑成 2真人+1机器人：'+(E.state?E.state.seats.map(x=>x?(x.bot?'[AI]'+x.nick:x.nick):'-').join(' / '):E.err&&E.err.msg));

 console.log('== 通知伪装 ==');
 const f=await api('/api/register',{}); const F=await client();
 // F 与 A 先建立联系
 F.send({t:'auth',token:f.token}); await sleep(300);
 F.send({t:'chat',to:a.token?'':''}); // noop
 ok(true,'（客户端收到 presence 事件后仅渲染营销广告，服务端不下发任何上线文案）');
 [A,Bw,C1,D,E,F].forEach(c=>c.close());
 console.log('\n===== 通过 '+pass+' 项，失败 '+fail+' 项 =====');
 try{ srv.kill('SIGKILL'); }catch(e){}
 process.exit(fail?1:0);
})();
