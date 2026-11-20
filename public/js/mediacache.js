/* ============================================================
 * v67 私有媒体缓存（表情 / 会话图片 / 视频 / 文件 / 语音）
 * ------------------------------------------------------------
 * 【私有性 · 不变】缓存只在内存 Map + WebView 的 IndexedDB。
 *   IDB 落在 App 私有目录 /data/data/<包名>/app_webview/，
 *   不是公共存储，MediaStore / 文件管理 / 手机管家扫描不到；
 *   原生层在私有目录另有 .nomedia 双保险。
 *   本文件绝不写外部目录、绝不调用 DDZNative.saveFile、
 *   绝不触发 DownloadManager / MediaScanner、绝不加 ?dl=1。
 *   只有手动点「⬇ 保存到手机」才写公共「下载」目录并可被外部看到。
 *
 * 【v67 三点修正】
 *   1) 取消 v66 的 24MB 落库上限：>8MB 自动切成 4MB 分片写入 IDB，
 *      大视频同样永久落盘（分片也避开某些 WebView 单条大 Blob 写失败）。
 *   2) 申请 navigator.storage.persist() 持久化，系统存储紧张时不回收。
 *   3) 启动时收集已落库 key，预热只处理「没缓存过的」，
 *      命中连本地读都省；30 是预热条数，不是缓存上限。
 *   另：写入失败不再静默，记入 stats.failed 并在设置页可见。
 *
 * 【命中路径】内存 → IndexedDB(直存/分片) → 网络 → 回写 IDB
 *   兼容 v66 已有数据：DB_NAME / STORE 未变，老缓存接着用。
 * ============================================================ */
