<script>
  // ─── Svelte 根组件（渐进迁移挂载点）───
  // 迁移期间现有 vanilla app 仍由 index.html 渲染，二者共存。
  // 此处承载 Svelte 组件库骨架（Toast/Modal）+ 已迁移视图。
  // 视图可见性由 main.js 的 __svelteViewSync 按 SVELTE_VIEWS 路由表驱动。
  import Toast from './components/Toast.svelte';
  import Modal from './components/Modal.svelte';
  import Settings from './views/Settings.svelte';
  import Discovery from './views/Discovery.svelte';
  import Library from './views/Library.svelte';
  import Mylist from './views/Mylist.svelte';
  import Stats from './views/Stats.svelte';
  import Detail from './views/Detail.svelte';
</script>

<!--
  Svelte 挂载的最小外壳。
  挂载目标是 index.html 中 .main-content 末尾的 <div id="app"></div>。
  Toast/Modal 均为 fixed 定位容器，不占布局；未触发时不可见，不影响现有 app。
  视图由 SVELTE_VIEWS 路由表控制可见性（未接管时 store 恒 false，全部隐藏）。
-->
<div id="svelte-root" class="svelte-root">
  <Toast />
  <Modal />
  <Settings />
  <Discovery />
  <Library />
  <Mylist />
  <Stats />
  <Detail />
</div>