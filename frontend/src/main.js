import { mount } from 'svelte';
import App from './App.svelte';
import Chrome from './components/chrome/Chrome.svelte';
import Sidebar from './components/Sidebar.svelte';
import { onboardingOpen } from './components/Onboarding.svelte';
import { showToast } from './components/Toast.svelte';
import { loadTheme, loadReduceMotion, applyZoom, applyDetailTitleBg } from './lib/theme.js';
import { showView } from './lib/router.js';
import { startGlobalMpvStatus } from './lib/mpv-status.js';
import { initI18n, bindDom } from './lib/i18n.js';
import { API } from './lib/api.js';
import { refreshBangumiAuthStatus } from './views/Settings.svelte';
import './lib/tooltip.js';
import './lib/keyboard.js';
import './lib/tauri-dialog.js';

// ─── i18n 初始化（必须在其他模块使用 t() 之前）───
initI18n();

const app = mount(App, {
  target: document.getElementById('app'),
});

// ─── Chrome 挂载：titlebar + onboarding（body 第一个子级 #chrome）───
// 与 App 并列，独立挂载点，互不影响。
mount(Chrome, {
  target: document.getElementById('chrome'),
});

// ─── Sidebar 挂载：body-wrapper 内 #sidebar 挂载点 ───
mount(Sidebar, {
  target: document.getElementById('sidebar'),
});

// ─── i18n DOM 绑定（替换 [data-i18n] 和 [data-i18n-attr]）───
bindDom();

// ─── Init (DOM already ready — modules are deferred) ───
(async () => {
  let configCache = null;
  const onServerOrigin = window.location.origin.startsWith('http');
  if (onServerOrigin) {
    try {
      configCache = await API.get('/api/config');
      const ai = configCache?.autoImport || {};
      if (ai.count > 0) {
        showToast(ai.message, 'success');
      } else if (!ai.done) {
        (async function pollStartupNotifs() {
          for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 1500));
            try {
              const resp = await API.get('/api/notifications');
              const notifs = resp.notifications || [];
              for (const n of notifs) {
                if (n.type === 'auto_import') {
                  showToast(n.message, 'success');
                  return;
                }
              }
            } catch (_) { return; }
          }
        })();
      }
    } catch (_) {}
  }
  loadTheme(configCache);
  loadReduceMotion(configCache);
  applyZoom(configCache?.uiScale || 1);
  applyDetailTitleBg();
  showView('library');
  startGlobalMpvStatus();

  if (configCache?.firstRun) {
    onboardingOpen.set(true);
  }

  // Handle Bangumi OAuth redirect result
  const params = new URLSearchParams(window.location.search);
  const authResult = params.get('bangumi_auth');
  if (authResult === 'success') {
    showToast(t('app.bangumiBindSuccessRedirect'), 'success');
    refreshBangumiAuthStatus();
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'denied') {
    showToast(t('app.bangumiAuthDenied'), 'error');
    window.history.replaceState({}, '', window.location.pathname);
  } else if (authResult === 'error') {
    const errMsg = params.get('bangumi_auth_msg') || t('app.authRedirectMsgError');
    showToast(t('app.bangumiBindFailed', { error: errMsg }), 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

export default app;