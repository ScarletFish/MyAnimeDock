// frontend/src/lib/thumb-manager.js — 缩略图「就绪才加载」管理器（无框架依赖，任意组件可复用）。
//
// 后端契约（并行 lane 改造后）：
//   GET /api/thumbnail?path=…&time=mid|数值
//     命中缓存 → 200 返回图片字节；未命中 → 202 {status:'pending'} 并在后台受闸生成（不挂等）
//   GET /api/thumbnail/status?path=…&time=mid|数值 → 200 {status:'ready'|'generating'|'missing'}
//
// 职责：
//   1. warm —— 每次 watchThumb 首次遇到该 (path,time) 时 fetch 一次 warmUrl（触发服务端调度）。
//      200 → 直接 onReady；202 → 注册 watcher 由轮询器接管；异常 → 记失败，下次 watch 可重试。
//   2. 惰性轮询 —— 有 watcher 才起 setInterval；每 tick 对 202 中且未终态的 (path,time)
//      查 status（≤8 个串行分批），ready → onReady，missing → onMissing，generating → 继续等。
//   3. known-ready 会话内缓存（无 TTL）—— 就绪过的 (path,time) 再 watch 直接异步 onReady，不发请求。
//
// 纯 JS、无 DOM 依赖：fetch 走全局（测试直接替换 globalThis.fetch）。

export const THUMB_POLL_INTERVAL = 2000; // 轮询间隔（ms）
const WARM_BATCH = 8; // 每 tick 串行分批上限（避免一次性几十个 status 并发）

/** (path,time) 复合 key：path 不可能含 \0 */
function keyOf(path, time) {
  return path + '\u0000' + String(time);
}

