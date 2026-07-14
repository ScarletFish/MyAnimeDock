/**
 * Debug diagnostic system.
 * Zero production impact when disabled.
 *
 * Usage:
 *   __debug.toggle()                    // Enable/disable via localStorage
 *   __debug.log('TAG', 'message', data)
 *   __debug.snapshot('showView: → library')  // State snapshot
 *   __debug.enabled = true             // Enable for this session only
 *
 * Persisted: localStorage.getItem('debug') === '1'
 */
(function () {
  var KEY = 'myanimedock_debug';

  window.__debug = {
    _enabled: localStorage.getItem(KEY) === '1',

    get enabled() { return this._enabled; },
    set enabled(v) {
      this._enabled = !!v;
      if (!v) localStorage.removeItem(KEY);
    },

    /** Tagged console.log — single source, easy to grep. */
    log: function (tag) {
      if (!window.__debug._enabled) return;
      var args = Array.prototype.slice.call(arguments, 1);
      console.log.apply(console, ['[' + tag + '] ' + new Date().toISOString().slice(11, 23)].concat(args));
    },

    /** Capture key state at a point in time. */
    snapshot: function (label) {
      if (!window.__debug._enabled) return;
      var mc = document.querySelector('.main-content');
      var state = {
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
      console.log.apply(console, [
        '%c[SNAPSHOT]%c ' + label,
        'color:#bada55;font-weight:bold',
        'color:inherit'
      ].concat([state]));
    },

    /** Toggle on/off, persists to localStorage. */
    toggle: function () {
      window.__debug._enabled = !window.__debug._enabled;
      if (window.__debug._enabled) {
        localStorage.setItem(KEY, '1');
        console.log('%c[DEBUG] Diagnostic mode ON', 'color:lime;font-weight:bold');
      } else {
        localStorage.removeItem(KEY);
        console.log('%c[DEBUG] Diagnostic mode OFF', 'color:red;font-weight:bold');
      }
    }
  };

  // Announce at load if already active
  if (window.__debug._enabled) {
    console.log('%c[DEBUG] Diagnostic mode active — call __debug.toggle() to disable', 'color:#bada55');
  }
})();
