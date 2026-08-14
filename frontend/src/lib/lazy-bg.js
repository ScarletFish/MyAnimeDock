// 懒加载背景图 action（替代原 detail-stats.js 的 IntersectionObserver 逻辑）。
// 读取 node.dataset.src → 命中时写 node.style.backgroundImage（detail-episodes.css:88
// 的 .episode-card-bg[style*="url"] opacity 规则依赖 inline style，不能加 class）。
// root 默认取最近的 .episode-list-scroll 滚动容器（与原 root:grid 语义一致），可传 opts.root 覆盖。
export function lazyBg(node, opts = {}) {
  const src = node.dataset.src;
  if (!src) return;

  const root = opts.root || node.closest('.episode-list-scroll') || null;

  const apply = () => {
    node.style.backgroundImage = 'url("' + src + '")';
    node.removeAttribute('data-src');
  };

  if (typeof IntersectionObserver === 'undefined') {
    apply();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        apply();
        observer.unobserve(entry.target);
      }
    }
  }, { root, rootMargin: '100px' });

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
      node.removeAttribute('data-src');
    },
  };
}