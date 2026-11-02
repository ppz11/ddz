# -*- coding: utf-8 -*-
"""浏览器端 UI 自检：左滑返回、标签切换、对战页空态、横屏、
   隐私空间背景/倒计时、多选删除、通话界面降级"""
import os, subprocess, time, urllib.request, json
from playwright.sync_api import sync_playwright

ROOT = '/data/workspace/ddz'
PORT = '8097'
BASE = 'http://127.0.0.1:' + PORT

srv = subprocess.Popen(['node', ROOT + '/server/server.js'], cwd=ROOT + '/server',
                       env=dict(os.environ, PORT=PORT),
                       stdout=open('/tmp/ui.log', 'w'), stderr=subprocess.STDOUT)
for _ in range(80):
    try:
        urllib.request.urlopen(BASE + '/api/health', timeout=1); break
    except Exception:
        time.sleep(0.15)

P, F = [], []
def ok(c, m):
    print(('  ✓ ' if c else '  ✗ ') + m); (P if c else F).append(m)

# 另一个玩家，用来产生一个联系人
other = urllib.request.urlopen(urllib.request.Request(
    BASE + '/api/register', data=json.dumps({'device': 'ui-other'}).encode(),
    headers={'Content-Type': 'application/json'})).read()
other = json.loads(other)
OTHER_UID = other['uid']

SWIPE = """(dx)=>{
  const el=document.elementFromPoint(window.innerWidth/2, window.innerHeight/2)||document.body;
  const mk=(t,x,y)=>new TouchEvent(t,{bubbles:true,cancelable:true,
    touches:t==='touchend'?[]:[new Touch({identifier:1,target:el,clientX:x,clientY:y})],
    changedTouches:[new Touch({identifier:1,target:el,clientX:x,clientY:y})]});
  el.dispatchEvent(mk('touchstart',200,400));
  el.dispatchEvent(mk('touchmove',200+dx,405));
  el.dispatchEvent(mk('touchend',200+dx,405));
  return true;}"""

LONGPRESS = """(sel)=>{const el=document.querySelector(sel); if(!el) return false;
  const o={bubbles:true,cancelable:true,pointerId:1,clientX:50,clientY:50};
  el.dispatchEvent(new PointerEvent('pointerdown',o));
  return true;}"""

