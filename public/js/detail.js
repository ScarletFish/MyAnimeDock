gsap.registerPlugin(Flip);

let currentAnime = null;

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

async function showDetail(id, fromRect, fromSrc) {
  resetDetailEnter();
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

  const countEl = document.getElementById('episodeCount');
  countEl.textContent = anime.episodes ? `${anime.episodes.length} 集` : '';

  renderEpisodes(anime);
}

function renderEpisodes(anime) {
  const list = document.getElementById('episodeList');

  if (!anime.episodes || anime.episodes.length === 0) {
    list.innerHTML = '<p style="color:var(--text2);padding:24px 0;text-align:center">暂无剧集信息</p>';
    return;
  }

  list.innerHTML = anime.episodes.map(ep => {
    const sizeStr = formatSize(ep.fileSize);
    const pct = ep.duration > 0 ? Math.min(100, Math.round(ep.progress / ep.duration * 100)) : 0;
    let statusClass, statusText, playLabel, playBtnClass;
    if (ep.watched) {
      statusClass = 'watched';
      statusText = '已观看';
      playLabel = '重看';
      playBtnClass = 'btn-ghost';
    } else if (ep.progress > 0) {
      statusClass = 'watching';
      statusText = '观看中';
      playLabel = '继续播放';
      playBtnClass = 'btn-accent';
    } else {
      statusClass = 'unwatched';
      statusText = '未观看';
      playLabel = '播放';
      playBtnClass = 'btn-primary';
    }
    return `
      <div class="episode-item ${statusClass}">
        <span class="episode-num">${ep.number}</span>
        <span class="episode-name">${escHtml(ep.fileName)}</span>
        <span class="episode-size">${sizeStr}</span>
        <div class="episode-progress-wrap">
          <div class="episode-progress-bar ${ep.watched ? 'done' : (ep.progress > 0 ? 'wip' : '')}" style="width:${ep.watched ? 100 : pct}%"></div>
        </div>
        <span class="episode-status ${statusClass}">${statusText}</span>
        <div class="episode-actions">
          ${anime.downloaded ? `
            <button class="btn btn-xs" onclick="toggleWatched('${escAttr(anime.id)}', ${ep.number}, ${!ep.watched})">${ep.watched ? '取消标记' : '标记已看'}</button>
            <button class="btn ${playBtnClass} btn-xs" onclick="playEpisode('${escAttr(ep.filePath)}', ${ep.progress})">${playLabel}</button>
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