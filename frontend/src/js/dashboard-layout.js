// Dashboard layout — temporary bridge for applyDetailTitleBg
// Will be moved to lib/theme.js in Phase 2.

function applyDetailTitleBg() {
  var on = localStorage.getItem('myAnimDock_detailTitleBg') === 'on';
  document.documentElement.setAttribute('data-detail-title-bg', on ? 'on' : '');
}

window.applyDetailTitleBg = applyDetailTitleBg;
