// Detail view logic
let currentAnime = null;

async function showDetail(id) {
  try {
    currentAnime = await API.get(`/api/anime/${encodeURIComponent(id)}`);
    renderDetail();
    showView('detail');
    document.getElementById('headerTitle').textContent = currentAnime.bangumiTitle || currentAnime.title;
  } catch (e) {
    showToast('加载详情失败: ' + e.message);
  }
}

function renderDetail() {
  if (!currentAnime) return;

  const anime = currentAnime;

  // Cover
  const coverEl = document.getElementById('detailCover');
  if (anime.localCover) {
    coverEl.innerHTML = `<img src="/covers/${path.basename(anime.localCover)}" alt="${escAttr(anime.title)}">`;
  } else {
    coverEl.innerHTML = `<div class="gray-cover" style="height:100%;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="64" height="64" fill="#555"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg></div>`;
  }

  // Title
  document.getElementById('detailTitle').textContent = anime.bangumiTitle || anime.title;

  // Rating
  const ratingEl = document.getElementById('detailRating');
  ratingEl.textContent = anime.rating ? `★ ${anime.rating}` : '暂无评分';

  // Season
  const seasonEl = document.getElementById('detailSeason');
  seasonEl.textContent = anime.season ? `Season ${anime.season}` : '';
  seasonEl.style.display = anime.season ? '' : 'none';

  // Status
  const statusEl = document.getElementById('detailStatus');
  statusEl.textContent = anime.downloaded ? '已下载' : '未下载';
  statusEl.className = `status-badge ${anime.downloaded ? 'downloaded' : 'deleted'}`;

  // Summary
  const summaryEl = document.getElementById('detailSummary');
  summaryEl.textContent = anime.summary || '暂无简介';

  // Clear search results
  document.getElementById('bangumiSearchResults').innerHTML = '';

  // Bangumi button visibility
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

  // Episodes
  renderEpisodes(anime);
}

function renderEpisodes(anime) {
  const list = document.getElementById('episodeList');

  if (!anime.episodes || anime.episodes.length === 0) {
    list.innerHTML = '<p style="color:var(--text2)">暂无剧集信息</p>';
    return;
  }

  list.innerHTML = anime.episodes.map(ep => {
    const sizeStr = formatSize(ep.fileSize);
    const pct = ep.duration > 0 ? Math.min(100, Math.round(ep.progress / ep.duration * 100)) : 0;
    const showResume = ep.progress > 0 && !ep.watched;
    return `
      <div class="episode-item">
        <span class="episode-num">${ep.number}</span>
        <span class="episode-name">${escHtml(ep.fileName)}</span>
        <span class="episode-size">${sizeStr}</span>
        <div class="episode-progress-wrap">
          <div class="episode-progress-bar ${ep.watched ? 'done' : ''}" style="width:${ep.watched ? 100 : pct}%"></div>
        </div>
        <span class="episode-status ${ep.watched ? 'watched' : 'unwatched'}">${ep.watched ? '已看' : '未看'}</span>
        <div class="episode-actions">
          ${anime.downloaded ? `
            <button class="btn btn-xs" onclick="toggleWatched('${escAttr(anime.id)}', ${ep.number}, ${!ep.watched})">${ep.watched ? '取消标记' : '标记已看'}</button>
            <button class="btn ${showResume ? 'btn-accent' : 'btn-primary'} btn-xs" onclick="playEpisode('${escAttr(ep.filePath)}', ${ep.progress})">${showResume ? '继续播放' : '播放'}</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
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
      renderEpisodes(currentAnime);
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
