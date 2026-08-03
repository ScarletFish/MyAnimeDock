// ─── i18n 初始化 ────────────────────────────────────────────────────
// 依赖：vendor/i18next/i18next.min.js（全局 i18next）+ i18n-zh.js（全局 I18N_ZH）
// 职责：
//   1. 初始化 i18next（固定 zh-CN，不切语言）
//   2. 暴露全局 t()，供所有 JS 文件使用
//   3. DOM 绑定：将 [data-i18n] 文本节点和 [data-i18n-attr] 属性替换为字典值
// 注意：必须在所有使用 t() 的脚本之前加载（JS_FILES 首位）。

(function () {
  if (!window.i18next) {
    console.error('[i18n] i18next UMD 未加载，请确认 vendor/i18next/i18next.min.js 存在');
    window.t = function (key) { return key; };
    return;
  }

  window.i18next.init({
    lng: 'zh-CN',
    fallbackLng: 'zh-CN',
    resources: {
      'zh-CN': { translation: window.I18N_ZH || {} },
    },
    // 项目已有 escHtml()/escAttr() 防 XSS，关闭 i18next 默认转义避免双重转义
    interpolation: { escapeValue: false },
  });

  /** 全局翻译函数：t('ns.key', { var: value }) */
  window.t = function (key, options) {
    return window.i18next.t(key, options);
  };

  // DOM 绑定：静态 HTML 中的文本节点与属性
  function bindDom() {
    // [data-i18n="ns.key"] → textContent
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      el.textContent = window.i18next.t(key);
    });

    // [data-i18n-attr="ns.key:attr1,attr2"] → 设置属性值
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var spec = el.getAttribute('data-i18n-attr');
      if (!spec) return;
      // 格式："ns.key:attr1,attr2"
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDom);
  } else {
    bindDom();
  }
})();
