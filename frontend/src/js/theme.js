// Theme & visual dock (搬移自 app.js —— 零逻辑改动)

// Theme
function loadTheme() {
  const theme = localStorage.getItem('theme') || configCache?.theme || 'default';
  const themeMode = localStorage.getItem('themeMode') || configCache?.themeMode || 'dark';
  // Backward compatibility: old format stored 'dark'/'light' as theme
  const isOldFormat = theme === 'dark' || theme === 'light';
  const resolvedTheme = isOldFormat ? 'default' : theme;
  const resolvedMode = isOldFormat ? theme : themeMode;
  setThemeAttributes(resolvedTheme, resolvedMode);
  localStorage.setItem('theme', resolvedTheme);
  localStorage.setItem('themeMode', resolvedMode);
  // Sync theme picker UI
  document.querySelectorAll('.theme-option').forEach(b => {
    b.classList.toggle('theme-option--active', b.dataset.theme === resolvedTheme);
  });
}

function applyTheme(theme, themeMode) {
  localStorage.setItem('theme', theme);
  localStorage.setItem('themeMode', themeMode);
  setThemeAttributes(theme, themeMode);
  document.dispatchEvent(new CustomEvent('themechanged'));
}

function setThemeAttributes(theme, themeMode) {
  // For default theme, use backward-compatible data-theme="dark|light"
  // so existing [data-theme="light"] selectors continue to work.
  // For non-default themes, use data-theme="themeName" + data-theme-mode.
  if (theme === 'default') {
    document.documentElement.setAttribute('data-theme', themeMode);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  document.documentElement.setAttribute('data-theme-mode', themeMode);
}

function updateDockThemeToggleLabels() {
  const dockToggle = document.getElementById('dockThemeMode');
  if (!dockToggle) return;
  const isLight = dockToggle.checked;
  document.getElementById('dockLabelDark').className = 'theme-toggle-label' + (isLight ? ' theme-toggle-label--inactive' : ' theme-toggle-label--active');
  document.getElementById('dockLabelLight').className = 'theme-toggle-label' + (isLight ? ' theme-toggle-label--active' : ' theme-toggle-label--inactive');
}

function selectTheme(btn, theme) {
  document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('theme-option--active'));
  btn.classList.add('theme-option--active');
  const dockToggle = document.getElementById('dockThemeMode');
  const mode = dockToggle ? (dockToggle.checked ? 'light' : 'dark') : 'dark';
  const rawTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const oldMode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
  // Resolve raw data-theme to theme name (default theme stores "dark"/"light")
  const oldTheme = (rawTheme === 'dark' || rawTheme === 'light') ? 'default' : rawTheme;
  if (theme === oldTheme && mode === oldMode) return;
  animateThemeTransition(theme, mode);
}

function handleDockThemeModeToggle(toggle) {
  const newMode = toggle.checked ? 'light' : 'dark';
  const theme = document.querySelector('.theme-option.theme-option--active')?.dataset?.theme || 'default';
  const rawTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const oldMode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
  const oldTheme = (rawTheme === 'dark' || rawTheme === 'light') ? 'default' : rawTheme;
  if (theme === oldTheme && newMode === oldMode) return;
  updateDockThemeToggleLabels();
  animateThemeTransition(theme, newMode);
}

function animateThemeTransition(theme, mode) {
  document.documentElement.classList.add('theme-transitioning');
  applyTheme(theme, mode);
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transitioning');
  }, 500);
}

// ─── Theme Dock ───
function openThemeDock() {
  const dock = document.getElementById('themeDock');
  const overlay = document.getElementById('themeDockOverlay');
  // Sync dock controls with current state
  const mode = document.documentElement.getAttribute('data-theme-mode') || 'dark';
  const dockToggle = document.getElementById('dockThemeMode');
  if (dockToggle) {
    dockToggle.checked = mode === 'light';
    updateDockThemeToggleLabels();
  }
  const zoomEl = document.getElementById('dockZoom');
  if (zoomEl) {
    const currentZoom = Math.round((parseFloat(document.documentElement.style.getPropertyValue('--scale')) || 1) * 100);
    zoomEl.value = currentZoom;
    document.getElementById('dockZoomLabel').textContent = currentZoom + '%';
  }
  const rmToggle = document.getElementById('dockReduceMotion');
  if (rmToggle) {
    rmToggle.checked = document.documentElement.getAttribute('data-reduce-motion') === 'true';
  }
  dock.classList.add('open');
  overlay.classList.add('open');
  document.addEventListener('keydown', handleDockEsc);
}

function closeThemeDock() {
  const dock = document.getElementById('themeDock');
  const overlay = document.getElementById('themeDockOverlay');
  dock.classList.remove('open');
  overlay.classList.remove('open');
  document.removeEventListener('keydown', handleDockEsc);
}

function handleDockEsc(e) {
  if (e.key === 'Escape') closeThemeDock();
}

let _dockZoomTimer = null;
function handleDockZoom(input) {
  const scale = parseInt(input.value) / 100;
  applyZoom(scale);
  document.getElementById('dockZoomLabel').textContent = input.value + '%';
  clearTimeout(_dockZoomTimer);
  _dockZoomTimer = setTimeout(async () => {
    try { await API.post('/api/config', { uiScale: scale }); } catch (_) {}
  }, 300);
}

function openVisualDock() {
  closeModal('settingsModal');
  openThemeDock();
}

function toggleThemeDock() {
  const dock = document.getElementById('themeDock');
  if (dock.classList.contains('open')) {
    closeThemeDock();
  } else {
    openThemeDock();
  }
}

// Zoom via CSS --scale variable (GSAP-safe, fixed-position-friendly)
function applyZoom(factor) {
  const s = parseFloat(factor) || 1;
  document.documentElement.style.setProperty('--scale', s);
  if (typeof applyGridColumns === 'function') applyGridColumns();
}

// ─── Reduce Motion ───
function handleReduceMotionToggle(input) {
  const reduced = input.checked;
  localStorage.setItem('reduceMotion', reduced ? '1' : '');
  document.documentElement.setAttribute('data-reduce-motion', reduced ? 'true' : 'false');
}

function loadReduceMotion() {
  const reduced = localStorage.getItem('reduceMotion') === '1' || configCache?.reduceMotion === true;
  if (reduced) {
    document.documentElement.setAttribute('data-reduce-motion', 'true');
  }
}

// ─── ESM exports for onclick handlers ───
window.selectTheme = selectTheme;
window.handleDockThemeModeToggle = handleDockThemeModeToggle;
window.handleDockZoom = handleDockZoom;
window.handleReduceMotionToggle = handleReduceMotionToggle;
window.toggleThemeDock = toggleThemeDock;
window.closeThemeDock = closeThemeDock;
window.openVisualDock = openVisualDock;
