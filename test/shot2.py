# -*- coding: utf-8 -*-
"""验证新增功能：创建房间页、三人对局、双人人机、伪装广告层、私密空间真消息"""
import os, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = '/data/workspace/ddz'
OUT = '/data/workspace/ddz/shots2'
os.makedirs(OUT, exist_ok=True)
PORT = '8091'
BASE = 'http://127.0.0.1:' + PORT

srv = subprocess.Popen(['node', ROOT + '/server/server.js'], cwd=ROOT + '/server',
                       env=dict(os.environ, PORT=PORT),
                       stdout=open('/tmp/shot2.log', 'w'), stderr=subprocess.STDOUT)
for _ in range(60):
    try:
        urllib.request.urlopen(BASE + '/api/health', timeout=1); break
    except Exception:
        time.sleep(0.2)

errors = []


def hook(pg, tag):
    pg.on('console', lambda m: errors.append('[%s] %s' % (tag, m.text)) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append('[%s][pageerror] %s' % (tag, e)))


LAYOUT_JS = """() => {
  const out = { issues: [] };
  const pages = [...document.querySelectorAll('.page')].filter(p => p.style.display !== 'none');
  pages.forEach(p => p.querySelectorAll('*').forEach(el => {
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return;
    if (b.right > window.innerWidth + 1) out.issues.push('右溢出:' + (el.className || el.tagName));
  }));
  const h = document.getElementById('hand');
  out.hand = h ? { n: h.querySelectorAll('.pc').length, sw: h.scrollWidth, cw: Math.round(h.getBoundingClientRect().width) } : null;
  return out;
}"""

