<script module>
  // ─── KbdHelp（Svelte 迁移）───
  // 键盘快捷键帮助浮层。原为 index.html 手写 HTML + keyboard.js 切 .hidden。
  // 迁移为 store 驱动组件：keyboard.js 通过 kbdHelpOpen store 开关。
  // 用 tr() 而非 data-i18n，因 bindDom() 在启动时先于本组件渲染执行。
  import { writable } from 'svelte/store';

  // 跨组件开关：keyboard.js 的 toggleHelp/showHelp/hideHelp 读写此 store
  export const kbdHelpOpen = writable(false);
</script>

<script>
  import { tr } from '../lib/anime-utils.js';
</script>

{#if $kbdHelpOpen}
  <div class="kbd-help-overlay" onclick={(e) => { if (e.target === e.currentTarget) kbdHelpOpen.set(false); }}>
    <div class="kbd-help__card">
      <h2 class="kbd-help__title">{tr('kbd.title')}</h2>
      <div class="kbd-help__grid">
        <div class="kbd-help__row"><kbd>1</kbd><span>{tr('kbd.discovery')}</span></div>
        <div class="kbd-help__row"><kbd>2</kbd><span>{tr('kbd.library')}</span></div>
        <div class="kbd-help__row"><kbd>3</kbd><span>{tr('kbd.mylist')}</span></div>
        <div class="kbd-help__row"><kbd>4</kbd><span>{tr('kbd.stats')}</span></div>
        <div class="kbd-help__row"><kbd>/</kbd><span>{tr('common.search')}</span></div>
        <div class="kbd-help__row"><kbd>?</kbd><span>{tr('kbd.help')}</span></div>
        <div class="kbd-help__row"><kbd>Esc</kbd><span>{tr('kbd.closeBack')}</span></div>
      </div>
      <p class="kbd-help__hint">{tr('kbd.clickToClose')}</p>
    </div>
  </div>
{/if}