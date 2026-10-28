# -*- coding: utf-8 -*-
import os, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT='/data/workspace/ddz'; OUT='/data/workspace/ddz/shots5'
os.makedirs(OUT, exist_ok=True); PORT='8096'; BASE='http://127.0.0.1:'+PORT
srv=subprocess.Popen(['node',ROOT+'/server/server.js'],cwd=ROOT+'/server',env=dict(os.environ,PORT=PORT),
                     stdout=open('/tmp/s5.log','w'),stderr=subprocess.STDOUT)
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

    print('== 1. 主界面无任何私密相关提示 ==')
    for pg_id in ['home','chat','me']:
        A.click('#tabbar .tab[data-p="%s"]'%pg_id); time.sleep(.5)
        t=A.evaluate("()=>document.getElementById('app').innerText")
        has = ('私密' in t) or ('隐私模式' in t) or ('指定入口' in t)
        ok(not has, '%s 页无「私密/指定入口」字样'%pg_id)
    # 创建房间页（非 tabbar）
    A.click('#tabbar .tab[data-p="home"]'); time.sleep(.3)
    A.click('#btn-create'); time.sleep(.6)
    t=A.evaluate("()=>document.getElementById('app').innerText")
    ok(not (('私密' in t) or ('指定入口' in t)), 'create 页无「私密/指定入口」字样')
    A.evaluate("()=>{const b=document.getElementById('btn-back-home');if(b)b.click();}"); time.sleep(.4)
    A.screenshot(path=OUT+'/01_me_clean.png')

    print('== 2. 进入私密空间 ==')
    A.click('#tabbar .tab[data-p="me"]'); time.sleep(.4)
    A.evaluate("()=>{const e=document.getElementById('me-uid');for(let i=0;i<5;i++)e.click();}")
    time.sleep(.9)
    A.evaluate("()=>{const i=document.getElementById('pinpad');if(i){i.focus();i.value='2468';i.dispatchEvent(new Event('input'));}}")
    time.sleep(1.2)
    ok(A.evaluate("()=>!!document.getElementById('secret-root')"), '已进入私密空间')
    A.screenshot(path=OUT+'/02_secret_open.png')

    print('== 3. 锁屏（切后台）→ 最小化并回到主界面 ==')
    # 记录 Capacitor minimizeApp 调用
    A.evaluate("""()=>{ window.__min=0;
      window.Capacitor = window.Capacitor || { Plugins: {} };
      window.Capacitor.Plugins = window.Capacitor.Plugins || {};
      window.Capacitor.Plugins.App = { minimizeApp: () => new Promise(r=>{ window.__min++; r(); }) }; }""")
    A.evaluate("""()=>{ Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
      document.dispatchEvent(new Event('visibilitychange')); }""")
    time.sleep(1.0)
    ok(A.evaluate("()=>!document.getElementById('secret-root')"), '锁屏后私密空间已关闭')
    cur=A.evaluate("()=>{const p=[...document.querySelectorAll('.page')].find(x=>x.style.display!=='none');return p?p.id:null;}")
    ok(cur=='page-home', '锁屏后回到主界面（当前页：%s）'%cur)
    ok(A.evaluate("()=>window.__min===1"), '已调用原生最小化 minimizeApp')
    A.screenshot(path=OUT+'/03_after_lock.png')

    print('== 4. 摇一摇 → 回到主界面 ==')
    A.evaluate("""()=>{ Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
      document.dispatchEvent(new Event('visibilitychange')); }""")
    time.sleep(.3)
    A.evaluate("()=>{const e=document.getElementById('me-uid');for(let i=0;i<5;i++)e.click();}")
    time.sleep(.8)
    A.evaluate("()=>{const i=document.getElementById('pinpad');if(i){i.focus();i.value='2468';i.dispatchEvent(new Event('input'));}}")
    time.sleep(1.2)
    ok(A.evaluate("()=>!!document.getElementById('secret-root')"), '再次进入私密空间')
    # 模拟剧烈摇动
    A.evaluate("""()=>{ let v=0; const fire=(x,y,z)=>{ const e=new Event('devicemotion');
        e.accelerationIncludingGravity={x:x,y:y,z:z}; window.dispatchEvent(e); };
      for(let i=0;i<6;i++){ fire(i%2?60:-60, i%2?-60:60, i%2?60:-60); } }""")
    time.sleep(.9)
    ok(A.evaluate("()=>!document.getElementById('secret-root')"), '摇一摇后私密空间已关闭')
    cur2=A.evaluate("()=>{const p=[...document.querySelectorAll('.page')].find(x=>x.style.display!=='none');return p?p.id:null;}")
    ok(cur2=='page-home', '摇一摇后回到主界面（当前页：%s）'%cur2)
    A.screenshot(path=OUT+'/04_after_shake.png')
    br.close()
srv.kill()
print('\n通过 %d 项，失败 %d 项'%(len(P),len(F)))
print('控制台错误:', errs if errs else '无')
