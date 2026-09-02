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
import { setStartupLibraryPromise } from './lib/ui-state.js';
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
  // 首屏并行：/api/library 不依赖 /api/config，立即发起（Library 首次加载时消费）。
  const startupLibrary = API.get('/api/library');
  startupLibrary.catch(() => {}); // 未被消费时避免 unhandled rejection（消费方仍会收到错误）
  setStartupLibraryPromise(startupLibrary);

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

  // 通知 Tauri 窗口可以显示了（窗口先隐藏，页面就绪后再显示，避免启动闪烁）。
  // 启动模式偏好（最大化）随 payload 传给 Rust：Rust 在 show() 前同步 maximize。
  // 本应用是自绘标题栏（decorations(false)），"全屏"= 最大化（占满工作区、保留
  // 原生可缩放/还原），而非传统独占全屏；隐藏窗口期异步调 maximize 在 show 时会失效。
  //
  // 时序约定：app-ready 等 Library 数据就绪信号（首屏渲染完成后）再发，
  // 避免窗口显示瞬间还是骨架屏。列数是纯函数（--card-w 设计常量 + 容器宽），
  // 不依赖窗口尺寸时序——窗口先被最大化到 2K 也不会影响任何测量锚定，
  // 因此无需其它协调。（旧 hscroll-auto-cols 锚定链已删除）
  if (window.__TAURI__?.event?.emit) {
    let readyFired = false;
    window.addEventListener('app:library-ready', () => {
      if (readyFired) return;
      readyFired = true;
      window.__TAURI__.event
        .emit('app-ready', { startupFullscreen: !!configCache?.startupFullscreen })
        .catch(() => {});
    });
  }

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