<script>
  // 纯展示型品牌角标：圆角矩形 + 字母 D。
  // 尺寸不在此控制（SVG 用 viewBox，由调用方 CSS 决定显示大小）；
  // rect 描边统一为 var(--border)，与侧边栏原效果一致；
  // text 的 stroke="none" 内置，避免被 .btn-icon 等上下文继承描边而产生残影。
</script>

<svg
  viewBox="0 0 16 16"
  xmlns="http://www.w3.org/2000/svg"
  role="img"
  aria-label="MyAnimeDock"
>
  <rect x="0" y="0" width="16" height="16" rx="3" fill="var(--accent)" stroke="var(--border)" stroke-width="0.5" />
  <text
    x="8"
    y="13"
    font-family="Georgia, 'Times New Roman', serif"
    font-weight="700"
    font-size="12"
    fill="var(--bg-elevated)"
    stroke="none"
    text-anchor="middle"
  >D</text>
</svg>
