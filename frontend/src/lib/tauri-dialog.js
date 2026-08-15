// Tauri native file/directory dialog wrapper
// Provides openDialog(options) → Promise<string|string[]|null>
// Falls back gracefully when not in Tauri environment.

export async function openDialog(options) {
  // Tauri v2 withGlobalTauri: plugin API 挂载在 __TAURI__.dialog
  if (window.__TAURI__?.dialog?.open) {
    return await window.__TAURI__.dialog.open(options);
  }
  // 回退：core.invoke（Tauri v2 plugin 命名规则用竖线分隔）
  if (window.__TAURI__?.core?.invoke) {
    return await window.__TAURI__.core.invoke('plugin:dialog|open', options);
  }
  if (window.__TAURI__?.invoke) {
    return await window.__TAURI__.invoke('plugin:dialog|open', options);
  }
  return null;
}

// Bridge: Onboarding.svelte and other vanilla callers use window.openDialog
window.openDialog = openDialog;
