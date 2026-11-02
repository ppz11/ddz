import asyncio, subprocess, time, socket, os, base64
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

# 造一张 1x1 红 PNG 的 dataURL，用来模拟导入图片
PNG = open('/tmp/stk/a.png','rb').read()
os.makedirs("/tmp/stk", exist_ok=True)
with open("/tmp/stk/a.png", "wb") as f:
    f.write(PNG)
with open("/tmp/stk/b.png", "wb") as f:
    f.write(PNG)
# JSON 配置包
pass


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path="/usr/bin/google-chrome",
                                     args=["--no-sandbox", "--disable-gpu"])
        ctx = await br.new_context(viewport={"width": 390, "height": 844},
                                   device_scale_factor=1, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8080/", wait_until="load", timeout=25000)
        await pg.wait_for_timeout(1200)

        # 1) 数据层：从图片建包
        r1 = await pg.evaluate("""async () => {
          const res = await fetch('/shared/../public/js/stickers.js').catch(()=>null);
          const S = window.Stickers;
          if(!S) return {err:'Stickers 未定义'};
          return {packsBefore: S.packs.length, defaultBefore: S.defaultId};
        }""")
        print("1 初始:", r1)

        # 2) 模拟导入图片（直接调 fromFiles 需要 File 对象，这里用 page 上传）
        # 先打开导入界面
        r2 = await pg.evaluate("""() => {
          const S=window.Stickers;
          let picked=null;
          S.openImport(function(f){ picked = f? f.name : null; });
          const box=document.getElementById('stk-import');
          return {opened: !!box, hasImgBtn: !!document.getElementById('sk-img'),
                  hasJsonBtn: !!document.getElementById('sk-json')};
        }""")
        print("2 导入界面:", r2)

        # 3) 上传两张图片
        await pg.set_input_files("input[type=file][multiple][accept='image/*']",
                                 ["/tmp/stk/a.png", "/tmp/stk/b.png"])
        await pg.wait_for_timeout(1200)
        r3 = await pg.evaluate("""() => {
          const S=window.Stickers;
          return {packs: S.packs.length, def: S.defaultId,
                  firstName: S.packs[0]? S.packs[0].name : null,
                  items: S.packs[0]? S.packs[0].items.length : 0,
                  isDefault: S.packs.length? (S.defaultId===S.packs[0].id) : false,
                  gridCount: document.querySelectorAll('#sk-grid .stk').length};
        }""")
        print("3 导入图片后:", r3)

        # 4) 上传 JSON 包 → 应成为新的默认
        await pg.set_input_files("input[type=file][accept='.json,application/json']", ["/tmp/stk/pack.json"])
        await pg.wait_for_timeout(1000)
        r4 = await pg.evaluate("""() => {
          const S=window.Stickers;
          const d=S.packById(S.defaultId);
          return {packs: S.packs.length, defName: d?d.name:null, isSecond: S.packs.length>1 && S.defaultId===S.packs[1].id};
        }""")
        print("4 上传JSON后(应为新默认):", r4)

        # 5) 持久化：刷新后还在
        r5 = await pg.evaluate("""() => {
          try{ return {ls: JSON.parse(localStorage.getItem('ddz_sticker_packs')||'[]').length,
                       def: localStorage.getItem('ddz_sticker_default')? 'yes':'no'}; }
          catch(e){ return {err:e.message}; }
        }""")
        print("5 localStorage 持久化:", r5)

        # 6) 删除包
        r6 = await pg.evaluate("""() => {
          const S=window.Stickers; const n0=S.packs.length;
          S.removePack(S.packs[0].id);
          return {before:n0, after:S.packs.length};
        }""")
        print("6 删除包:", r6)

        print("JS 错误:", len(errs), errs[:2] if errs else "")
        await br.close()


asyncio.run(main())
SRV.kill()
