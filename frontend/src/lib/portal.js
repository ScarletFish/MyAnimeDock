// ─── Portal action: 将弹窗节点移动到 body 级 #modal-root ───
export function portal(node, target = '#modal-root') {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (el) el.appendChild(node);
  return {
    destroy() {
      node.remove();
    }
  };
}