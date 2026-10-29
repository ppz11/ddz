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
  /* 文件类型图标：按后缀显示，不再一律是 📄 */
  var ICON = {
    pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
    txt: '📃', zip: '🗜', rar: '🗜', '7z': '🗜',
    mp3: '🎵', wav: '🎵', m4a: '🎵', flac: '🎵', ogg: '🎵',
    mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', bmp: '🖼',
    apk: '📦', exe: '⚙️'
  };
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
    /* 顶部「管理」：一键进入多选删除，不必靠长按才发现 */
    var mb = document.getElementById('chat-manage');
    if (mb) {
      mb.textContent = selMode === 'conv' ? '完成' : '管理';
      mb.onclick = function () { if (selMode === 'conv') exitSel(); else enterConvSel(); };
    }
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
      '<div class="back" id="th-manage">管理</div>' +
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
    /* 会话内「管理」：一键进入消息多选删除；长按单条消息也能删除 */
    var mg = document.getElementById('th-manage');
    if (mg) mg.onclick = function () {
      if (selMode === 'msg') exitSel();
      else { selMode = 'msg'; selMsgs.clear(); renderMsgs(); App.toast('勾选要删除的消息'); }
    };
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
    /* 用字符串比较，避免数字/字符串 uid 类型不一致时把自己发的消息错判成对方的
       （此前会出现「我和对方的消息挤在同一列」） */
    var me = String(App.me().uid || '');
    box.innerHTML = msgs.map(function (m) {
      var isMe = String(m.from) === me;
      var who = isMe ? App.me() : (contacts.filter(function (c) { return String(c.uid) === String(m.from); })[0] || {});
      var av = Avatar.svg(who.avatar, 32);
      var body = bubble(m);
      var pick = selMode === 'msg'
        ? '<div class="pick' + (selMsgs.has(String(m.id)) ? ' on' : '') + '" data-mpick="' + m.id + '"></div>'
        : '';
      // 对方的消息带昵称，一眼分得清是谁说的
      var nm = (!isMe && who.nick) ? '<div class="who">' + esc(who.nick) + '</div>' : '';
      return '<div class="msg ' + (isMe ? 'me' : '') + (selMsgs.has(String(m.id)) ? ' picked' : '') + '" data-id="' + m.id + '">' +
        pick +
        '<div class="a">' + av + '</div><div class="bcol">' + nm + '<div class="bub ' + (m.kind || 'text') + '">' + body +
        '<div class="time">' + fmt(m.ts) + '</div></div></div></div>';
    }).join('');
    box.querySelectorAll('[data-join]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var g = String(b.dataset.join || '').trim();
        if (!g) return;
        Net.send({ t: 'invite:join', gid: g });
        Sfx.click();
      };
    });
    box.querySelectorAll('.bub img,.bub video').forEach(function (el) {
      var nm = el.closest('.msg') ? (el.getAttribute('src') || '').split('/').pop() : '';
      el.onclick = function () { view(el.src, el.tagName === 'VIDEO', nm); };
      // 图片加载失败 → 显示可重试的占位，避免只剩一块空白
      if (el.tagName === 'IMG') {
        el.onerror = function () {
          if (el.dataset.bad) return;
          el.dataset.bad = '1';
          var d = document.createElement('div');
          d.className = 'imgbad';
          d.textContent = '图片加载失败 · 点此重试';
          d.onclick = function () { delete el.dataset.bad; el.style.display = ''; d.remove(); el.src = el.getAttribute('src') + (el.src.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now(); };
          el.style.display = 'none';
          if (el.parentNode) el.parentNode.insertBefore(d, el);
        };
      }
    });
    box.querySelectorAll('[data-play]').forEach(function (b) {
      b.onclick = function (e) { e.stopPropagation(); playVoice(b.dataset.play, b); };
    });
    /* 图片 / 视频 / 语音 / 文件统一「保存到手机」 */
    box.querySelectorAll('[data-save],[data-dl]').forEach(function (b) {
      var a = b.tagName === 'A' ? b : null;
      if (a) {
        a.onclick = function (e) {
          e.preventDefault(); e.stopPropagation();
          saveToDevice(a.getAttribute('href'), a.getAttribute('download') || 'file');
        };
        return;
      }
      b.onclick = function (e) {
        e.stopPropagation();
        saveToDevice(b.dataset.save || b.dataset.dl, b.dataset.name || 'file');
      };
    });
    /* 视频 / 图片长按也能保存 */
    box.querySelectorAll('.bub video,.bub img').forEach(function (el) {
      longPress(el, function () {
        saveToDevice(el.src, (el.src || '').split('/').pop() || 'file');
      });
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
    var mg = document.getElementById('th-manage');
    if (mg) mg.textContent = selMode === 'msg' ? '完成' : '管理';
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
    /* 邀请卡片：点「加入房间」直接进牌桌 */
    if (m.kind === 'invite') {
      var g = String(m.gid || '');
      return '<div class="invcard" data-gid="' + esc(g) + '">' +
        '<div class="ic">🎮</div>' +
        '<div class="ib"><div class="it">' + esc(m.nick || '好友') + ' 邀请你打牌</div>' +
        '<div class="id">房间号 <b>' + esc(g) + '</b> · ' + esc(ruleText(m.rule)) + '</div></div>' +
        '<button class="ij" data-join="' + esc(g) + '">加入房间</button></div>';
    }
    /* 图片：加载失败会给出「点此重试」的占位，不再是一片空白 */
    if (m.kind === 'image') {
      return '<img src="' + Net.abs(m.url) + '" alt="图片" loading="lazy" data-img="1">';
    }
    /* 视频：playsinline + 明确尺寸，避免 WebView 里全屏接管导致黑屏 */
    if (m.kind === 'video') {
      var vu = Net.abs(m.url);
      return '<video src="' + vu + '" controls playsinline webkit-playsinline preload="metadata" ' +
        'style="width:200px;max-width:100%;border-radius:10px;background:#000"></video>';
    }
    /* 语音：波形 + 时长 + 播放按钮（播放失败会明确提示） */
    if (m.kind === 'voice') {
      var w = '';
      var n = Math.min(18, Math.max(5, Math.round(m.dur || 1) * 2));
      for (var i = 0; i < n; i++) {
        var h = 6 + (Math.abs(Math.sin(i * 1.7 + (m.id || '').length)) * 14);
        w += '<i style="height:' + h.toFixed(0) + 'px"></i>';
      }
      var vu = Net.abs(m.url);
      var vn = String(m.name || ('voice_' + (m.id || '') + '.m4a'));
      return '<div class="wave">' + w + '</div><span class="du">' + (m.dur || 0) + '″</span>' +
        '<span data-play="' + vu + '" style="font-size:16px">▶</span>' +
        '<span class="msave" data-save="' + vu + '" data-name="' + esc(vn) + '" title="保存">⬇</span>';
    }
    /* 文件：显示真实类型图标与后缀，用 a 标签下载（WebView 里 window.open 常被拦） */
    if (m.kind === 'file') {
      var nm = String(m.name || '文件');
      var ext = (nm.split('.').pop() || '').toLowerCase();
      var ic = ICON[ext] || '📄';
      return '<div class="filebub">' +
        '<div class="fic">' + ic + '</div>' +
        '<div class="fmid"><div class="fname">' + esc(nm) + '</div>' +
        '<div style="font-size:10px;opacity:.7">' + (ext ? ext.toUpperCase() + ' · ' : '') + size(m.size) + '</div></div>' +
        '<a class="fdl" href="' + Net.abs(m.url) + '" target="_blank" rel="noopener" download="' + esc(nm) + '">⬇</a></div>';
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
    audioEl.preload = 'auto';
    btn.textContent = '⏸';
    var reset = function (msg) {
      btn.textContent = '▶';
      audioEl = null;
      if (msg) App.toast('语音播放失败：' + msg);
    };
    audioEl.onerror = function () { reset('音频无法加载（格式不支持或文件已失效）'); };
    audioEl.onended = function () { btn.textContent = '▶'; audioEl = null; };
    var pr = audioEl.play();
    if (pr && pr.catch) pr.catch(function (e) { reset((e && e.message) || '被浏览器拦截'); });
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

  /* ---------------- 媒体查看 / 保存 ----------------
   * 查看器带「保存到手机」：原生桥接优先（安卓 DownloadManager 落到下载目录），
   * 无原生时退回到浏览器下载。所有失败都有明确提示。 */
  function view(src, isVideo, name) {
    var v = document.createElement('div');
    v.className = 'viewer';
    v.innerHTML =
      '<div class="x">✕</div>' +
      (isVideo
        ? '<video src="' + src + '" controls autoplay playsinline webkit-playsinline style="max-width:96%;max-height:74%;background:#000"></video>'
        : '<img src="' + src + '" style="max-width:96%;max-height:74%">') +
      '<div class="vbar">' +
      '<button class="vb" data-a="save">⬇ 保存到手机</button>' +
      '<button class="vb ghost" data-a="close">关闭</button>' +
      '</div>' +
      '<div class="vmsg" id="vmsg"></div>';
    var close = function () { v.remove(); };
    v.querySelector('.x').onclick = close;
    v.querySelector('[data-a="close"]').onclick = close;
    v.querySelector('[data-a="save"]').onclick = function () { saveToDevice(src, name || (isVideo ? 'video.mp4' : 'image.jpg')); };
    document.getElementById('app').appendChild(v);
  }
  /* 保存到本机：安卓原生 → 浏览器下载 → 新窗口兜底 */
  function saveToDevice(url, name) {
    url = String(url || '');
    if (!url) return App.toast('文件地址为空');
    var u = url.indexOf('dl=1') >= 0 ? url : (url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dl=1');
    var fn = String(name || 'file').replace(/[\\/:*?"<>|]/g, '_');
    if (window.DDZNative && typeof window.DDZNative.saveFile === 'function') {
      var r = window.DDZNative.saveFile(u, fn);
      App.toast(String(r).indexOf('ok') === 0 ? '已保存到下载目录' : ('保存失败：' + r));
      return;
    }
    try {
      var a = document.createElement('a');
      a.href = u; a.download = fn; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click();
      setTimeout(function () { a.remove(); }, 1500);
      App.toast('已开始下载：' + fn);
    } catch (e) {
      try { window.open(u, '_blank'); App.toast('已在新窗口打开，长按可保存'); }
      catch (x) { App.toast('保存失败'); }
    }
  }

  function fmt(ts) {
    if (!ts) return '';
    var d = new Date(ts), n = new Date();
    if (d.toDateString() === n.toDateString()) return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function size(b) { if (!b) return ''; var u = ['B', 'KB', 'MB', 'GB'], i = 0; while (b > 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + u[i]; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  /* 长按：手指轻微抖动不打断（超过 10px 才算拖动取消），否则在手机上很难触发 */
  function longPress(el, fn) {
    var t = null, x0 = 0, y0 = 0;
    el.addEventListener('pointerdown', function (e) {
      x0 = e.clientX; y0 = e.clientY;
      clearTimeout(t); t = setTimeout(fn, 550);
    });
    el.addEventListener('pointermove', function (e) {
      if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) clearTimeout(t);
    });
    el.addEventListener('pointerup', function () { clearTimeout(t); });
    el.addEventListener('pointercancel', function () { clearTimeout(t); });
    el.addEventListener('pointerleave', function () { clearTimeout(t); });
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
    view: view, exitSel: exitSel, isSel: function () { return !!selMode; } };
})();
