// state.js — Minimal shared state for cross-module data
// Provides get/set with CustomEvent notification for reactive sync.
const _s = {};

export const AppState = {
  get(k) { return _s[k]; },

  set(k, v) {
    if (_s[k] === v) return;
    const old = _s[k];
    _s[k] = v;
    document.dispatchEvent(new CustomEvent('statechange', {
      detail: { key: k, value: v, old }
    }));
  },

  // Subscribe to specific key changes. Returns unsubscribe function.
  on(k, fn) {
    const handler = e => {
      if (e.detail.key === k) fn(e.detail.value, e.detail.old);
    };
    document.addEventListener('statechange', handler);
    return () => document.removeEventListener('statechange', handler);
  }
};

// Initialize cross-module shared state
AppState.set('detailSourceView', 'library');
AppState.set('currentAnime', null);
