// stats.js — Data visualization view
// Displays word cloud (wordcloud2.js) and Nightingale rose chart

const WORDCLOUD_MAX_WORDS = 60;

function loadStats() {
  const canvas = document.getElementById('wordCloudCanvas');
  const loadingEl = document.getElementById('statsLoading');
  const emptyEl = document.getElementById('statsEmpty');
  const cardBody = document.querySelector('.stats-card-body');

  // Reset state
  loadingEl.style.display = '';
  emptyEl.style.display = 'none';
  if (cardBody) cardBody.classList.remove('stats-card-body--loaded');

  API.get('/api/stats/tags').then(data => {
    loadingEl.style.display = 'none';
    if (!data.tags || Object.keys(data.tags).length === 0) {
      emptyEl.style.display = '';
      return;
    }
    const entries = Object.entries(data.tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, WORDCLOUD_MAX_WORDS);

    if (entries.length === 0) {
      emptyEl.style.display = '';
      return;
    }

    // Find max count for normalization
    const maxCount = entries[0][1];
    const minCount = entries[entries.length - 1][1];
    const range = Math.max(maxCount - minCount, 1);

    // Build wordcloud2 list: [[word, weight], ...]
    // Normalize so least-frequent word = 8, most-frequent = 55
    // (wordcloud2 treats weight as font-size before weightFactor)
    const list = entries.map(([word, count]) => {
      const weight = 8 + ((count - minCount) / range) * 47;
      return [word, Math.round(weight)];
    });

    renderWordCloud(canvas, list);
    if (cardBody) cardBody.classList.add('stats-card-body--loaded');
  }).catch(err => {
    loadingEl.style.display = 'none';
    emptyEl.style.display = '';
    console.error('Stats load error:', err);
  });
}

function renderWordCloud(canvas, list) {
  if (!canvas) return;

  // Get computed theme colors
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue('--accent').trim() || '#e9407a';
  const accentRgb = style.getPropertyValue('--accent-rgb').trim() || '233,64,122';
  const bgColor = style.getPropertyValue('--bg-surface').trim() || '#1a1a2e';

  const isDark = document.documentElement.getAttribute('data-theme-mode') !== 'light';

  // Generate color palette based on accent
  const palette = generatePalette(accent, accentRgb, isDark, list.length);

  // Determine canvas dimensions from parent container
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.min(Math.max(rect.width - 32, 400), 1200);
  const h = 400;

  // Set canvas — wordcloud2.js reads element.width/height for layout
  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = 'width:' + w + 'px;height:' + h + 'px;display:block;max-width:100%;border-radius:var(--radius-md)';

  // Resolve font family
  const fontFamily = "'Noto Sans SC', 'DM Sans', sans-serif";

  WordCloud(canvas, {
    list: list,
    fontFamily: fontFamily,
    fontWeight: '600',
    color: function (word, weight) {
      // Cyclic palette based on word index
      const idx = list.findIndex(e => e[0] === word);
      return palette[idx % palette.length];
    },
    backgroundColor: bgColor,
    weightFactor: function (w) {
      // w is already our 8-55 font size; slight boost for readability
      return w * 1.2;
    },
    rotateRatio: 0.4,
    minSize: 10,
    shape: 'circle',
    ellipticity: 1,
    shrinkToFit: true,
    shuffle: false,
    gridSize: 8,
    drawOutOfBound: false,
    hover: null,
    click: null
  });
}

function generatePalette(accent, accentRgb, isDark, count) {
  // Create a harmonious palette from the accent color
  // Parse accent RGB
  const rgb = accentRgb.split(',').map(Number);
  const [r, g, b] = rgb;

  // Generate shades: lighter variants for dark bg, darker for light bg
  const colors = [];
  const steps = Math.max(count, 6);

  if (isDark) {
    // On dark bg: accent → lighter tints
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const mix = 0.3 + t * 0.5; // 30% → 80% lightness
      const nr = Math.round(r + (255 - r) * (1 - mix));
      const ng = Math.round(g + (255 - g) * (1 - mix));
      const nb = Math.round(b + (255 - b) * (1 - mix));
      colors.push(`rgb(${nr},${ng},${nb})`);
    }
  } else {
    // On light bg: accent → slightly darker
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const nr = Math.round(r * (0.5 + t * 0.5));
      const ng = Math.round(g * (0.5 + t * 0.5));
      const nb = Math.round(b * (0.5 + t * 0.5));
      colors.push(`rgb(${nr},${ng},${nb})`);
    }
  }
  return colors;
}

