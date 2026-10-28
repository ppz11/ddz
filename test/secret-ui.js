# -*- coding: utf-8 -*-
import os, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT='/data/workspace/ddz'; OUT='/data/workspace/ddz/shots4'
os.makedirs(OUT, exist_ok=True); PORT='8097'; BASE='http://127.0.0.1:'+PORT
srv=subprocess.Popen(['node',ROOT+'/server/server.js'],cwd=ROOT+'/server',env=dict(os.environ,PORT=PORT),
                     stdout=open('/tmp/s4.log','w'),stderr=subprocess.STDOUT)
for _ in range(60):
    try: urllib.request.urlopen(BASE+'/api/health',timeout=1); break
    except Exception: time.sleep(0.2)
errs=[]; P=[]; F=[]
def ok(c,m):
    print(('  ✓ ' if c else '  ✗ ')+m); (P if c else F).append(m)
with sync_playwright() as p:
    br=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=br.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
    A=ctx.new_page(); A.on('pageerror',lambda e:errs.append(str(e)))
    A.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    A.goto(BASE); A.wait_for_selector('#lg-go'); A.click('#lg-go'); time.sleep(.9)
    A.click('#tabbar .tab[data-p="me"]'); time.sleep(.6)
    A.screenshot(path=OUT+'/01_me.png')
    # 我的页面不应有任何私密空间入口
    txt=A.evaluate("()=>document.getElementById('page-me').innerText")
    ok('私密空间' not in txt, '「我的」页面无「私密空间」字样（残留：%s）' % ('有' if '私密空间' in txt else '无'))
    ok(A.query_selector('#row-secret') is None, '显性入口 row-secret 已移除')
    ok(A.query_selector('#me-uid') is not None, 'UID 元素存在（连击入口）')
    uid_txt=A.evaluate("()=>document.getElementById('me-uid').textContent")
    print('   UID 文本:', uid_txt)
    # 连击 5 下 UID
    for i in range(5):
        A.click('#me-uid'); time.sleep(0.12)
    time.sleep(1.0)
    A.screenshot(path=OUT+'/02_first_setpin.png')
    has_overlay=A.evaluate("()=>!!document.getElementById('secret-root')")
    ok(has_overlay, '首次：连击 5 下后进入设置暗号界面')
    body=A.evaluate("()=>{const b=document.getElementById('s-body');return b?b.innerText:'';}")
    print('   设置界面文案:', body.replace('\n',' | ')[:80])
    ok('4 位暗号' in body, '提示为「设置 4 位暗号」')
    # 检查隐藏输入框：应为数字键盘属性且不可见
    info=A.evaluate("""()=>{const i=document.getElementById('pinpad');if(!i)return null;
      const r=i.getBoundingClientRect();const cs=getComputedStyle(i);
      return {mode:i.getAttribute('inputmode'),pattern:i.getAttribute('pattern'),max:i.maxLength,
              w:Math.round(r.width),h:Math.round(r.height),op:cs.opacity,focused:document.activeElement===i};}""")
    print('   隐藏输入框:', info)
    ok(info and info['mode']=='numeric' and info['pattern']=='[0-9]*', '输入框为纯数字键盘模式')
    ok(info and info['max']==4, '限长 4 位')
    ok(info and info['w']<=2 and info['h']<=2 and info['op']=='0', '输入框完全不可见（1px 透明）')
    ok(info and info['focused'], '已自动聚焦，系统数字键盘弹出')
    # 输入 4 位
    A.keyboard.type('3141'); time.sleep(1.2)
    A.screenshot(path=OUT+'/03_after_set.png')
    ok(A.evaluate("()=>!!document.getElementById('secret-root')"), '设置后停留在私密空间')
    st=A.evaluate("()=>{const b=document.getElementById('s-body');return b?b.innerText:'';}")
    print('   私密空间内容:', st.replace('\n',' | ')[:80])
    # 关闭
    A.evaluate("()=>window.Secret.close()"); time.sleep(.5)
    ok(A.evaluate("()=>!document.getElementById('secret-root')"), '可正常关闭')
    # 再次连击 5 下 → 不应显示任何 PIN 界面，只弹键盘
    for i in range(5):
        A.click('#me-uid'); time.sleep(0.12)
    time.sleep(1.0)
    A.screenshot(path=OUT+'/04_second_unlock.png')
    ov=A.evaluate("()=>!!document.getElementById('secret-root')")
    ok(not ov, '第二次：不弹出任何 PIN 输入界面（overlay 未出现）')
    info2=A.evaluate("""()=>{const i=document.getElementById('pinpad');return i?{focused:document.activeElement===i,val:i.value}:null;}""")
    print('   键盘状态:', info2)
    ok(info2 and info2['focused'], '仅弹出系统数字键盘')
    # 输错
    A.keyboard.type('9999'); time.sleep(1.0)
    A.screenshot(path=OUT+'/05_wrong.png')
    ov2=A.evaluate("()=>!!document.getElementById('secret-root')")
    ok(not ov2, '暗号错误时不进入私密空间')
    # 重新触发输对
    A.evaluate("()=>window.Secret.enter()"); time.sleep(.6)
    A.evaluate("()=>{const i=document.getElementById('pinpad');i.focus();}"); time.sleep(.3)
    A.keyboard.type('3141'); time.sleep(1.2)
    A.screenshot(path=OUT+'/06_unlocked.png')
    ok(A.evaluate("()=>!!document.getElementById('secret-root')"), '暗号正确后自动进入私密空间')
    inner=A.evaluate("()=>{const b=document.getElementById('s-body');return b?b.innerText:'';}")
    print('   进入后内容:', inner.replace('\n',' | ')[:90])
    br.close()
srv.kill()
print('\n通过 %d 项，失败 %d 项'%(len(P),len(F)))
print('控制台错误:', errs if errs else '无')
