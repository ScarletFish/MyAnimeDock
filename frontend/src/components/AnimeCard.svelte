<script>
  // ─── AnimeCard（Svelte 迁移 Chunk A）───
  // 基于 Mylist.svelte 的 card snippet（唯一无嵌套的正确结构）。
  // 只认 props，不查全局、不 import 全局，只发事件。
  import { tr, coverSrc } from '../lib/anime-utils.js';

  let {
    item,
    alwaysShowTitle = false,
    showMoreBtn = true,
    coverSize = '400',
    onClick = null,
    onContextMenu = null,
    onMore = null,
  } = $props();

  const isWish = $derived(item.source === 'wishlist');
  const title = $derived(item.bangumiTitle || item.title || '');
  const cover = $derived(coverSrc(item, coverSize));

  function handleMore(e) {
    e.stopPropagation();
    if (onMore) onMore(item, e);
  }
</script>

<div
  class="anime-card" class:anime-card--wish={isWish}
  data-id={item.id} data-source={item.source}
  onclick={(e) => onClick && onClick(item, e)}
  oncontextmenu={(e) => onContextMenu && onContextMenu(item, e)}
>
  {#if cover}
    <img src={cover} loading="lazy" decoding="async" alt={title}
      style={isWish ? 'opacity:0.45;filter:grayscale(0.6)' : ''}>
  {:else}
    <div class="gray-cover"><span class="gray-cover-text">{(title || '?')[0].toUpperCase()}</span></div>
  {/if}
  {#if showMoreBtn && !isWish}
    <div class="card-more-btn" data-tooltip={tr('ui.setStatusTooltip', '设置状态')} onclick={handleMore}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
      </svg>
    </div>
  {/if}
  {#if item.userRating}
    <span class="user-rating">☆ {item.userRating}</span>
  {/if}
  {#if alwaysShowTitle}
    <div class="title-strip"><div class="card-title">{title}</div></div>
  {/if}
  <div class="overlay">
    <h3>{title}</h3>
    <div class="meta">
      {#if item.rating}<span class="rating-badge">★ {item.rating}</span>{/if}
      {#if item.season && !isWish}<span class="season-badge">S{item.season}</span>{/if}
      {#if isWish}<span class="wishlist-badge">{tr('ui.wishlistBadge', '愿望单')}</span>{/if}
    </div>
  </div>
</div>