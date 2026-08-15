// Modal bridge — closeModal + overlay click/Escape delegation.
// Kept temporarily for theme.js (closeModal('settingsModal')).
// Will be deleted after theme.js migration.

window.closeModal = function closeModal(el) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el || typeof el.classList !== 'object') return;
  el.classList.remove('show');
  document.body.style.overflow = '';
  if (el._onClose) {
    const cb = el._onClose;
    el._onClose = null;
    cb();
  }
};

// Auto-init: overlay click + Escape key delegation
(function() {
  // Overlay click: close modal when clicking overlay background
  document.addEventListener('click', function(e) {
    var overlay = e.target.closest('.modal-overlay');
    if (overlay && e.target === overlay) {
      closeModal(overlay);
    }
  });
  // Escape key: close topmost open modal
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var openModals = document.querySelectorAll('.modal-overlay.show');
      if (openModals.length > 0) {
        closeModal(openModals[openModals.length - 1]);
      }
    }
  });
})();
