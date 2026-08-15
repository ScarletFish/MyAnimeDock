// Theme — pure functions for loading/applying theme, zoom, reduce-motion.
// No DOM event handlers, no UI rendering. Used by app.js init and ThemeDock.svelte.

/**
 * Set theme attributes on document.documentElement.
 * For default theme: data-theme="dark|light" (backward-compatible).
 * For non-default: data-theme="themeName" + data-theme-mode.
 */
export function setThemeAttributes(theme, themeMode) {
  if (theme === 'default') {
    document.documentElement.setAttribute('data-theme', themeMode);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  document.documentElement.setAttribute('data-theme-mode', themeMode);
}

/**
 * Apply theme: write localStorage + set attributes + dispatch event.
 */
export function applyTheme(theme, themeMode) {
  localStorage.setItem('theme', theme);
  localStorage.setItem('themeMode', themeMode);
  setThemeAttributes(theme, themeMode);
  document.dispatchEvent(new CustomEvent('themechanged'));
}

/**
 * Load theme from localStorage (+ configCache fallback), apply to document.
 */
export function loadTheme(configCache) {
  const theme = localStorage.getItem('theme') || configCache?.theme || 'default';
  const themeMode = localStorage.getItem('themeMode') || configCache?.themeMode || 'dark';
  // Backward compatibility: old format stored 'dark'/'light' as theme
  const isOldFormat = theme === 'dark' || theme === 'light';
  const resolvedTheme = isOldFormat ? 'default' : theme;
  const resolvedMode = isOldFormat ? theme : themeMode;
  setThemeAttributes(resolvedTheme, resolvedMode);
  localStorage.setItem('theme', resolvedTheme);
  localStorage.setItem('themeMode', resolvedMode);
}

/**
 * Apply zoom via CSS --scale variable.
 */
export function applyZoom(factor) {
  const s = parseFloat(factor) || 1;
  document.documentElement.style.setProperty('--scale', s);
  if (typeof applyGridColumns === 'function') applyGridColumns();
}

/**
 * Load reduce-motion from localStorage (+ configCache fallback).
 */
export function loadReduceMotion(configCache) {
  const reduced = localStorage.getItem('reduceMotion') === '1' || configCache?.reduceMotion === true;
  if (reduced) {
    document.documentElement.setAttribute('data-reduce-motion', 'true');
  }
}

/**
 * Apply detail-title-bg setting to document.
 */
export function applyDetailTitleBg() {
  var on = localStorage.getItem('myAnimDock_detailTitleBg') === 'on';
  document.documentElement.setAttribute('data-detail-title-bg', on ? 'on' : '');
}
