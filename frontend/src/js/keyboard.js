// Global keyboard navigation — number keys, /, ?, Esc
(function () {
  'use strict';

  var helpOverlay = document.getElementById('kbdHelpOverlay');
  var searchInput = document.getElementById('globalSearchInput');

  document.addEventListener('keydown', function (e) {
    // Skip when focus is in an editable element
    var tag = (document.activeElement || {}).tagName || '';
    var editable = document.activeElement && document.activeElement.getAttribute('contenteditable') === 'true';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) {
      // Allow Esc to close modals / help even in inputs
      if (e.key !== 'Escape') return;
    }

    switch (e.key) {
      case '1':
        e.preventDefault();
        showView('discovery');
        break;
      case '2':
        e.preventDefault();
        showView('library');
        break;
      case '3':
        e.preventDefault();
        showView('mylist');
        break;
      case '4':
        e.preventDefault();
        showView('stats');
        break;
      case '/':
        // Only activate when not already typing in an input
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          if (searchInput) { searchInput.focus(); searchInput.select(); }
        }
        break;
      case '?':
        e.preventDefault();
        toggleHelp();
        break;
      case 'Escape':
        if (helpOverlay && !helpOverlay.classList.contains('hidden')) {
          e.preventDefault();
          hideHelp();
        }
        break;
    }
  });

  function toggleHelp() {
    if (!helpOverlay) return;
    if (helpOverlay.classList.contains('hidden')) {
      showHelp();
    } else {
      hideHelp();
    }
  }

  function showHelp() {
    if (!helpOverlay) return;
    helpOverlay.classList.remove('hidden');
  }

  function hideHelp() {
    if (!helpOverlay) return;
    helpOverlay.classList.add('hidden');
  }

  // Close help on overlay click
  if (helpOverlay) {
    helpOverlay.addEventListener('click', function (e) {
      if (e.target === helpOverlay) hideHelp();
    });
  }
})();