/** encodeURIComponent 后再补编码单引号（沿用 encPath 规则；URL 会被放进 url('…')） */
function encPath(p) {
  return encodeURIComponent(p).replace(/'/g, '%27');
}

function warmUrl(path, time) {
  return '/api/thumbnail?path=' + encPath(path) + '&time=' + String(time);
}

function statusUrl(path, time) {
  return '/api/thumbnail/status?path=' + encPath(path) + '&time=' + String(time);
}

// ─── 会话内状态 ───
const knownReady = new Set(); // key → 该 (path,time) 缩略图已就绪（无 TTL）
const entries = new Map(); // key → { key, path, time, warming, has202, settled, watchers }
let timer = null; // 轮询 setInterval（惰性启停）

// ─── Warm-miss 监听（详情页调试用：EpisodeHeatmap 汇总 202，单个 null-check，零业务影响）───
let _warmMissListener = null;
export function onWarmMiss(fn) {
  _warmMissListener = fn;
  return () => { _warmMissListener = null; };
}

function entryOf(path, time) {
  const key = keyOf(path, time);
  let entry = entries.get(key);
  if (!entry || entry.settled) {
    entry = {
      key,
      path,
      time,
      warming: false, // warm fetch 进行中/已发起（同一 (path,time) 至多一次）
      has202: false, // warm 返回 202 → 进入轮询
      settled: false, // ready/missing 终态
      watchers: new Map(), // token → { onReady, onMissing, disposed }
    };
    entries.set(key, entry);
  }
  return entry;
}

function hasLivePollTarget() {
  for (const e of entries.values()) {
    if (e.has202 && !e.settled && e.watchers.size > 0) return true;
  }
  return false;
}

function stopPollerIfIdle() {
  if (timer === null) return;
  if (hasLivePollTarget()) return;
  clearInterval(timer);
  timer = null;
}

function ensurePoller() {
  if (timer !== null) return;
  if (!hasLivePollTarget()) return;
  timer = setInterval(pollTick, THUMB_POLL_INTERVAL);
}

/** 终态结算：触发全部活 watcher，卸载 entry（known-ready 兜底 / 允许重新 warm） */
function settleEntry(entry, type, readyUrl) {
  const live = [];
  for (const t of entry.watchers.values()) {
    if (!t.disposed) live.push(t);
  }
  entry.watchers.clear();
  entries.delete(entry.key);
  for (const t of live) {
    if (type === 'ready') t.onReady(readyUrl || warmUrl(entry.path, entry.time));
    else t.onMissing();
  }
  stopPollerIfIdle();
}

async function warm(entry) {
  let res;
  try {
    res = await fetch(warmUrl(entry.path, entry.time), { cache: 'no-store' });
  } catch {
    // 网络异常：计入该 (path,time) 的 warm 失败（下次 watch 可重试），不 panic、不误判终态
    entry.warming = false;
    return;
  }
  if (res.status === 200) {
    // 已就绪：直接 onReady。warm 的 200 响应即完整图片字节，
    // 转 objectURL 直喂 <img>，避免 <img> 再独立请求同一 URL 造成双倍传输
    // （warm 用 cache:'no-store'，且服务端对 thumb 强制 no-cache，img 二次请求逃不掉）。
    let readyUrl = warmUrl(entry.path, entry.time);
    try {
      const blob = await res.blob();
      if (blob && blob.size > 0) readyUrl = URL.createObjectURL(blob);
    } catch { /* blob 失败回退 warmUrl（走正常 img 加载） */ }
    knownReady.add(entry.key);
    entry.settled = true;
    entry.warming = false;
    settleEntry(entry, 'ready', readyUrl);
  } else if (res.status === 202) {
    // 服务端已在后台生成：watcher 已注册，轮询器接管
    entry.warming = false;
    entry.has202 = true;
    ensurePoller();
    if (_warmMissListener) _warmMissListener();
  } else {
    // 意外状态码（500 等）：按 warm 失败处理，下次 watch 可重试
    entry.warming = false;
  }
}

async function pollOne(entry) {
  if (entries.get(entry.key) !== entry) return; // 已被退订/终态卸载
  let res;
  try {
    res = await fetch(statusUrl(entry.path, entry.time), { cache: 'no-store' });
  } catch {
    return; // 网络异常 → 跳过本轮，下轮再试（不断言永久失败）
  }
  if (res.status !== 200) return; // 意外状态 → 下轮再试
  let body;
  try {
    body = await res.json();
  } catch {
    return; // 响应异常 → 下轮再试
  }
  if (body.status === 'ready') {
    knownReady.add(entry.key);
    entry.settled = true;
    settleEntry(entry, 'ready');
  } else if (body.status === 'missing') {
    entry.settled = true;
    settleEntry(entry, 'missing'); // 终态；下次新 watch 允许重新 warm
  }
  // 'generating' → 继续等（不退订）
}

async function pollTick() {
  const targets = [];
  for (const e of entries.values()) {
    if (e.has202 && !e.settled && e.watchers.size > 0) targets.push(e);
  }
  if (targets.length === 0) {
    stopPollerIfIdle();
    return;
  }
  // 每 tick 分批 ≤WARM_BATCH 串行，避免一次性几十个并发
  for (let i = 0; i < targets.length; i += WARM_BATCH) {
    for (const e of targets.slice(i, i + WARM_BATCH)) {
      await pollOne(e);
    }
  }
  stopPollerIfIdle();
}

/**
 * 观察一个 (path,time) 的缩略图，就绪时回调 onReady(warmUrl)。
 * @param {{ path: string, time: string|number, onReady: (url:string)=>void, onMissing?: ()=>void }} opts
 * @returns {() => void} dispose：注销该 watch 的回调；若该 (path,time) 无剩余 watcher
 *                       且不在 known-ready，则卸载让后续 watch 可以重新 warm。
 */
export function watchThumb({ path, time, onReady, onMissing = () => {} }) {
  const key = keyOf(path, time);
  const token = { onReady, onMissing, disposed: false };

  // known-ready：立即异步触发，不发任何请求
  if (knownReady.has(key)) {
    queueMicrotask(() => {
      if (!token.disposed) token.onReady(warmUrl(path, time));
    });
    return () => {
      token.disposed = true;
    };
  }

  const entry = entryOf(path, time);
  entry.watchers.set(token, token);

  // 同一 (path,time) 至多 warm 一次（进行中/已 202/已终态都不再触发）
  if (!entry.warming && !entry.has202 && !entry.settled) {
    entry.warming = true;
    warm(entry);
  }
  ensurePoller();

  return () => {
    token.disposed = true;
    entry.watchers.delete(token);
    if (entry.watchers.size === 0 && !entry.settled && !knownReady.has(key)) {
      // 无剩余 watcher 且未到终态 → 卸载 entry，允许后续 watch 重新 warm
      entries.delete(key);
    }
    stopPollerIfIdle();
  };
}

/** 清空会话内缓存（known-ready + entries + 轮询定时器）。供测试使用。 */
export function resetThumbCache() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  knownReady.clear();
  entries.clear();
}