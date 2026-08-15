// ─── sync-stream.js 单元测试 ───
// 用 mock EventSource 覆盖：done 事件、cancel 显式 resolve、
// cancel 后事件丢弃、timeout 兜底、finish 幂等、handler 收数据。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncStream } from './sync-stream.js';

// ─── Mock EventSource ───
class MockEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    MockEventSource.instances.push(this);
  }

  addEventListener(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  close() {
    this.closed = true;
  }

  /** 测试辅助：模拟服务端推送事件 */
  dispatchEvent(event, data) {
    const handlers = this.listeners[event] || [];
    for (const h of handlers) h({ data });
  }
}

/** 取最近一次创建的 EventSource 实例 */
function lastES() {
  return MockEventSource.instances[MockEventSource.instances.length - 1];
}

beforeEach(() => {
  MockEventSource.instances = [];
  globalThis.EventSource = MockEventSource;
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.EventSource;
});

describe('createSyncStream', () => {
  it('构造时拼接正确的 SSE URL', () => {
    const stream = createSyncStream(['a', 'b']);
    const es = lastES();
    expect(es.url).toBe(
      '/api/library/sync/stream?ids=' + encodeURIComponent(JSON.stringify(['a', 'b']))
    );
    expect(stream.done).toBeInstanceOf(Promise);
  });

  it('done 事件 → done resolve 且 cancelled:false', async () => {
    const stream = createSyncStream(['a']);
    const es = lastES();
    es.dispatchEvent('done', '');
    const result = await stream.done;
    expect(result).toEqual({ cancelled: false });
    expect(es.closed).toBe(true);
  });

  it('cancel() → done resolve 且 cancelled:true（即使 close() 不触发 error）', async () => {
    const stream = createSyncStream(['a']);
    const es = lastES();
    stream.cancel();
    const result = await stream.done;
    expect(result).toEqual({ cancelled: true });
    expect(es.closed).toBe(true);
  });

  it('cancel 后的事件被丢弃（handler 不再被调用）', async () => {
    const stream = createSyncStream(['a']);
    const es = lastES();
    const handler = vi.fn();
    stream.on('progress', handler);

    stream.cancel();
    es.dispatchEvent('progress', '{"animeId":"a"}');

    expect(handler).not.toHaveBeenCalled();
  });

  it('cancel 后注册的 handler 不再被调用', async () => {
    const stream = createSyncStream(['a']);
    const es = lastES();
    stream.cancel();

    const handler = vi.fn();
    stream.on('progress', handler);
    es.dispatchEvent('progress', '{"animeId":"a"}');

    expect(handler).not.toHaveBeenCalled();
  });

  it('timeout 触发 finish（120s 服务端挂死兜底）', async () => {
    vi.useFakeTimers();
    const stream = createSyncStream(['a']);
    const es = lastES();

    const p = stream.done;
    await vi.advanceTimersByTimeAsync(120000);

    const result = await p;
    expect(result).toEqual({ cancelled: false });
    expect(es.closed).toBe(true);
  });

  it('finish 幂等：重复 cancel 只 resolve 一次', async () => {
    const stream = createSyncStream(['a']);
    const es = lastES();

    stream.cancel();
    stream.cancel(); // 第二次调用应被 settled 守卫拦截
    es.dispatchEvent('done', ''); // 终态事件同样被守卫拦截

    const result = await stream.done;
    expect(result).toEqual({ cancelled: true });
    expect(es.closed).toBe(true);
  });

  it('事件 handler 能收到数据', () => {
    const stream = createSyncStream(['a']);
    const es = lastES();
    const handler = vi.fn();

    stream.on('progress', handler);
    es.dispatchEvent('progress', '{"animeId":"a","success":true}');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].data).toBe('{"animeId":"a","success":true}');
  });

  it('多个事件可分别注册 handler', () => {
    const stream = createSyncStream(['a']);
    const es = lastES();
    const onMatching = vi.fn();
    const onProgress = vi.fn();

    stream.on('matching', onMatching);
    stream.on('progress', onProgress);

    es.dispatchEvent('matching', '{"animeId":"a"}');
    es.dispatchEvent('progress', '{"animeId":"a"}');

    expect(onMatching).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
  });
});