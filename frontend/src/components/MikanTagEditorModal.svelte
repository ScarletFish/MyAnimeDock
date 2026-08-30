<script>
  import { tr, isRegexValid } from '../lib/anime-utils.js';
  import { portal } from '../lib/portal.js';

  let {
    open = false,
    mode = 'include',
    tag = null,
    onSave,
    onDelete,
    onCancel,
  } = $props();

  let name = $state('');
  let regex = $state('');
  let pos = $state(null); // { x, y } | null = adjacent to settings
  let drag = $state(null); // { startX, startY, origX, origY } | null

  // 打开时定位到设置弹窗右侧
  $effect(() => {
    if (open) {
      name = tag?.name ?? '';
      regex = tag?.regex ?? '';
      const settingsModal = document.querySelector('#settingsModal .modal--settings');
      if (settingsModal) {
        const r = settingsModal.getBoundingClientRect();
        const editorW = 380;
        const gap = 12;
        if (r.right + gap + editorW <= window.innerWidth) {
          pos = { x: r.right + gap, y: r.top };
        } else {
          pos = { x: (window.innerWidth - editorW) / 2, y: (window.innerHeight - 300) / 2 };
        }
      } else {
        pos = { x: window.innerWidth / 2, y: window.innerHeight / 3 };
      }
    }
  });

  function onHandleDown(e) {
    e.preventDefault();
    const rect = e.target.closest('.mikan-tag-editor').getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top };
  }

  $effect(() => {
    if (!drag) return;
    function onMove(e) {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      pos = { x: drag.origX + dx, y: drag.origY + dy };
    }
    function onUp() { drag = null; }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  });

  // 点击 tag editor 外部关闭
  $effect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (!e.target.closest('.mikan-tag-editor')) onCancel?.();
    }
    setTimeout(() => document.addEventListener('pointerdown', onDocClick), 0);
    return () => document.removeEventListener('pointerdown', onDocClick);
  });

  const isNew = $derived(!tag);
  const title = $derived(
    isNew
      ? (mode === 'include' ? tr('mikan.newIncludeTag') : mode === 'exclude' ? tr('mikan.newExcludeTag') : tr('mikan.newLang'))
      : (mode === 'lang' ? tr('mikan.editLang') : tr('mikan.editTag'))
  );

  const regexInvalid = $derived(!isRegexValid(regex));
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal mikan-tag-editor"
    use:portal
    style={pos ? `left:${pos.x}px;top:${pos.y}px` : ''}
  >
    <div class="mikan-tag-editor-drag-handle" onpointerdown={onHandleDown}>
      <h3 class="mikan-tag-editor-title">{title}</h3>
      <svg class="mikan-tag-editor-drag-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>
    </div>

    <div class="form-group">
      <label for="mikanTagEditorName">{tr('settings.mikanTagName')}</label>
      <input
        id="mikanTagEditorName"
        type="text"
        placeholder={tr('mikan.tagNamePlaceholder')}
        bind:value={name}
      >
    </div>

    <div class="form-group">
      <label for="mikanTagEditorRegex">{tr('settings.mikanTagRegex')}</label>
      <input
        id="mikanTagEditorRegex"
        type="text"
        placeholder={tr('mikan.tagRegexPlaceholder')}
        bind:value={regex}
        class:invalid={regexInvalid}
      >
      {#if regexInvalid}
        <span class="field-error">{tr('settings.mikanTagInvalidRegex')}</span>
      {/if}
      <p class="form-hint" style="margin-top: var(--space-2)">{tr('settings.mikanTagRegexHint')}</p>
    </div>

    <div class="mikan-tag-editor-actions">
      <button class="btn btn-outline btn-sm" onclick={() => onCancel?.()}>{tr('common.cancel')}</button>
      {#if !isNew}
        <button class="btn btn-danger btn-sm" onclick={() => onDelete?.(tag.key)}>{tr('settings.mikanTagDelete')}</button>
      {/if}
      <button
        class="btn btn-primary btn-sm"
        disabled={regexInvalid}
        onclick={() => onSave?.({
          key: tag?.key ?? crypto.randomUUID(),
          name: name.trim(),
          regex: regex.trim(),
        })}
      >
        {tr('common.save')}
      </button>
    </div>
  </div>
{/if}

<style>
  .mikan-tag-editor {
    position: fixed;
    max-width: 380px;
    padding: var(--space-6);
    margin: 0;
    z-index: var(--z-toast);
    transform: none;
    transition: none;
  }
  .mikan-tag-editor-drag-handle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: grab;
    margin: calc(-1 * var(--space-6)) calc(-1 * var(--space-6)) var(--space-4);
    padding: var(--space-2) var(--space-6);
    border-bottom: 1px solid var(--border);
  }
  .mikan-tag-editor-drag-handle:active {
    cursor: grabbing;
  }
  .mikan-tag-editor-drag-icon {
    color: var(--fg-muted);
    flex-shrink: 0;
  }
  .mikan-tag-editor-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--fw-bold);
    color: var(--fg-primary);
    letter-spacing: -0.01em;
  }
  .mikan-tag-editor .form-group {
    margin-bottom: var(--space-4);
  }
  .mikan-tag-editor-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    margin-top: var(--space-5);
  }
</style>
