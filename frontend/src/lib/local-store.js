// ─── localStorage ↔ Svelte writable 双向同步 ───
// 用法：export const mySetting = localStore('storageKey', defaultValue);
// 读：$mySetting（响应式）  写：mySetting.set(val) / mySetting.update(fn)
// 所有订阅者自动收到变更通知，不再需要手动 CustomEvent。
import { writable } from 'svelte/store';

/**
 * 创建一个与 localStorage 双向同步的 Svelte writable store。
 * @param {string} key      localStorage 键名
 * @param {*}      fallback 存储不存在或解析失败时的默认值
 * @returns {import('svelte/store').Writable & { set: Function, update: Function }}
 */
export function localStore(key, fallback) {
  let initial = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) initial = JSON.parse(raw);
  } catch {}

  const { subscribe, set: _set, update: _update } = writable(initial);

  return {
    subscribe,
    set(val) {
      localStorage.setItem(key, JSON.stringify(val));
      _set(val);
    },
    update(fn) {
      let next;
      _update((v) => { next = fn(v); return next; });
      localStorage.setItem(key, JSON.stringify(next));
    },
  };
}
