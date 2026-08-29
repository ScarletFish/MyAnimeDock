<script>
  import { onMount } from 'svelte';
  import { showToast } from './Toast.svelte';
  import { tr, isRegexValid } from '../lib/anime-utils.js';
  import { API as api } from '../lib/api.js';
  import { Select } from 'bits-ui';
  import MikanTagEditorModal from './MikanTagEditorModal.svelte';

  let {
    resources = [],
    subgroup = null,
    anime = null,
    bangumiDetail = null,
    onPreview = null,
    onConfirm = null,
    onCancel = null,
  } = $props();

  let selectedLangs = $state(new Set(['simplified']));
  let excludedLangs = $state(new Set());
  let selectedTags = $state(new Set(['halfEpisode']));
  let subscribing = $state(false);
  let config = $state(null);
  let addDdOpen = $state(false);
  let excludeDdOpen = $state(false);
  let editorOpen = $state(false);
  let editorMode = $state('include');

  let manualMust = $state('');
  let manualExclude = $state('');

  const DEFAULT_LANG_OPTIONS = [
    { key: 'simplified', label: '简', bit: 1, regex: '简|CHS|GB|简体|简中' },
    { key: 'traditional', label: '繁', bit: 2, regex: '繁|CHT|BIG5|繁体|繁中' },
    { key: 'japanese', label: '日', bit: 4, regex: '日|JPN' },
  ];
  let langOptions = $derived(config?.mikanLangOptions || DEFAULT_LANG_OPTIONS);
  const LANG_COMPOUNDS = [
    { name: '简日', mask: 1 | 4 },
    { name: '繁日', mask: 2 | 4 },
    { name: '简繁日', mask: 1 | 2 | 4 },
  ];

  let tagLibrary = $derived(config?.mikanTagLibrary || { include: [], exclude: [] });
  let includeTags = $derived(tagLibrary.include);
  let excludeTags = $derived(tagLibrary.exclude);

  let availableIncludeOptions = $derived(
    includeTags.filter(t => !selectedTags.has(t.key))
  );

  let availableExcludeOptions = $derived(
    excludeTags.filter(t => !selectedTags.has(t.key))
  );

  let availableExcludeLangOptions = $derived(
    langOptions.filter(l => !excludedLangs.has(l.key))
  );

  let langMask = $derived(
    langOptions.filter(l => selectedLangs.has(l.key)).reduce((m, l) => m | l.bit, 0)
  );

  let excludedLangMask = $derived(
    langOptions.filter(l => excludedLangs.has(l.key)).reduce((m, l) => m | l.bit, 0)
  );

  let mustContain = $derived.by(() => {
    const parts = [];
    if (langMask) {
      const chars = [];
      for (const l of langOptions) {
        if (selectedLangs.has(l.key)) chars.push(l.regex);
      }
      if (chars.length === 1) {
        parts.push(chars[0]);
      } else {
        parts.push(chars.map(c => `(?=.*(?:${c}))`).join(''));
      }
    }
    for (const t of includeTags) {
      if (selectedTags.has(t.key)) parts.push(t.regex);
    }
    if (manualMust.trim()) parts.push(manualMust.trim());
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.map(p => `(?=.*(?:${p}))`).join('');
  });

  let mustNotContain = $derived.by(() => {
    const parts = [];
    if (excludedLangMask) {
      for (const l of langOptions) {
        if (excludedLangs.has(l.key)) parts.push(l.regex);
      }
    }
    for (const t of excludeTags) {
      if (selectedTags.has(t.key)) parts.push(t.regex);
    }
    if (manualExclude.trim()) parts.push(manualExclude.trim());
    return parts.join('|');
  });

  let containTokens = $derived.by(() => {
    const t = [];
    if (langMask) {
      for (const l of langOptions) {
        if (selectedLangs.has(l.key)) t.push(l.regex);
      }
    }
    for (const tag of includeTags) if (selectedTags.has(tag.key)) t.push(tag.regex);
    if (manualMust.trim()) t.push(manualMust.trim());
    return t;
  });

  let notContainTokens = $derived.by(() => {
    const t = [];
    if (excludedLangMask) {
      for (const l of langOptions) {
        if (excludedLangs.has(l.key)) t.push(l.regex);
      }
    }
    for (const tag of excludeTags) if (selectedTags.has(tag.key)) t.push(tag.regex);
    if (manualExclude.trim()) t.push(manualExclude.trim());
    return t;
  });

  const manualMustValid = $derived(manualMust.trim() === '' || isRegexValid(manualMust.trim()));
  const manualExcludeValid = $derived(manualExclude.trim() === '' || isRegexValid(manualExclude.trim()));
  const manualValid = $derived(manualMustValid && manualExcludeValid);

  function buildSegments(name, re, type) {
    if (!re) return [{ text: name, type: 'normal' }];
    const segs = [];
    let last = 0;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(name)) !== null) {
      if (m.index > last) segs.push({ text: name.slice(last, m.index), type: 'normal' });
      segs.push({ text: m[0], type });
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++; // guard zero-width
    }
    if (last < name.length) segs.push({ text: name.slice(last), type: 'normal' });
    return segs.length ? segs : [{ text: name, type: 'normal' }];
  }

  let preview = $derived.by(() => {
    if (!resources.length) return { matched: [], excluded: [], unmatched: [], total: 0, segments: new Map(), hasFilter: false };

    const containRe = mustContain ? new RegExp(mustContain, 'i') : null;
    const notContainRe = mustNotContain ? new RegExp(mustNotContain, 'i') : null;

    const segContainRe = containTokens.length ? new RegExp(containTokens.join('|'), 'gi') : null;
    const segNotContainRe = notContainTokens.length ? new RegExp(notContainTokens.join('|'), 'gi') : null;

    const matched = [], excluded = [], unmatched = [];
    const segmentsMap = new Map();
    for (const r of resources) {
      const name = r.name;
      if (notContainRe && notContainRe.test(name)) {
        excluded.push(r);
        segmentsMap.set(r, buildSegments(name, segNotContainRe, 'excluded'));
        continue;
      }
      if (!containRe || containRe.test(name)) {
        matched.push(r);
        segmentsMap.set(r, segContainRe ? buildSegments(name, segContainRe, 'matched') : [{ text: name, type: 'normal' }]);
        continue;
      }
      unmatched.push(r);
      segmentsMap.set(r, [{ text: name, type: 'normal' }]);
    }
    return { matched, excluded, unmatched, total: resources.length, segments: segmentsMap, hasFilter: !!(mustContain || mustNotContain) };
  });

  $effect(() => {
    if (onPreview) onPreview(preview);
  });

  onMount(async () => {
    try {
      config = await api.get('/api/config');
      const langKeys = new Set((config?.mikanLangOptions || DEFAULT_LANG_OPTIONS).map((l) => l.key));
      const req = config?.mikanDefaultRequired || ['simplified'];
      const excl = config?.mikanDefaultExcluded || ['halfEpisode', 'raw', 'lowRes480p'];
      // 语言 key 归入语言集合；其余归入 Tag 集合。悬空 key（如手改配置删了被引用项）
      // 由渲染处 includeTags/excludeTags.find 守卫自然忽略，不显示也不影响正则。
      selectedTags = new Set([...req, ...excl].filter((k) => !langKeys.has(k)));
      selectedLangs = new Set(req.filter((k) => langKeys.has(k)));
      excludedLangs = new Set(excl.filter((k) => langKeys.has(k)));
    } catch {}
    const gsap = globalThis.gsap;
    if (!gsap) return;
    gsap.fromTo('.mikan-panel', { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.25, ease: 'power2.out' });
  });

  function toggleLang(key) {
    const next = new Set(selectedLangs);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selectedLangs = next;
  }

  function toggleExcludeLang(key) {
    const next = new Set(excludedLangs);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    excludedLangs = next;
  }

  function toggleTag(key) {
    const next = new Set(selectedTags);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selectedTags = next;
  }

  function onIncludeSelect(val) {
    if (val === '__new__') { editorMode = 'include'; editorOpen = true; return; }
    if (val) selectedTags = new Set([...selectedTags, val]);
  }

  function onExcludeSelect(val) {
    if (val === '__new__') { editorMode = 'exclude'; editorOpen = true; return; }
    if (!val) return;
    const lang = langOptions.find(l => l.key === val);
    if (lang) {
      excludedLangs = new Set([...excludedLangs, val]);
    } else {
      selectedTags = new Set([...selectedTags, val]);
    }
  }

  async function handleNewTag(data) {
    try {
      const lib = config?.mikanTagLibrary || { include: [], exclude: [] };
      const arr = (editorMode === 'include' ? lib.include : lib.exclude).slice();
      const i = arr.findIndex(t => t.key === data.key);
      if (i >= 0) arr[i] = data;
      else arr.push(data);
      const updated = {
        include: editorMode === 'include' ? arr : lib.include,
        exclude: editorMode === 'exclude' ? arr : lib.exclude,
      };
      await api.post('/api/config', { mikanTagLibrary: updated });
      config = { ...config, mikanTagLibrary: updated };
      selectedTags = new Set([...selectedTags, data.key]);
      editorOpen = false;
      showToast(tr('mikan.subscribed', { name: data.name }), 'success');
    } catch (e) {
      showToast(tr('mikan.subscribeFailed', { error: e.message }), 'error');
    }
  }

  async function confirm() {
    if (!anime || !subgroup) return;
    subscribing = true;
    try {
      await api.post('/api/mikan/subscribe', {
        animeId: anime.detailUrl,
        bgmId: bangumiDetail?.bgmId,
        name: bangumiDetail?.name,
        subgroupId: subgroup.id,
        subgroupName: subgroup.name,
        rssUrl: subgroup.rssUrl,
        mustContain: mustContain || undefined,
        mustNotContain: mustNotContain || undefined,
      });
      showToast(tr('mikan.subscribed', { name: subgroup.name }), 'success');
      if (onConfirm) onConfirm();
    } catch (e) {
      showToast(tr('mikan.subscribeFailed', { error: e.message }), 'error');
    } finally {
      subscribing = false;
    }
  }
