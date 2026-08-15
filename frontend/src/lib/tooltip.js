// Global Tooltip — styled replacement for native title attribute.
// Use data-tooltip="text" on any element → hover shows modern tooltip.
// Delay 500ms, fades in above the element, auto-positions.
// Side-effect module: import once to activate.

(function() {
  var el = document.createElement('div');
  el.id = 'globalTooltip';
  document.body.appendChild(el);

  var showTimer = null;
  var hideTimer = null;
  var current = null;

  // Mouse enter an element with data-tooltip
  document.addEventListener('mouseover', function(e) {
    var target = e.target.closest('[data-tooltip]');
    if (!target) { return; }
    if (target === current) { return; }

    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    current = target;

    // Store cursor position at entry (fixed, doesn't track movement)
    var entryX = e.clientX;
    var entryY = e.clientY;

    showTimer = setTimeout(function() {
      // Rich tooltip: multiline wrapped text (data-tooltip-rich), else single-line
      var rich = target.hasAttribute('data-tooltip-rich');
      el.classList.toggle('is-rich', rich);
      el.textContent = target.getAttribute('data-tooltip');
      position(entryX, entryY);
      el.classList.remove('is-exiting');
      el.classList.add('is-visible');
    }, 500);
  });

  // Mouse leave → hide
  document.addEventListener('mouseout', function(e) {
    var target = e.target.closest('[data-tooltip]');
    if (!target) { return; }
    if (target !== current && !target.contains(current)) { return; }

    clearTimeout(showTimer);
    current = null;
    hideTimer = setTimeout(function() {
      el.classList.add('is-exiting');
      el.classList.remove('is-visible');
    }, 80);
  });

  // Scroll → hide (prevents stuck tooltip)
  document.addEventListener('scroll', function() {
    if (el.classList.contains('is-visible')) {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      current = null;
      el.classList.add('is-exiting');
      el.classList.remove('is-visible');
    }
  }, true);

  function position(cx, cy) {
    var tw = el.offsetWidth || 0;
    var th = el.offsetHeight || 30;
    var gap = 10;
    // Default: below-right of cursor
    var left = cx + gap;
    var top = cy + gap + 4;

    // Flip left if would overflow right edge
    if (tw && left + tw > window.innerWidth - 6) {
      left = cx - tw - gap;
    }
    // Flip above if would overflow bottom edge
    if (top + th > window.innerHeight - 6) {
      top = cy - th - gap;
    }
    // Protect left/top edges
    left = Math.max(6, left);
    top = Math.max(6, top);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }
})();

// ─── Sidebar floating tooltip ───
(function() {
  var tip = document.getElementById('sidebarTooltip');
  if (!tip) return;
  var textEl = document.getElementById('sidebarTooltipText');
  var btns = document.querySelectorAll('.sidebar-brand, .sidebar-nav .nav-btn, .sidebar-bottom .nav-btn');
  var hideTimer = null;
  var showTimer = null;

  function showTip(btn) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    var label = btn.getAttribute('data-tip');
    if (!label) return;
    textEl.textContent = label;
    var br = btn.getBoundingClientRect();
    tip.style.top = (br.top + br.height / 2) + 'px';
    tip.classList.add('is-visible');
  }

  function scheduleShow(btn) {
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(function() { showTip(btn); }, 400);
  }

  function cancelShow() {
    if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  }

  function hideTip() {
    cancelShow();
    hideTimer = setTimeout(function() {
      tip.classList.remove('is-visible');
    }, 120);
  }

  btns.forEach(function(btn) {
    btn.addEventListener('mouseenter', function() { scheduleShow(btn); });
    btn.addEventListener('mouseleave', hideTip);
  });

  tip.addEventListener('mouseenter', function() {
    cancelShow();
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  });
  tip.addEventListener('mouseleave', hideTip);
})();
