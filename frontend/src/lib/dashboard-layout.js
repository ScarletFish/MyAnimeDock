// Dashboard layout — localStorage helpers
// Pure functions, no DOM dependencies.

/** 默认布局配置 */
export function defaultDashboardLayout() {
  return [
    { id: 'stats', enabled: true },
    { id: 'continueWatch', enabled: true },
    { id: 'localLibrary', enabled: true }
  ];
}

/** 从 localStorage 读取布局配置，不存在则返回默认 */
export function getDashboardLayout() {
  try {
    var saved = JSON.parse(localStorage.getItem('myAnimDock_layout'));
    if (saved && Array.isArray(saved) && saved.length > 0) return saved;
  } catch (e) {}
  return defaultDashboardLayout();
}

/** 保存布局配置到 localStorage */
export function saveDashboardLayout(layout) {
  localStorage.setItem('myAnimDock_layout', JSON.stringify(layout));
}

/** 读取卡片标题可见性设置 */
export function getCardTitleVisible(view, defaultVal = false) {
  var val = localStorage.getItem('myAnimDock_cardTitle_' + view);
  if (val === null) return defaultVal;
  return val === 'true';
}

/** 应用详情页标题背景设置到 document */
export function applyDetailTitleBg() {
  var on = localStorage.getItem('myAnimDock_detailTitleBg') === 'on';
  document.documentElement.setAttribute('data-detail-title-bg', on ? 'on' : '');
}
