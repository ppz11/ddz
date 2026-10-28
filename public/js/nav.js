/* ===================== 全局手势返回（左滑 / 右滑） =====================
 * 任何页面、任何浮层，只要注册了 Nav.push(返回函数)，
 * 在屏幕上左滑或右滑都能直接返回上一层。
 * ===================================================================== */
window.Nav = (function () {
  var stack = [];

  /* 注册一个返回动作；返回 unbind 用 */
  function push(fn, tag) {
    if (typeof fn !== 'function') return function () { };
    var item = { fn: fn, tag: tag || '' };
    stack = stack.filter(function (x) { return x.tag !== item.tag || !item.tag; });
    stack.push(item);
    return function () { stack = stack.filter(function (x) { return x !== item; }); };
  }
  function drop(tag) { stack = stack.filter(function (x) { return x.tag !== tag; }); }
  function clear() { stack = []; }

  /* 返回上一层；有可返回的层则返回 true */
  function back() {
    if (!stack.length) return false;
    var it = stack.pop();
    try { it.fn(); } catch (e) { }
    return true;
  }
  function depth() { return stack.length; }

  /* ---------- 手势识别 ---------- */
  var MIN = 62;            // 触发返回的最小横向位移
  var sx = 0, sy = 0, st = 0, tracking = false, fired = false;

  function noSwipe(t) {
    if (!t || !t.closest) return false;
    return !!t.closest('[data-noswipe], .hand, .handwrap, .emoji-panel, .tchat, .sw');
  }
  function onStart(e) {
    var t = e.touches ? e.touches[0] : e;
    if (e.touches && e.touches.length > 1) { tracking = false; return; }
    if (noSwipe(e.target)) { tracking = false; return; }
    tracking = true; fired = false;
    sx = t.clientX; sy = t.clientY; st = Date.now();
  }
  function onMove(e) {
    if (!tracking || fired) return;
    var t = e.touches ? e.touches[0] : e;
    var dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < MIN) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.62) { tracking = false; return; }   // 纵向滚动，不算
    if (Date.now() - st > 900) { tracking = false; return; }
    fired = true; tracking = false;
    if (back()) {
      try { if (navigator.vibrate && window.App && App.vibe()) navigator.vibrate(8); } catch (x) { }
      if (e.cancelable) e.preventDefault();
    }
  }
  function onEnd() { tracking = false; }

  function install() {
    var o = { passive: false };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, o);
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    // 桌面端：鼠标拖拽也支持，方便调试
    var md = false;
    document.addEventListener('mousedown', function (e) { if (e.button === 0) { md = true; onStart(e); } });
    document.addEventListener('mousemove', function (e) { if (md) onMove(e); });
    document.addEventListener('mouseup', function () { md = false; onEnd(); });
  }

  return { push: push, drop: drop, clear: clear, back: back, depth: depth, install: install };
})();