</script>

<div class="mikan-panel">
  <button class="mikan-panel-back" onclick={onCancel} aria-label={tr('common.close')}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
    {subgroup?.name || ''}
  </button>

  <div class="mikan-panel-section">
    <div class="mikan-panel-section-label">{tr('mikan.mustContain')}</div>
    <div class="mikan-panel-tags">
      {#each langOptions as opt}
        <button class="tag-pill" class:active={selectedLangs.has(opt.key)} onclick={() => toggleLang(opt.key)}>
          {opt.label}
        </button>
      {/each}

      {#each [...selectedTags] as key}
        {@const tag = includeTags.find(t => t.key === key)}
        {#if tag}
          <button class="tag-pill" onclick={() => toggleTag(key)}>
            {tag.name}
            <svg class="tag-pill-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        {/if}
      {/each}

      {#if availableIncludeOptions.length > 0}
        <Select.Root type="single" bind:value={() => null, onIncludeSelect} bind:open={addDdOpen}>
          <Select.Trigger class="tag-pill tag-pill--add">+</Select.Trigger>
          <Select.Portal to="#modal-root">
            <Select.Content class="mikan-add-dd" side="bottom" sideOffset={4}>
              <Select.Item value="__new__" class="mikan-add-dd-item">{tr('mikan.newTag')}</Select.Item>
              {#each availableIncludeOptions as tag}
                <Select.Item value={tag.key} class="mikan-add-dd-item">{tag.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      {/if}
    </div>
    <div class="mikan-panel-manual">
      <input class="mikan-panel-manual-input" type="text" placeholder={tr('mikan.manualMustPlaceholder')} bind:value={manualMust} class:invalid={!manualMustValid} />
      {#if !manualMustValid}<span class="field-error">{tr('settings.mikanTagInvalidRegex')}</span>{/if}
    </div>
  </div>

  <div class="mikan-panel-section">
    <div class="mikan-panel-section-label">{tr('mikan.exclude')}</div>
    <div class="mikan-panel-tags">
      {#each [...excludedLangs] as key}
        {@const opt = langOptions.find(l => l.key === key)}
        {#if opt}
          <button class="tag-pill tag-pill--exclude" onclick={() => toggleExcludeLang(key)}>
            {opt.label}
            <svg class="tag-pill-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        {/if}
      {/each}

      {#each [...selectedTags] as key}
        {@const tag = excludeTags.find(t => t.key === key)}
        {#if tag}
          <button class="tag-pill tag-pill--exclude" onclick={() => toggleTag(key)}>
            {tag.name}
            <svg class="tag-pill-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        {/if}
      {/each}

      {#if availableExcludeLangOptions.length > 0 || availableExcludeOptions.length > 0}
        <Select.Root type="single" bind:value={() => null, onExcludeSelect} bind:open={excludeDdOpen}>
          <Select.Trigger class="tag-pill tag-pill--add">+</Select.Trigger>
          <Select.Portal to="#modal-root">
            <Select.Content class="mikan-add-dd" side="bottom" sideOffset={4}>
              <Select.Item value="__new__" class="mikan-add-dd-item">{tr('mikan.newTag')}</Select.Item>
              {#if availableExcludeLangOptions.length > 0}
                <Select.Group class="mikan-add-dd-group">
                  <div class="mikan-add-dd-label">{tr('mikan.lang')}</div>
                  {#each availableExcludeLangOptions as opt}
                    <Select.Item value={opt.key} class="mikan-add-dd-item">
                      {opt.label}
                    </Select.Item>
                  {/each}
                </Select.Group>
              {/if}
              {#if availableExcludeOptions.length > 0}
                {#each availableExcludeOptions as tag}
                  <Select.Item value={tag.key} class="mikan-add-dd-item">{tag.name}</Select.Item>
                {/each}
              {/if}
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      {/if}
    </div>
    <div class="mikan-panel-manual">
      <input class="mikan-panel-manual-input" type="text" placeholder={tr('mikan.manualExcludePlaceholder')} bind:value={manualExclude} class:invalid={!manualExcludeValid} />
      {#if !manualExcludeValid}<span class="field-error">{tr('settings.mikanTagInvalidRegex')}</span>{/if}
    </div>
  </div>

  <div class="mikan-panel-preview">
    {#if preview.total > 0}
      <span class="mikan-panel-preview-count">{preview.matched.length}/{preview.total}</span>
      {tr('mikan.matchCount')}
    {/if}
  </div>

  <div class="mikan-panel-footer">
    <button class="btn btn-outline btn-sm" onclick={onCancel}>{tr('common.cancel')}</button>
    <button class="btn btn-primary btn-sm" onclick={confirm}               disabled={subscribing || !manualValid} aria-busy={subscribing}>
      {#if subscribing}
        <span class="btn-spinner spin" aria-hidden="true"></span>
      {/if}
      {tr('mikan.subscribeConfirm')}
    </button>
  </div>
</div>

<MikanTagEditorModal
  open={editorOpen}
  mode={editorMode}
  tag={null}
  onCancel={() => editorOpen = false}
  onSave={handleNewTag}
/>

<style>
  .mikan-panel-manual { margin-top: var(--space-3); }
  .mikan-panel-manual-input {
    width: 100%;
    background: var(--bg-deep);
    border: 1px solid var(--border);
    color: var(--fg-primary);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    transition: all var(--duration-fast) var(--ease-out);
  }
  .mikan-panel-manual-input::placeholder { color: var(--fg-muted); }
  .mikan-panel-manual-input:focus {
    outline: none;
    border-color: rgba(var(--accent-rgb), 0.4);
    box-shadow: inset 0 1px 0 rgba(var(--accent-rgb), 0.03), 0 0 0 3px rgba(var(--accent-rgb), 0.07);
    background: var(--bg-elevated);
  }
  .mikan-panel-manual-input.invalid {
    border-color: var(--error);
    box-shadow: 0 0 0 1px var(--error);
  }
  .mikan-panel-manual-input.invalid:focus {
    box-shadow: 0 0 0 1px var(--error), 0 0 0 3px rgba(var(--error-rgb), 0.15);
  }
</style>
