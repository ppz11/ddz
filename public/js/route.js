/* ===================== 会话归属路由（v76 / v77 加固） =====================
 * 规则（用户确认 1A / 2A / 3A）：
 *   - 默认所有人都在「聊天」里会话。
 *   - 本机一旦把某人加进「好友空间」，本机与 TA 的收发整体搬到好友空间：
 *     聊天列表隐藏该会话、不再收新消息、不再计未读/弹通知。
 *   - 这只是【本机界面限制】：消息本身照常存服务端、照常推给对方；
 *     没加好友的对方仍在他自己的聊天界面正常收到，不会丢消息（3A）。
 *   - 加好友之前的旧聊天记录「只读合并」进好友空间，不迁移物理数据（2A）；
 *     解除好友后聊天界面自动恢复，历史一条不少。
 *   - 好友空间按真人 pid 合并：对方换身份（新 uid）仍是同一个会话。
 *
 * v77：服务端所有 contacts 推送统一补 pid（原来 auth / 在线广播漏了，
 *      会让已迁走的好友会话闪回聊天列表）；这里再加 30s 轻量核对，
 *      覆盖换身份后重连、弱网丢 route:list 的情况，且只在 pids 变化时重绘。
 * v78：路由变化时直接调 Chat.applyRoute()（重算列表 + 清未读残留），
 *      不再只 renderList() 画一份没过滤过的旧数组。
 */
window.ChatRoute = (function () {
  var set = {}, ready = false;
  function key(pids) { return (pids || []).map(String).sort().join('|'); }
  function refresh() { try { Net.send({ t: 'route:list' }); } catch (e) { } }
  Net.on('route:list', function (m) {
    var nk = key(m.pids), changed = !ready || nk !== key(Object.keys(set));
    set = {};
    (m.pids || []).forEach(function (p) { if (p) set[String(p)] = 1; });
    ready = true;
    if (!changed) return;   /* 不重绘，避免打断正在滚动 / 正在输入的聊天列表 */
    /* 让聊天列表立刻按新路由重画（contacts 回流会重算未读红点） */
    try { Net.send({ t: 'contacts' }); } catch (e) { }
    try { if (window.Chat && Chat.applyRoute) Chat.applyRoute(); else if (window.Chat && Chat.renderList) Chat.renderList(); } catch (e) { }
  });
  Net.on('friend:list', function (m) { if (m.via === 'secret') refresh(); });
  /* 登录/重连后主动拉一次；之后每 30s 只查询，pids 不变就不重绘 */
  setTimeout(refresh, 1200);
  setInterval(refresh, 30000);
  return {
    has: function (pid) { return !!(pid && set[String(pid)]); },
    refresh: refresh,
    ready: function () { return ready; },
    size: function () { return Object.keys(set).length; },
    __set: function () { return set; }
  };
})();
