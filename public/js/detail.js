gsap.registerPlugin(Flip);

let currentAnime = null;
let watchCardVersion = 0;
let watchStatsVersion = 0;
let detailRefreshTimer = null;
let wasMpvActive = false;

function resetDetailEnter() {
  const viewEl = document.getElementById('detailView');
  if (viewEl) {
    viewEl.classList.remove('detail-enter-active', 'show-content');
  }
  const hero = document.getElementById('heroCover');
  if (hero) hero.remove();
  const wrap = document.getElementById('detailCover');
  if (wrap) {
    wrap.style.opacity = '';
    wrap.style.transform = '';
    wrap.style.visibility = '';
  }
}

function startDetailRefresh() {
  stopDetailRefresh();
  wasMpvActive = false;
  detailRefreshTimer = setInterval(async () => {
    if (!currentAnime) { stopDetailRefresh(); return; }
    try {
      const st = await API.get('/api/mpv-status');
      if (wasMpvActive && !st.active) {
        currentAnime = await API.get(`/api/anime/${encodeURIComponent(currentAnime.id)}`);
        renderDetail();
        showToast('播放已结束，进度已更新');
      }
      wasMpvActive = st.active;
    } catch (e) {}
  }, 2000);
}

function stopDetailRefresh() {
  if (detailRefreshTimer) { clearInterval(detailRefreshTimer); detailRefreshTimer = null; }
}

async function showDetail(id, fromRect, fromSrc) {
  resetDetailEnter();
  stopDetailRefresh();
  try {
    currentAnime = await API.get(`/api/anime/${encodeURIComponent(id)}`);
    renderDetail();

    if (fromRect) {
      const viewEl = document.getElementById('detailView');
      viewEl.classList.add('detail-enter-active');
      showView('detail');
      animateHeroCoverFlip(fromRect, fromSrc);
    } else {
      showView('detail');
      const wrap = document.getElementById('detailCover');
      wrap.style.opacity = '1';
      wrap.style.transform = 'scale(1)';
    }

    document.getElementById('headerTitle').textContent = currentAnime.bangumiTitle || currentAnime.title;
    startDetailRefresh();
  } catch (e) {
    showToast('加载详情失败: ' + e.message);
  }
}

function animateHeroCoverFlip(fromRect, fromSrc) {
  const viewEl = document.getElementById('detailView');
  const wrap = document.getElementById('detailCover');
  const img = wrap.querySelector('img');
  if (!img) {
    wrap.style.opacity = '1';
    return;
  }

  const toRect = wrap.getBoundingClientRect();

  // Hide real cover during animation
  wrap.style.visibility = 'hidden';
  wrap.style.opacity = '0';

  // Create overlay at card position (First)
  const hero = document.createElement('div');
  hero.id = 'heroCover';
  hero.style.cssText = `
    position:fixed;z-index:100;pointer-events:none;overflow:hidden;
    left:${fromRect.left}px;top:${fromRect.top}px;
    width:${fromRect.width}px;height:${fromRect.height}px;
    border-radius:16px;
  `;

  const clone = document.createElement('img');
  clone.src = fromSrc || img.src;
  clone.alt = img.alt || '';
  clone.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
  hero.appendChild(clone);
  document.body.appendChild(hero);

  const state = Flip.getState(hero);

  // Move hero to detail position (Last)
  hero.style.left = toRect.left + 'px';
  hero.style.top = toRect.top + 'px';
  hero.style.width = toRect.width + 'px';
  hero.style.height = toRect.height + 'px';

  viewEl.classList.add('show-content');

  Flip.from(state, {
    duration: 0.35,
    ease: 'power2.out',
    absolute: true,
    onComplete: () => {
      wrap.style.visibility = '';
      wrap.style.opacity = '1';
      wrap.style.transform = '';
      hero.remove();
    }
  });
}