// ─── Nightingale Rose Chart ───

function loadSeasonChart() {
  const canvas = document.getElementById('seasonChartCanvas');
  if (!canvas) return;
  const loadingEl = document.getElementById('seasonChartLoading');
  const emptyEl = document.getElementById('seasonChartEmpty');

  if (loadingEl) loadingEl.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';

  API.get('/api/stats/seasons').then(data => {
    if (loadingEl) loadingEl.style.display = 'none';
    const seasons = data.seasons || {};
    const entries = [
      { key: 'spring', label: '春', color: '#4ade80' },
      { key: 'summer', label: '夏', color: '#facc15' },
      { key: 'autumn', label: '秋', color: '#f97316' },
      { key: 'winter', label: '冬', color: '#60a5fa' }
    ];
    const values = entries.map(e => seasons[e.key] || 0);
    const total = values.reduce((s, v) => s + v, 0);

    if (total === 0) {
      if (emptyEl) emptyEl.style.display = '';
      return;
    }

    renderRoseChart(canvas, entries, values);
  }).catch(err => {
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    console.error('Season chart load error:', err);
  });
}

function renderRoseChart(canvas, entries, values) {
  if (!canvas) return;

  const style = getComputedStyle(document.documentElement);
  const isDark = document.documentElement.getAttribute('data-theme-mode') !== 'light';
  const bgColor = style.getPropertyValue('--bg-surface').trim() || '#1a1a2e';
  const textColor = isDark ? '#ede8e2' : '#2c2418';
  const mutedColor = isDark ? 'rgba(237,232,226,0.5)' : 'rgba(44,36,24,0.5)';

  const rect = canvas.parentElement.getBoundingClientRect();
  const size = Math.min(Math.max(rect.width - 32, 300), 500);
  const dpr = window.devicePixelRatio || 1;

  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.cssText = 'width:' + size + 'px;height:' + size + 'px;display:block;max-width:100%';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = size * 0.32;
  const maxVal = Math.max(...values, 1);

  // Draw petals (Nightingale rose: each petal radius ∝ value)
  const angleStep = (Math.PI * 2) / entries.length;
  const startAngle = -Math.PI / 2; // Start from top

  for (let i = 0; i < entries.length; i++) {
    const angle = startAngle + i * angleStep;
    const radius = (values[i] / maxVal) * maxRadius;
    const halfAngle = angleStep * 0.42; // Slight gap between petals

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle - halfAngle, angle + halfAngle);
    ctx.closePath();

    // Gradient fill
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, entries[i].color + '40');
    grad.addColorStop(1, entries[i].color);
    ctx.fillStyle = grad;
    ctx.fill();

    // Border
    ctx.strokeStyle = entries[i].color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw center circle
  ctx.beginPath();
  ctx.arc(cx, cy, maxRadius * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();

  // Draw labels outside petals
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < entries.length; i++) {
    const angle = startAngle + i * angleStep;
    const labelRadius = maxRadius + size * 0.1;
    const lx = cx + Math.cos(angle) * labelRadius;
    const ly = cy + Math.sin(angle) * labelRadius;

    // Season label with count
    ctx.fillStyle = textColor;
    ctx.font = '600 ' + Math.round(size * 0.06) + 'px "Noto Sans SC", "DM Sans", sans-serif';
    const count = values[i];
    ctx.fillText(entries[i].label + ' ' + count, lx, ly);
  }
}

// Re-render on theme change
document.addEventListener('themechanged', () => {
  const view = document.getElementById('statsView');
  if (view && !view.classList.contains('hidden')) {
    // Re-fetch and re-render when theme changes
    loadStats();
    loadSeasonChart();
  }
});
