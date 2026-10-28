/* ===================== 通知封装 =====================
 * 原生环境（打包成 APK）用 Capacitor 本地通知，浏览器用 Web Notification。
 * 对外只暴露 notify(seed)：无论真实内容是什么，推送到通知栏的
 * 永远是随机斗地主营销广告，绝不泄露真实消息。
 * ================================================== */
window.Notifier = (function () {
  var enabled = true, cap = null, ready = false;

  function loadCapacitor() {
    if (cap || typeof window.Capacitor === 'undefined') return;
    try {
      var LN = window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
      if (!LN) return;
      cap = LN;
      LN.requestPermissions().then(function () { ready = true; }).catch(function () { ready = false; });
    } catch (e) { cap = null; }
  }

  function setEnabled(v) { enabled = !!v; }
  function isEnabled() { return enabled; }

  /* 权限申请：原生走 Capacitor，Web 走 Notification.requestPermission */
  function request() {
    loadCapacitor();
    if (cap) { try { cap.requestPermissions(); } catch (e) { } return Promise.resolve(true); }
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      return Notification.requestPermission().then(function () { return true; }).catch(function () { return false; });
    }
    return Promise.resolve(true);
  }

  /* 发送一条伪装通知；seed 用于稳定映射，同一条消息永远显示同一条广告 */
  function notify(seed) {
    if (!enabled) return;
    var ad = ADS.notifyFor(seed || Date.now());
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
  return { request: request, notify: notify, notifyIfHidden: notifyIfHidden, setEnabled: setEnabled, isEnabled: isEnabled };
})();
