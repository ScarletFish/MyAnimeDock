// Global keyboard navigation — number keys, /, ?, Esc
// ES module：模块级副作用在 import 时执行（等价原 IIFE 自初始化）。
import { focusSearch } from '../components/chrome/SearchBar.svelte';

const helpOverlay = document.getElementById('kbdHelpOverlay');

export function toggleHelp() {
  if (!helpOverlay) return;
  if (helpOverlay.classList.contains('hidden')) {
    showHelp();
  } else {
    hideHelp();
  }
}

export function showHelp() {
  if (!helpOverlay) return;
  helpOverlay.classList.remove('hidden');
}

export function hideHelp() {
  if (!helpOverlay) return;
  helpOverlay.classList.add('hidden');
}

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
        focusSearch();
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

// Close help on overlay click
if (helpOverlay) {
  helpOverlay.addEventListener('click', function (e) {
    if (e.target === helpOverlay) hideHelp();
  });
}