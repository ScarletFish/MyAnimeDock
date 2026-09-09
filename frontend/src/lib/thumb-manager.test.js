// ─── thumb-manager.js 单元测试 ───
// mock fetch 覆盖：warm 200/202、status ready/missing/generating、
// warm 至多一次、ready 后停止轮询、known-ready 短路、dispose 退订、网络异常重试。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THUMB_POLL_INTERVAL, watchThumb, resetThumbCache } from './thumb-manager.js';

const ORIG_FETCH = globalThis.fetch;
const ORIG_RESPONSE = globalThis.Response;

/**
 * 安装 fetch mock；handler(url, opts, calls) 返回 Response 或 throw。
 * 返回 { fn, calls }，calls 收集 { url, opts }。
 */
function installFetch(handler) {
  const calls = [];
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts, calls);
  });
  globalThis.fetch = fn;
  return { fn, calls };
}

function json(status) {
  return new Response(JSON.stringify({ status }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const WARM = (p, t) => '/api/thumbnail?path=' + encodeURIComponent(p).replace(/'/g, '%27') + '&time=' + t;
const STATUS = (p, t) => '/api/thumbnail/status?path=' + encodeURIComponent(p).replace(/'/g, '%27') + '&time=' + t;

beforeEach(() => {
  resetThumbCache();
  vi.useFakeTimers();
  vi.stubGlobal('URL', { ...globalThis.URL, createObjectURL: vi.fn(() => 'blob:mock-url'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = ORIG_FETCH;
  globalThis.Response = ORIG_RESPONSE;
});

describe('watchThumb', () => {
  it('warm 200 → 直接 onReady（objectURL 直喂 img，URL 含 %27 转义），跳过轮询；known-ready 后不再发请求', async () => {
    const { calls } = installFetch(async () => new Response('img', { status: 200 }));
    const p = "C:\\a\\b'c.mp4";
    const onReady = vi.fn();
    const onMissing = vi.fn();
    const dispose = watchThumb({ path: p, time: 'mid', onReady, onMissing });
    await vi.advanceTimersByTimeAsync(0);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(WARM(p, 'mid'));
    expect(calls[0].opts.cache).toBe('no-store');
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith('blob:mock-url');
    expect(onMissing).not.toHaveBeenCalled();

    // known-ready：第二个 watch 不再发请求，直接异步 onReady（warmUrl）
    const onReady2 = vi.fn();
    const d2 = watchThumb({ path: p, time: 'mid', onReady: onReady2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.length).toBe(1);
    expect(onReady2).toHaveBeenCalledTimes(1);
    expect(onReady2).toHaveBeenCalledWith(WARM(p, 'mid'));
    d2();
    dispose();
  });

  it('warm 202 → 轮询直到 ready，触发 onReady 后停止轮询', async () => {
    let statusCalls = 0;
    installFetch(async (url) => {
      if (url.startsWith('/api/thumbnail/status')) {
        statusCalls++;
        return json(statusCalls === 1 ? 'generating' : 'ready');
      }
      return new Response('', { status: 202 });
    });
    const p = '/v/a.mp4';
    const onReady = vi.fn();
    const dispose = watchThumb({ path: p, time: 60, onReady });
    await vi.advanceTimersByTimeAsync(0);

    expect(statusCalls).toBe(0); // warm 未中，尚未进入轮询
    expect(onReady).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(THUMB_POLL_INTERVAL);
    expect(statusCalls).toBe(1); // generating → 继续等
    expect(onReady).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(THUMB_POLL_INTERVAL);
    expect(statusCalls).toBe(2); // ready → onReady
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(WARM(p, '60'));

    // 终态后不再轮询
    const before = statusCalls;
    await vi.advanceTimersByTimeAsync(THUMB_POLL_INTERVAL * 3);
    expect(statusCalls).toBe(before);
    dispose();
  });

  it('status missing → onMissing 触发并退订；新 watch 可重新 warm', async () => {
    let missing = false;
    let warmCalls = 0;
    const { calls } = installFetch(async (url) => {
      if (url.startsWith('/api/thumbnail/status')) return json(missing ? 'missing' : 'generating');
      warmCalls++;
      return new Response('', { status: 202 });
    });
    const p = '/v/m.mp4';
    const onMissing = vi.fn();
    const dispose = watchThumb({ path: p, time: 'mid', onMissing });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(THUMB_POLL_INTERVAL); // generating
    expect(onMissing).not.toHaveBeenCalled();

    missing = true;
    await vi.advanceTimersByTimeAsync(THUMB_POLL_INTERVAL);
    expect(onMissing).toHaveBeenCalledTimes(1);

    // 终态后无 further 轮询
    await vi.advanceTimersByTimeAsync(THUMB_POLL_INTERVAL * 2);
    const statusCalls = calls.filter((c) => c.url.startsWith('/api/thumbnail/status')).length;
    expect(statusCalls).toBe(2);

    // 新 watch 允许重新 warm
    const onMissing2 = vi.fn();
    const d2 = watchThumb({ path: p, time: 'mid', onMissing: onMissing2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(warmCalls).toBe(2);
    d2();
    dispose();
  });

  it('同一 (path,time) 多个 watch：warm 至多一次，轮询共享', async () => {
    let warmCalls = 0;
    installFetch(async (url) => {
      if (url.startsWith('/api/thumbnail/status')) return json('generating');
      warmCalls++;
      return new Response('', { status: 202 });
    });
    const p = '/v/s.mp4';
    const onReadyA = vi.fn();
    const onReadyB = vi.fn();
    const dA = watchThumb({ path: p, time: 'mid', onReady: onReadyA });
    await vi.advanceTimersByTimeAsync(0);
    const dB = watchThumb({ path: p, time: 'mid', onReady: onReadyB });
    await vi.advanceTimersByTimeAsync(0);

    expect(warmCalls).toBe(1);
    // 两个 watcher 都随轮询一起结算（终态后各自收 onReady）
    dA();
    dB();
  });

  it('dispose 退订单个 watcher；剩余 watcher 仍收到 onReady', async () => {
    let statusCalls = 0;
    installFetch(async (url) => {
      if (url.startsWith('/api/thumbnail/status')) {
        statusCalls++;
        return json(statusCalls >= 2 ? 'ready' : 'generating');
      }
      return new Response('', { status: 202 });
    });
    const p = '/v/d.mp4';
    const onReadyA = vi.fn();
    const onReadyB = vi.fn();
    const dA = watchThumb({ path: p, time: 'mid', onReady: onReadyA });
    const dB = watchThumb({ path: p, time: 'mid', onReady: onReadyB });
    await vi.advanceTimersByTimeAsync(0);

    dA(); // 退订 A
    await vi.advanceTimersByTimeAsync(THUMB_POLL_INTERVAL); // generating
    await vi.advanceTimersByTimeAsync(THUMB_POLL_INTERVAL); // ready
    expect(onReadyA).not.toHaveBeenCalled();
    expect(onReadyB).toHaveBeenCalledTimes(1);
    dB();
  });

  it('全部退订且未终态 → 新 watch 可重新 warm', async () => {
    let warmCalls = 0;
    installFetch(async (url) => {
      if (url.startsWith('/api/thumbnail/status')) return json('generating');
      warmCalls++;
      return new Response('', { status: 202 });
    });
    const p = '/v/r.mp4';
    const d1 = watchThumb({ path: p, time: 'mid', onReady: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    d1(); // 无剩余 watcher、未终态 → 卸载
    const d2 = watchThumb({ path: p, time: 'mid', onReady: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(warmCalls).toBe(2); // 重新 warm
    d2();
  });

  it('warm 网络异常 → 不触发回调、不轮询；下次 watch 重试', async () => {
    let failWarm = true;
    let warmCalls = 0;
    const { calls } = installFetch(async (url) => {
      if (url.startsWith('/api/thumbnail/status')) return json('generating');
      warmCalls++;
      if (failWarm) throw new TypeError('network down');
      return new Response('', { status: 202 });
    });
    const p = '/v/e.mp4';
    const onReady = vi.fn();
    const onMissing = vi.fn();
    const d1 = watchThumb({ path: p, time: 'mid', onReady, onMissing });
    await vi.advanceTimersByTimeAsync(0);

    expect(warmCalls).toBe(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();

    // 无轮询（warm 未 202）
    await vi.advanceTimersByTimeAsync(THUMB_POLL_INTERVAL * 2);
    expect(calls.filter((c) => c.url.startsWith('/api/thumbnail/status')).length).toBe(0);

    // 下次 watch 重试 warm → 202 → 进入轮询
    failWarm = false;
    const d2 = watchThumb({ path: p, time: 'mid', onReady, onMissing });
    await vi.advanceTimersByTimeAsync(0);
    expect(warmCalls).toBe(2);
    d1();
    d2();
  });

  it('known-ready 短路时 dispose 可阻止尚未触发的 onReady', async () => {
    installFetch(async () => new Response('img', { status: 200 }));
    const p = '/v/k.mp4';
    const onReady1 = vi.fn();
    const d1 = watchThumb({ path: p, time: 'mid', onReady: onReady1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onReady1).toHaveBeenCalledTimes(1);

    const onReady2 = vi.fn();
    const d2 = watchThumb({ path: p, time: 'mid', onReady: onReady2 });
    d2(); // 在微任务触发前退订
    await vi.advanceTimersByTimeAsync(0);
    expect(onReady2).not.toHaveBeenCalled();
    d1();
  });
});