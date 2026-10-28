# -*- coding: utf-8 -*-
"""启动服务 + 两个浏览器上下文模拟两名玩家，截图验证界面并收集控制台错误"""
import os, subprocess, time, sys, json
from playwright.sync_api import sync_playwright

ROOT = '/data/workspace/ddz'
OUT = '/data/workspace/ddz/shots'
os.makedirs(OUT, exist_ok=True)
PORT = '8087'
BASE = 'http://127.0.0.1:' + PORT

srv = subprocess.Popen(['node', ROOT + '/server/server.js'],
                       cwd=ROOT + '/server',
                       env=dict(os.environ, PORT=PORT),
                       stdout=open('/tmp/shot_srv.log', 'w'), stderr=subprocess.STDOUT)

errors = []


def wait_server():
    import urllib.request
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + '/api/health', timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


assert wait_server(), '服务器启动失败'

with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--disable-dev-shm-usage',
                                 '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    ctx1 = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                          permissions=['microphone'])
    ctx2 = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    p1 = ctx1.new_page(); p2 = ctx2.new_page()

    def hook(pg, tag):
        pg.on('console', lambda m: errors.append('[%s][%s] %s' % (tag, m.type, m.text))
              if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append('[%s][pageerror] %s' % (tag, e)))

    hook(p1, 'A'); hook(p2, 'B')

    def login(pg):
        pg.goto(BASE, wait_until='domcontentloaded')
        pg.wait_for_selector('#lg-go', state='visible', timeout=15000)
        pg.screenshot(path=OUT + '/01_login.png')
        pg.click('#lg-go')
        pg.wait_for_selector('#main:not(.hidden)', timeout=10000)
        time.sleep(0.6)

    login(p1)
    p1.screenshot(path=OUT + '/02_home.png')

    # A 开房间
    p1.click('#btn-create')
    time.sleep(1.2)
    p1.screenshot(path=OUT + '/03_waiting.png')
    gid = p1.evaluate("() => (document.getElementById('mid-notice')||{}).innerText || ''")
    gid = ''.join(ch for ch in gid if ch.isdigit())
    print('房号:', gid)

    # B 加入
    login(p2)
    p2.fill('#join-input', gid)
    p2.click('#btn-join')
    time.sleep(1.5)
    p1.screenshot(path=OUT + '/04_bid.png')
    p2.screenshot(path=OUT + '/04b_bid_other.png')

    # 叫地主：谁亮按钮谁点
    for pg in (p1, p2):
        try:
            btns = pg.query_selector_all('#action-zone .btn')
            for b in btns:
                t = b.inner_text()
                if '叫地主' in t or '叫' in t and '不叫' not in t:
                    b.click(); break
            else:
                for b in btns:
                    if '不叫' in b.inner_text():
                        b.click(); break
        except Exception as e:
            print('bid err', e)
        time.sleep(0.9)

    # 抢地主阶段
    for pg in (p1, p2):
        try:
            for b in pg.query_selector_all('#action-zone .btn'):
                t = b.inner_text()
                if '抢地主' in t or '不抢' in t:
                    b.click(); break
        except Exception as e:
            print('grab err', e)
        time.sleep(0.9)

    time.sleep(1.0)
    print('A 状态:', p1.evaluate("() => { const g=window.Game&&window.Game.state; return g?{phase:g.phase,turn:g.turn,seat:g.seat,hand:g.hand.length,landlord:g.landlord,let:g.letCount}:null; }"))
    p1.screenshot(path=OUT + '/05_play.png')

    # 自动打几手（用页面内引擎算提示再点出牌）
    def auto_play(pg, n=6):
        for _ in range(n):
            try:
                st = pg.evaluate("() => window.Game && window.Game.state")
                if not st or st.get('phase') != 'play':
                    break
                if st.get('turn') != st.get('seat'):
                    time.sleep(0.7); continue
                pg.evaluate("() => window.Game.hint()")
                time.sleep(0.25)
                pg.evaluate("() => window.Game.play()")
                time.sleep(0.8)
            except Exception as e:
                print('autoplay err', e); break

    auto_play(p1, 4)
    p1.screenshot(path=OUT + '/06_play_cards.png')
    auto_play(p2, 4)
    p2.screenshot(path=OUT + '/06b_play_cards.png')
    print('出牌后 A:', p1.evaluate("() => { const g=window.Game&&window.Game.state; return g?{phase:g.phase,turn:g.turn,hand:g.hand.length,last:g.last?g.last.info.type:null}:null; }"))

    # 布局校验
    def layout(pg, tag):
        r = pg.evaluate("""() => {
          const out = {};
          const h = document.getElementById('hand');
          out.handCards = h ? h.querySelectorAll('.pc').length : -1;
          out.handW = h ? Math.round(h.getBoundingClientRect().width) : -1;
          out.handScroll = h ? h.scrollWidth : -1;
          out.viewport = window.innerWidth;
          let over = [];
          document.querySelectorAll('#page-play *').forEach(el => {
            const b = el.getBoundingClientRect();
            if (b.width > 0 && (b.right > window.innerWidth + 1 || b.left < -1)) over.push(el.className || el.tagName);
          });
          out.overflow = over.slice(0, 6);
          return out;
        }""")
        print('  [' + tag + '] 布局:', r)
    layout(p1, 'A'); layout(p2, 'B')

    # 聊天：点在线用户
    p1.click('#tabbar .tab[data-p="home"]')
    time.sleep(0.4)
    p1.click('#tabbar .tab[data-p="chat"]')
    time.sleep(0.5)
    p1.screenshot(path=OUT + '/07_chat_list.png')
    try:
        if p1.query_selector('#chat-list .citem'):
            p1.click('#chat-list .citem')
        else:
            p1.click('#tabbar .tab[data-p="home"]'); time.sleep(0.5)
            p1.click('.online-list .u')
            time.sleep(0.9)
        time.sleep(0.8)
        p1.click('#c-input')
        p1.keyboard.type('你好，这把打得不错')
        p1.click('#c-send')
        time.sleep(0.5)
        p1.click('#c-emoji')
        time.sleep(0.6)
        p1.screenshot(path=OUT + '/08_chat_emoji.png')
        p1.click('#emoji-panel .tabs button[data-p="obj"]')
        time.sleep(0.4)
        p1.screenshot(path=OUT + '/09_chat_sticker.png')
        # 点第一个物件贴纸发送
        p1.click('#emoji-panel .grid button')
        time.sleep(0.6)
        p1.screenshot(path=OUT + '/10_chat_sent.png')
        p1.click('#c-emoji') if p1.query_selector('#emoji-panel') else None
    except Exception as e:
        print('chat err', e)

    # 我的 / 战绩
    p1.click('#tabbar .tab[data-p="me"]')
    time.sleep(0.7)
    p1.screenshot(path=OUT + '/11_me.png')

    # 私密空间：长按顶栏头像
    try:
        box = p1.query_selector('#tb-av').bounding_box()
        p1.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        p1.mouse.down()
        time.sleep(3.0)
        p1.mouse.up()
        time.sleep(0.8)
        p1.screenshot(path=OUT + '/12_secret_pin.png')
        for k in ['2', '5', '8', '0']:
            p1.click('.secret .pin button[data-k="%s"]' % k)
            time.sleep(0.2)
        time.sleep(0.8)
        p1.screenshot(path=OUT + '/13_secret_rooms.png')
    except Exception as e:
        print('secret err', e)

    br.close()

srv.kill()
print('\n'.join(errors) if errors else '无控制台错误')
print('截图输出:', OUT)
print(sorted(os.listdir(OUT)))
