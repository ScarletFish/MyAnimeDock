<script>
  // ─── 延迟挂载区块（时间错峰）───
  // 详情页扩展信息（角色/统计/关联/推荐）在动画结束后才挂载，避免动画期间抢资源。
  // delay：延迟挂载（ms）。动画期间（封面展开 0.35s）传 350/450 错峰；
  // 动画被跳过（prefers-reduced-motion）时自动缩短为 0。
  // 挂载前不渲染、不执行、不发 API；延迟到期后挂载并正常加载。
  import { onMount } from 'svelte';

  let { delay = 0, children } = $props();

  let mounted = $state(false);

  onMount(() => {
    // 动画被跳过时无错峰必要，delay 归零
    const reduceMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.reduceMotion === 'true';
    const effectiveDelay = reduceMotion ? 0 : delay;
    if (effectiveDelay > 0) {
      const t = setTimeout(() => {
        mounted = true;
      }, effectiveDelay);
      return () => clearTimeout(t);
    }
    mounted = true;
  });
</script>

{#if mounted}
  {@render children()}
{/if}