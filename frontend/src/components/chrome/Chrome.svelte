<script>
  // ─── Chrome 根组件（渐进迁移：titlebar 由 vanilla 迁为 Svelte）───
  // 无自身布局，仅承载 <Titlebar/>。
  // 挂载目标是 index.html 中 body 第一个子级 <div id="chrome"></div>。
  import Titlebar from './Titlebar.svelte';
</script>

<Titlebar />