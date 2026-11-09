# -*- coding: utf-8 -*-
"""v57 真实 Chromium 验证：7 分辨率 × 7 状态"""
from playwright.sync_api import sync_playwright
import os, hashlib

URL = 'file:///data/workspace/打牌布局测试台_v57.html'
RES = ['844×390', '740×330', '926×428', '1024×600', '1280×720', '1280×720@2', '1067×480@3']
ST = ['bid', 'double', 'dbl', 'play', 'follow', 'wait', 'rest']

CHECKS = """()=>{
  const f=document.getElementById('fr');
  const W=f.contentWindow, m=W.__measure();
  const r=[];
  const A=(n,p,d)=>r.push([n,!!p,d]);
  A('识别自检', m.vw>0&&m.dpr>0, m.vw+'×'+m.vh+' DPR'+m.dpr);
  A('昵称≥14px', m.nmSize>=14, m.nmSize+'px');
  A('四按钮尺寸', m.rbActual>=44, Math.round(m.rbActual)+'px');
  A('底牌贴顶', m.dibar&&m.dibar.t<=4, m.dibar?'top='+m.dibar.t:'无');
  A('底牌居中', m.dibar&&Math.abs((m.dibar.l+m.dibar.r)/2-m.vw/2)<3, m.dibar?'中心='+Math.round((m.dibar.l+m.dibar.r)/2):'无');
  A('左右信息平齐', m.leftts&&m.rightts?Math.abs(m.leftts.t-m.rightts.t)<=4:true, '');
  A('按钮不压手牌', m.tablerail&&m.hand?m.tablerail.b<=m.hand.t+3:true, m.tablerail&&m.hand?m.tablerail.b+' / '+m.hand.t:'');
  A('座位贴底牌下沿', m.seatleft&&m.dibar?(m.seatleft.t>=m.dibar.b-2&&m.seatleft.t<=m.dibar.b+40):true, m.seatleft?'top='+m.seatleft.t:'');
  A('我出的牌不压按钮', m.myplayed&&m.action&&m.myplayed.h>0?m.myplayed.b<=m.action.t+3:true,'');
  A('按钮不压手牌(2)', m.action&&m.hand&&m.action.h>0?m.action.b<=m.hand.t+3:true,'');
  A('我的信息不出屏', m.myinfo?m.myinfo.b<=m.vh+1&&m.myinfo.t>=0:true,'');
  A('我的牌与对手同宽', m.mycard&&m.opcard?Math.abs(m.mycard.w-m.opcard.w)<=2:true,'');
  A('手牌不出屏', m.hand?m.hand.b<=m.vh+2:true,'');
  A('等待提示不压出牌', m.waitrow&&m.myplayed&&m.myplayed.h>0?m.waitrow.t>=m.myplayed.b-6:true,'');
  A('中间无占位提示', !m.noticeOn,'');
  A('昵称完整不被裁', !m.nmClipped, m.nmClipped?'被裁':'完整');
  A('手牌收窄≤84%', m.handRatio>0&&m.handRatio<=0.84, Math.round(m.handRatio*100)+'%');
  A('出牌叠放适度', m.pcOv===0||(m.pcOv>=0.3&&m.pcOv<=0.7), m.pcOv?m.pcOv.toFixed(2):'无出牌');
  A('身份与昵称同字号', m.rlFs===0||Math.abs(m.rlFs-m.nmFs)<1.5, m.rlFs?m.rlFs+'/'+m.nmFs:'无身份');
  A('剩张与叫分同字号', m.btagFs===0||Math.abs(m.cntFs-m.btagFs)<1.5, m.btagFs?m.cntFs+'/'+m.btagFs:'无叫分结果');
  A('加倍环节标签+大字标', m.state!=='dbl'||(m.dblTag.indexOf('加倍')>=0&&m.bigcls.indexOf('on')>=0), m.state==='dbl'?m.dblTag:'非加倍态');
  A('动态表情在右半部', m.stkLeft>=m.vw/2-3, 'left='+Math.round(m.stkLeft));
  A('叫分标贴该玩家出牌区', m.bigact&&m.bigcls.indexOf('on')>=0?(function(){
      const zone=m.bigcls.indexOf('at-left')>=0?'L':(m.bigcls.indexOf('at-right')>=0?'R':'M');
      const h=zone==='L'?m.leftpcards:(zone==='R'?m.rightpcards:m.mypcards);
      return h?(Math.abs((m.bigact.l+m.bigact.r)/2-(h.l+h.r)/2)<=10&&Math.abs((m.bigact.t+m.bigact.b)/2-(h.t+h.b)/2)<=12):true;})():true,'');
  /* v57 两条核心 */
  A('身份与昵称等宽', m.rlW===0||Math.abs(m.nmW-m.rlW)<=1, m.rlW?(m.nmW+' / '+m.rlW+'px'):'本状态无身份');
  A('叫分结果与剩张数等宽', m.btagW===0||Math.abs(m.btagW-m.cntW)<=1, m.btagW?(m.btagW+' / '+m.cntW+'px'):'本状态无叫分结果');
  return {state:m.state, vw:m.vw, rows:r};
}"""


