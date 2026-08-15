// Toast 桥接层 —— 复用 Svelte 版 Toast.svelte 的实现。
// 迁移期间 vanilla JS（app.js/onboarding.js）仍调用 window.showToast，
// 这里转发到 Svelte 组件，避免双容器。待 vanilla JS 全部迁移后删除本文件。
import { showToast, dismissToast } from '../components/Toast.svelte';

window.showToast = showToast;
window.dismissToast = dismissToast;