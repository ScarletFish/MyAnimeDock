<script>
  // ─── Chrome 根组件（渐进迁移：titlebar + onboarding 由 vanilla 迁为 Svelte）───
  // 无自身布局，仅承载 <Titlebar/> 与 <Onboarding/>。
  // 挂载目标是 index.html 中 body 第一个子级 <div id="chrome"></div>。
  import Titlebar from './Titlebar.svelte';
  import Onboarding from './Onboarding.svelte';
</script>

<Titlebar />
<Onboarding />