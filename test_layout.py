import asyncio, json, os, subprocess, time, socket
from playwright.async_api import async_playwright

def wait_port(port, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            s = socket.create_connection(("127.0.0.1", port), 0.5)
            s.close()
            return True
        except Exception:
            time.sleep(0.3)
    return False

SRV = subprocess.Popen(["node", "server/server.js"], cwd="/data/workspace/ddz",
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if not wait_port(8080):
    print("服务端启动失败")
    SRV.kill()
    raise SystemExit(1)

URL = "http://127.0.0.1:8080/"
OUT = "/data/workspace/shots_layout"
os.makedirs(OUT, exist_ok=True)

DEVICES = [
    ("安卓小屏", 640, 360),
    ("iPhoneSE", 667, 375),
    ("iPhone13", 844, 390),
    ("iPhone15PM", 932, 430),
    ("安卓中端", 800, 360),
    ("安卓宽屏", 915, 412),
    ("平板", 1024, 768),
    ("超窄屏", 740, 320),
    ("竖屏 iPhone13", 390, 844),
    ("竖屏 安卓", 412, 915),
    ("竖屏 小屏", 360, 780),
]

MOCK = r"""
(scene) => {
  const mk=(id,r,s,v,red)=>({id:id,r:r,s:s,v:v,red:red,joker:null});
  const SU=['S','H','C','D'];
  const RK=[['5',5],['6',6],['7',7],['8',8],['9',9],['10',10],['J',11],['Q',12],['K',13],['A',14],['2',15]];
  const A=(i)=>({seed:i,style:i%6,hue:(i*47)%360,hue2:(i*91)%360,face:i%5,acc:i%5,ring:i%3});
  let n=0;
  const handN = (scene==='max') ? 20 : 12;
  const hand=[];
  for(let i=0;i<handN;i++){ const rk=RK[i%RK.length], s=SU[i%4]; n++;
    hand.push(mk('h'+n, rk[0], s, rk[1], s==='H'||s==='D')); }
  const lastN = (scene==='max') ? 20 : 8;
  const last=[];
  for(let i=0;i<lastN;i++){ const rk=RK[i%RK.length], s=SU[(i+1)%4]; n++;
    last.push(mk('p'+n, rk[0], s, rk[1], s==='H'||s==='D')); }
  const trio = (scene==='trio');
  const seatN = trio ? 3 : 2;
  const seats=[];
  for(let i=0;i<seatN;i++) seats.push({uid:'u'+(i+1), nick:'暴走的熊猫超长昵称'+i, avatar:A(i+1)});
  const st={
    gid:'1234', rule: (scene==='bid3'||trio) ? 'trio54' : 'let46', n:seatN, seat:0,
    phase: (scene==='bid3') ? 'bid' : 'play',
    turn:0, bidTurn:0, bid: (scene==='bid3') ? {score:1} : null,
    seats:seats, counts: seats.map(()=>handN),
    landlord: (scene==='bid3') ? -1 : 0, letCount:5, multiplier:2,
    hand:hand, bottom:[mk('b1','A','S',14,false),mk('b2','K','H',13,true),mk('b3','2','C',15,false)],
    // 叫分阶段真实情况下还没有人出牌
    last: (scene==='bid3') ? null : {by:1, cards:last, info:{type:'dstraight',main:5,len:lastN}},
    lastSeat: (scene==='bid3') ? [] : seats.map((_,i)=> (i!==0) ? {cards:last.slice(0,6)} : null),
  };
  try { App.firstTipOf = function(){}; } catch(e){}
  Game.onGame(st);
  try { App.go('play'); } catch(e){}
  document.getElementById('boot').classList.add('hidden');
  document.getElementById('login').classList.add('hidden');
  document.getElementById('main').classList.remove('hidden');
  // 强制隐藏：App.go 可能把 login 重新显示出来，会盖住牌桌影响可见性判定
  document.getElementById('boot').style.display='none';
  document.getElementById('login').style.display='none';
  document.body.classList.toggle('land', window.innerWidth > window.innerHeight);
  return true;
}
"""

# 极端场景 × 代表分辨率
SCENES = [
    ("满手牌20张+对手出20张", "max", [(640, 360), (844, 390), (740, 320)]),
    ("三人场", "trio", [(640, 360), (844, 390), (1024, 768)]),
    ("叫分4按钮", "bid3", [(640, 360), (844, 390), (740, 320)]),
]

CHECK = r"""
() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = { vw: vw, vh: vh, overflowX: document.documentElement.scrollWidth > vw + 1,
                scrollW: document.documentElement.scrollWidth, items: [] };
  out.k = getComputedStyle(document.documentElement).getPropertyValue('--k').trim();
  // 新布局关键元素
  const dibar = document.querySelector('.dibar');
  if (dibar) { const r = dibar.getBoundingClientRect();
    out.dibar = { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) }; }
  const fld = document.querySelector('.field');
  if (fld) out.fieldTop = Math.round(fld.getBoundingClientRect().top);
  const sl = document.querySelector('.seatleft'), sr = document.querySelector('.seatright');
  if (sl) { const r = sl.getBoundingClientRect(); out.leftSeat = { left: Math.round(r.left), w: Math.round(r.width) }; }
  if (sr) { const r = sr.getBoundingClientRect(); out.rightSeat = { right: Math.round(r.right), w: Math.round(r.width),
            over: Math.round(r.right - vw) }; }
  // 左右信息块是否贴边（最左 / 最右）
  const colL = document.querySelector('.seatcol.left .ts'), colR = document.querySelector('.seatcol.right .ts');
  if (colL) out.tsLeft = Math.round(colL.getBoundingClientRect().left);
  if (colR) out.tsRight = Math.round(vw - colR.getBoundingClientRect().right);
  // 打出的牌相对信息块的位置
  const pmL = document.querySelector('.seatcol.left .pmine'), pmR = document.querySelector('.seatcol.right .pmine');
  if (colL && pmL) out.leftPlayedDir = pmL.getBoundingClientRect().left >= colL.getBoundingClientRect().left ? '右' : '左';
  if (colR && pmR) out.rightPlayedDir = pmR.getBoundingClientRect().left < colR.getBoundingClientRect().left ? '左' : '右';
  // 信息块是否还有底色/边框
  const ts2 = document.querySelector('.seatcol .ts');
  if (ts2) { const c = getComputedStyle(ts2);
    out.tsStyle = { bg: c.backgroundColor, bw: c.borderTopWidth }; }
  // 昵称宽度（不应过宽）
  const nm = document.querySelector('.seatcol .ts .nm');
  if (nm) out.nmW = Math.round(nm.getBoundingClientRect().width);
  const sel = ['.handwrap','.hand','.myinfo','.myplayed','.dibar','#action-zone','.acts','.mid','.played','.field','.seatleft','.seatright','.seatcol'];
  sel.forEach(s => {
    document.querySelectorAll(s).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return;
      out.items.push({ sel: s, x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
        overRight: Math.round(r.right - vw), overBottom: Math.round(r.bottom - vh) });
    });
  });
  // 操作按钮是否互相重叠
  const btns = [...document.querySelectorAll('#action-zone button')].map(b => {
    const r = b.getBoundingClientRect();
    return { t: (b.textContent||'').trim().slice(0,6), x: Math.round(r.left), y: Math.round(r.top),
             w: Math.round(r.width), h: Math.round(r.height) };
  });
  out.btns = btns;
  out.btnOverlap = false;
  for (let i=0;i<btns.length;i++) for (let j=i+1;j<btns.length;j++) {
    const a=btns[i], b=btns[j];
    const ox = Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y);
    if (ox > 2 && oy > 2) out.btnOverlap = true;
  }
  // 关键区块纵向重叠检测（手牌区 vs 动作区 vs 我的信息区）
  const box = s => { const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect();
    return {s:s,y:Math.round(r.top),b:Math.round(r.bottom)}; };
  const zones = ['.myinfo','.myplayed','.bottombar','.handwrap','#action-zone'].map(box).filter(Boolean);
  out.zones = zones;
  out.zoneOverlap = [];
  for (let i=0;i<zones.length;i++) for (let j=i+1;j<zones.length;j++) {
    const a=zones[i], b=zones[j];
    const oy = Math.min(a.b, b.b) - Math.max(a.y, b.y);
    if (oy > 4) out.zoneOverlap.push(a.s + ' × ' + b.s + ' 重叠 ' + oy + 'px');
  }
  // 手牌是否被裁掉
  const hw = document.querySelector('.handwrap');
  if (hw) { const h = hw.querySelector('.hand');
    if (h) out.handScroll = { wrapW: Math.round(hw.clientWidth), handW: Math.round(h.scrollWidth),
      clipped: h.scrollWidth > hw.clientWidth + 2 }; }
  const pc = document.querySelector('.hand .pc');
  out.cardW = pc ? Math.round(pc.getBoundingClientRect().width) : 0;
  out.cardH = pc ? Math.round(pc.getBoundingClientRect().height) : 0;
  const pm = document.querySelector('.pmine .pc');
  out.playedCardW = pm ? Math.round(pm.getBoundingClientRect().width) : 0;
  out.playedCardH = pm ? Math.round(pm.getBoundingClientRect().height) : 0;
  // 手牌最后一张是否完整可见
  const cards = document.querySelectorAll('.hand .pc');
  if (cards.length) {
    const last = cards[cards.length - 1].getBoundingClientRect();
    out.lastCard = { right: Math.round(last.right), bottom: Math.round(last.bottom),
                     visible: last.right <= vw + 1 && last.bottom <= vh + 1 };
  }
  // 出牌区是否被裁
  const pw = document.querySelector('.seatcol.left .pmine .prow') || document.querySelector('.pmine .prow');
  if (pw) { const r = pw.getBoundingClientRect();
    out.playedRow = { w: Math.round(r.width), right: Math.round(r.right), over: Math.round(r.right - vw) }; }
  const hw2 = document.querySelector('.handwrap');
  if (hw2) out.handBottom = Math.round(hw2.getBoundingClientRect().bottom);
  const az = document.querySelector('#action-zone');
  if (az) out.actBottom = Math.round(az.getBoundingClientRect().bottom);
  return out;
}
"""


async def main():
    results = []
    async with async_playwright() as p:
        exe = "/usr/bin/google-chrome"
        if not os.path.exists(exe):
            exe = "/usr/local/bin/chromium"
        browser = await p.chromium.launch(executable_path=exe,
                                          args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
        page = None
        async def shot(name, w, h, sc):
            nonlocal page
            ctx = await browser.new_context(viewport={"width": w, "height": h},
                                            device_scale_factor=1, is_mobile=True, has_touch=True)
            page = await ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            await page.goto(URL, wait_until="load", timeout=25000)
            await page.wait_for_timeout(500)
            await page.evaluate(MOCK, sc)
            await page.wait_for_timeout(420)
            data = await page.evaluate(CHECK)
            data["name"] = name
            data["errs"] = errs[:3]
            await page.screenshot(path=f"{OUT}/{name.replace(' ','_')}_{w}x{h}.png")
            await ctx.close()
            return data

        for name, w, h in DEVICES:
            results.append(await shot(name, w, h, "play"))
        for sname, sc, vps in SCENES:
            for w, h in vps:
                results.append(await shot(f"{sname} {w}x{h}", w, h, sc))
        await browser.close()

    lines = []
    for r in results:
        lines.append(f"== {r['name']} {r['vw']}x{r['vh']} ==")
        over = [i for i in r["items"] if i["overRight"] > 2 or i["overBottom"] > 2]
        lines.append(f"  横向溢出: {'✘ ' + str(r['scrollW']) + '>' + str(r['vw']) if r['overflowX'] else '✔ 无'}")
        if over:
            for i in over:
                lines.append(f"    ✘ {i['sel']} 右超{i['overRight']}px 下超{i['overBottom']}px")
        else:
            lines.append("    ✔ 所有区块都在屏幕内")
        lines.append(f"  按钮重叠: {'✘ 有重叠' if r['btnOverlap'] else '✔ 无'}")
        lines.append(f"  区块重叠: {'✘ ' + '; '.join(r['zoneOverlap']) if r['zoneOverlap'] else '✔ 无'}")
        hs = r.get("handScroll") or {}
        lines.append(f"  手牌: 容器{hs.get('wrapW')}px 内容{hs.get('handW')}px → {'✘ 被裁切' if hs.get('clipped') else '✔ 完整显示'}")
        lines.append(f"  手牌单张: {r['cardW']}x{r['cardH']}px | 出牌单张: {r['playedCardW']}x{r['playedCardH']}px")
        db = r.get("dibar") or {}
        lines.append(f"  底牌位置: 底边={db.get('bottom')} / 对局区顶={r.get('fieldTop')} "
                     f"{'✔ 在对局区上方' if (db.get('bottom') or 999) <= (r.get('fieldTop') or 0) + 2 else '✘ 不在最上方'}")
        lsr = r.get("leftSeat") or {}
        rsr = r.get("rightSeat") or {}
        lines.append(f"  左侧块: left={lsr.get('left')} | 右侧块: right={rsr.get('right')} 屏宽{r['vw']} "
                     f"{'✔ 贴左右边' if (lsr.get('left') or 99) <= 20 and (r['vw'] - (rsr.get('right') or 0)) <= 20 else '✘ 未贴边/溢出'}")
        # 统一结构：两侧玩家的信息块贴屏幕左右边，出的牌都朝牌桌中间展开
        dirOK = (r.get('leftPlayedDir')=='右' and r.get('rightPlayedDir')=='左')
        lines.append(f"  出牌方向: 左→{r.get('leftPlayedDir')} 右→{r.get('rightPlayedDir')} "
                     f"{'✔ 都朝中间' if dirOK else '✘'}")
        lines.append(f"  昵称宽: {r.get('nmW')}px | 尺度系数 k={r.get('k')}")
        ts = r.get('tsStyle') or {}
        noBg = (str(ts.get('bg')) in ('rgba(0, 0, 0, 0)', 'transparent')) and (float(str(ts.get('bw')).replace('px','') or 0) < 0.5)
        lines.append(f"  信息块样式: 底色={ts.get('bg')} 边框={ts.get('bw')} {'✔ 无底色无边框' if noBg else '✘ 仍有底色/边框'}")
        lc = r.get("lastCard") or {}
        lines.append(f"  手牌末张: {'✔ 完整可见' if lc.get('visible') else '✘ 被裁切 (right=' + str(lc.get('right')) + ' bottom=' + str(lc.get('bottom')) + ')'}")
        pr = r.get("playedRow") or {}
        lines.append(f"  出牌区宽: {pr.get('w')}px → {'✘ 超出屏幕 ' + str(pr.get('over')) + 'px' if (pr.get('over') or 0) > 1 else '✔ 在屏内'}")
        lines.append(f"  底部边界: 手牌区底 {r.get('handBottom')} / 按钮区底 {r.get('actBottom')} / 屏高 {r['vh']}")
        ok = (not r['overflowX']) and (not r['btnOverlap']) and (not r['zoneOverlap']) \
             and lc.get('visible') and ((pr.get('over') or 0) <= 1) \
             and (r.get('handBottom') or 0) <= r['vh'] + 1 and (r.get('actBottom') or 0) <= r['vh'] + 1 \
             and r['cardW'] >= 40 * (float(r.get('k') or 1)) and (r['playedCardW'] >= 28 * float(r.get('k') or 1) or '叫分' in r['name']) \
             and dirOK
        lines.append(f"  >>> 总判定: {'✔ 通过' if ok else '✘ 不通过'}")
        if not r['zoneOverlap']:
            pass
        if r["errs"]:
            lines.append(f"  JS错误: {r['errs']}")
        lines.append("")
    open("/data/workspace/layout_report.txt", "w", encoding="utf-8").write("\n".join(lines))
    print("\n".join(lines))
    SRV.kill()

asyncio.run(main())
