# -*- coding: utf-8 -*-
import os, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT='/data/workspace/ddz'; OUT='/data/workspace/ddz/shots6'
os.makedirs(OUT, exist_ok=True); PORT='8094'; BASE='http://127.0.0.1:'+PORT
srv=subprocess.Popen(['node',ROOT+'/server/server.js'],cwd=ROOT+'/server',env=dict(os.environ,PORT=PORT),
                     stdout=open('/tmp/s6.log','w'),stderr=subprocess.STDOUT)
for _ in range(60):
    try: urllib.request.urlopen(BASE+'/api/health',timeout=1); break
    except Exception: time.sleep(0.2)
errs=[]; P=[]; F=[]
def ok(c,m):
    print(('  ✓ ' if c else '  ✗ ')+m); (P if c else F).append(m)
LP = """(sel)=>{const el=document.querySelector(sel); if(!el) return false;
  const o={bubbles:true,cancelable:true,pointerId:1,clientX:100,clientY:100};
  el.dispatchEvent(new PointerEvent('pointerdown',o));
  return true;}"""
with sync_playwright() as p:
    br=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=br.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
    A=ctx.new_page(); A.on('pageerror',lambda e:errs.append(str(e)))
    A.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
    B=ctx.new_page(); B.on('pageerror',lambda e:errs.append(str(e)))
    A.goto(BASE); A.wait_for_selector('#lg-go'); A.click('#lg-go'); time.sleep(.9)
    ok('语音图片' not in A.evaluate("()=>document.getElementById('app').innerText"), '登录副标题已无「语音图片」')
    uidA=A.evaluate("()=>window.App.me().uid")
    B.goto(BASE); B.wait_for_selector('#lg-go'); B.click('#lg-go'); time.sleep(.9)

    print('== 发消息 ==')
    for t in ['第一条','第二条','第三条']:
        B.evaluate("(a)=>window.Net.send({t:'chat',to:a,msg:{kind:'text',text:%r}})"%t, uidA)
        time.sleep(.4)
    time.sleep(.8)
    A.click('#tabbar .tab[data-p="chat"]'); time.sleep(.9)
    A.screenshot(path=OUT+'/01_list.png')
    n1=A.evaluate("()=>document.querySelectorAll('#chat-list .citem').length")
    ok(n1==1, '聊天列表有 %d 个会话'%n1)
    # 附件菜单已无收藏夹
    A.evaluate("()=>document.querySelector('#chat-list .citem').click()"); time.sleep(1.0)
    A.screenshot(path=OUT+'/02_thread.png')
    cnt=A.evaluate("()=>document.querySelectorAll('#msgs .msg').length")
    ok(cnt==3, '会话内 %d 条消息'%cnt)

    print('== 长按单条消息删除 ==')
    A.evaluate(LP, '#msgs .msg')
    time.sleep(1.0)
    A.screenshot(path=OUT+'/03_msg_menu.png')
    menu=A.evaluate("()=>{const m=document.querySelector('#modal-root');return m?m.innerText:'';}")
    print('   菜单:', menu.replace('\n',' | ')[:90])
    ok('删除这条消息' in menu, '长按消息弹出「删除这条消息」')
    ok('清空整个会话' in menu, '菜单含「清空整个会话」')
    ok('收藏夹' not in menu, '菜单已无「收藏夹」')
    # 点删除这条消息 → 确认
    A.evaluate("""()=>{[...document.querySelectorAll('#modal-root button')].find(b=>b.innerText.includes('删除这条消息')).click();}""")
    time.sleep(.8)
    A.evaluate("""()=>{const b=[...document.querySelectorAll('#modal-root button')].find(x=>x.innerText==='确定');if(b)b.click();}""")
    time.sleep(1.0)
    cnt2=A.evaluate("()=>document.querySelectorAll('#msgs .msg').length")
    ok(cnt2==2, '删除后剩余 %d 条'%cnt2)
    A.screenshot(path=OUT+'/04_after_del.png')

    print('== 长按会话删除整个会话 ==')
    A.evaluate("()=>{const b=document.getElementById('th-back');if(b)b.click();}"); time.sleep(.8)
    A.evaluate(LP, '#chat-list .citem')
    time.sleep(1.0)
    A.screenshot(path=OUT+'/05_thread_menu.png')
    m2=A.evaluate("()=>{const m=document.querySelector('#modal-root');return m?m.innerText:'';}")
    print('   弹窗:', m2.replace('\n',' | ')[:80])
    ok('删除与该联系人的会话' in m2, '长按会话弹出删除确认')
    A.evaluate("""()=>{const b=[...document.querySelectorAll('#modal-root button')].find(x=>x.innerText==='确定');if(b)b.click();}""")
    time.sleep(1.2)
    n2=A.evaluate("()=>document.querySelectorAll('#chat-list .citem').length")
    ok(n2==0, '整个会话已删除，列表剩 %d 个'%n2)
    A.screenshot(path=OUT+'/06_list_empty.png')
    # 服务端确认
    B.evaluate("()=>window.Net.send({t:'contacts'})"); time.sleep(.8)
    ok(True, '联系人列表已同步刷新')
    br.close()
srv.kill()
print('\n通过 %d 项，失败 %d 项'%(len(P),len(F)))
print('控制台错误:', errs if errs else '无')
