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

  // 打开时根据传入 tag 重置字段
  $effect(() => {
    if (open) {
      name = tag?.name ?? '';
      regex = tag?.regex ?? '';
    }
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
  <div class="modal-overlay show" use:portal onclick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
    <div class="modal mikan-tag-editor">
      <h3 class="mikan-tag-editor-title">{title}</h3>

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
  </div>
{/if}

<style>
  .mikan-tag-editor {
    max-width: 380px;
    padding: var(--space-6);
  }
  .mikan-tag-editor-title {
    margin: 0 0 var(--space-4);
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
