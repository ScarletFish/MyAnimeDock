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
    const watchedClass = ep.watched ? 'watched' : 'unwatched';
    return `
      <div class="episode-item">
        <span class="episode-num">${ep.number}</span>
        <span class="episode-name">${escHtml(ep.fileName)}</span>
        <span class="episode-size">${sizeStr}</span>
        <span class="episode-status ${watchedClass}">${ep.watched ? '已看' : '未看'}</span>
        <div class="episode-actions">
          ${anime.downloaded ? `<button class="btn btn-primary" onclick="playEpisode('${escAttr(ep.filePath)}')">播放</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function playEpisode(filePath) {
  try {
    await API.post('/api/play', { filePath });
    showToast('正在播放...');
  } catch (e) {
    showToast('播放失败: ' + e.message);
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