function renderDetail() {
  if (!currentAnime) return;

  const anime = currentAnime;

  const coverEl = document.getElementById('detailCover');
  if (anime.localCover) {
    coverEl.innerHTML = `<img src="/covers/${path.basename(anime.localCover)}?w=540&q=80" alt="${escAttr(anime.title)}">`;
  } else {
    coverEl.innerHTML = `<div class="gray-cover"><svg viewBox="0 0 24 24" width="64" height="64" fill="#555"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg></div>`;
  }

  document.getElementById('detailTitle').textContent = anime.bangumiTitle || anime.title;

  const ratingEl = document.getElementById('detailRating');
  ratingEl.textContent = anime.rating ? `★ ${anime.rating}` : '暂无评分';

  const seasonEl = document.getElementById('detailSeason');
  seasonEl.textContent = anime.season ? `Season ${anime.season}` : '';
  seasonEl.style.display = anime.season ? '' : 'none';

  const statusEl = document.getElementById('detailStatus');
  statusEl.textContent = anime.downloaded ? '已下载' : '未下载';
  statusEl.className = `status-badge ${anime.downloaded ? 'downloaded' : 'deleted'}`;

  const summaryEl = document.getElementById('detailSummary');
  summaryEl.textContent = anime.summary || '暂无简介';

  document.getElementById('bangumiSearchResults').innerHTML = '';

  const fetchBtn = document.getElementById('btnFetchBangumi');
  if (fetchBtn) {
    if (anime.bangumiId) {
      fetchBtn.style.display = 'none';
    } else {
      fetchBtn.style.display = 'inline-flex';
      fetchBtn.disabled = false;
      fetchBtn.textContent = '获取元数据';
    }
  }

  renderWatchCard(anime);
  renderEpisodeHeatmap(anime);
  renderWatchStats(anime);
}

function findWatchEpisode(anime) {
  if (!anime.episodes || anime.episodes.length === 0) return null;
  let first = null;
  for (const ep of anime.episodes) {
    if (!first) first = ep;
    if (!ep.watched && ep.progress > 0) return ep;
  }
  for (const ep of anime.episodes) {
    if (!ep.watched) return ep;
  }
  return null;
}

function renderWatchCard(anime) {
  const version = ++watchCardVersion;
  const ep = findWatchEpisode(anime);
  const bgEl = document.getElementById('watchCardBg');
  const labelEl = document.getElementById('watchCardLabel');
  const titleEl = document.getElementById('watchCardTitle');
  const progressWrap = document.getElementById('watchCardProgressWrap');
  const progressBar = document.getElementById('watchCardProgressBar');
  const btn = document.getElementById('watchCardBtn');
  const btnText = document.getElementById('watchCardBtnText');

  if (!ep) {
    labelEl.textContent = '已全部观看完毕';
    titleEl.textContent = '';
    progressWrap.style.display = 'none';
    btn.style.display = 'none';
    bgEl.style.backgroundImage = '';
    return;
  }

  const pct = ep.duration > 0 ? Math.min(100, Math.round(ep.progress / ep.duration * 100)) : 0;
  const thumbTime = ep.progress > 0 ? ep.progress : 60;
  const thumbUrl = `/api/thumbnail?path=${encodeURIComponent(ep.filePath)}&time=${thumbTime}`;

  // Show a neutral background first (reset)
  bgEl.style.backgroundImage = '';

  // Set video thumbnail as full card background with version guard
  const img = new Image();
  img.onload = () => {
    if (version === watchCardVersion) {
      bgEl.style.backgroundImage = `url(${thumbUrl})`;
    }
  };
  img.onerror = () => {
    if (version === watchCardVersion && anime.localCover) {
      bgEl.style.backgroundImage = `url(/covers/${path.basename(anime.localCover)}?w=540&q=80)`;
    }
  };
  img.src = thumbUrl;

  if (ep.watched) {
    labelEl.textContent = '重温';
    btnText.textContent = '重新播放';
  } else if (ep.progress > 0) {
    labelEl.textContent = `继续播放 第 ${ep.number} 集`;
    btnText.textContent = '继续播放';
  } else {
    labelEl.textContent = `开始播放 第 ${ep.number} 集`;
    btnText.textContent = '开始播放';
  }
  titleEl.textContent = ep.fileName;
  progressWrap.style.display = 'block';
  progressBar.style.width = pct + '%';
  btn.style.display = 'inline-flex';
  btn.onclick = () => playEpisode(ep.filePath, ep.progress);
}