with sync_playwright() as p:
    br = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg = ctx.new_page(); hook(pg, 'A')
    pg.goto(BASE); pg.wait_for_selector('#lg-go'); pg.click('#lg-go'); time.sleep(0.8)

    # ---- 创建房间页 ----
    pg.click('#tabbar .tab[data-p="home"]'); time.sleep(0.3)
    pg.click('#btn-create'); time.sleep(0.6)
    pg.screenshot(path=OUT + '/01_create_room.png')
    print('创建房页布局:', pg.evaluate(LAYOUT_JS)['issues'] or '无')

    # 选三人
    pg.click('#sel-mode .ms[data-mode="trio"]'); time.sleep(0.4)
    pg.screenshot(path=OUT + '/02_create_trio.png')
    pg.click('#sel-vs .ms[data-vs="pve"]'); time.sleep(0.3)
    pg.click('#btn-do-create'); time.sleep(2.0)
    pg.screenshot(path=OUT + '/03_trio_table.png')
    st = pg.evaluate("() => { const g = window.Game && window.Game.state; return g ? {n:g.n,phase:g.phase,seat:g.seat,hand:g.hand.length,bots:g.seats.map(s=>s&&s.bot)} : null; }")
    print('三人牌桌状态:', st)
    print('三人布局:', pg.evaluate(LAYOUT_JS)['issues'] or '无')

    # 叫分（轮到自己就点 1 分）
    for _ in range(25):
        s = pg.evaluate("() => { const g = window.Game && window.Game.state; return g ? {phase:g.phase,turn:g.turn,seat:g.seat,bidTurn:g.bidTurn} : null; }")
        if not s or s['phase'] != 'bid': break
        if s['bidTurn'] == s['seat']:
            btns = pg.query_selector_all('#action-zone .btn')
            clicked = False
            for b in btns:
                try:
                    if '分' in b.inner_text() and b.is_enabled():
                        b.click(); clicked = True; break
                except Exception: pass
            if not clicked:
                for b in btns:
                    try:
                        if '不叫' in b.inner_text() and b.is_enabled(): b.click(); break
                    except Exception: pass
            time.sleep(0.8)
        else:
            time.sleep(0.5)
    time.sleep(1.0)
    pg.screenshot(path=OUT + '/04_trio_play.png')
    print('出牌阶段:', pg.evaluate("() => { const g=window.Game.state; return {phase:g.phase,landlord:g.landlord,turn:g.turn,counts:g.counts,mult:g.multiplier}; }"))
    print('出牌布局:', pg.evaluate(LAYOUT_JS)['issues'] or '无')

    # 出两手牌
    for _ in range(3):
        s = pg.evaluate("() => { const g=window.Game.state; return g?{phase:g.phase,turn:g.turn,seat:g.seat}:null; }")
        if not s or s['phase'] != 'play' or s['turn'] != s['seat']: time.sleep(0.9); continue
        pg.evaluate("() => window.Game.hint()"); time.sleep(0.2)
        pg.evaluate("() => window.Game.play()"); time.sleep(1.4)
    pg.screenshot(path=OUT + '/05_trio_played.png')
    print('出牌后手牌:', pg.evaluate(LAYOUT_JS)['hand'])

    # ---- 双人人机 ----
    pg.evaluate("() => { window.Game.reset(); window.Net.send({t:'match:bot', rule:'let46'}); }")
    time.sleep(2.0)
    pg.screenshot(path=OUT + '/06_duo_bot.png')
    print('双人人机:', pg.evaluate("() => { const g=window.Game.state; return g?{n:g.n,phase:g.phase,bots:g.seats.map(s=>s&&s.bot)}:null; }"))

    # ---- 伪装层：聊天列表 ----
    pg2 = ctx.new_page(); hook(pg2, 'B')
    pg2.goto(BASE); pg2.wait_for_selector('#lg-go'); pg2.click('#lg-go'); time.sleep(0.8)
    uidA = pg.evaluate("() => window.App.me().uid")
    # B 给 A 发一条真实消息
    pg2.evaluate("(uid) => window.Net.send({t:'chat', to: uid, msg:{kind:'text', text:'这是一条真实私密消息'}})", uidA)
    time.sleep(1.2)
    pg.click('#tabbar .tab[data-p="chat"]'); time.sleep(0.8)
    pg.screenshot(path=OUT + '/07_chat_disguised.png')
    listTxt = pg.evaluate("() => document.getElementById('chat-list').innerText")
    print('聊天列表文案:', listTxt[:120].replace('\n', ' | '))
    print('是否泄露真实内容:', '真实私密消息' in listTxt)

    # 打开会话
    if pg.query_selector('#chat-list .citem'):
        pg.click('#chat-list .citem'); time.sleep(1.0)
        pg.screenshot(path=OUT + '/08_thread_disguised.png')
        thTxt = pg.evaluate("() => (document.getElementById('msgs')||document.body).innerText")
        print('会话内文案:', thTxt[:150].replace('\n', ' | '))
        print('会话内是否泄露:', '真实私密消息' in thTxt)

    # ---- 私密空间看真消息 ----
    pg.evaluate("() => window.Secret.enter()"); time.sleep(0.8)
    for k in ['1', '2', '3', '4']:
        el = pg.query_selector('.secret .pin button[data-k="%s"]' % k)
        if el: el.click(); time.sleep(0.15)
    time.sleep(0.8)
    pg.screenshot(path=OUT + '/09_secret.png')
    pg.evaluate("(uid) => window.Net.send({t:'secret:create', with: uid})", uidB := pg2.evaluate("() => window.App.me().uid"))
    time.sleep(1.0)
    pg.evaluate("() => window.Secret.close()")
    pg.evaluate("() => window.Secret.enter()"); time.sleep(0.6)
    for k in ['1', '2', '3', '4']:
        el = pg.query_selector('.secret .pin button[data-k="%s"]' % k)
        if el: el.click(); time.sleep(0.12)
    time.sleep(0.9)
    pg.screenshot(path=OUT + '/10_secret_room.png')
    if pg.query_selector('.secret .sitem'):
        pg.click('.secret .sitem'); time.sleep(0.9)
        pg.screenshot(path=OUT + '/11_secret_thread.png')
    print('私密空间已渲染:', pg.evaluate("() => !!document.getElementById('secret-root')"))

    br.close()

srv.kill()
print('\n控制台错误:', errors if errors else '无')
print('截图目录:', sorted(os.listdir(OUT)))
