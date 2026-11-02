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

MOCK = r"""
() => {
  const mk=(id,r,s,v,red)=>({id:id,r:r,s:s,v:v,red:red,joker:null});
  const SU=['S','H','C','D'];
  const RK=[['5',5],['6',6],['7',7],['8',8],['9',9],['10',10],['J',11],['Q',12],['K',13],['A',14],['2',15]];
  const A=(i)=>({seed:i,style:i%6,hue:(i*47)%360,hue2:(i*91)%360,face:i%5,acc:i%5,ring:i%3});
  let c=0;
  const hand=[]; for(let i=0;i<17;i++){const rk=RK[i%RK.length],s=SU[i%4];c++;hand.push(mk('h'+c,rk[0],s,rk[1],s==='H'||s==='D'));}
  const seats=[{uid:'u1',nick:'暴走的布丁',avatar:A(1)},{uid:'u2',nick:'忧郁的极光',avatar:A(2)},{uid:'u3',nick:'晨曦的小怪兽',avatar:A(3)}];
  const st={gid:'1',rule:'trio54',n:3,seat:0,phase:'play',turn:0,bidTurn:0,
    bid:{score:1,by:0}, doubleTurn:-1, doubleSeats:[], doubled:[],
    seats:seats,counts:[17,17,17],landlord:0,letCount:0,multiplier:1,
    hand:hand,bottom:[mk('b1','A','S',14,false),mk('b2','3','H',3,true),mk('b3','4','D',4,true)],
    last:null,lastSeat:[]};
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


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path="/usr/bin/google-chrome",
                                     args=["--no-sandbox", "--disable-gpu"])
        for (w, h) in [(390, 844), (412, 915), (360, 780)]:
            ctx = await br.new_context(viewport={"width": w, "height": h},
                                       device_scale_factor=1, is_mobile=True, has_touch=True)
            pg = await ctx.new_page()
            await pg.goto("http://127.0.0.1:8080/", wait_until="load", timeout=25000)
            await pg.wait_for_timeout(900)
            await pg.evaluate(MOCK)
            await pg.wait_for_timeout(900)
            r = await pg.evaluate("""()=>{
              const hw=document.querySelector('.handwrap');
              const hd=document.getElementById('hand');
              const last=hd?hd.lastElementChild:null;
              return {
                innerW: window.innerWidth,
                docScrollW: document.documentElement.scrollWidth,
                bodyScrollW: document.body.scrollWidth,
                hasLand: document.body.classList.contains('land'),
                handwrapW: hw?Math.round(hw.getBoundingClientRect().width):null,
                handwrapLeft: hw?Math.round(hw.getBoundingClientRect().left):null,
                handClient: hd?hd.clientWidth:null,
                handScroll: hd?hd.scrollWidth:null,
                cardW: hd?getComputedStyle(hd).getPropertyValue('--card-w'):null,
                lastRight: last?Math.round(last.getBoundingClientRect().right):null
              };}""")
            print(f"--- {w}x{h} ---")
            for k, v in r.items():
                print(f"   {k}: {v}")
            await ctx.close()
        await br.close()


asyncio.run(main())
SRV.kill()