window.MediaCache = (function () {
  var MEM_MAX = 160;
  var DIRECT_MAX = 8 * 1024 * 1024;   /* 小于此值整块直存 */
  var CHUNK = 4 * 1024 * 1024;        /* 大于此值按 4MB 切片 */
  var CHUNK_PREFIX = '\u0001';        /* 分片 key 前缀，stats 时跳过 */
  var DB_NAME = 'ddz_media_v1', STORE = 'files';

  var mem = new Map();        /* url -> objectURL */
  var pending = new Map();    /* url -> Promise  */
  var queue = [], running = 0, MAX_RUN = 2;
  var dbP = null, keys = new Set(), keysReady = false;
  var persisted = false, lastErr = '';

  /* ---------- IndexedDB 基础 ---------- */
  function openDB() {
    if (dbP) return dbP;
    dbP = new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(null);
      try {
        var rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = function () {
          try { rq.result.createObjectStore(STORE); } catch (e) { }
        };
        rq.onsuccess = function () {
          askPersist();
          collectKeys().then(function () { keysReady = true; });
          resolve(rq.result);
        };
        rq.onerror = function () { resolve(null); };
        rq.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbP;
  }
  /* 申请持久化存储：拿到后 WebView 不会因存储压力自动清掉缓存 */
  function askPersist() {
    try {
      var st = navigator.storage;
      if (!st || !st.persist) return;
      if (st.persisted) st.persisted().then(function (p) { if (p) persisted = true; })['catch'](function () { });
      st.persist().then(function (ok) { persisted = !!ok; })['catch'](function () { });
    } catch (e) { }
  }
  function collectKeys() {
    return openDB().then(function (d) {
      if (!d) return;
      return new Promise(function (res) {
        try {
          var rq = d.transaction(STORE, 'readonly').objectStore(STORE).openKeyCursor();
          rq.onsuccess = function (e) {
            var c = e.target.result;
            if (!c) return res();
            var k = String(c.key);
            if (k.charAt(0) !== CHUNK_PREFIX) keys.add(k);
            c.continue();
          };
          rq.onerror = function () { res(); };
        } catch (e) { res(); }
      });
    });
  }

  /* ---------- 读：兼容 v66 整块 / v67 分片 ---------- */
  function getBlob(url) {
    return openDB().then(function (d) {
      if (!d) return null;
      return new Promise(function (resolve) {
        try {
          var st = d.transaction(STORE, 'readonly').objectStore(STORE);
          var r = st.get(url);
          r.onsuccess = function () {
            var v = r.result;
            if (v instanceof Blob) { resolve(v); return; }
            if (v && v.__ddzMeta) {
              var n = v.n | 0, parts = new Array(n), left = n;
              if (!n) return resolve(null);
              for (var i = 0; i < n; i++) {
                (function (i) {
                  var cr = st.get(CHUNK_PREFIX + url + '#' + i);
                  var fin = function () {
                    parts[i] = (cr.result instanceof Blob) ? cr.result : new Blob();
                    if (--left === 0) resolve(new Blob(parts, { type: v.type || '' }));
                  };
                  cr.onsuccess = fin; cr.onerror = fin;
                })(i);
              }
              return;
            }
            resolve(null);
          };
          r.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }
  /* ---------- 写：全部落盘，不再有 24MB 上限 ---------- */
  function putBlob(url, blob) {
    return openDB().then(function (d) {
      if (!d) throw new Error('IndexedDB 不可用');
      return new Promise(function (resolve, reject) {
        try {
          var tx = d.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
          if (blob.size <= DIRECT_MAX) {
            st.put(blob, url);
          } else {
            var n = Math.ceil(blob.size / CHUNK);
            st.put({ __ddzMeta: true, n: n, size: blob.size, type: blob.type || '' }, url);
            for (var i = 0; i < n; i++) {
              st.put(blob.slice(i * CHUNK, (i + 1) * CHUNK), CHUNK_PREFIX + url + '#' + i);
            }
          }
          tx.oncomplete = function () { keys.add(url); resolve(true); };
          tx.onerror = function () { reject(tx.error || new Error('配额不足/写入失败')); };
          tx.onabort = function () { reject(tx.error || new Error('配额不足/写入中止')); };
        } catch (e) { reject(e); }
      });
    });
  }
  function clearDB() {
    return openDB().then(function (d) {
      if (!d) return false;
      return new Promise(function (res) {
        try {
          var tx = d.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = function () { keys.clear(); res(true); };
          tx.onerror = function () { res(false); };
        } catch (e) { res(false); }
      });
    });
  }

  /* ---------- 内存 objectURL ---------- */
  function keep(url, o) {
    mem.delete(url); mem.set(url, o);
    while (mem.size > MEM_MAX) {
      var k = mem.keys().next().value, v = mem.get(k);
      try { if (v) URL.revokeObjectURL(v); } catch (e) { }
      mem.delete(k);
    }
  }
  function toObj(blob, url) {
    var o = URL.createObjectURL(blob); keep(url, o); return o;
  }
  function get(url) {
    if (!url) return null;
    return mem.get(String(url)) || null;
  }
  /* 只查本地，绝不回源（给视频用，命中 0 等待） */
  function cached(url) {
    url = String(url || '');
    return new Promise(function (resolve) {
      if (!url) return resolve(null);
      if (/^(data|blob):/.test(url)) return resolve(url);
      if (mem.has(url)) return resolve(mem.get(url));
      getBlob(url).then(function (b) {
        try { resolve(b && b.size ? toObj(b, url) : null); } catch (e) { resolve(null); }
      })['catch'](function () { resolve(null); });
    });
  }
  /* 取到并缓存：内存 → IDB → 网络 → 落盘。返回 Promise<objectURL> */
  function fetchURL(url) {
    url = String(url || '');
    if (!url) return Promise.reject(new Error('empty url'));
    if (/^(data|blob):/.test(url)) return Promise.resolve(url);
    if (mem.has(url)) return Promise.resolve(mem.get(url));
    if (pending.has(url)) return pending.get(url);
    var pr = getBlob(url).then(function (b) {
      if (b && b.size) return toObj(b, url);
      return fetch(url, { credentials: 'same-origin' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' · ' + url);
          return r.blob();
        })
        .then(function (blob) {
          if (!blob || !blob.size) throw new Error('空文件 · ' + url);
          /* v67：等落盘完成再返回，保证「点过一次就永久留着」；
             配额真的爆了也不阻断本次播放，只是如实记录失败原因。 */
          return putBlob(url, blob)
            .then(function () { return toObj(blob, url); })
            ['catch'](function (e) {
              lastErr = String(e && e.message ? e.message : e);
              return toObj(blob, url);
            });
        });
    });
    pending.set(url, pr);
    var done = function () { pending.delete(url); };
    pr.then(done, done);
    return pr;
  }
  function resolve(url) { return fetchURL(url); }

  /* ---------- 增量预热 ---------- */
  function pump() {
    if (running >= MAX_RUN || !queue.length) return;
    var url = queue.shift();
    if (!url || mem.has(url) || pending.has(url) || (keysReady && keys.has(url))) { pump(); return; }
    running++;
    fetchURL(url).then(function () { running--; pump(); },
                       function () { running--; pump(); });
  }
  function prefetch(url) {
    url = String(url || '');
    if (!url || mem.has(url) || pending.has(url) || queue.indexOf(url) >= 0) return;
    if (keysReady && keys.has(url)) return;   /* 已落库：连本地读都省 */
    if (/^(data|blob):/.test(url)) return;
    if (!/^\/api\/file\//.test(url) && !/^https?:\/\//.test(url)) return;
    queue.push(url); pump();
  }
  /* v68：原生模式下会被换绑成原生预热，避免下面每 4 秒的表情扫描
     又去走一遍 IndexedDB 下载（那会重复消耗流量）。 */
  var warmRef = warm;
  function warm(urls) { (urls || []).forEach(prefetch); }
  /* 30 只是「每次进会话预热的条数」，不是缓存容量上限：
     更早的媒体点开时同样会缓存并永久保留，没有条数 / 时间淘汰。 */
  function warmChat(list) {
    /* v72：收到的视频/文件也要缓存，不再只取 30 条 / 跳过大文件 */
    var arr = (list || []).slice(-300).reverse(), out = [];
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i]; if (!m || !m.url) continue;
      var u = String(m.url);
      if (/^\/api\/file\//.test(u) || /^https?:\/\//.test(u)) out.push(u);
    }
    warm(out);
  }

  /* ---------- 统计 / 清除 ---------- */
  function stats() {
    var out = { mem: mem.size, idb: 0, bytes: 0, queued: queue.length,
                persisted: persisted, failed: lastErr || '', quota: 0, usage: 0 };
    try {
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (e) {
          out.quota = e.quota || 0; out.usage = e.usage || 0;
        })['catch'](function () { });
      }
    } catch (e) { }
    return openDB().then(function (d) {
      if (!d) return out;
      return new Promise(function (res) {
        try {
          var rq = d.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
          rq.onsuccess = function (e) {
            var c = e.target.result;
            if (!c) return res(out);
            var k = String(c.key);
            if (k.charAt(0) !== CHUNK_PREFIX) {
              out.idb++;
              var v = c.value;
              try { out.bytes += (v instanceof Blob) ? v.size : (v && v.size ? v.size : 0); } catch (x) { }
            }
            c.continue();
          };
          rq.onerror = function () { res(out); };
        } catch (e) { res(out); }
      });
    });
  }
  function clear() {
    mem.forEach(function (v) { try { URL.revokeObjectURL(v); } catch (e) { } });
    mem.clear(); pending.clear(); queue.length = 0; lastErr = '';
    return clearDB();
  }

  /* v72 表情预热：不再「每 4 秒扫一次、只取前 80 张」。
     登录后 / 同步完成 / 本地包就绪三个时机都立刻全量预热，之后 15 秒轻扫一次补漏。
     已缓存的由 prefetch 自己跳过，不会重复消耗流量。 */
  function collectStickers() {
    var S = window.Stickers; if (!S) return [];
    var ps = (S.globalPacks && S.globalPacks.length) ? S.globalPacks : (S.packs || []);
    var out = [];
    for (var i = 0; i < ps.length; i++) {
      var items = (ps[i] && ps[i].items) || [];
      for (var j = 0; j < items.length; j++) {
        var u = items[j] && items[j].url;
        if (u && /^\/api\/file\//.test(String(u))) out.push(String(u));
      }
    }
    return out;
  }
  function warmStickers() { try { warmRef(collectStickers()); } catch (e) { } }
  try {
    setTimeout(warmStickers, 120);
    document.addEventListener('ddz:stickers', warmStickers);
    setInterval(warmStickers, 15000);
  } catch (e) { }

  /* v72 缓存进度订阅：返回取消函数。cb(pct, done)。
     新 APK 的原生桥给真实百分比；旧 APK 退化为「缓存中… → 已缓存」。 */
  function makeWatch(cachedFn, progressFn) {
    var watchers = {};
    function emit(u, pct, done) {
      var ws = watchers[u]; if (!ws) return;
      for (var i = 0; i < ws.length; i++) { try { ws[i](pct, done); } catch (e) { } }
      if (done) delete watchers[u];
    }
    return function (url, cb) {
      url = String(url || ''); if (!url) return function () { };
      (watchers[url] = watchers[url] || []).push(cb);
      var tries = 0;
      (function tick() {
        try {
          cachedFn(url).then(function (hit) {
            if (hit) { emit(url, 100, true); return; }
            var pct = 0;
            try { pct = progressFn(url) || 0; } catch (e) { }
            emit(url, pct, false);
            if (++tries < 1500) setTimeout(tick, 400);
            else emit(url, 0, true);
          }).catch(function () { emit(url, 0, true); });
        } catch (e) { emit(url, 0, true); }
      })();
      return function () { delete watchers[url]; };
    };
  }
  var watchIDB = makeWatch(cached, function () { return 0; });

  /* 无原生（PC 浏览器 / 尚未重编译的旧 APK）：沿用 v67 的内存 + IndexedDB 缓存。
     这条路径受 WebView 存储配额约束，大文件建议 ≤200MB。 */
  var idbApi = {
    get: get, cached: cached, resolve: resolve, fetchURL: fetchURL,
    prefetch: prefetch,    warm: warm, warmChat: warmChat, warmStickers: warmStickers,
    watch: watchIDB, stats: stats, clear: clear,
    size: function () { return mem.size; },
    queued: function () { return queue.length; }
  };

  /* ============================================================
   * v68 原生私有目录缓存（100% 兜底）
   * ------------------------------------------------------------
   * 文件落在 /data/data/<包名>/no_backup/ddz_media/：
   *   · 第三方「文件管理 / 手机管家 / 相册」无权读取，且有 .nomedia 双保险
   *   · 不写公共目录、不调 DDZNative.saveFile、不加 ?dl=1
   *   · 不受 WebView IndexedDB 配额约束，1GB 视频也只是磁盘文件
   *   · 只要不点「清除缓存」就一直保留（没有 TTL、没有条数淘汰）
   * 播放走原生在 127.0.0.1 起的本地 HTTP 服务，支持 Range（可快进），
   * 完全不经过 JS 内存，所以 1GB 也不会 OOM。
   * ============================================================ */
  var N = null;
  try {
    N = (window.DDZNative && typeof window.DDZNative.cacheBase === 'function'
         && typeof window.DDZNative.cacheFetch === 'function') ? window.DDZNative : null;
  } catch (e) { N = null; }
  if (!N) return idbApi;

  var inflight = {};
  function nId(url) {
    var s = String(url || ''), h = 5381;
    for (var i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
    return 'f' + (h >>> 0).toString(16) + '_' + s.length.toString(36);
  }
  function nAbs(url) {
    try { return (window.Net && Net.abs) ? Net.abs(url) : String(url); }
    catch (e) { return String(url); }
  }
  function nLocal(url) {
    if (!url) return null;
    if (/^(data|blob):/.test(String(url))) return String(url);
    var id = nId(url);
    try { return String(N.cacheHas(id)) === '1' ? N.cacheUrl(id) : null; }
    catch (e) { return null; }
  }
  /* 后台下载一次；已存在 / 正在下载 / 地址非法都直接跳过，绝不重复要流量 */
  function nStart(url) {
    url = String(url || '');
    if (!url || /^(data|blob):/.test(url)) return;
    if (!/^\/api\/file\//.test(url) && !/^https?:\/\//.test(url)) return;
    var id = nId(url);
    try { if (String(N.cacheHas(id)) === '1') return; } catch (e) { }
    if (inflight[id]) return;
    inflight[id] = 1;
    try { N.cacheFetch(nAbs(url), id); } catch (e) { delete inflight[id]; }
    /* 原生下载是异步的：轮询到文件出现即释放 inflight；
       下载失败（404 / 断网）最多等 10 分钟就不占位，下次还能重试。 */
    var t0 = Date.now();
    var poll = setInterval(function () {
      var ok = false;
      try { ok = String(N.cacheHas(id)) === '1'; } catch (e) { }
      if (ok || Date.now() - t0 > 600000) { clearInterval(poll); delete inflight[id]; }
    }, 800);
  }
  function nStats() {
    try {
      var j = JSON.parse(String(N.cacheStats() || '{}'));
      return { mem: 0, idb: 0, bytes: j.bytes || 0, count: j.count || 0,
               queued: Object.keys(inflight).length, persisted: true,
               native: true, failed: '', quota: 0, usage: 0 };
    } catch (e) {
      return { mem: 0, idb: 0, bytes: 0, count: 0, queued: 0,
               persisted: true, native: true, failed: '', quota: 0, usage: 0 };
    }
  }
  /* 换绑表情预热：原生模式只拉服务器表情（都很小），不重复走 IDB */
  warmRef = function (list) { (list || []).forEach(nStart); };
  /* v72：新收到的视频/文件立刻入队缓存，最多 2 个并发，不会一进会话拉满带宽 */
  var nQueue = [];
  setInterval(function () {
    if (!nQueue.length) return;
    if (Object.keys(inflight).length >= 2) return;
    nStart(nQueue.shift());
  }, 350);
  function nProgress(url) {
    try {
      if (!N || typeof N.cacheProgress !== 'function') return 0;
      var s = String(N.cacheProgress(nId(url)) || '');
      var m = s.match(/^(\d+)\/(\d+)$/);
      if (m && Number(m[2]) > 0) return Math.min(99, Math.floor(Number(m[1]) * 100 / Number(m[2])));
    } catch (e) { }
    return 0;
  }
  var watchNative = makeWatch(function (u) { return Promise.resolve(nLocal(u)); }, nProgress);

  return {
    get: function (url) { return nLocal(url); },
    cached: function (url) { return Promise.resolve(nLocal(url)); },
    /* 未命中时立刻返回服务器直链边下边播，同时后台补缓存；
       下一次点开就是本地地址，0 等待。 */
    resolve: function (url) {
      var hit = nLocal(url);
      if (hit) return Promise.resolve(hit);
      nStart(url);
      return Promise.resolve(nAbs(url));
    },
    fetchURL: function (url) { return this.resolve(url); },
    prefetch: nStart,
    warm: function (list) { (list || []).forEach(nStart); },
    /* v72：视频 / 大文件收到就入队开始缓存，不再等用户点开。
       2 并发的队列保证不会一次拉爆带宽，进度由 cacheProgress 真实上报。 */
    warmChat: function (list) {
      var arr = (list || []).slice().reverse();
      for (var i = 0; i < arr.length; i++) {
        var m = arr[i]; if (!m || !m.url) continue;
        var u = String(m.url);
        if (!/^\/api\/file\//.test(u) && !/^https?:\/\//.test(u)) continue;
        try { if (String(N.cacheHas(nId(u))) === '1') continue; } catch (e) { }
        nQueue.push(u);
      }
    },
    warmStickers: warmStickers,
    watch: watchNative,
    stats: function () { return Promise.resolve(nStats()); },
    clear: function () {
      try { N.cacheClear(); } catch (e) { }
      inflight = {};
      return Promise.resolve(true);
    },
    size: function () { return nStats().count; },
    queued: function () { return Object.keys(inflight).length; },
    native: true,
    idbFallback: idbApi
  };
})();