function renderEpisodeHeatmap(anime) {
  const grid = document.getElementById('episodeHeatmapGrid');
  const header = document.querySelector('.episode-heatmap-header h3');
  if (!anime.episodes || anime.episodes.length === 0) {
    grid.innerHTML = '<p class="heatmap-empty">暂无剧集信息</p>';
    header.textContent = '剧集列表';
    return;
  }
  header.textContent = `剧集列表 · ${anime.episodes.length} 集`;

  const cols = window.innerWidth < 768 ? 5 : 10;
  grid.innerHTML = anime.episodes.map((ep, i) => {
    let cls = 'unwatched', tip = `第${ep.number}集 · 未观看`;
    if (ep.watched) { cls = 'watched'; tip = `第${ep.number}集 · 已观看`; }
    else if (ep.progress > 0) { cls = 'watching'; tip = `第${ep.number}集 · 观看中 ${ep.duration > 0 ? Math.round(ep.progress / ep.duration * 100) + '%' : ''}`; }
    return `<button class="heatmap-cell ${cls}" data-tip="${tip}" data-ep="${ep.number}" data-path="${escAttr(ep.filePath)}" data-pos="${ep.progress}" tabindex="0"></button>`;
  }).join('');

  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  grid.querySelectorAll('.heatmap-cell').forEach(el => {
    el.addEventListener('click', () => {
      const path = el.dataset.path;
      const pos = parseFloat(el.dataset.pos) || 0;
      playEpisode(path, pos);
    });
  });
}

// ─── Window resize → reflow heatmap ───
let heatmapResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(heatmapResizeTimer);
  heatmapResizeTimer = setTimeout(() => {
    if (currentAnime && document.getElementById('detailView').classList.contains('hidden') === false) {
      renderEpisodeHeatmap(currentAnime);
    }
  }, 200);
});

