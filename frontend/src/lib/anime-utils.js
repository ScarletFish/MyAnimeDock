// ─── 共享动漫工具（Svelte 迁移 Chunk A）───
// 纯逻辑抽取：从 Library.svelte / Mylist.svelte 抽出可复用积木。

import { showDetail } from './router.js';

// i18n 辅助（复用全局 t()）
export function tr(key, options) {
  return typeof globalThis.t === 'function' ? globalThis.t(key, options) : key;
}

// API 辅助（自包含，不复用全局 API）
export const api = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async put(url, data) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

export function basename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

export function coverSrc(item, size) {
  return item.localCover ? '/covers/' + basename(item.localCover) + '?w=' + size + '&q=75' : '';
}

export function getCardTitleVisible(view, defaultVal = false) {
  const val = localStorage.getItem('myAnimDock_cardTitle_' + view);
  if (val === null) return defaultVal;
  return val === 'true';
}

export function localDateStr(isoStr) {
  var d = new Date(isoStr);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

export function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

export function navigateToDetail(id, el, source) {
  const img = el.querySelector('img');
  let rect = null;
  let imgSrc = null;
  if (img && img.naturalWidth > 0) {
    rect = img.getBoundingClientRect();
    if (rect.width && rect.height) imgSrc = img.currentSrc || img.src;
  }
  if (!rect) rect = el.getBoundingClientRect();
  showDetail(id, rect, imgSrc, source);
}

export const STATUS_SECTIONS_LIBRARY = ['watching', 'wish', 'completed'];
export const STATUS_SECTIONS_MYLIST = ['watching', 'wish', 'completed', 'on_hold', 'dropped'];