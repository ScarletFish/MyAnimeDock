<script>
  import { portal } from '../lib/portal.js';
  import { showToast } from './Toast.svelte';
  import { tr } from '../lib/anime-utils.js';
  import { API as api } from '../lib/api.js';
  import { Select } from 'bits-ui';

  let {
    open = $bindable(false),
    anime = null,
    subgroup = null,
    bangumiDetail = null,
    onSubscribed = null,
  } = $props();

  let selectedLangs = $state(new Set(['simplified']));
  let selectedTags = $state(new Set(['halfEpisode']));
  let subscribing = $state(false);
  let config = $state(null);
  let addDdOpen = $state(false);

  const LANG_OPTIONS = [
    { key: 'simplified', label: 'mikan.simplified', bit: 1 },
    { key: 'traditional', label: 'mikan.traditional', bit: 2 },
    { key: 'japanese', label: 'mikan.japanese', bit: 4 },
  ];
  // Mikan 实际使用的语言组合词 (name → bitmask)
  const LANG_COMPOUNDS = [
    { name: '简日', mask: 1 | 4 },   // simplified | japanese
    { name: '繁日', mask: 2 | 4 },   // traditional | japanese
    { name: '简繁日', mask: 1 | 2 | 4 }, // all three
  ];

  const PRESET_TAGS = [
    { key: '1080p', group: 'quality', regex: '1080p' },
    { key: '720p', group: 'quality', regex: '720p' },
    { key: '4k', group: 'quality', regex: '4K' },
    { key: 'mkv', group: 'format', regex: '\\.mkv' },
    { key: 'mp4', group: 'format', regex: '\\.mp4' },
    { key: 'internalSub', group: 'subtitle', regex: '内封' },
    { key: 'embeddedSub', group: 'subtitle', regex: '内嵌' },
    { key: 'halfEpisode', group: 'exclude', regex: '\\.5', isExclude: true },
    { key: 'episodeRange', group: 'exclude', regex: '\\d+[~-]\\d+', isExclude: true },
    { key: 'collection', group: 'exclude', regex: '合集', isExclude: true },
  ];

  const TAG_LABELS = {
    '1080p': 'mikan.1080p', '720p': 'mikan.720p', '4k': 'mikan.4k',
    mkv: 'mikan.mkv', mp4: 'mikan.mp4',
    internalSub: 'mikan.internalSub', embeddedSub: 'mikan.embeddedSub',
    halfEpisode: 'mikan.halfEpisode', episodeRange: 'mikan.episodeRange', collection: 'mikan.collection',
  };
  const GROUP_LABELS = { quality: 'mikan.quality', format: 'mikan.format', subtitle: 'mikan.subtitle', exclude: 'mikan.exclude' };
  const GROUP_ORDER = ['quality', 'format', 'subtitle', 'exclude'];

  let downloadPath = $derived(
    config?.mediaDir && bangumiDetail?.name
      ? `${config.mediaDir}/${bangumiDetail.name}/`
      : ''
  );

  let langMask = $derived(
    LANG_OPTIONS.filter(l => selectedLangs.has(l.key)).reduce((m, l) => m | l.bit, 0)
  );

  let availableOptions = $derived(
    PRESET_TAGS.filter(t => !selectedTags.has(t.key))
  );

  let mustContain = $derived.by(() => {
    const parts = [];
    // 语言：精确匹配（组合词 bitmask === 选中 bitmask）
    const matched = LANG_COMPOUNDS.filter(c => c.mask === langMask);
    if (matched.length > 0) parts.push(matched.map(c => c.name).join('|'));
    // 其他标签：AND 逻辑
    for (const t of PRESET_TAGS) {
      if (!t.isExclude && selectedTags.has(t.key)) parts.push(t.regex);
    }
    return parts.length > 0 ? parts.join('|') : '';
  });

  let mustNotContain = $derived.by(() => {
    const parts = [];
    // 语言排除：包含任何未选语言的组合词（bitmask & ~langMask ≠ 0）
    for (const c of LANG_COMPOUNDS) {
      if (c.mask & ~langMask) parts.push(c.name);
    }
    // 其他排除：OR 逻辑
    for (const t of PRESET_TAGS) {
      if (t.isExclude && selectedTags.has(t.key)) parts.push(t.regex);
    }
    return parts.join('|');
  });

  $effect(() => {
    if (!open) {
      selectedLangs = new Set(['simplified']);
      selectedTags = new Set(['halfEpisode', 'collection']);
      addDdOpen = false;
      return;
    }
    api.get('/api/config').then(cfg => { config = cfg; }).catch(() => {});
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

  function onAddSelect(val) {
    if (val) {
      selectedTags = new Set([...selectedTags, val]);
    }
  }

  async function subscribe() {
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
      open = false;
      if (onSubscribed) onSubscribed();
    } catch (e) {
      showToast(tr('mikan.subscribeFailed', { error: e.message }), 'error');
    } finally {
      subscribing = false;
    }
  }
</script>

{#if open && anime && subgroup}
  <div
    class="modal-overlay show"
    use:portal
    role="button"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) open = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') open = false; }}
  >
    <div class="modal mikan-subscribe-modal">
      <button class="mikan-subscribe-close" onclick={() => (open = false)} aria-label={tr('common.close')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="mikan-subscribe-inner">
        <div class="mikan-subscribe-heading">
          <h2 class="mikan-subscribe-title">{bangumiDetail?.name || anime.name}</h2>
        </div>

        <div class="mikan-subscribe-info">
          <div class="mikan-subscribe-info-row">
            <span class="mikan-subscribe-label">{tr('mikan.subgroup')}</span>
            <span class="mikan-subscribe-value">{subgroup.name}</span>
          </div>
          {#if downloadPath}
            <div class="mikan-subscribe-info-row">
              <span class="mikan-subscribe-label">{tr('mikan.savePath')}</span>
              <span class="mikan-subscribe-value mikan-subscribe-path">{downloadPath}</span>
            </div>
          {/if}
        </div>

        <div class="mikan-subscribe-filter">
          <div class="mikan-subscribe-filter-label">{tr('mikan.lang')}</div>
          <div class="mikan-subscribe-tags">
            {#each LANG_OPTIONS as opt}
              <button class="tag-pill" class:active={selectedLangs.has(opt.key)} onclick={() => toggleLang(opt.key)}>
                {tr(opt.label)}
              </button>
            {/each}
          </div>
        </div>

        <div class="mikan-subscribe-filter">
          <div class="mikan-subscribe-filter-label">{tr('mikan.filter')}</div>
          <div class="mikan-subscribe-tags">
            {#each [...selectedTags] as key}
              {@const tag = PRESET_TAGS.find(t => t.key === key)}
              {#if tag}
                <button class="tag-pill" class:tag-pill--exclude={tag.isExclude} onclick={() => toggleTag(key)}>
                  {TAG_LABELS[key] ? tr(TAG_LABELS[key]) : tag.regex}
                  <svg class="tag-pill-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              {/if}
            {/each}

            {#if availableOptions.length > 0}
              <Select.Root type="single" bind:value={() => null, onAddSelect} bind:open={addDdOpen}>
                <Select.Trigger class="tag-pill tag-pill--add">
                  +
                </Select.Trigger>
                <Select.Portal to="#modal-root">
                  <Select.Content class="mikan-add-dd" side="bottom" sideOffset={4}>
                    {#each GROUP_ORDER as group}
                      {@const groupTags = availableOptions.filter(t => t.group === group)}
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

        <div class="mikan-subscribe-footer">
          <button class="btn btn-primary" onclick={subscribe} disabled={subscribing} aria-busy={subscribing}>
            {#if subscribing}
              <span class="btn-spinner spin" aria-hidden="true"></span>
            {/if}
            {tr('mikan.subscribeConfirm')}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
