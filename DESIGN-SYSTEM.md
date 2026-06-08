# MyAnimeDocker Design System

## Style: Modern Dark Cinema

Dark, cinematic interface designed for media management. Inspired by streaming platforms (Netflix, Crunchyroll).

## Colors

```css
:root {
  /* Backgrounds */
  --bg-deep: #000000;
  --bg-base: #0a0a0f;
  --bg-elevated: #12121a;
  --bg-surface: #1a1a25;
  
  /* Foreground */
  --fg-primary: #f0f0f5;
  --fg-secondary: #a0a0b0;
  --fg-muted: #606070;
  
  /* Accent (Anime Red) */
  --accent: #e94560;
  --accent-hover: #ff6b81;
  --accent-glow: rgba(233, 69, 96, 0.3);
  
  /* Status */
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  
  /* Borders */
  --border: rgba(255, 255, 255, 0.08);
  --border-hover: rgba(255, 255, 255, 0.15);
  
  /* Effects */
  --glass-bg: rgba(10, 10, 15, 0.8);
  --glass-blur: blur(20px);
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
  
  /* Spacing (8px grid) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  
  /* Border Radius */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  
  /* Typography */
  --font-sans: 'Inter', 'Noto Sans SC', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  
  /* Transitions */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
}
```

## Typography

- **Headings**: Inter 600-700, tracking -0.02em
- **Body**: Inter 400, line-height 1.6
- **Labels**: Inter 500, uppercase, tracking 0.05em
- **Mono**: JetBrains Mono for code/technical

## Effects

1. **Glassmorphism**: Sidebar and headers use backdrop-blur
2. **Subtle Glow**: Accent color glows on hover/focus
3. **Scale Press**: Cards scale 0.98 on press, 1.02 on hover
4. **Stagger Animation**: Grid items animate in sequence

## Anti-Patterns to Avoid

- Pure #000000 backgrounds (use #0a0a0f instead)
- Emoji as icons (use SVG)
- Hover-only interactions (ensure tap works)
- Animations > 400ms
- Low contrast text (< 4.5:1)
