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

  const INCLUDE_TAGS = [
    { key: '1080p', group: 'quality', regex: '1080p' },
    { key: '720p', group: 'quality', regex: '720p' },
    { key: '4k', group: 'quality', regex: '4K' },
    { key: 'mkv', group: 'format', regex: '\\.mkv' },
    { key: 'mp4', group: 'format', regex: '\\.mp4' },
    { key: 'internalSub', group: 'subtitle', regex: '内封' },
    { key: 'embeddedSub', group: 'subtitle', regex: '内嵌' },
  ];

  const EXCLUDE_TAGS = [
    { key: 'halfEpisode', regex: '\\.5' },
    { key: 'episodeRange', regex: '\\d+[~-]\\d+' },
    { key: 'collection', regex: '合集' },
  ];

  const TAG_LABELS = {
    '1080p': 'mikan.1080p', '720p': 'mikan.720p', '4k': 'mikan.4k',
    mkv: 'mikan.mkv', mp4: 'mikan.mp4',
    internalSub: 'mikan.internalSub', embeddedSub: 'mikan.embeddedSub',
    halfEpisode: 'mikan.halfEpisode', episodeRange: 'mikan.episodeRange', collection: 'mikan.collection',
  };
  const GROUP_LABELS = { quality: 'mikan.quality', format: 'mikan.format', subtitle: 'mikan.subtitle' };
  const GROUP_ORDER = ['quality', 'format', 'subtitle'];

  let availableIncludeOptions = $derived(
    INCLUDE_TAGS.filter(t => !selectedTags.has(t.key))
  );

  let availableExcludeOptions = $derived(
    EXCLUDE_TAGS.filter(t => !selectedTags.has(t.key))
  );

  let langMask = $derived(
    LANG_OPTIONS.filter(l => selectedLangs.has(l.key)).reduce((m, l) => m | l.bit, 0)
  );

  let mustContain = $derived.by(() => {
    const parts = [];
    const matched = LANG_COMPOUNDS.filter(c => c.mask === langMask);
    if (matched.length > 0) parts.push(matched.map(c => c.name).join('|'));
    for (const t of INCLUDE_TAGS) {
      if (selectedTags.has(t.key)) parts.push(t.regex);
    }
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    return parts.map(p => `(?=.*${p})`).join('');
  });

  let mustNotContain = $derived.by(() => {
    const parts = [];
    for (const c of LANG_COMPOUNDS) {
      if (c.mask & ~langMask) parts.push(c.name);
    }
    for (const t of EXCLUDE_TAGS) {
      if (selectedTags.has(t.key)) parts.push(t.regex);
    }
    return parts.join('|');
  });

  let preview = $derived.by(() => {
    if (!resources.length) return { matched: [], excluded: [], unmatched: [], total: 0 };

    const containRe = mustContain ? new RegExp(mustContain, 'i') : null;
    const notContainRe = mustNotContain ? new RegExp(mustNotContain, 'i') : null;

    const matched = [], excluded = [], unmatched = [];
    for (const r of resources) {
      const name = r.name;
      if (notContainRe && notContainRe.test(name)) { excluded.push(r); continue; }
      if (!containRe || containRe.test(name)) { matched.push(r); continue; }
      unmatched.push(r);
    }
    return { matched, excluded, unmatched, total: resources.length };
  });

  $effect(() => {
    if (onPreview) onPreview(preview);
  });

  onMount(() => {
    const gsap = globalThis.gsap;
    if (!gsap) return;
    gsap.fromTo('.mikan-panel', { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.25, ease: 'power2.out' });
  });

  function toggleLang(key) {
    const next = new Set(selectedLangs);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (next.size > 0) selectedLangs = next;
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
    if (val) selectedTags = new Set([...selectedTags, val]);
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
        {@const tag = INCLUDE_TAGS.find(t => t.key === key)}
        {#if tag}
          <button class="tag-pill" onclick={() => toggleTag(key)}>
            {TAG_LABELS[key] ? tr(TAG_LABELS[key]) : tag.regex}
            <svg class="tag-pill-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        {/if}
      {/each}

      {#if availableIncludeOptions.length > 0}
        <Select.Root type="single" bind:value={() => null, onIncludeSelect} bind:open={addDdOpen}>
          <Select.Trigger class="tag-pill tag-pill--add">+</Select.Trigger>
          <Select.Portal to="#modal-root">
            <Select.Content class="mikan-add-dd" side="bottom" sideOffset={4}>
              {#each GROUP_ORDER as group}
                {@const groupTags = availableIncludeOptions.filter(t => t.group === group)}
                {#if groupTags.length > 0}
                  <Select.Group class="mikan-add-dd-group">
                    <div class="mikan-add-dd-label">{tr(GROUP_LABELS[group])}</div>
                    {#each groupTags as tag}
                      <Select.Item value={tag.key} class="mikan-add-dd-item">
                        {TAG_LABELS[tag.key] ? tr(TAG_LABELS[tag.key]) : tag.regex}
                      </Select.Item>
                    {/each}
                  </Select.Group>
                {/if}
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
      {#each [...selectedTags] as key}
        {@const tag = EXCLUDE_TAGS.find(t => t.key === key)}
        {#if tag}
          <button class="tag-pill tag-pill--exclude" onclick={() => toggleTag(key)}>
            {TAG_LABELS[key] ? tr(TAG_LABELS[key]) : tag.regex}
            <svg class="tag-pill-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        {/if}
      {/each}

      {#if availableExcludeOptions.length > 0}
        <Select.Root type="single" bind:value={() => null, onExcludeSelect} bind:open={excludeDdOpen}>
          <Select.Trigger class="tag-pill tag-pill--add">+</Select.Trigger>
          <Select.Portal to="#modal-root">
            <Select.Content class="mikan-add-dd" side="bottom" sideOffset={4}>
              {#each availableExcludeOptions as tag}
                <Select.Item value={tag.key} class="mikan-add-dd-item">
                  {TAG_LABELS[tag.key] ? tr(TAG_LABELS[tag.key]) : tag.regex}
                </Select.Item>
              {/each}
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
