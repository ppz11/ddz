/* ===================== 私信聊天（文字/语音/图片/视频/文件/表情） ===================== */
window.Chat = (function () {
  var contacts = [], cur = null, msgs = [], unread = {}, panel = null;
  var rec = null, chunks = [], stream = null, recStart = 0, recTimer = null, canceling = false;
  /* 多选删除：'conv' = 选会话，'msg' = 选消息 */
  var selMode = null, selConvs = new Set(), selMsgs = new Set();

  function init() {
    Net.on('contacts', function (m) { contacts = m.list || []; renderList(); paintThreadState(); });
    Net.on('chat', function (m) {
      // 通知栏永远只推送斗地主营销广告，绝不泄露真实内容
      if (m.msg.from !== App.me().uid) Notifier.notifyIfHidden(m.msg.id || (m.msg.from + m.msg.ts));
      if (cur && (m.msg.from === cur || m.msg.to === cur)) { pushMsg(m.msg); scrollBottom(); Sfx.msg(); }
      else {
        unread[m.msg.from] = (unread[m.msg.from] || 0) + 1;
        Sfx.msg();
        if (App.disguise()) App.toast(ADS.randomFeed()); else App.toast('收到新消息');
      }
      renderList();
    });
    Net.on('chat:history', function (m) { msgs = m.list || []; renderMsgs(); scrollBottom(); });
    Net.on('chat:deleted', function (m) {
      msgs = msgs.filter(function (x) { return x.id !== m.id; }); renderMsgs();
    });
    Net.on('chat:deletedbatch', function (m) {
      var ids = (m.ids || []).map(String);
      msgs = msgs.filter(function (x) { return ids.indexOf(String(x.id)) < 0; });
      renderMsgs();
    });
    /* 单向删除：服务端不会再给对方推送删除事件，这里只处理自己这边的回执 */
    Net.on('chat:threadsdeleted', function (m) {
      var uids = m.uids || [];
      uids.forEach(function (k) { delete unread[k]; });
      if (cur && uids.indexOf(cur) >= 0) close();
      exitSel(); renderList();
    });
    Net.on('chat:threadgone', function (m) {
      delete unread[m.with];
      if (cur === m.with) { msgs = []; renderMsgs(); }
      renderList();
    });
  }

  function ruleText(r) {
    return r === 'trio54' ? '三人经典' : (r === 'let46' ? '让牌玩法' : '经典玩法');
  }
  function renderList() {
    var box = document.getElementById('chat-list');
    if (!contacts.length) {
      box.innerHTML = '<div class="empty">还没有联系人<br>去大厅邀人开局，或在创建房间页邀请在线好友</div>';
    } else {
      box.innerHTML = contacts.map(function (c) {
      var n = unread[c.uid] || 0;
      // 伪装模式下，列表预览一律伪装成「邀请你开局」，不做广告资讯
      var last = App.disguise() ? ADS.inviteFor(c.uid + (c.ts || '')) : (c.lastText || '');
      var rm = c.room;
      var acts = '';
      if (!c.self) {
        if (rm && rm.gid) {
          var st = rm.phase === 'wait' ? ('已开房 ' + rm.filled + '/' + rm.n + ' 人') : '对局进行中';
          acts += '<button class="join" data-join="' + rm.gid + '">加入房间 · ' + st + '</button>';
        }
        if (c.online) {
          acts += '<button class="inv" data-invp="' + c.uid + '">邀请开局</button>';
          acts += '<button class="cb" data-call="' + c.uid + '" data-m="audio">📞 语音</button>';
          acts += '<button class="cb" data-call="' + c.uid + '" data-m="video">📹 视频</button>';
        }
      }
      var roomHtml = acts ? '<div class="croom">' + acts + '</div>' : '';
      // 在线状态以服务端为准：列表与会话内显示完全一致
      var state = c.online
        ? '<span class="st on">在线</span>'
        : '<span class="st off">离线</span>';
      var pick = selMode === 'conv'
        ? '<div class="pick' + (selConvs.has(c.uid) ? ' on' : '') + '" data-pick="' + c.uid + '"></div>'
        : '';
      return '<div class="citem' + (c.online ? ' on' : '') + (selConvs.has(c.uid) ? ' picked' : '') + '" data-uid="' + c.uid + '">' +
        pick +
        '<div class="a">' + Avatar.svg(c.avatar, 46) + (c.online ? '<i class="lv"></i>' : '') + '</div>' +
        '<div class="m"><div class="n">' + esc(c.nick) + state +
        '<span class="ts">' + fmt(c.ts) + '</span></div>' +
        '<div class="p">' + (last ? esc(last) : '点击开始聊天') + '</div>' + roomHtml + '</div>' +
        (n ? '<div class="badge">' + n + '</div>' : '') + '</div>';
      }).join('');
    }
    box.querySelectorAll('[data-join]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        Game.reset();
        App.joinRoom(b.dataset.join);
      };
    });
    box.querySelectorAll('[data-invp]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        Sfx.click();
        App.invitePlay(b.dataset.invp);
      };
    });
    box.querySelectorAll('[data-call]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        Call.start(b.dataset.call, b.dataset.m);
      };
    });
    box.querySelectorAll('.citem').forEach(function (el) {
      el.onclick = function () {
        if (selMode === 'conv') { toggleConv(el.dataset.uid); return; }
        open(el.dataset.uid);
      };
      // 长按会话 → 菜单：删除 / 多选删除
      longPress(el, function () {
        var uid = el.dataset.uid;
        var c = contacts.filter(function (x) { return x.uid === uid; })[0] || {};
        App.sheet([
          ['🗑 删除该会话', function () {
            App.confirm('删除与「' + esc(c.nick || '玩家') + '」的会话？', '只在你这边删除，对方仍能看到', function () {
              Net.send({ t: 'chat:delthread', with: uid });
              unread[uid] = 0;
              if (cur === uid) close();
              App.toast('会话已删除');
            });
          }],
          ['☑️ 多选删除', function () { enterConvSel(uid); }],
          ['✅ 标记已读', function () { unread[uid] = 0; renderList(); }]
        ]);
      });
    });
    box.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); toggleConv(b.dataset.pick); };
    });
    paintConvBar();
    App.updateChatDot(Object.keys(unread).reduce(function (a, k) { return a + unread[k]; }, 0));
  }

  function open(uid) {
    cur = uid; unread[uid] = 0; msgs = [];
    var c = contacts.filter(function (x) { return x.uid === uid; })[0] || {};
    var t = document.createElement('div');
    t.className = 'thread'; t.id = 'thread';
    t.innerHTML =
      '<header><div class="back" id="th-back">‹</div><div class="a">' + Avatar.svg(c.avatar, 34) + '</div>' +
      '<div><div class="n">' + esc(c.nick || '玩家') + '</div><div class="s" id="th-st">' +
      (c.online ? '在线' : '离线') + '</div></div>' +
      '<div style="flex:1"></div>' +
      '<div class="back" id="th-call">📞</div>' +
      '<div class="back" id="th-vid">📹</div>' +
      '<div class="back" id="th-info">⋯</div></header>' +
      '<div class="msgs" id="msgs"></div>' +
      '<div class="composer">' +
      '<div class="ic" id="c-voice">🎙</div>' +
      '<div class="input" id="c-input" contenteditable="true" data-ph="说点什么…"></div>' +
      '<div class="ic" id="c-emoji">😊</div>' +
      '<div class="ic" id="c-plus">＋</div>' +
      '<div class="ic" id="c-send" style="background:var(--jade);color:#04281f">➤</div>' +
      '</div>' +
      '<input type="file" id="f-img" accept="image/*" class="hidden">' +
      '<input type="file" id="f-vid" accept="video/*" class="hidden">' +
      '<input type="file" id="f-file" class="hidden">';
    document.getElementById('pages').appendChild(t);
    document.getElementById('th-back').onclick = close;
    document.getElementById('th-info').onclick = function () { App.toast('UID：' + uid); };
    document.getElementById('th-call').onclick = function () { Call.start(uid, 'audio'); };
    document.getElementById('th-vid').onclick = function () { Call.start(uid, 'video'); };
    document.getElementById('c-send').onclick = sendText;
    document.getElementById('c-emoji').onclick = togglePanel;
    document.getElementById('c-plus').onclick = plusMenu;
    // 左滑 / 右滑均可返回
    Nav.push(close, 'thread');
    bindVoice(document.getElementById('c-voice'));
    var inp = document.getElementById('c-input');
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
    });
    inp.addEventListener('input', function () { Net.send({ t: 'typing', to: uid }); });
    document.getElementById('f-img').onchange = function (e) { sendFile(e.target.files[0], 'image'); };
    document.getElementById('f-vid').onchange = function (e) { sendFile(e.target.files[0], 'video'); };
    document.getElementById('f-file').onchange = function (e) { sendFile(e.target.files[0], 'file'); };
    Net.send({ t: 'chat:history', with: uid });
    renderList();
  }
  function close() {
    var t = document.getElementById('thread'); if (t) t.remove();
    cur = null; closePanel();
    exitSel();
    try { Nav.drop('thread'); } catch (e) { }
  }
  /* 会话顶部状态与列表保持一致（真实在线 / 离线） */
  function paintThreadState() {
    var s = document.getElementById('th-st');
    if (!s || !cur) return;
    var c = contacts.filter(function (x) { return x.uid === cur; })[0];
    if (!c) return;
    s.textContent = c.online ? '在线' : '离线';
    s.className = 's ' + (c.online ? 'on' : 'off');
  }
  function pushMsg(m) { msgs.push(m); if (msgs.length > 300) msgs.shift(); renderMsgs(); }

  function renderMsgs() {
    var box = document.getElementById('msgs'); if (!box) return;
    var me = App.me().uid;
    box.innerHTML = msgs.map(function (m) {
      var who = m.from === me ? App.me() : (contacts.filter(function (c) { return c.uid === m.from; })[0] || {});
      var av = Avatar.svg(who.avatar, 32);
      var body = bubble(m);
      var pick = selMode === 'msg'
        ? '<div class="pick' + (selMsgs.has(String(m.id)) ? ' on' : '') + '" data-mpick="' + m.id + '"></div>'
        : '';
      return '<div class="msg ' + (m.from === me ? 'me' : '') + (selMsgs.has(String(m.id)) ? ' picked' : '') + '" data-id="' + m.id + '">' +
        pick + (m.from === me ? '' : '') +
        '<div class="a">' + av + '</div><div class="bub ' + (m.kind || 'text') + '">' + body +
        '<div class="time">' + fmt(m.ts) + '</div></div></div>';
    }).join('');
    box.querySelectorAll('.bub img,.bub video').forEach(function (el) {
      el.onclick = function () { view(el.src, el.tagName === 'VIDEO'); };
    });
    box.querySelectorAll('[data-play]').forEach(function (b) {
      b.onclick = function () { playVoice(b.dataset.play, b); };
    });
    box.querySelectorAll('[data-dl]').forEach(function (b) {
      b.onclick = function () { window.open(b.dataset.dl, '_blank'); };
    });
    box.querySelectorAll('[data-mpick]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); toggleMsg(b.dataset.mpick); };
    });
    box.querySelectorAll('.msg').forEach(function (el) {
      if (selMode === 'msg') {
        el.onclick = function () { toggleMsg(el.dataset.id); };
        return;
      }
      longPress(el, function () {
        App.sheet([
          ['🗑 删除这条消息', function () {
            App.confirm('删除这条消息？', '只在你这边删除，对方仍能看到', function () {
              Net.send({ t: 'chat:del', id: el.dataset.id, with: cur });
            });
          }],
          ['☑️ 多选删除', function () { enterMsgSel(el.dataset.id); }],
          ['🧹 清空整个会话', function () {
            App.confirm('清空与该联系人的全部消息？', '只在你这边清空，对方仍能看到', function () {
              Net.send({ t: 'chat:delthread', with: cur });
              App.toast('会话已清空');
            });
          }]
        ]);
      });
    });
    paintMsgBar();
  }

  function bubble(m) {
    // 隐私伪装：会话里一律伪装成「对方邀请你开局」；
    // 真真假假的广告资讯只出现在手机通知栏，不出现在会话内容里
    if (App.disguise()) {
      return '<div class="invmsg">🎮 ' + esc(ADS.inviteFor(m.id || (m.from + m.ts))) + '</div>' +
        '<div class="time">' + fmt(m.ts) + '</div>';
    }
    if (m.kind === 'sticker') {
      var svg = Stickers.html(m.sticker.pack, m.sticker.id);
      if (m.sticker.pack === 'emoji') return '<div style="font-size:44px;line-height:1.2">' + (Stickers.EMOJI[m.sticker.id] || '🙂') + '</div>';
      return svg;
    }
    if (m.kind === 'image') return '<img src="' + Net.abs(m.url) + '" alt="图片">';
    if (m.kind === 'video') return '<video src="' + Net.abs(m.url) + '" controls playsinline preload="metadata" style="width:200px"></video>';
    if (m.kind === 'voice') {
      var w = '';
      var n = Math.min(18, Math.max(5, Math.round(m.dur || 1) * 2));
      for (var i = 0; i < n; i++) {
        var h = 6 + (Math.abs(Math.sin(i * 1.7 + (m.id || '').length)) * 14);
        w += '<i style="height:' + h.toFixed(0) + 'px"></i>';
      }
      return '<div class="wave">' + w + '</div><span class="du">' + (m.dur || 0) + '″</span>' +
        '<span data-play="' + Net.abs(m.url) + '" style="font-size:16px">▶</span>';
    }
    if (m.kind === 'file') {
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px">' +
        '<div style="font-size:26px">📄</div><div><div class="fname">' + esc(m.name) + '</div>' +
        '<div style="font-size:10px;opacity:.7">' + size(m.size) + '</div></div>' +
        '<div data-dl="' + Net.abs(m.url) + '" style="margin-left:6px;font-size:18px">⬇</div></div>';
    }
    return esc(m.text || '');
  }

  function scrollBottom() {
    var b = document.getElementById('msgs'); if (b) setTimeout(function () { b.scrollTop = b.scrollHeight; }, 40);
  }

  function send(obj) { Net.send(Object.assign({ t: 'chat', to: cur }, { msg: obj })); }

  function sendText() {
    var el = document.getElementById('c-input');
    var txt = el.innerText.replace(/\n$/, '').trim();
    if (!txt) return;
    el.innerHTML = '';
    send({ kind: 'text', text: txt });
    Sfx.send();
  }
  function sendSticker(pack, id) {
    send({ kind: 'sticker', sticker: { pack: pack, id: id } });
    Sfx.send(); closePanel();
  }
  function sendFile(file, kind) {
    if (!file) return;
    if (file.size > 26 * 1024 * 1024) return App.toast('文件太大，上限 26MB');
    App.toast('发送中…');
    Net.upload(file, kind, 0).then(function (r) {
      if (r.err) return App.toast(r.err);
      send({ kind: kind, url: r.url, name: r.name, size: r.size, mime: r.mime });
      App.toast('已发送');
    }).catch(function () { App.toast('发送失败'); });
  }

  /* ---------------- 语音（原生录音优先，Web 录音兜底） ---------------- */
  function bindVoice(btn) {
    if (!btn) return;
    Rec.hold(btn, function (r) {
      App.toast('发送中…');
      Net.upload(r.file, 'voice', r.dur).then(function (up) {
        if (up.err) return App.toast(up.err);
        send({ kind: 'voice', url: up.url, dur: r.dur, name: r.file.name, size: r.file.size });
        App.toast('已发送');
      }).catch(function () { App.toast('发送失败'); });
    });
  }
  function startRec() {
    if (rec) return;
    rec = 1;
    Rec.start(function (err) {
      if (err) { rec = null; return App.toast(err); }
      recStart = Date.now(); canceling = false;
      Sfx.rec(); showRecBar();
    });
  }
  function stopRec(cancel) {
    if (!rec) return;
    canceling = cancel;
    rec = null; hideRecBar();
    Rec.stop().then(function (r) {
      if (canceling || !r) return;
      App.toast('发送中…');
      Net.upload(r.file, 'voice', r.dur).then(function (up) {
        if (up.err) return App.toast(up.err);
        send({ kind: 'voice', url: up.url, dur: r.dur, name: r.file.name, size: r.file.size });
      });
    });
  }
  function showRecBar() {
    var b = document.createElement('div');
    b.className = 'recbar'; b.id = 'recbar';
    b.innerHTML = '<span class="dotrec"></span><span>录音中 <b id="rect">0</b>″</span><span style="color:var(--sub);font-size:11px">松开发送</span>';
    document.getElementById('thread').appendChild(b);
    recTimer = setInterval(function () {
      var e = document.getElementById('rect');
      if (e) e.textContent = Math.round((Date.now() - recStart) / 1000);
    }, 300);
  }
  function hideRecBar() {
    clearInterval(recTimer);
    var b = document.getElementById('recbar'); if (b) b.remove();
  }
  var audioEl = null;
  function playVoice(url, btn) {
    if (audioEl) { audioEl.pause(); audioEl = null; }
    audioEl = new Audio(url);
    audioEl.play().catch(function () { App.toast('播放失败'); });
    btn.textContent = '⏸';
    audioEl.onended = function () { btn.textContent = '▶'; audioEl = null; };
  }

  /* ---------------- 表情面板 ---------------- */
  function togglePanel() {
    if (panel) return closePanel();
    panel = document.createElement('div');
    panel.className = 'emoji-panel'; panel.id = 'emoji-panel';
    panel.innerHTML = '<div class="tabs">' +
      '<button class="on" data-p="face">表情</button><button data-p="obj">物件</button><button data-p="emoji">Emoji</button></div>' +
      '<div class="grid" id="emo-grid"></div>';
    document.getElementById('thread').appendChild(panel);
    fill('face');
    panel.querySelectorAll('.tabs button').forEach(function (b) {
      b.onclick = function () {
        panel.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); fill(b.dataset.p);
      };
    });
  }
  function fill(p) {
    var g = document.getElementById('emo-grid'); if (!g) return;
    if (p === 'emoji') {
      g.innerHTML = Stickers.EMOJI.map(function (e, i) { return '<button data-k="emoji" data-i="' + i + '">' + e + '</button>'; }).join('');
    } else {
      var arr = p === 'face' ? Stickers.PACK_FACE : Stickers.PACK_OBJ;
      g.innerHTML = arr.map(function (s) { return '<button data-k="' + p + '" data-i="' + s.id + '" title="' + s.n + '">' + Stickers.svgOf(s) + '</button>'; }).join('');
    }
    g.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { sendSticker(b.dataset.k, b.dataset.i); };
    });
  }
  function closePanel() { if (panel) { panel.remove(); panel = null; } }

  /* ---------------- 附件菜单 ---------------- */
  function plusMenu() {
    App.sheet([['🖼 发送图片', function () { document.getElementById('f-img').click(); }],
      ['🎬 发送视频', function () { document.getElementById('f-vid').click(); }],
      ['📎 发送文件', function () { document.getElementById('f-file').click(); }]]);
  }

  function view(src, isVideo) {
    var v = document.createElement('div');
    v.className = 'viewer';
    v.innerHTML = '<div class="x">✕</div>' + (isVideo ? '<video src="' + src + '" controls autoplay playsinline></video>' : '<img src="' + src + '">');
    v.querySelector('.x').onclick = function () { v.remove(); };
    document.getElementById('app').appendChild(v);
  }

  function fmt(ts) {
    if (!ts) return '';
    var d = new Date(ts), n = new Date();
    if (d.toDateString() === n.toDateString()) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function size(b) { if (!b) return ''; var u = ['B', 'KB', 'MB', 'GB'], i = 0; while (b > 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + u[i]; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function longPress(el, fn) {
    var t = null;
    el.addEventListener('pointerdown', function () { t = setTimeout(fn, 550); });
    el.addEventListener('pointerup', function () { clearTimeout(t); });
    el.addEventListener('pointermove', function () { clearTimeout(t); });
    el.addEventListener('pointercancel', function () { clearTimeout(t); });
  }

  /* ---------------- 多选删除 ---------------- */
  function barHtml(kind) {
    var n = kind === 'conv' ? selConvs.size : selMsgs.size;
    var total = kind === 'conv' ? contacts.length : msgs.length;
    return '<div class="selbar">' +
      '<button class="sb" data-a="all">' + (n >= total && total > 0 ? '取消全选' : '全选') + '</button>' +
      '<div class="sb-n">已选 <b>' + n + '</b> 项</div>' +
      '<button class="sb danger" data-a="del"' + (n ? '' : ' disabled') + '>删除</button>' +
      '<button class="sb" data-a="cancel">取消</button></div>';
  }
  function ensureBar(kind) {
    var host = kind === 'conv' ? document.getElementById('page-chat') : document.getElementById('thread');
    if (!host) return null;
    var b = document.getElementById('selbar');
    if (!b) { b = document.createElement('div'); b.id = 'selbar'; host.appendChild(b); }
    else if (b.parentNode !== host) host.appendChild(b);
    b.innerHTML = barHtml(kind);
    b.querySelectorAll('[data-a]').forEach(function (x) {
      x.onclick = function () {
        var a = x.dataset.a;
        if (a === 'cancel') exitSel();
        else if (a === 'all') {
          if (kind === 'conv') {
            if (selConvs.size >= contacts.length) selConvs.clear();
            else contacts.forEach(function (c) { selConvs.add(c.uid); });
            renderList();
          } else {
            if (selMsgs.size >= msgs.length) selMsgs.clear();
            else msgs.forEach(function (m) { selMsgs.add(String(m.id)); });
            renderMsgs();
          }
        } else if (a === 'del') {
          if (kind === 'conv') delSelConvs(); else delSelMsgs();
        }
      };
    });
    return b;
  }
  function paintConvBar() {
    var old = document.getElementById('selbar');
    if (selMode !== 'conv') { if (old) old.remove(); return; }
    ensureBar('conv');
  }
  function paintMsgBar() {
    var old = document.getElementById('selbar');
    if (selMode !== 'msg') { if (old) old.remove(); return; }
    ensureBar('msg');
  }
  function exitSel() {
    selMode = null; selConvs.clear(); selMsgs.clear();
    var b = document.getElementById('selbar'); if (b) b.remove();
  }
  function enterConvSel(first) {
    selMode = 'conv'; selConvs.clear();
    if (first) selConvs.add(first);
    renderList();
  }
  function toggleConv(uid) {
    if (selConvs.has(uid)) selConvs.delete(uid); else selConvs.add(uid);
    renderList();
  }
  function delSelConvs() {
    var list = Array.from(selConvs);
    if (!list.length) return;
    App.confirm('删除选中的 ' + list.length + ' 个会话？', '只在你这边删除，对方仍能看到', function () {
      Net.send({ t: 'chat:delthreads', uids: list });
      list.forEach(function (k) { delete unread[k]; if (cur === k) close(); });
      exitSel(); renderList();
      App.toast('已删除 ' + list.length + ' 个会话');
    });
  }
  function enterMsgSel(first) {
    if (!cur) return;
    selMode = 'msg'; selMsgs.clear();
    if (first) selMsgs.add(String(first));
    renderMsgs();
  }
  function toggleMsg(id) {
    id = String(id);
    if (selMsgs.has(id)) selMsgs.delete(id); else selMsgs.add(id);
    renderMsgs();
  }
  function delSelMsgs() {
    var list = Array.from(selMsgs);
    if (!list.length || !cur) return;
    App.confirm('删除选中的 ' + list.length + ' 条消息？', '只在你这边删除，对方仍能看到', function () {
      Net.send({ t: 'chat:delbatch', with: cur, ids: list });
      msgs = msgs.filter(function (x) { return list.indexOf(String(x.id)) < 0; });
      exitSel(); renderMsgs();
      App.toast('已删除 ' + list.length + ' 条消息');
    });
  }

  return { init: init, renderList: renderList, open: open, close: close, get cur() { return cur; }, sendFile: sendFile,
    exitSel: exitSel, isSel: function () { return !!selMode; } };
})();
