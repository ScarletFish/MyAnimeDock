<script>
  import { onMount } from 'svelte';
  import { showToast } from './Toast.svelte';
  import { tr } from '../lib/anime-utils.js';
  import { API as api } from '../lib/api.js';
  import { Select } from 'bits-ui';

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
  let selectedTags = $state(new Set(['halfEpisode', 'collection']));
  let subscribing = $state(false);
  let config = $state(null);
  let addDdOpen = $state(false);
  let excludeDdOpen = $state(false);

  const LANG_OPTIONS = [
    { key: 'simplified', label: 'mikan.simplified', bit: 1 },
    { key: 'traditional', label: 'mikan.traditional', bit: 2 },
    { key: 'japanese', label: 'mikan.japanese', bit: 4 },
  ];
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
    LANG_OPTIONS.filter(l => !excludedLangs.has(l.key))
  );

  let langMask = $derived(
    LANG_OPTIONS.filter(l => selectedLangs.has(l.key)).reduce((m, l) => m | l.bit, 0)
  );

  let excludedLangMask = $derived(
    LANG_OPTIONS.filter(l => excludedLangs.has(l.key)).reduce((m, l) => m | l.bit, 0)
  );

  let mustContain = $derived.by(() => {
    const parts = [];
    if (langMask) {
      const chars = [];
      if (langMask & 1) chars.push('简');
      if (langMask & 2) chars.push('繁');
      if (langMask & 4) chars.push('日');
      if (chars.length === 1) {
        parts.push(chars[0]);
      } else {
        parts.push(chars.map(c => `(?=.*${c})`).join(''));
      }
    }
    for (const t of includeTags) {
      if (selectedTags.has(t.key)) parts.push(t.regex);
    }
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.map(p => `(?=.*${p})`).join('');
  });

  let mustNotContain = $derived.by(() => {
    const parts = [];
    if (excludedLangMask) {
      if (excludedLangMask & 1) parts.push('简');
      if (excludedLangMask & 2) parts.push('繁');
      if (excludedLangMask & 4) parts.push('日');
    }
    for (const t of excludeTags) {
      if (selectedTags.has(t.key)) parts.push(t.regex);
    }
    return parts.join('|');
  });

  let containTokens = $derived.by(() => {
    const t = [];
    if (langMask) {
      if (langMask & 1) t.push('简');
      if (langMask & 2) t.push('繁');
      if (langMask & 4) t.push('日');
    }
    for (const tag of includeTags) if (selectedTags.has(tag.key)) t.push(tag.regex);
    return t;
  });

  let notContainTokens = $derived.by(() => {
    const t = [];
    if (excludedLangMask) {
      if (excludedLangMask & 1) t.push('简');
      if (excludedLangMask & 2) t.push('繁');
      if (excludedLangMask & 4) t.push('日');
    }
    for (const tag of excludeTags) if (selectedTags.has(tag.key)) t.push(tag.regex);
    return t;
  });

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
    try { config = await api.get('/api/config'); } catch {}
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
    if (val) selectedTags = new Set([...selectedTags, val]);
  }

  function onExcludeSelect(val) {
    if (!val) return;
    const lang = LANG_OPTIONS.find(l => l.key === val);
    if (lang) {
      excludedLangs = new Set([...excludedLangs, val]);
    } else {
      selectedTags = new Set([...selectedTags, val]);
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
      {#each LANG_OPTIONS as opt}
        <button class="tag-pill" class:active={selectedLangs.has(opt.key)} onclick={() => toggleLang(opt.key)}>
          {tr(opt.label)}
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
              {#each availableIncludeOptions as tag}
                <Select.Item value={tag.key} class="mikan-add-dd-item">{tag.name}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      {/if}
    </div>
  </div>

  <div class="mikan-panel-section">
    <div class="mikan-panel-section-label">{tr('mikan.exclude')}</div>
    <div class="mikan-panel-tags">
      {#each [...excludedLangs] as key}
        {@const opt = LANG_OPTIONS.find(l => l.key === key)}
        {#if opt}
          <button class="tag-pill tag-pill--exclude" onclick={() => toggleExcludeLang(key)}>
            {tr(opt.label)}
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
              {#if availableExcludeLangOptions.length > 0}
                <Select.Group class="mikan-add-dd-group">
                  <div class="mikan-add-dd-label">{tr('mikan.lang')}</div>
                  {#each availableExcludeLangOptions as opt}
                    <Select.Item value={opt.key} class="mikan-add-dd-item">
                      {tr(opt.label)}
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
  </div>

  <div class="mikan-panel-preview">
    {#if preview.total > 0}
      <span class="mikan-panel-preview-count">{preview.matched.length}/{preview.total}</span>
      {tr('mikan.matchCount')}
    {/if}
  </div>

  <div class="mikan-panel-footer">
    <button class="btn btn-outline btn-sm" onclick={onCancel}>{tr('common.cancel')}</button>
    <button class="btn btn-primary btn-sm" onclick={confirm} disabled={subscribing} aria-busy={subscribing}>
      {#if subscribing}
        <span class="btn-spinner spin" aria-hidden="true"></span>
      {/if}
      {tr('mikan.subscribeConfirm')}
    </button>
  </div>
</div>
