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

  let selectedTags = $state(new Set(['simplified', 'halfEpisode']));
  let subscribing = $state(false);
  let config = $state(null);
  let addDdOpen = $state(false);

  const PRESET_TAGS = [
    { key: 'simplified', group: 'lang', regex: '简体' },
    { key: 'traditional', group: 'lang', regex: '繁体' },
    { key: 'simplifiedTraditional', group: 'lang', regex: '简繁' },
    { key: '1080p', group: 'quality', regex: '1080p' },
    { key: '720p', group: 'quality', regex: '720p' },
    { key: '4k', group: 'quality', regex: '4K' },
    { key: 'mkv', group: 'format', regex: '\\.mkv' },
    { key: 'mp4', group: 'format', regex: '\\.mp4' },
    { key: 'halfEpisode', group: 'exclude', regex: '\\.5', isExclude: true },
    { key: 'collection', group: 'exclude', regex: '合集', isExclude: true },
  ];

  const GROUP_LABELS = { lang: 'mikan.lang', quality: 'mikan.quality', format: 'mikan.format', exclude: 'mikan.exclude' };
  const GROUP_ORDER = ['lang', 'quality', 'format', 'exclude'];

  let downloadPath = $derived(
    config?.mediaDir && bangumiDetail?.name
      ? `${config.mediaDir}/${bangumiDetail.name}/`
      : ''
  );

  let availableOptions = $derived(
    PRESET_TAGS.filter(t => !selectedTags.has(t.key))
  );

  let mustContain = $derived.by(() => {
    return PRESET_TAGS
      .filter(t => !t.isExclude && selectedTags.has(t.key))
      .map(t => t.regex)
      .join('|');
  });

  let mustNotContain = $derived.by(() => {
    return PRESET_TAGS
      .filter(t => t.isExclude && selectedTags.has(t.key))
      .map(t => t.regex)
      .join('|');
  });

  $effect(() => {
    if (!open) {
      selectedTags = new Set(['simplified', 'halfEpisode']);
      addDdOpen = false;
      return;
    }
    api.get('/api/config').then(cfg => { config = cfg; }).catch(() => {});
  });

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

        <div class="mikan-subscribe-tags">
          {#each selectedTags as key}
            {@const tag = PRESET_TAGS.find(t => t.key === key)}
            {#if tag}
              <button class="tag-pill" class:tag-pill--exclude={tag.isExclude} onclick={() => toggleTag(key)}>
                {tag.regex}
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
                      <Select.Group>
                        <div class="mikan-add-dd-label">{tr(GROUP_LABELS[group])}</div>
                        {#each groupTags as tag}
                          <Select.Item value={tag.key} class="mikan-add-dd-item">
                            {tag.regex}
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
