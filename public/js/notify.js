/* ===================== 通知封装 =====================
 * 原生环境（打包成 APK）：走安卓原生通知 + 桌面角标。
 * 浏览器环境：退化为 Web Notification。
 *
 * 对外只暴露 notify(seed)：无论真实内容是什么，推送到通知栏的
 * 永远是随机斗地主营销广告，绝不泄露真实消息。
 *
 * 角标：App 在后台收到消息时累加，回到前台清零。
 * ================================================== */
window.Notifier = (function () {
  var enabled = true, cap = null, ready = false;
  var badge = 0;

  function loadCapacitor() {
    if (cap || typeof window.Capacitor === 'undefined') return;
    try {
      var LN = window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
      if (!LN) return;
      cap = LN;
      LN.requestPermissions().then(function () { ready = true; }).catch(function () { ready = false; });
    } catch (e) { cap = null; }
  }

  /* 原生桥接（DDZNative）：前台保活服务 + 原生通知 + 桌面角标 */
  function nat() {
    try {
      return (window.DDZNative && typeof window.DDZNative.notifyMsg === 'function') ? window.DDZNative : null;
    } catch (e) { return null; }
  }

  function setEnabled(v) { enabled = !!v; }
  function isEnabled() { return enabled; }

  /* 权限申请：原生走桥接，Web 走 Notification.requestPermission */
  function request() {
    loadCapacitor();
    var n = nat();
    if (n) {
      try { n.startPush(); } catch (e) { }
      return Promise.resolve(true);
    }
    if (cap) { try { cap.requestPermissions(); } catch (e) { } return Promise.resolve(true); }
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      return Notification.requestPermission().then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(true);
  }

  /* 设置桌面角标数字（原生生效；浏览器无此能力，忽略） */
  function setBadge(n) {
    badge = Math.max(0, n | 0);
    var x = nat();
    if (x) { try { x.setBadge(badge); } catch (e) { } return; }
    try {
      if (navigator.setAppBadge) { badge > 0 ? navigator.setAppBadge(badge) : navigator.clearAppBadge(); }
    } catch (e) { }
  }
  function clearBadge() { setBadge(0); }
  function badgeCount() { return badge; }

  /* 发送一条伪装通知；seed 用于稳定映射，同一条消息永远显示同一条广告 */
  function notify(seed) {
    if (!enabled) return;
    var ad = ADS.notifyFor(seed || Date.now());
    badge++;
    var x = nat();
    if (x) {
      try {
        x.notifyMsg(ad.title, ad.body, (Math.floor(Math.random() * 50000) + 20000), badge);
        try { x.setBadge(badge); } catch (e) { }
        return;
      } catch (e) { }
    }
    loadCapacitor();
    if (cap) {
      try {
        cap.schedule({
          notifications: [{
            title: ad.title, body: ad.body,
            id: (Math.floor(Math.random() * 100000) + 1000),
            schedule: { at: new Date(Date.now() + 100) },
            extra: { fake: true }
          }]
        });
        return;
      } catch (e) { }
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification(ad.title, { body: ad.body, tag: 'ddz' }); } catch (e) { }
    }
  }

  /* 页面可见时不做系统通知，只在应用内提示 */
  function notifyIfHidden(seed) {
    if (document.visibilityState === 'visible') return;
    notify(seed);
  }

  /* 回到前台：清角标 */
  function onForeground() {
    if (badge > 0) { badge = 0; setBadge(0); }
  }
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') onForeground();
    });
  } catch (e) { }

  /* 启动保活服务（App 一进来就调，保证退到后台也能收到） */
  function startPush() {
    var x = nat();
    if (x) { try { x.startPush(); } catch (e) { } return true; }
    return false;
  }

  return {
    request: request, notify: notify, notifyIfHidden: notifyIfHidden,
    setEnabled: setEnabled, isEnabled: isEnabled,
    setBadge: setBadge, clearBadge: clearBadge, badgeCount: badgeCount,
    startPush: startPush
  };
})();