def main():
    total = ok = 0
    fails = []
    js_errors = []
    samples = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, executable_path='/usr/bin/google-chrome-stable', args=['--no-sandbox'])
        for i, name in enumerate(RES):
            pg = b.new_page(viewport={'width': 1500, 'height': 1000})
            pg.on('pageerror', lambda e, n=name: js_errors.append((n, str(e))))
            pg.goto(URL + '?r=' + str(i))
            pg.wait_for_timeout(750)
            for s in ST:
                pg.evaluate("s=>{const w=document.getElementById('fr').contentWindow;w.__setState(s);}", s)
                pg.wait_for_timeout(130)
                res = pg.evaluate(CHECKS)
                for n, p, d in res['rows']:
                    total += 1
                    if p:
                        ok += 1
                    else:
                        fails.append((name, s, n, d))
                if i == 0 and s == 'play':
                    m = pg.evaluate("()=>document.getElementById('fr').contentWindow.__measure()")
                    samples.append((name, s, m['nmW'], m['rlW'], m['btagW'], m['cntW']))
                if i == 3 and s == 'play':
                    m = pg.evaluate("()=>document.getElementById('fr').contentWindow.__measure()")
                    samples.append((name, s, m['nmW'], m['rlW'], m['btagW'], m['cntW']))
            pg.close()
        # 动态表情时序
        pg = b.new_page(viewport={'width': 1500, 'height': 1000})
        pg.goto(URL + '?r=0&s=follow')
        pg.wait_for_timeout(700)
        pg.evaluate("()=>document.getElementById('fr').contentWindow.__sticker()")
        pg.wait_for_timeout(80)
        card = pg.evaluate("""()=>{const D=document.getElementById('fr').contentDocument;
          const c=D.querySelector('#big-sticker .bs-card');const r=c.getBoundingClientRect();
          return {cx:Math.round(r.left+r.width/2), vw:D.defaultView.innerWidth};}""")
        seq = []
        pg.wait_for_timeout(2800); seq.append(('2.88s', pg.evaluate("()=>document.getElementById('fr').contentWindow.__stickerStage()")))
        pg.wait_for_timeout(250);  seq.append(('3.13s', pg.evaluate("()=>document.getElementById('fr').contentWindow.__stickerStage()")))
        pg.wait_for_timeout(300);  seq.append(('3.43s', pg.evaluate("()=>document.getElementById('fr').contentWindow.__stickerStage()")))
        rows = pg.eval_on_selector_all('#tbl tr', 'els=>els.length')
        b.close()
    print('分辨率', len(RES), '× 状态', len(ST), '=', len(RES) * len(ST), '组')
    print('断言', ok, '/', total, '通过')
    print('体检表行数:', rows)
    print('表情卡中心/半宽:', card, '→', '右半部 ✔' if card['cx'] >= card['vw'] / 2 else '✘')
    print('动态表情时序:', seq)
    print('等宽实测样本 [分辨率,状态,昵称,身份,叫分,剩张]:')
    for x in samples:
        print('  ', x)
    print('页面 JS 异常:', js_errors if js_errors else '0')
    if fails:
        print('失败明细（前 40）:')
        for f in fails[:40]:
            print('  ', f)
    else:
        print('全部通过 ✔')
    a = open('/data/workspace/打牌布局测试台_v57.html', 'rb').read()
    for p in ['/data/workspace/v57work/public/layout-test.html', '/data/workspace/v57work/public/layout-v57.html']:
        print('测试台一致', os.path.basename(p), hashlib.md5(a).hexdigest() == hashlib.md5(open(p, 'rb').read()).hexdigest())
    return len(fails) + len(js_errors)


if __name__ == '__main__':
    raise SystemExit(main())
