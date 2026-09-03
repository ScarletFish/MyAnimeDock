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

// ─── 窗口就绪信号（顶层注册，避免 Library 先派发导致监听器未就位的竞态）───
// 关键：app-ready 的监听必须在这里（任何 await / showView 之前）同步注册，
// 否则 Library 首帧派发 app:library-ready 时会被错过 → app-ready 永不发射 → 3s 兜底。
// configCache 由下方 async IIFE 填充，emit 时才读取（顶层注册时尚未可用，惰性取）。
// 用 { once: true }：该事件只消费一次（Library 数据刷新重派发时不再重复发 app-ready）。
let __configCache = null;
const __isTauri = !!window.__TAURI__?.event;

// 启动页（splash）：仅 Tauri 上下文显示（窗口隐藏期作占位/兜底）；
// 浏览器 dev 无隐藏窗口，直接移除，避免 splash 遮住首屏等数据。
const __splash = document.getElementById('splash');
const __hideSplash = () => {
  if (!__splash || __splash.classList.contains('is-hidden')) return;
  __splash.classList.add('is-hidden');
  setTimeout(() => __splash.remove(), 320); // 等 opacity 过渡结束后移除 DOM
};
if (!__isTauri) {
  __splash?.remove();
} else {
  // Tauri：等 library-ready 后淡出；8s 兜底强移，防卡死
  setTimeout(__hideSplash, 8000);
}

// 统一监听 app:library-ready（顶层，先于任何派发而存在；once 只消费一次）
window.addEventListener('app:library-ready', () => {
  __hideSplash();
  if (!__isTauri) return;
  if (window.__TAURI__?.event?.emit) {
    window.__TAURI__.event
      .emit('app-ready', { startupFullscreen: !!__configCache?.startupFullscreen })
      .catch(() => {});
  }
}, { once: true });

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

  // 窗口就绪信号已由顶层统一注册（见 main.js 顶部），此处仅把 configCache 交给
  // 顶层 emit 回调惰性读取（startupFullscreen 载荷）。app-ready 等 Library 数据
  // 就绪（首屏渲染完成）后再发，避免窗口显示瞬间还是骨架屏。
  __configCache = configCache;

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