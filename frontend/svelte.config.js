/**
 * Svelte 编译器配置。
 *
 * warningFilter：渐进迁移期间，从 vanilla HTML 原样搬移的结构会触发大量 a11y 警告
 * （这些结构在原版就是如此，视觉/行为保持一致，后续统一优化）。
 * 这里只过滤「迁移遗留」的结构性警告，其余 a11y 警告仍保留提醒。
 */
export default {
  compilerOptions: {
    warningFilter(warning) {
      const migratedStructural = [
        'a11y_label_has_associated_control',          // 原版 label 用作 form-group 标题（无 for）
        'a11y_no_noninteractive_element_to_interactive_role', // 原版 <nav role="tablist">
        'a11y_no_static_element_interactions',        // 原版 overlay/list/拖拽手柄的 pointer/click
        'a11y_click_events_have_key_events',          // 原版 overlay 点击关闭
        'a11y_consider_explicit_label',               // 纯图标按钮（已补 aria-label）
      ];
      if (migratedStructural.includes(warning.code)) return false;
      return true;
    },
  },
};
