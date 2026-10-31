const DDZ = require('/data/workspace/ddz/shared/engine.js');
const AI = require('/data/workspace/ddz/shared/ai.js');
let ok=0, bad=0, noDouble=0;
for (let i=0;i<300;i++){
  const g = DDZ.newGame('trio54');
  // 首位叫分者强制叫 3 分 → 必定触发加倍阶段
  const first = g.bidTurn;
  let r = DDZ.applyBid(g, first, {type:'bid', score:3});
  if (g.phase !== 'double') { noDouble++; continue; }
  let dg=0;
  while (g.phase === 'double' && dg++ < 20){
    const seat = DDZ.doubleTurn(g);
    if (seat < 0) break;
    const rr = DDZ.applyDouble(g, seat, seat % 2 === 0);  // 交替加倍/不加倍
    if (rr.err) { bad++; console.log('✘', rr.err); break; }
  }
  let guard=0;
  while (g.phase === 'play' && guard++ < 400){
    const seat = g.turn;
    const a = AI.play(g, seat);
    const rr = DDZ.applyPlay(g, seat, a.ids||[]);
    if (rr.err) DDZ.applyPlay(g, seat, []);
  }
  if (g.phase === 'over' && g.result) ok++; else { bad++; if(bad<3) console.log('✘ 未结束', g.phase, guard); }
}
console.log('强制叫3分：完成', ok, '异常', bad, '未触发加倍', noDouble);
console.log(bad===0 ? '✔ 加倍路径稳定' : '✘ 有问题');
