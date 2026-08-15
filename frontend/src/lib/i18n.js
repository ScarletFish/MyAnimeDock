// i18n 初始化 — ES module version
// Depends on vendor/i18next/i18next.min.js (global i18next).
// Provides initI18n() that must be called before any t() usage.
// Also sets window.t / globalThis.t for backward compatibility.

import { I18N_ZH } from './i18n-zh.js';

export function initI18n() {
  if (!window.i18next) {
    console.error('[i18n] i18next UMD 未加载，请确认 vendor/i18next/i18next.min.js 存在');
    window.t = globalThis.t = function (key) { return key; };
    return;
  }

  window.i18next.init({
    lng: 'zh-CN',
    fallbackLng: 'zh-CN',
    resources: {
      'zh-CN': { translation: I18N_ZH || {} },
    },
    interpolation: { escapeValue: false },
  });

  /** 全局翻译函数：t('ns.key', { var: value }) */
  window.t = globalThis.t = function (key, options) {
    return window.i18next.t(key, options);
  };
}

export function bindDom() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    el.textContent = window.i18next.t(key);
  });

  document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
    var spec = el.getAttribute('data-i18n-attr');
    if (!spec) return;
    var parts = spec.split(':');
    var key = parts[0];
    var attrs = parts.length > 1 ? parts[1].split(',') : ['data-tooltip', 'title', 'aria-label', 'placeholder'];
    attrs.forEach(function (attr) {
      attr = attr.trim();
      if (!attr) return;
      if (el.hasAttribute(attr)) {
        el.setAttribute(attr, window.i18next.t(key));
      }
    });
  });
}
