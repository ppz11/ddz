const DDZ = require('/data/workspace/ddz/shared/engine.js');
const AI = require('/data/workspace/ddz/shared/ai.js');
function run(rule){
  const g=DDZ.newGame(rule); let guard=0;
  while(g.phase==='bid' && guard++<50){
    const s=g.bidTurn;
    let act = rule==='let46' ? (g.landlord<0?AI.bid(g,s):AI.grab(g,s)) : AI.bid(g,s);
    const r=DDZ.applyBid(g,s,act); if(r.redeal) return {redeal:true};
  }
  let dg=0;
  while(g.phase==='double' && dg++<20){
    const s=DDZ.doubleTurn(g); if(s<0) break;
    DDZ.applyDouble(g,s, dg%2===0);
  }
  guard=0; let passSeen=0;
  while(g.phase==='play' && guard++<400){
    const s=g.turn; const a=AI.play(g,s);
    const r=DDZ.applyPlay(g,s,a.ids||[]);
    if(!(a.ids||[]).length){ if(g.lastSeat[s]&&g.lastSeat[s].pass) passSeen++; }
    if(r.err) DDZ.applyPlay(g,s,[]);
  }
  return {ok:g.phase==='over'&&!!g.result, passSeen, guard};
}
let ok=0,bad=0,pass=0;
for(const rule of ['trio54','duo37','let46']){
  for(let i=0;i<150;i++){
    const r=run(rule);
    if(r.redeal) continue;
    if(r.ok){ok++; pass+=r.passSeen;} else {bad++; if(bad<3) console.log('✘',rule,JSON.stringify(r));}
  }
}
console.log('完成:',ok,'异常:',bad,'| 累计记录「过」次数:',pass);
console.log(bad===0 && pass>0 ? '✔ 牌局正常且「过」有被记录' : (bad? '✘ 有异常':'✘ 没记录到过'));
