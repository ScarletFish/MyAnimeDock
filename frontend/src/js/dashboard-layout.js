// Dashboard layout settings (搬移自 app.js —— 零逻辑改动)

// ─── Dashboard Layout (动漫库页面模块排序与开关) ───

/** 默认布局配置 */
function defaultDashboardLayout() {
  return [
    { id: 'stats', enabled: true },
    { id: 'continueWatch', enabled: true },
    { id: 'localLibrary', enabled: true }
  ];
}

/** 从 localStorage 读取布局配置，不存在则返回默认 */
function getDashboardLayout() {
  try {
    var saved = JSON.parse(localStorage.getItem('myAnimDock_layout'));
    if (saved && Array.isArray(saved) && saved.length > 0) return saved;
  } catch (e) {}
  return defaultDashboardLayout();
}

/** 保存布局配置到 localStorage */
function saveDashboardLayout(layout) {
  localStorage.setItem('myAnimDock_layout', JSON.stringify(layout));
}

// ─── Card Title Always Visible（三处独立开关） ───

function getCardTitleVisible(view, defaultVal) {
  var val = localStorage.getItem('myAnimDock_cardTitle_' + view);
  if (val === null) return defaultVal === true;
  return val === 'true';
}

function applyDetailTitleBg() {
  var on = localStorage.getItem('myAnimDock_detailTitleBg') === 'on';
  document.documentElement.setAttribute('data-detail-title-bg', on ? 'on' : '');
}

function renderDashboardLayoutSettings() {
  var list = document.getElementById('dashboardLayoutList');
  if (!list) return;
  if (typeof getDashboardLayout !== 'function') return;
  var layout = getDashboardLayout();
  var defs = { stats: t('app.dashboardStats'), continueWatch: t('app.dashboardContinueWatch'), localLibrary: t('app.dashboardLocalLibrary') };
  list.innerHTML = layout.map(function(s, i) {
    var label = defs[s.id] || s.id;
    return '<div class="dashboard-layout-item" data-id="' + s.id + '">' +
      '<span class="dashboard-layout-drag-handle" data-drag-handle="' + s.id + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>' +
      '</span>' +
      '<label class="toggle-switch" style="margin:0">' +
        '<input type="checkbox" ' + (s.enabled ? 'checked' : '') + ' onchange="toggleDashboardSection(\'' + s.id + '\', this.checked)">' +
        '<span class="toggle-slider"></span>' +
      '</label>' +
      '<span class="dashboard-layout-label">' + label + '</span>' +
      '<div class="dashboard-layout-arrows">' +
        '<button class="btn btn-icon btn-xs" onclick="moveDashboardSection(\'' + s.id + '\', -1)" ' + (i === 0 ? 'disabled' : '') + ' data-tooltip="' + t('app.tooltipMoveUp') + '">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>' +
        '</button>' +
        '<button class="btn btn-icon btn-xs" onclick="moveDashboardSection(\'' + s.id + '\', 1)" ' + (i === layout.length - 1 ? 'disabled' : '') + ' data-tooltip="' + t('app.tooltipMoveDown') + '">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');

  // ── Pointer-based drag (replaces native drag API) ──
  if (list._dragCleanup) list._dragCleanup();
  var dragState = { active: false, srcId: null, ghost: null, startY: 0, srcIdx: -1 };
  var items = function() { return list.querySelectorAll('.dashboard-layout-item'); };

  function onPointerDown(e) {
    var handle = e.target.closest('[data-drag-handle]');
    if (!handle) return;
    var item = handle.closest('.dashboard-layout-item');
    if (!item) return;
    e.preventDefault();
    dragState.active = true;
    dragState.srcId = item.dataset.id;
    dragState.startY = e.clientY;
    var arr = Array.from(items());
    dragState.srcIdx = arr.indexOf(item);
    item.classList.add('dragging');
  }

  function onPointerMove(e) {
    if (!dragState.active) return;
    e.preventDefault();
    // Find which item we're over
    var arr = Array.from(items());
    var overItem = null;
    for (var i = 0; i < arr.length; i++) {
      var rect = arr[i].getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        overItem = arr[i];
        break;
      }
    }
    arr.forEach(function(el) { el.classList.remove('drag-over'); });
    if (overItem && overItem.dataset.id !== dragState.srcId) {
      overItem.classList.add('drag-over');
    }
  }

  function onPointerUp(e) {
    if (!dragState.active) return;
    dragState.active = false;
    // Find target
    var arr = Array.from(items());
    var targetId = null;
    for (var i = 0; i < arr.length; i++) {
      var rect = arr[i].getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        targetId = arr[i].dataset.id;
        break;
      }
    }
    arr.forEach(function(el) { el.classList.remove('dragging', 'drag-over'); });
    if (!targetId || targetId === dragState.srcId) return;
    // Reorder
    var layout = getDashboardLayout();
    var fromIdx = layout.findIndex(function(s) { return s.id === dragState.srcId; });
    var toIdx = layout.findIndex(function(s) { return s.id === targetId; });
    if (fromIdx === -1 || toIdx === -1) return;
    var moved = layout.splice(fromIdx, 1)[0];
    layout.splice(toIdx, 0, moved);
    saveDashboardLayout(layout);
    renderDashboardLayoutSettings();
    if (typeof renderDashboard === 'function') renderDashboard();
  }

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  list._dragCleanup = function() {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  };
}

function toggleDashboardSection(id, enabled) {
  if (typeof getDashboardLayout !== 'function') return;
  var layout = getDashboardLayout();
  var s = layout.find(function(s) { return s.id === id; });
  if (s) s.enabled = enabled;
  saveDashboardLayout(layout);
  if (typeof renderDashboard === 'function') renderDashboard();
}

function moveDashboardSection(id, dir) {
  if (typeof getDashboardLayout !== 'function') return;
  var layout = getDashboardLayout();
  var idx = layout.findIndex(function(s) { return s.id === id; });
  if (idx === -1) return;
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= layout.length) return;
  var tmp = layout[idx];
  layout[idx] = layout[newIdx];
  layout[newIdx] = tmp;
  saveDashboardLayout(layout);
  renderDashboardLayoutSettings();
  if (typeof renderDashboard === 'function') renderDashboard();
}

// ─── ESM exports for onclick handlers ───
window.toggleDashboardSection = toggleDashboardSection;
window.moveDashboardSection = moveDashboardSection;