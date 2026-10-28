const D=require('../shared/engine.js');
const AI=require('../shared/ai.js');
function auto(rule,rounds){
  let over=0,redeal=0,err=0,stats={landlord:0,farmer:0},maxS=0;
  for(let r=0;r<rounds;r++){
    let g=D.newGame(rule); const n=g.seats;
    let guard=0;
    while(g.phase==='bid'&&guard++<40){
      const seat=g.bidTurn;
      let act;
      if(rule==='let46'){
        act = g.landlord<0 ? AI.bid(g,seat) : AI.grab(g,seat);
      } else act=AI.bid(g,seat);
      const res=D.applyBid(g,seat,act);
      if(res.err){err++;break;}
      if(res.redeal){redeal++;break;}
      if(res.started)break;
    }
    if(g.phase!=='play'){continue;}
    let steps=0;
    while(g.phase==='play'&&steps<600){
      const seat=g.turn;
      const a=AI.play(g,seat);
      const res=D.applyPlay(g,seat,a.ids);
      if(res.err){err++;console.log('ERR',res.err,rule,'seat',seat,'ids',JSON.stringify(a.ids));break;}
      steps++;
    }
    if(steps>=600){console.log('死循环',rule);break;}
    maxS=Math.max(maxS,steps);
    if(g.phase==='over'){over++; if(g.result.winner===g.landlord)stats.landlord++;else stats.farmer++;}
  }
  console.log(rule,'完成',over,'重发',redeal,'错误',err,'最长',maxS,'地主胜',stats.landlord,'农民胜',stats.farmer);
}
auto('trio54',500);
auto('duo37',500);
auto('let46',500);
