/**
 * Debug diagnostic system.
 * Zero production impact when disabled.
 *
 * Usage:
 *   __debug.toggle()                    // Enable/disable via localStorage
 *   __debug.log('tag', 'message', data)
 *   __debug.snapshot('showView: → library')  // State snapshot
 *   __debug.enabled = true             // Enable for this session only
 *   __debug.openDetail(id)             // Set time origin for detail flow
 *   __debug.ms()                       // ms since detail open (0 if no origin)
 *
 * Enabled when: localStorage 'myanimedock_debug' === '1' OR backend config debugDetailFlow === true.
 * Persisted: localStorage KEY for manual toggle.
 */
const KEY = 'myanimedock_debug';

// ─── Detail flow time origin ───
let _detailT0 = 0;

// ─── Remote log sink (fire-and-forget, silent failure) ───
function _remoteLog(tag, msg) {
  try {
    fetch('/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, ts: Date.now(), ms: __debug.ms(), msg }),
    }).catch(function () {});
  } catch (_) { /* ignore */ }
}

export const __debug = {
  _enabled: localStorage.getItem(KEY) === '1',

  get enabled() { return this._enabled; },
  set enabled(v) {
    this._enabled = !!v;
    if (!v) localStorage.removeItem(KEY);
  },

  /** Tagged console.log — single source, easy to grep. Also sends to backend when enabled. */
  log(tag, msg, data) {
    if (!this._enabled) return;
    const text = data !== undefined ? msg + ' ' + JSON.stringify(data) : msg;
    console.log(`[${tag}] ${new Date().toISOString().slice(11, 23)} ${text}`);
    _remoteLog(tag, text);
  },

  /** Set time origin for detail flow tracking. */
  openDetail(id) {
    _detailT0 = Date.now();
    this.log('detail', 'time-origin', { id });
  },

  /** Milliseconds since detail open (0 if no origin set). */
  ms() {
    return _detailT0 ? Date.now() - _detailT0 : 0;
  },

  /** Capture key state at a point in time. */
  snapshot(label) {
    if (!this._enabled) return;
    const mc = document.querySelector('.main-content');
    const state = {
      view: typeof currentView !== 'undefined' ? currentView : '?',
      libraryScrollTop: typeof libraryScrollTop !== 'undefined' ? libraryScrollTop : '?',
      mcScrollTop: mc ? mc.scrollTop : '?',
      mcScrollHeight: mc ? mc.scrollHeight : '?',
      mcClientHeight: mc ? mc.clientHeight : '?',
      libraryDataLen: typeof libraryData !== 'undefined'
        ? (Array.isArray(libraryData) ? libraryData.length : typeof libraryData)
        : '?',
      libraryChangingView: typeof _libraryChangingView !== 'undefined' ? _libraryChangingView : '?'
    };
    console.log(
      '%c[SNAPSHOT]%c ' + label,
      'color:#bada55;font-weight:bold',
      'color:inherit',
      state
    );
  },

  /** Toggle on/off, persists to localStorage. */
  toggle() {
    this._enabled = !this._enabled;
    if (this._enabled) {
      localStorage.setItem(KEY, '1');
      console.log('%c[DEBUG] Diagnostic mode ON', 'color:lime;font-weight:bold');
    } else {
      localStorage.removeItem(KEY);
      console.log('%c[DEBUG] Diagnostic mode OFF', 'color:red;font-weight:bold');
    }
  }
};

// ─── Auto-enable from backend config (non-blocking, silent failure) ───
// Fires once at module load. If backend config has debugDetailFlow enabled,
// also enables __debug (localStorage gate is bypassed).
fetch('/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
  if (cfg && cfg.debugDetailFlow) {
    __debug._enabled = true;
    console.log('%c[DEBUG] Auto-enabled via backend config (debugDetailFlow)', 'color:#bada55;font-weight:bold');
  }
}).catch(function () { /* offline / slow backend — ignore */ });

// Announce at load if already active
if (__debug._enabled) {
  console.log('%c[DEBUG] Diagnostic mode active — call __debug.toggle() to disable', 'color:#bada55');
}
