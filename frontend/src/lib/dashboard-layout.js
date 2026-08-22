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
