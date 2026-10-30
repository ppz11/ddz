/* ===================== 私信聊天（文字/语音/图片/视频/文件/表情） ===================== */
window.Chat = (function () {
  var contacts = [], cur = null, msgs = [], unread = {}, panel = null;
  var rec = null, chunks = [], stream = null, recStart = 0, recTimer = null, canceling = false;
  /* 多选删除：'conv' = 选会话，'msg' = 选消息 */
  var selMode = null, selConvs = new Set(), selMsgs = new Set();

  function init() {
    Net.on('contacts', function (m) { contacts = m.list || []; renderList(); paintThreadState(); });
    /* 好友名单：主界面专用，与隐私空间完全隔离 */
    Net.on('friend:list', function (m) {
      if (m.via === 'secret') return;
      paintFriends(m.list || [], 'list');
    });
    Net.on('friend:search', function (m) { paintFriends(m.list || [], 'search'); });
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
      /* 内置测试助手：标出来，方便装机前试功能（发什么它回什么） */
      if (c.test) state = '<span class="st on" style="background:#2b6cb0">🧪 测试</span>';
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
    var fb = document.getElementById('chat-friends');
    if (fb) fb.onclick = openFriends;
  }

  /* ---------------- 好友名单 ----------------
   * 删掉整个会话后好友依然在，随时能从这里重新发起聊天。 */
  function openFriends() {
    Net.send({ t: 'friend:list', via: 'main' });
    var box = document.createElement('div');
    box.className = 'modal'; box.id = 'friend-box';
    box.innerHTML = '<div class="box" style="max-width:340px">' +
      '<h3>好友</h3>' +
      '<p style="margin-bottom:8px">删掉会话后好友仍在这里<br>' +
      '<span style="font-size:11px;opacity:.75">输入对方 UID 或昵称即可添加</span></p>' +
      '<div class="row" style="margin-bottom:10px">' +
      '<input id="fr-q" placeholder="输入 UID 或昵称" style="flex:1;margin:0">' +
      '<button class="btn jade" id="fr-add">添加</button></div>' +
      '<div class="fr-list" id="fr-list"><div class="fr-empty">加载中…</div></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn ghost" id="fr-close">关闭</button></div></div>';
    document.body.appendChild(box);
    box.querySelector('#fr-close').onclick = function () { box.remove(); };
    box.querySelector('#fr-add').onclick = function () {
      var q = (box.querySelector('#fr-q').value || '').trim();
      if (!q) { App.toast('请输入 UID 或昵称'); return; }
      Net.send({ t: 'friend:add', via: 'main', q: q });
      box.querySelector('#fr-q').value = '';
    };
    box.onclick = function (e) { if (e.target === box) box.remove(); };
  }

  /* 好友列表渲染（搜索结果复用同一套卡片） */
  function paintFriends(list, mode) {
    var box = document.getElementById('friend-box'); if (!box) return;
    var el = box.querySelector('#fr-list'); if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = '<div class="fr-empty">' + (mode === 'search' ? '没找到这个玩家' : '还没有好友') + '</div>';
      return;
    }
    el.innerHTML = list.map(function (f) {
      return '<div class="fr-item' + (f.online ? '' : ' off') + '" data-pid="' + f.pid + '"' +
        (mode === 'search' ? ' data-add="1"' : '') + '>' +
        '<div class="a">' + Avatar.svg(f.avatar, 36) + '</div>' +
        '<div class="m"><div class="n">' + esc(f.nick || '玩家') + '</div>' +
        '<div class="u">' + esc(f.uid || f.pid) + '</div></div>' +
        '<span class="st">' + (f.online ? '在线' : '离线') + '</span>' +
        (mode === 'search'
          ? '<button class="del" data-act="add">添加</button>'
          : '<button class="del" data-act="del">删除</button>') +
        '</div>';
    }).join('');
    el.querySelectorAll('.fr-item').forEach(function (it) {
      var pid = it.dataset.pid;
      var b = it.querySelector('[data-act]');
      if (b) b.onclick = function (e) {
        e.stopPropagation();
        if (b.dataset.act === 'add') {
          Net.send({ t: 'friend:add', via: 'main', pid: pid });
        } else {
          App.confirm('删除好友？', '会话不会被删除，只是从好友列表移除', function () {
            Net.send({ t: 'friend:del', via: 'main', pid: pid });
          });
        }
      };
      it.onclick = function () {
        if (it.dataset.add) return;
        box.remove();
        if (f_uid_of(list, pid)) open(f_uid_of(list, pid));
        else App.toast('对方暂无可聊天的账号');
      };
    });
  }
  function f_uid_of(list, pid) {
    for (var i = 0; i < list.length; i++) if (list[i].pid === pid) return list[i].uid;
    return '';
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
          /* 探一下真实原因再写进提示：
             404 = 服务器上文件没了；0/网络错误 = 被拦或连不上（多半是混合内容没放行）。
             以前只有一个笼统的「加载失败」，根本没法判断是哪种。 */
          try {
            fetch(el.getAttribute('src'), { method: 'GET' }).then(function (r) {
              d.textContent = '图片加载失败（HTTP ' + r.status + '）· 点此重试';
            })['catch'](function () {
              d.textContent = '图片加载失败（网络被拦截）· 点此重试';
            });
          } catch (e) { }
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
      /* 与隐私空间同样的问题：m.sticker 缺失时直接取 .pack 会抛错，
         导致整条消息渲染不出来。这里做健壮降级。 */
      var st = m.sticker || {};
      var sid = (st.id == null ? '' : String(st.id));
      try {
        if (st.pack === 'emoji') return '<div style="font-size:44px;line-height:1.2">' + (Stickers.EMOJI[sid] || '🙂') + '</div>';
        var svg = (typeof Stickers.html === 'function') ? Stickers.html(st.pack, sid) : '';
        return svg || ('<div style="font-size:42px">' + (Stickers.EMOJI[sid] || '🙂') + '</div>');
      } catch (e) { return '<div style="font-size:42px">🙂</div>'; }
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
      return '<img src="' + Net.abs(m.url) + '" alt="图片" data-img="1">';
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
    if (file.size > 300 * 1024 * 1024) return App.toast('文件太大，上限 300MB');
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
  /* 短语音播放：先尝试直接播；失败则把文件整段取回做成 Blob 再播。
     短录音常因缺少时长头信息 / 服务端 Content-Type 不对而直接播失败，
     走 Blob + 显式 MIME 可以绕过这类问题。 */
  function playVoice(url, btn) {
    if (audioEl) { audioEl.pause(); audioEl = null; }
    btn.textContent = '⏸';
    var reset = function (msg) {
      btn.textContent = '▶';
      audioEl = null;
      if (msg) App.toast('语音播放失败：' + msg);
    };
    function attach(a) {
      audioEl = a;
      a.onerror = function () { reset('音频无法加载（格式不支持或文件已失效）'); };
      a.onended = function () { btn.textContent = '▶'; audioEl = null; };
      var pr = a.play();
      if (pr && pr.catch) pr.catch(function (e) { blobFallback(); });
    }
    function blobFallback() {
      try {
        fetch(url).then(function (r) {
          // 用服务端返回的真实 Content-Type，别再靠后缀猜
          // （url 是 /api/file/xxx，根本没有后缀，之前全被猜成 webm）
          var ct = (r.headers && r.headers.get ? r.headers.get('Content-Type') : '') || '';
          return r.arrayBuffer().then(function (buf) { return { buf: buf, ct: ct }; });
        }).then(function (o) {
          var type = (o.ct || '').split(';')[0].trim();
          if (!type || type === 'application/octet-stream') type = 'audio/mp4';
          var b = new Blob([o.buf], { type: type });
          var a = new Audio(URL.createObjectURL(b));
          a.onended = function () { btn.textContent = '▶'; URL.revokeObjectURL(a.src); audioEl = null; };
          a.onerror = function () { reset('格式不支持'); };
          audioEl = a;
          var p = a.play();
          if (p && p.catch) p.catch(function (e) { reset((e && e.message) || '无法播放'); });
        }).catch(function () { reset('下载失败'); });
      } catch (e) { reset('无法播放'); }
    }
    var a0 = new Audio(url);
    a0.preload = 'auto';
    a0.onerror = function () { blobFallback(); };
    attach(a0);
  }

  /* ---------------- 表情面板 ---------------- */
  function togglePanel() {
    if (panel) return closePanel();
    panel = document.createElement('div');
    panel.className = 'emoji-panel'; panel.id = 'emoji-panel';
    /* 只保留 Emoji，去掉「表情 / 物件」两个自绘 SVG 包和顶部切换栏 */
    var big = !!(window.Stickers && Stickers.isBig && Stickers.isBig());
    panel.innerHTML = '<div class="ep-bar"><button class="ep-add" id="ep-add">＋ 表情包</button>' +
      '<button class="ep-add' + (big ? ' on' : '') + '" id="ep-big">大图</button></div>' +
      '<div class="grid' + (big ? ' big' : '') + '" id="emo-grid"></div>';
    document.getElementById('thread').appendChild(panel);
    fill('emoji');
    var add = document.getElementById('ep-add');
    if (add) add.onclick = openImport;
    /* 大图模式：面板格子放大到 3 列，表情看得更清楚 */
    var bg = document.getElementById('ep-big');
    if (bg) bg.onclick = function () {
      if (!window.Stickers) return;
      Stickers.setBig(!Stickers.isBig());
      closePanel(); togglePanel();
    };
  }
  function fill(p) {
    var g = document.getElementById('emo-grid'); if (!g) return;
    /* 只保留 Emoji：自绘 SVG 贴纸在对方手机上经常渲染不出来（一片空白），
       Emoji 走系统字体，任何机型都能正常显示。 */
    g.innerHTML = Stickers.EMOJI.map(function (e, i) { return '<button data-k="emoji" data-i="' + i + '">' + e + '</button>'; }).join('');
    g.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { sendSticker('emoji', b.dataset.i); };
    });
  }
  function closePanel() { if (panel) { panel.remove(); panel = null; } }

  /* 导入表情包：把选中的表情上传后作为图片发出去，对方能正常看到 */
  function openImport() {
    if (!window.Stickers || !Stickers.openImport) return;
    Stickers.openImport(function (file) {
      closePanel();
      if (!file) return;
      App.toast('发送中…');
      Net.upload(file, 'image', 0).then(function (up) {
        if (up && up.err) return App.toast(up.err);
        send({ kind: 'image', url: up.url, name: file.name, size: file.size });
      }).catch(function () { App.toast('发送失败'); });
    });
  }

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
  /* 长按：安卓 WebView 默认会弹系统「复制/选择」菜单打断 JS 长按，
     所以必须阻止 contextmenu；同时去掉过于敏感的 pointerleave
     （手指轻微移动就会取消，导致手机上几乎触发不了）。 */
  function longPress(el, fn) {
    var t = null, x0 = 0, y0 = 0;
    function clear() { if (t) { clearTimeout(t); t = null; } }
    el.addEventListener('pointerdown', function (e) {
      x0 = e.clientX; y0 = e.clientY;
      clear(); t = setTimeout(fn, 500);
    });
    el.addEventListener('pointermove', function (e) {
      // 阈值 20px 太严：手指轻微抖动就取消，手机上几乎触发不了 → 放宽到 14px
      if (Math.abs(e.clientX - x0) > 14 || Math.abs(e.clientY - y0) > 14) clear();
    });
    ['pointerup', 'pointercancel'].forEach(function (n) { el.addEventListener(n, clear); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
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
    view: view, saveToDevice: saveToDevice, exitSel: exitSel, isSel: function () { return !!selMode; } };
})();
