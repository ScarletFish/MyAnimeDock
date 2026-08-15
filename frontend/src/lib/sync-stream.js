// ─── SSE 流式同步控制器（metamatch.js 迁移步骤 0）───
// 从 mmSyncViaSSE 抽取的纯逻辑、无 DOM 依赖模块。
// 只负责 EventSource 生命周期与终态报告，不处理任何业务逻辑
// （不碰 items、不碰 syncLog）。
//
// 核心坑修复：EventSource.close() 不会触发 error 事件，因此取消时
// 必须显式 resolve，否则 done Promise 永久悬挂（vanilla 用全局
// mmSyncResolve 绕过，这里收敛为模块内的 resolveDone）。

/**
 * 创建一条 SSE 同步流。
 * @param {string[]} ids 动漫 ID 数组
 * @returns {{
 *   on: (event: string, handler: (e: Event) => void) => void,
 *   cancel: () => void,
 *   done: Promise<{ cancelled: boolean }>,
 * }}
 */
export function createSyncStream(ids) {
  const url = '/api/library/sync/stream?ids=' + encodeURIComponent(JSON.stringify(ids));
  const es = new EventSource(url);

  // 事件名 -> handler 集合
  const handlers = new Map();

  // 终态守卫：settled 后所有路径（done/error/cancelled/timeout/cancel）幂等
  let settled = false;
  let cancelled = false;

  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  // 120s 服务端挂死兜底
  const timeoutId = setTimeout(finish, 120000);

  /** 幂等收尾：关闭连接并 resolve done（只执行一次） */
  function finish() {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    es.close();
    resolveDone({ cancelled });
  }

  /**
   * 注册事件处理器。settled（含 cancel）后注册的 handler 不再被调用，
   * 已注册的 handler 在 settled 后收到的事件也会被丢弃。
   */
  function on(event, handler) {
    if (settled) return;
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(handler);

    es.addEventListener(event, (e) => {
      // cancel 后的事件一律丢弃
      if (settled) return;
      handler(e);
    });
  }

  /** 取消：置 cancelled、关闭连接、显式 resolve（核心坑修复） */
  function cancel() {
    if (settled) return;
    cancelled = true;
    finish(); // 显式 resolve，避免 close() 不触发 error 导致悬挂
  }

  // 终态事件 + timeout 都走幂等 finish()
  es.addEventListener('done', finish);
  es.addEventListener('error', finish);
  es.addEventListener('cancelled', finish);

  return { on, cancel, done };
}