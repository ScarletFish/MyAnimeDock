<script>
  // ─── 滚动到才挂载区块 ───
  // 详情页扩展信息（角色/统计/关联/推荐）滚动进入视口附近才挂载，避免无条件全量加载。
  // 挂载前不渲染、不执行、不发 API；触发后挂载并正常加载，挂载后保持不卸载（重复滚动不重触发）。
  // rootMargin：提前量（px），滚动到区块前即开始加载，消除滚动到位时的等待。
  // skeleton：可选 Svelte 5 snippet。有则未触发时渲染骨架（观察目标在骨架外层），触发后渲染 children；
  //           无则保持原 1px 哨兵行为（向后兼容）。
  import { onMount, onDestroy } from 'svelte';

  let { rootMargin = '200px 0px', skeleton = null, children } = $props();

  let sentinel = $state(null);
  let mounted = $state(false);
  let observer = null;

  onMount(() => {
    if (!sentinel) {
      // 兜底：观察目标缺失时不阻塞内容（正常路径不会走到）
      mounted = true;
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          mounted = true;
          observer?.disconnect();
          observer = null;
        }
      },
      { root: null, rootMargin, threshold: 0 },
    );
    observer.observe(sentinel);
  });

  onDestroy(() => {
    observer?.disconnect();
    observer = null;
  });
</script>

{#if mounted}
  {@render children()}
{:else if skeleton}
  <div bind:this={sentinel}>
    {@render skeleton()}
  </div>
{:else}
  <!-- 哨兵：占 1px 触发滚动，挂载后整体移除，不残留布局 -->
  <div aria-hidden="true" style="height:1px" bind:this={sentinel}></div>
{/if}
