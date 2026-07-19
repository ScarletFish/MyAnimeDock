// Custom title bar — window controls for Tauri (decorations: false)
// Loaded from index.html, self-initializing IIFE.
(function () {
  'use strict';

  var btnMin = document.getElementById('titlebarMinimize');
  var btnMax = document.getElementById('titlebarMaximize');
  var btnClose = document.getElementById('titlebarClose');
  var titlebar = document.getElementById('titlebar');

  if (!btnMin || !btnMax || !btnClose || !titlebar) return;

  // Browser fallback: no Tauri window API — still show controls, just no-op
  var tauriWin = null;
  if (window.__TAURI__ && window.__TAURI__.window) {
    try {
      tauriWin = window.__TAURI__.window.getCurrentWindow();
    } catch (_) {}
  }

  // ── Minimize ──
  btnMin.addEventListener('click', function () {
    if (tauriWin) tauriWin.minimize();
  });

  // ── Close ──
  btnClose.addEventListener('click', function () {
    if (tauriWin) tauriWin.close();
  });

  // ── Maximize / Restore toggle ──
  function updateMaximizeIcon(m) {
    var maximized = m;
    if (maximized === undefined) {
      if (!tauriWin) return;
      tauriWin.isMaximized().then(function (val) { setIcon(val); });
      return;
    }
    setIcon(maximized);

    function setIcon(maxed) {
      btnMax.innerHTML = maxed
        ? '<svg viewBox="0 0 14 14"><rect x="4.5" y="5.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 2.5h7.5v1H3v6.5H2V2.5z" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 14 14"><rect x="3" y="3" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
      btnMax.title = maxed ? '\u8FD8\u539F' : '\u6700\u5927\u5316';
    }
  }

  btnMax.addEventListener('click', async function () {
    if (!tauriWin) return;
    await tauriWin.toggleMaximize();
    updateMaximizeIcon();
  });

  // ── Listen for window resize (external maximize, keyboard shortcuts, etc.) ──
  if (tauriWin && tauriWin.onResize) {
    tauriWin.onResize(function () {
      updateMaximizeIcon();
    });
  }

  // ── Window drag (move) — mousedown on title bar, skip buttons ──
  titlebar.addEventListener('mousedown', function (e) {
    if (!tauriWin) return;
    // Only primary button, skip interactive elements
    if (e.button !== 0) return;
    if (e.target.closest('button, input, select, textarea, a')) return;
    tauriWin.startDragging();
  });

  // ── Double-click title bar to maximize / restore ──
  titlebar.addEventListener('dblclick', function (e) {
    if (!tauriWin) return;
    // Don't toggle if clicking a button
    if (e.target.closest('.titlebar__btn')) return;
    tauriWin.toggleMaximize().then(function () { updateMaximizeIcon(); });
  });

  // ── Back button (detail view) ──
  var btnBack = document.getElementById('titlebarBack');
  if (btnBack) {
    btnBack.addEventListener('click', function () {
      if (typeof window.goBack === 'function') window.goBack();
    });
  }

  // ── Expose context switcher for app.js / detail.js ──
  window.setTitlebarContext = function (mode, title) {
    var brand = document.getElementById('titlebarBrand');
    var detailCtx = document.getElementById('titlebarDetailContext');
    if (!brand || !detailCtx) return;

    if (mode === 'detail') {
      brand.classList.add('hidden');
      detailCtx.classList.remove('hidden');
    } else {
      brand.classList.remove('hidden');
      detailCtx.classList.add('hidden');
    }
  };

  // ── Initial icon state ──
  updateMaximizeIcon();
})();
