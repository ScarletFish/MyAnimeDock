<script module>
  // ─── Onboarding 打开开关 store（跨组件通信）───
  // main.js 桥接 window.showOnboarding → onboardingOpen.set(true)。
  import { writable } from 'svelte/store';

  export const onboardingOpen = writable(false);
</script>

<script>
  // ─── Onboarding（首启引导，fixed overlay）───
  // 由 vanilla onboarding.js 迁移而来，复用现有 onboarding.css 类名，视觉零变化。
  // 初始 class:hidden 避免首屏闪现；configCache 刷新已丢弃（无消费者）。
  import { showToast } from './Toast.svelte';

  // i18n 辅助：现有全局 t() 可用则用之，否则回退文案
  function tr(key, fallback) {
    return typeof globalThis.t === 'function' ? globalThis.t(key) : fallback;
  }

  // ─── 自包含 API 封装（不复用全局 API）───
  const api = {
    async post(url, data) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };

  // ─── 状态 ───
  let mediaDir = $state('');
  let mpvPath = $state('');
  let errorMsg = $state('');
  let submitting = $state(false);
  let dirSkipped = $state(false);
  let mpvSkipped = $state(false);

  // ─── 浏览按钮 ───
  async function browseDir() {
    try {
      const selected = await window.openDialog({
        directory: true,
        multiple: false,
        title: tr('onboarding.selectMediaDir'),
      });
      if (selected) {
        mediaDir = selected;
      } else if (!window.__TAURI__) {
        showToast(tr('onboarding.browserManualPath'), 'info');
      }
    } catch (e) {
      showToast(tr('onboarding.selectDirFailed') + ': ' + e.message, 'error');
    }
  }

  async function browseMpv() {
    try {
      const selected = await window.openDialog({
        multiple: false,
        title: tr('onboarding.selectMpvFile'),
        filters: [{ name: tr('onboarding.executableFile'), extensions: ['exe', 'com'] }],
      });
      if (selected) {
        mpvPath = selected;
      } else if (!window.__TAURI__) {
        showToast(tr('onboarding.browserManualPath'), 'info');
      }
    } catch (e) {
      showToast(tr('onboarding.selectFileFailed') + ': ' + e.message, 'error');
    }
  }

  // ─── 跳过链接 ───
  function skipDir(e) {
    e.preventDefault();
    dirSkipped = true;
  }
  function skipMpv(e) {
    e.preventDefault();
    mpvSkipped = true;
  }

  // ─── 提交 ───
  async function onSubmit() {
    submitting = true;
    errorMsg = '';

    const dir = mediaDir.trim();
    const mpv = mpvPath.trim();

    try {
      // 保存已填内容（空值 = 保持默认）
      const payload = {};
      if (dir) payload.mediaDir = dir;
      if (mpv) payload.mpvPath = mpv;

      if (dir || mpv) {
        await api.post('/api/config', payload);
      }

      // 关闭引导
      onboardingOpen.set(false);

      // 进入发现页进行首次扫描
      if (typeof window.showView === 'function') window.showView('discovery');
    } catch (e) {
      errorMsg = e.message || tr('onboarding.saveConfigFailed');
      submitting = false;
    }
  }
</script>

<div id="onboardingOverlay" class="onboarding-overlay" class:hidden={!$onboardingOpen}>
  <div class="onboarding__card">
    <div class="onboarding__header">
      <svg class="onboarding__icon" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="12" width="32" height="28" rx="4" stroke="currentColor" stroke-width="2"/>
        <circle cx="24" cy="28" r="6" stroke="currentColor" stroke-width="2"/>
        <path d="M24 16V22M24 34V40" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M16 30L20 28M28 28L32 30" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M14 12V8H34V12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <h1 class="onboarding__title">{tr('onboarding.welcome')}</h1>
      <p class="onboarding__desc">{tr('onboarding.desc')}</p>
    </div>
    <div class="onboarding__body">
      <div class="onb-field" id="onbDirGroup" class:onb-field--skipped={dirSkipped}>
        <label class="onb-field__label">{tr('onboarding.mediaDir')}</label>
        <div class="onb-field__row">
          <input type="text" class="onb-field__input" id="onbMediaDir" bind:value={mediaDir} placeholder={tr('onboarding.mediaDirPlaceholder')} autocomplete="off" spellcheck="false" />
          <button class="onb-field__browse" id="onbBrowseDir" onclick={browseDir}>{tr('common.browse')}</button>
        </div>
        <div class="onb-field__foot">
          <button type="button" class="onb-field__skip" id="onbSkipDir" onclick={skipDir}>{tr('onboarding.skipForNow')}</button>
        </div>
      </div>
      <div class="onb-field" id="onbMpvGroup" class:onb-field--skipped={mpvSkipped}>
        <label class="onb-field__label"><span>{tr('onboarding.mpvPlayer')}</span><span class="onb-field__optional">{tr('common.optional')}</span></label>
        <div class="onb-field__row">
          <input type="text" class="onb-field__input" id="onbMpvPath" bind:value={mpvPath} placeholder={tr('onboarding.mpvPlaceholder')} autocomplete="off" spellcheck="false" />
          <button class="onb-field__browse" id="onbBrowseMpv" onclick={browseMpv}>{tr('common.browse')}</button>
        </div>
        <div class="onb-field__foot">
          <button type="button" class="onb-field__skip" id="onbSkipMpv" onclick={skipMpv}>{tr('onboarding.skipForNow')}</button>
        </div>
      </div>
      <div class="onb-error" id="onbError" class:hidden={!errorMsg}>{errorMsg}</div>
      <button class="onb-submit" id="onbStart" onclick={onSubmit} disabled={submitting}>{submitting ? tr('onboarding.configuring') : tr('onboarding.start')}</button>
    </div>
  </div>
</div>