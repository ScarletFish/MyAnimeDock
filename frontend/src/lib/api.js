// API helper functions

// 兜底请求超时（安全网）：正常本地 API 毫秒级返回；外部抓取服务端预算最坏
// 蜜柑详情 8s / 全量列表 10s / bangumi 失败后 curl 兜底 ~13s，这里留一定余量。
// 15s 之上仍无响应即中止（AbortController），UI 不会被长时间挂起。
const DEFAULT_TIMEOUT = 15000;

async function fetchWithTimeout(url, options = {}, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // 兼容外部传入的 signal（主动取消）：任一触发即中止
  let onOuterAbort = null;
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else {
      onOuterAbort = () => controller.abort();
      options.signal.addEventListener('abort', onOuterAbort, { once: true });
    }
  }
  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    // 仅当超时触发（而非外部主动取消）时，换成可读的错误信息
    if (e?.name === 'AbortError' && !options.signal?.aborted) throw new Error('请求超时');
    throw e;
  } finally {
    clearTimeout(timer);
    if (onOuterAbort) options.signal.removeEventListener('abort', onOuterAbort);
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const API = {
  get(url, options = {}) {
    return fetchWithTimeout(url, options);
  },
  post(url, data, signal) {
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal,
    });
  },
  put(url, data) {
    return fetchWithTimeout(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },
  del(url) {
    return fetchWithTimeout(url, { method: 'DELETE' });
  },
};
