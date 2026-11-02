import asyncio, subprocess, time, socket, os
os.system("pkill -f 'node server/server.js' 2>/dev/null; sleep 1")
from playwright.async_api import async_playwright


def wait(port, t=15):
    t0 = time.time()
    while time.time() - t0 < t:
        try:
            s = socket.create_connection(("127.0.0.1", port), 0.5)
            s.close()
            return True
        except Exception:
            time.sleep(0.3)
    return False


SRV = subprocess.Popen(["node", "server/server.js"], cwd="/data/workspace/ddz",
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
wait(8080)

# 出牌阶段 + 一家「过」+ 王牌
MOCK = r"""
() => {
  const mk=(id,r,s,v,red)=>({id:id,r:r,s:s,v:v,red:red,joker:null});
  const SU=['S','H','C','D'];
  const RK=[['5',5],['6',6],['7',7],['8',8],['9',9],['10',10],['J',11],['Q',12],['K',13],['A',14],['2',15]];
  const A=(i)=>({seed:i,style:i%6,hue:(i*47)%360,hue2:(i*91)%360,face:i%5,acc:i%5,ring:i%3});
  let c=0;
  const hand=[];
  for(let i=0;i<17;i++){const rk=RK[i%RK.length],s=SU[i%4];c++;hand.push(mk('h'+c,rk[0],s,rk[1],s==='H'||s==='D'));}
  // 加一张大王一张小王
  hand.push({id:'jk1',r:'',s:'',v:16,red:true,joker:'big'});
  hand.push({id:'jk2',r:'',s:'',v:17,red:false,joker:'small'});
  const seats=[{uid:'u1',nick:'暴走的布丁',avatar:A(1)},{uid:'u2',nick:'忧郁的极光',avatar:A(2)},{uid:'u3',nick:'晨曦的小怪兽',avatar:A(3)}];
  const st={gid:'1',rule:'trio54',n:3,seat:0,phase:'play',turn:0,bidTurn:0,
    bid:{score:2,by:0}, doubleTurn:-1, doubleSeats:[], doubled:[],
    seats:seats,counts:[19,17,17],landlord:0,letCount:0,multiplier:2,
    hand:hand,bottom:[mk('b1','A','S',14,false),mk('b2','3','H',3,true),mk('b3','4','D',4,true)],
    last:null,
    // 第 2 家「过」
    lastSeat:[null,{pass:true,by:1},null]};
  try{App.firstTipOf=function(){};}catch(e){}
  Game.onGame(st);
  try{App.go('play');}catch(e){}
  document.getElementById('boot').style.display='none';
  document.getElementById('login').style.display='none';
  document.getElementById('main').classList.remove('hidden');
  document.body.classList.toggle('land', window.innerWidth>window.innerHeight);
  return true;
}
"""

CHECK = r"""
() => {
  const out={};
  // 1) 竖屏按钮位置 + 与聊天按钮是否重叠
  const ob=document.getElementById('btn-orient');
  const cb=document.querySelector('.tablechat');
  const vb=document.getElementById('btn-table-voice');
  out.orientVisible = ob ? getComputedStyle(ob).display!=='none' : false;
  out.voiceExists = !!vb;
  if(ob&&cb){
    const a=ob.getBoundingClientRect(), b=cb.getBoundingClientRect();
    const ov = !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);
    out.orientChatOverlap = ov;
    out.orientTop = Math.round(a.top);
    out.orientRight = Math.round(window.innerWidth-a.right);
    out.chatBottom = Math.round(b.bottom);
  }
  if(vb&&cb){
    const a=vb.getBoundingClientRect(), b=cb.getBoundingClientRect();
    out.voiceChatOverlap = !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);
  }
  if(vb&&ob){
    const a=vb.getBoundingClientRect(), b=ob.getBoundingClientRect();
    out.voiceOrientOverlap = !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);
  }
  // 2) 「过」字
  const pw=document.querySelector('.pass-word');
  out.passWord = pw ? pw.textContent : null;
  out.passFont = pw ? getComputedStyle(pw).fontFamily.slice(0,30) : null;
  // 3) 王牌
  const jk=document.querySelectorAll('.pc.joker');
  out.jokerCount = jk.length;
  out.jokerHasSvg = [...jk].some(e=>e.querySelector('svg.jk-crown'));
  out.jokerCorner = [...jk].map(e=>{const c=e.querySelector('.jk-corner'); return c?c.textContent:null;});
  return out;
}
"""


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path="/usr/bin/google-chrome",
                                     args=["--no-sandbox", "--disable-gpu"])
        errs = []
        for (nm, w, h) in [("安卓小屏", 640, 360), ("iPhone13", 844, 390), ("竖屏", 390, 844), ("超窄屏", 740, 320)]:
            ctx = await br.new_context(viewport={"width": w, "height": h},
                                       device_scale_factor=1, is_mobile=True, has_touch=True)
            pg = await ctx.new_page()
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.goto("http://127.0.0.1:8080/", wait_until="load", timeout=25000)
            await pg.wait_for_timeout(900)
            await pg.evaluate(MOCK)
            await pg.wait_for_timeout(800)
            o = await pg.evaluate(CHECK)
            ok = (o['orientVisible'] and o['voiceExists']
                  and not o.get('orientChatOverlap') and not o.get('voiceChatOverlap')
                  and not o.get('voiceOrientOverlap')
                  and o['passWord'] == '过' and o['jokerHasSvg'])
            print(f"{nm:<9} 竖屏按钮[top={o.get('orientTop')} right={o.get('orientRight')}] "
                  f"语音钮={o['voiceExists']} 重叠(竖/聊={o.get('orientChatOverlap')},"
                  f"音/聊={o.get('voiceChatOverlap')}) 过字='{o['passWord']}' "
                  f"王牌SVG={o['jokerHasSvg']} {o['jokerCorner']} {'✔' if ok else '✘'}")
            await ctx.close()
        print("JS 错误:", len(errs), errs[:2] if errs else "")
        await br.close()


asyncio.run(main())
SRV.kill()