with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': 390, 'height': 844})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' else None)

    pg.goto(BASE + '/', wait_until='domcontentloaded')
    pg.wait_for_selector('#login:not(.hidden)', timeout=15000)
    pg.click('#lg-go')
    pg.wait_for_selector('#main:not(.hidden)', timeout=15000)
    time.sleep(1.2)

    print('== 1. 基础加载 ==')
    ok(pg.evaluate("!!window.Nav && typeof Nav.back==='function'"), '手势返回模块已加载')
    ok(pg.evaluate("!!window.Rec && typeof Rec.hold==='function'"), '统一录音模块已加载')
    ok(pg.evaluate("!!window.Call && typeof Call.start==='function'"), '通话模块已加载')

    print('== 2. 标签切换 + 对战页空态 ==')
    pg.click('#tabbar .tab[data-p="play"]'); time.sleep(0.4)
    ok(pg.evaluate("document.getElementById('page-play').classList.contains('on')"), '可以切到「对战」页')
    ok(pg.evaluate("!!document.getElementById('play-empty') && !document.getElementById('play-empty').classList.contains('hidden')"),
       '未开局时显示与其他页面同款的空态布局')
    ok(pg.evaluate("document.body.classList.contains('land')"), '进入牌桌时请求横屏（land）')
    pg.click('#tabbar .tab[data-p="chat"]'); time.sleep(0.4)
    ok(pg.evaluate("document.getElementById('page-chat').classList.contains('on')"), '可以切到「聊天」页')

    print('== 3. 会话页与返回 ==')
    pg.evaluate("Net.send({t:'contacts'})"); time.sleep(0.6)
    n = pg.evaluate("(App.contacts()||[]).length")
    ok(n >= 1, '联系人列表有 %d 人' % n)
    pg.evaluate("Chat.open(%r)" % OTHER_UID); time.sleep(0.6)
    ok(pg.evaluate("!!document.getElementById('thread')"), '会话页已打开')
    # 会话打开时直接点底部标签 → 会话关闭并能切换
    pg.click('#tabbar .tab[data-p="home"]'); time.sleep(0.4)
    ok(pg.evaluate("!document.getElementById('thread')"), '会话中点击底部标签会先关闭会话')
    ok(pg.evaluate("document.getElementById('page-home').classList.contains('on')"), '并成功切到大厅')

    print('== 4. 左滑 / 右滑返回 ==')
    pg.evaluate("Chat.open(%r)" % OTHER_UID); time.sleep(0.5)
    ok(pg.evaluate("!!document.getElementById('thread')"), '重新打开会话')
    pg.evaluate(SWIPE, 140); time.sleep(0.4)          # 右滑
    ok(pg.evaluate("!document.getElementById('thread')"), '右滑返回生效')
    pg.evaluate("Chat.open(%r)" % OTHER_UID); time.sleep(0.5)
    pg.evaluate(SWIPE, -140); time.sleep(0.4)         # 左滑
    ok(pg.evaluate("!document.getElementById('thread')"), '左滑返回生效')

    print('== 5. 多选删除（会话列表）==')
    pg.evaluate("App.go('chat')"); time.sleep(0.5)
    pg.evaluate(LONGPRESS, '.citem'); time.sleep(0.9)
    ok(pg.evaluate("!!document.querySelector('.modal')"), '长按会话弹出操作菜单')
    btns = pg.evaluate("Array.from(document.querySelectorAll('.modal .btn')).map(b=>b.textContent)")
    ok(any('多选删除' in (b or '') for b in btns), '菜单含「多选删除」：' + ' / '.join(btns[:3]))
    pg.evaluate("""()=>{const b=Array.from(document.querySelectorAll('.modal .btn'))
      .find(x=>(x.textContent||'').indexOf('多选删除')>=0); b&&b.click();}""")
    time.sleep(0.5)
    ok(pg.evaluate("!!document.querySelector('#selbar')"), '进入多选模式，底部操作条出现')
    ok(pg.evaluate("!!document.querySelector('.citem .pick')"), '会话条目出现勾选框')
    # 长按进入多选时会预选该项，所以点第一项等于取消；这里点第二项验证可增减
    n0 = pg.evaluate("document.querySelectorAll('.citem.picked').length")
    pg.evaluate("document.querySelectorAll('.citem .pick')[1].click()"); time.sleep(0.4)
    n1 = pg.evaluate("document.querySelectorAll('.citem.picked').length")
    ok(n1 == n0 + 1, '点击勾选框可增减选中（%d → %d）' % (n0, n1))
    pg.evaluate("""()=>{const b=document.querySelector('#selbar .sb[data-a="all"]'); b&&b.click();}""")
    time.sleep(0.4)
    ok(pg.evaluate("document.querySelectorAll('.citem.picked').length >= 2"), '「全选」按钮可用')
    pg.evaluate("""()=>{const b=document.querySelector('#selbar .sb[data-a="cancel"]'); b&&b.click();}""")
    time.sleep(0.3)
    ok(pg.evaluate("!document.getElementById('selbar')"), '取消后退出多选模式')

    print('== 6. 隐私空间 ==')
    pg.evaluate("Net.send({t:'secret:setpin',pin:'1234'})"); time.sleep(0.5)
    pg.evaluate("Secret.enter()"); time.sleep(0.8)
    pg.evaluate("Net.send({t:'secret:unlock',pin:'1234'})"); time.sleep(1.0)
    ok(pg.evaluate("!!document.getElementById('secret-root')"), '隐私空间已打开')
    ok(pg.evaluate("!!document.querySelector('#secret-root .felt')"), '隐私空间背景与主界面一致（同一张牌桌底纹）')
    ok(pg.evaluate("!!document.getElementById('s-idle')"), '存在 60 秒无操作倒计时')
    idle = pg.evaluate("(document.getElementById('s-idle')||{}).textContent")
    ok(str(idle).isdigit() and int(idle) > 0, '倒计时正在走：' + str(idle) + ' 秒')
    pg.evaluate("Secret.close()"); time.sleep(0.3)

    print('== 7. 通话界面（http 环境自动降级为语音）==')
    # 对方必须真的在线，否则服务端直接回「对方离线」
    pg2 = ctx.new_page()
    pg2.goto(BASE + '/', wait_until='domcontentloaded')
    pg2.wait_for_selector('#login:not(.hidden)', timeout=15000)
    pg2.click('#lg-id'); time.sleep(0.3)
    pg2.fill('#m-in', OTHER_UID)
    pg2.click('.modal .btn[data-a="1"]'); time.sleep(0.8)
    pg2.click('#lg-go')
    pg2.wait_for_selector('#main:not(.hidden)', timeout=15000)
    online_js = "(App.contacts()||[]).filter(function(c){return c.uid==='%s';})[0].online" % OTHER_UID
    for _ in range(40):
        time.sleep(0.2)
        pg.evaluate("Net.send({t:'contacts'})"); time.sleep(0.2)
        if pg.evaluate(online_js):
            break
    ok(pg.evaluate(online_js), '对方已上线，可以发起通话')
    pg.evaluate("Call.start('%s','video')" % OTHER_UID); time.sleep(0.8)
    ok(pg.evaluate("!!document.getElementById('callui')"), '通话界面已弹出')
    # 对方接听 → 主叫才进入通话中，之后才会尝试摄像头
    try:
        pg2.wait_for_selector('#ck-yes', timeout=10000)
        pg2.click('#ck-yes')
    except Exception as e:
        print('   [提示] 对方未收到来电弹窗:', str(e)[:80])
    # localhost 属于安全上下文，会先尝试 WebRTC，取不到摄像头再降级；这里等兜底生效
    time.sleep(7.5)
    vis = pg.evaluate("()=>{const b=document.getElementById('c-ptt');return !!b && !b.classList.contains('hidden');}")
    ok(vis, '取不到摄像头时自动降级为「按住说话」语音通话')
    st = pg.evaluate("(document.getElementById('c-st')||{}).textContent||''")
    ok('按住说话' in st, '界面说明了当前通话方式：' + st[:30])
    pg.evaluate("Call.hangup()"); time.sleep(0.3)
    ok(pg.evaluate("!document.getElementById('callui')"), '挂断后界面关闭')

    print('== 8. 控制台报错 ==')
    real = [e for e in errs if 'favicon' not in e and 'net::ERR' not in e]
    ok(len(real) == 0, '无 JS 报错' + ('' if not real else '：' + real[0][:120]))

    br.close()

try:
    srv.kill('SIGKILL')
except Exception:
    pass
print('\n===== 通过 %d 项，失败 %d 项 =====' % (len(P), len(F)))
