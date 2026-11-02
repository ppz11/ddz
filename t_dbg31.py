import asyncio, json, os, subprocess, time, socket
from playwright.async_api import async_playwright

def wait_port(port, timeout=20):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            s = socket.create_connection(("127.0.0.1", port), 0.5); s.close(); return True
        except Exception:
            time.sleep(0.3)
    return False

SRV = subprocess.Popen(["node", "server/server.js"], cwd="/data/workspace/ddz",
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if not wait_port(8080):
    print("服务端启动失败"); SRV.kill(); raise SystemExit(1)

URL = "http://127.0.0.1:8080/"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox","--disable-dev-shm-usage"])
        ctx = await b.new_context(viewport={"width": 844, "height": 390})
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append("CONSOLE:" + m.text) if m.type == "error" else None)
        await pg.goto(URL)
        # 等登录完成
        try:
            await pg.wait_for_function("() => { const l=document.getElementById('login'); return l && !l.classList.contains('hidden'); }", timeout=20000)
            print("登录页出现，点进入")
            await pg.evaluate("() => { document.getElementById('lg-go').click(); }")
            await pg.wait_for_timeout(2000)
        except Exception as e:
            print("登录超时", e)
        print("登录完成")
        # 进聊天页
        await pg.evaluate("() => { try{ App.go('chat'); }catch(e){} }")
        await pg.wait_for_timeout(1200)
        info = await pg.evaluate("""() => {
          const ids=['chat-refresh','chat-friends','chat-manage'];
          const out={};
          ids.forEach(id=>{ const el=document.getElementById(id); if(!el){out[id]='不存在';return;}
            const r=el.getBoundingClientRect();
            const cx=Math.round(r.left+r.width/2), cy=Math.round(r.top+r.height/2);
            const top=document.elementFromPoint(cx,cy);
            out[id]={w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.left),y:Math.round(r.top),
              topEl: top? (top.id||top.className||top.tagName):'null',
              hasOnclick: !!el.onclick, visible: r.width>0&&r.height>0};
          });
          out.page = (document.querySelector('#page-chat')||{}).className;
          out.err = window.__lastErr||null;
          return out; }""")
        print("== 按钮状态 ==")
        print(json.dumps(info, ensure_ascii=False, indent=1))
        # 逐个点
        for bid in ["chat-refresh", "chat-friends", "chat-manage"]:
            await pg.evaluate("(id)=>{const e=document.getElementById(id); if(e) e.click();}", bid)
            await pg.wait_for_timeout(800)
            res = await pg.evaluate("""() => ({
              modals: document.querySelectorAll('.modal').length,
              modalIds: [...document.querySelectorAll('.modal')].map(m=>m.id||m.className),
              friendBox: !!document.getElementById('friend-box'),
              toast: (document.querySelector('.toast')||{}).textContent||'',
              selMode: (typeof Chat!=='undefined')? null : null
            })""")
            print(f"点 {bid} ->", json.dumps(res, ensure_ascii=False))
            # 关掉弹窗
            await pg.evaluate("() => { document.querySelectorAll('.modal').forEach(m=>m.remove()); }")
            await pg.wait_for_timeout(200)
        print("== JS 错误 ==")
        for e in errs[:20]: print(" ", e[:200])
        await b.close()

asyncio.run(main())
SRV.kill()
