// ─── UI Component Factories ───

// Sort Dropdown — trigger button + dropdown menu + click-outside close
// Usage: const dd = createDropdown({ containerId, options, storageKey, onSelect })
//   dd.current  → read/write current selection
//   dd.render() → re-render
function createDropdown({ containerId, options, storageKey, onSelect }) {
  let current = localStorage.getItem(storageKey) || options[0].key;
  let isOpen = false;
  const containerIdSel = '#' + containerId;

  function toggle() {
    isOpen = !isOpen;
    setTimeout(render, 0);
  }

  function select(key) {
    current = key;
    localStorage.setItem(storageKey, key);
    isOpen = false;
    render();
    if (onSelect) onSelect(key);
  }

  function render() {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML =
      '<button class="library-sort-trigger' + (isOpen ? ' open' : '') + '" onclick="window.__dd_' + containerId + '.toggle()">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M6 12h12M9 18h6"/></svg>' +
      '</button>' +
      '<div class="library-sort-menu' + (isOpen ? ' open' : '') + '">' +
        options.map(function(o) {
          return '<div class="library-sort-option' + (o.key === current ? ' active' : '') + '" onclick="window.__dd_' + containerId + '.select(\'' + o.key + '\')">' + o.label + '</div>';
        }).join('') +
      '</div>';
  }

  // Click outside: close
  document.addEventListener('click', function(e) {
    if (!isOpen) return;
    if (e.target.closest(containerIdSel)) return;
    isOpen = false;
    render();
  });

  // Expose global for inline onclick
  window['__dd_' + containerId] = { toggle: toggle, select: select };

  return {
    get current() { return current; },
    set current(v) { current = v; localStorage.setItem(storageKey, v); render(); },
    render: render,
    toggle: toggle,
    select: select
  };
}

// Filter Bar — row of toggle buttons with active state
// Usage: const bar = createFilterBar({ container, options, initial, onChange })
//   bar.current  → read/write current filter
//   bar.render() → re-render active states
function createFilterBar({ container, options, initial, onChange }) {
  var el = typeof container === 'string' ? document.querySelector(container) : container;
  var current = initial || options[0].key;

  function set(key) {
    current = key;
    render();
    if (onChange) onChange(key);
  }

  function render() {
    if (!el) return;
    el.querySelectorAll('[data-filter]').forEach(function(btn) {
      btn.classList.toggle('filter-btn--active', btn.dataset.filter === current);
    });
  }

  // Bind click handlers
  if (el) {
    el.querySelectorAll('[data-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() { set(btn.dataset.filter); });
    });
  }

  return {
    get current() { return current; },
    set current(v) { current = v; render(); },
    set: set,
    render: render
  };
}
