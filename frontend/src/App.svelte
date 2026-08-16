<script>
  // ─── Svelte 根组件 ───
  // 承载 Svelte 组件库骨架（Toast/Modal）+ 已迁移视图。
  // 视图可见性由 main.js 的 __svelteViewSync 驱动（store.set(v === view)）。
  import Toast from './components/Toast.svelte';
  import Modal from './components/Modal.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import Settings from './views/Settings.svelte';
  import Discovery from './views/Discovery.svelte';
  import Library from './views/Library.svelte';
  import Mylist from './views/Mylist.svelte';
  import Stats from './views/Stats.svelte';
  import Detail from './views/Detail.svelte';
  import ThemeDock from './components/ThemeDock.svelte';
  import MetaMatch from './views/MetaMatch.svelte';
  import KbdHelp from './components/KbdHelp.svelte';
</script>

<!--
  Svelte 挂载的最小外壳。
  挂载目标是 index.html 中 .main-content 末尾的 <div id="app"></div>。
  Toast/Modal 均为 fixed 定位容器，不占布局；未触发时不可见，不影响现有 app。
  视图可见性由 main.js 的 __svelteViewSync 驱动（store.set(v === view)）。
-->
<div id="svelte-root" class="svelte-root">
  <Toast />
  <Modal />
  <ConfirmDialog />
  <Onboarding />
  <ThemeDock />
  <KbdHelp />
  <Settings />
  <Discovery />
  <Library />
  <Mylist />
  <Stats />
  <Detail />
  <MetaMatch />
</div>