function renderWatchStats(anime) {
  const version = ++watchStatsVersion;
  const canvas = document.getElementById('watchStatsChart');
  const ctx = canvas.getContext('2d');
  const empty = document.getElementById('watchStatsEmpty');
  const emptyText = empty.querySelector('p');

  API.get(`/api/anime/${encodeURIComponent(anime.id)}/sessions`).then(data => {
    if (version !== watchStatsVersion) return;

    const dailyEntries = Object.entries(data);
    const totalMinutes = dailyEntries.reduce((s, [, v]) => s + v, 0);

    if (totalMinutes === 0) {
      canvas.style.display = 'none';
      empty.style.display = 'flex';
      if (emptyText) {
        emptyText.textContent = configCache?.playerMode === 'mpv'
          ? '播放后将显示观看统计'
          : '使用 mpv 播放器以启用观看统计';
      }
      return;
    }

    canvas.style.display = 'block';
    empty.style.display = 'none';

    // Aggregate into weeks (Mon-Sun)
    const weeks = [];
    const weekMap = new Map();
    for (const [dateStr, mins] of dailyEntries) {
      const d = new Date(dateStr + 'T00:00:00');
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((day + 6) % 7));
      const key = mon.toISOString().slice(0, 10);
      if (!weekMap.has(key)) {
        weekMap.set(key, { start: mon, minutes: 0 });
      }
      weekMap.get(key).minutes += mins;
    }
    const sortedWeeks = [...weekMap.values()].sort((a, b) => a.start - b.start);

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = Math.min(820, rect.width - 2);
    const H = 240;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const PAD = { top: 20, right: 16, bottom: 40, left: 48 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;

    const maxVal = Math.max(1, ...sortedWeeks.map(w => w.minutes));
    const n = sortedWeeks.length;
    const stepX = n > 1 ? cw / (n - 1) : cw;

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    const gridLines = 4;
    ctx.strokeStyle = 'rgba(237,232,226,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridLines; i++) {
      const y = PAD.top + (ch / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = 'rgba(237,232,226,0.4)';
    ctx.font = '11px DM Sans, Noto Sans SC, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= gridLines; i++) {
      const y = PAD.top + (ch / gridLines) * i;
      const val = Math.round(maxVal - (maxVal / gridLines) * i);
      ctx.fillText(val + '分钟', PAD.left - 8, y);
    }

    // Compute points
    function getXY(w, i) {
      const x = n > 1 ? PAD.left + i * stepX : PAD.left + cw / 2;
      const y = PAD.top + ch - (w.minutes / maxVal) * ch;
      return [x, y];
    }

    // Animate
    const animDuration = 600;
    const startTime = performance.now();

    function drawChart(progress) {
      ctx.clearRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = 'rgba(237,232,226,0.06)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= gridLines; i++) {
        const y = PAD.top + (ch / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(W - PAD.right, y);
        ctx.stroke();
      }

      // Y labels
      ctx.fillStyle = 'rgba(237,232,226,0.4)';
      ctx.font = '11px DM Sans, Noto Sans SC, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= gridLines; i++) {
        const y = PAD.top + (ch / gridLines) * i;
        const val = Math.round(maxVal - (maxVal / gridLines) * i);
        ctx.fillText(val + '分钟', PAD.left - 8, y);
      }

      const pts = sortedWeeks.map((w, i) => getXY(w, i));
      const visibleCount = Math.max(1, Math.ceil(pts.length * progress));
      const visPts = pts.slice(0, visibleCount);

      // Area fill
      if (visPts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(visPts[0][0], PAD.top + ch);
        ctx.lineTo(visPts[0][0], visPts[0][1]);
        for (let i = 1; i < visPts.length; i++) {
          const [px, py] = visPts[i - 1];
          const [cx, cy] = visPts[i];
          const mx = (px + cx) / 2;
          ctx.bezierCurveTo(mx, py, mx, cy, cx, cy);
        }
        ctx.lineTo(visPts[visPts.length - 1][0], PAD.top + ch);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + ch);
        grad.addColorStop(0, 'rgba(225,58,90,0.30)');
        grad.addColorStop(1, 'rgba(225,58,90,0.02)');
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Line
      if (visPts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(visPts[0][0], visPts[0][1]);
        for (let i = 1; i < visPts.length; i++) {
          const [px, py] = visPts[i - 1];
          const [cx, cy] = visPts[i];
          const mx = (px + cx) / 2;
          ctx.bezierCurveTo(mx, py, mx, cy, cx, cy);
        }
        ctx.strokeStyle = 'rgba(225,58,90,0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Dots + x-axis labels
      const labelInterval = n > 8 ? Math.ceil(n / 6) : 1;
      visPts.forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(225,58,90,0.9)';
        ctx.fill();

        if (i % labelInterval === 0 || i === visPts.length - 1) {
          const d = sortedWeeks[i].start;
          const label = (d.getMonth() + 1) + '/' + d.getDate();
          ctx.fillStyle = 'rgba(237,232,226,0.35)';
          ctx.font = '10px DM Sans, Noto Sans SC, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, x, H - PAD.bottom + 8);
        }
      });
    }

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      drawChart(1);
    } else {
      function animate(now) {
        if (version !== watchStatsVersion) return;
        const t = Math.min(1, (now - startTime) / animDuration);
        const ease = 1 - Math.pow(1 - t, 3);
        drawChart(ease);
        if (t < 1) requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);
    }

  }).catch(() => {
    if (version !== watchStatsVersion) return;
    canvas.style.display = 'none';
    empty.style.display = 'flex';
    if (emptyText) {
      emptyText.textContent = configCache?.playerMode === 'mpv'
        ? '播放后将显示观看统计'
        : '使用 mpv 播放器以启用观看统计';
    }
  });
}

async function playEpisode(filePath, position = 0) {
  try {
    await API.post('/api/play', { filePath, position });
    showToast('正在播放...');
  } catch (e) {
    showToast('播放失败: ' + e.message);
  }
}

async function toggleWatched(animeId, epNumber, watched) {
  try {
    const result = await API.post('/api/progress', { animeId, episodeNumber: epNumber, watched, progress: watched ? 999999 : 0 });
    if (currentAnime) {
      const ep = currentAnime.episodes.find(e => e.number === epNumber);
      if (ep) { ep.watched = result.episode.watched; ep.progress = result.episode.progress; }
      renderWatchCard(currentAnime);
      renderEpisodeHeatmap(currentAnime);
      renderWatchStats(currentAnime);
    }
  } catch (e) {
    showToast('操作失败: ' + e.message);
  }
}

async function fetchBangumiMetadata() {
  if (!currentAnime) return;
  const btn = document.getElementById('btnFetchBangumi');
  const resultsEl = document.getElementById('bangumiSearchResults');
  btn.disabled = true;
  btn.textContent = '搜索中...';
  resultsEl.innerHTML = '';
  try {
    const result = await API.post('/api/bangumi/fetch', { animeId: currentAnime.id });
    if (result.anime) {
      currentAnime = result.anime;
      renderDetail();
      showToast('Bangumi 元数据获取成功');
      return;
    }
    if (result.results) {
      showSearchResults(result.results, result.animeId);
      btn.textContent = '重新搜索';
      btn.disabled = false;
    }
  } catch (e) {
    showToast('搜索失败: ' + e.message);
    btn.disabled = false;
    btn.textContent = '获取元数据';
  }
}

function showSearchResults(results, animeId) {
  const el = document.getElementById('bangumiSearchResults');
  if (!results || results.length === 0) {
    el.innerHTML = '<p class="search-result-empty">未找到匹配结果</p>';
    return;
  }
  el.innerHTML = '<h4 style="margin:0 0 12px 0;color:var(--text1)">请选择匹配的条目：</h4>' +
    results.map(r => `
      <div class="search-result-item" onclick="attachBangumiSubject('${animeId}', ${r.id})">
        <img class="search-result-cover" src="${r.images?.small || r.images?.grid || ''}" alt=""
          onerror="this.style.display='none'">
        <div class="search-result-info">
          <div class="search-result-title">${escHtml(r.name_cn || r.name)}</div>
          <div class="search-result-subtitle">${escHtml(r.name)}</div>
          <div class="search-result-meta">${r.date || ''}${r.rating?.score ? ' · ★' + r.rating.score.toFixed(1) : ''}</div>
        </div>
        <button class="btn btn-primary search-result-btn">选择</button>
      </div>
    `).join('');
}

async function attachBangumiSubject(animeId, subjectId) {
  const resultsEl = document.getElementById('bangumiSearchResults');
  resultsEl.innerHTML = '<p style="text-align:center;color:var(--text2);padding:16px">正在获取元数据...</p>';
  try {
    const result = await API.post('/api/bangumi/fetch', { animeId, subjectId });
    currentAnime = result.anime;
    renderDetail();
    showToast('Bangumi 元数据获取成功');
  } catch (e) {
    showToast('获取失败: ' + e.message);
    resultsEl.innerHTML = '';
    const btn = document.getElementById('btnFetchBangumi');
    btn.textContent = '获取元数据';
    btn.disabled = false;
  }
}

async function deleteAnime() {
  if (!currentAnime) return;
  if (!confirm(`确定要从资料库移除「${currentAnime.title}」吗？\n观看记录将被保留。`)) return;

  try {
    await API.del(`/api/anime/${encodeURIComponent(currentAnime.id)}`);
    showToast('已移除');
    goBack();
    loadLibrary();
    loadMemories();
  } catch (e) {
    showToast('移除失败: ' + e.message);
  }
}