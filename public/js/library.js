// Library view logic
let libraryData = [];
let contextMenuAnimeId = null;
let isFetchingMetadata = false;

async function loadLibrary() {
  try {
    libraryData = await API.get('/api/library');
    renderLibrary();
    updateFetchMetaButtonState();
  } catch (e) {
    showToast('加载资料库失败: ' + e.message);
  }
}

function updateFetchMetaButtonState() {
  const btn = document.getElementById('libraryFetchMetaBtn');
  const status = document.getElementById('libraryFetchMetaStatus');
  if (!btn || !status) return;

  const needsFetch = libraryData.some(a => !a.bangumiId && !a.bangumiMatched);
  
  if (isFetchingMetadata) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span id="libraryFetchMetaText">获取中...</span>';
    status.textContent = '正在批量获取元数据...';
    status.style.color = 'var(--accent)';
  } else if (needsFetch) {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg><span id="libraryFetchMetaText">获取元数据</span>';
    status.textContent = `${libraryData.filter(a => !a.bangumiId && !a.bangumiMatched).length} 部待获取`;
    status.style.color = 'var(--fg-muted)';
  } else {
    btn.disabled = true;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg><span id="libraryFetchMetaText">获取元数据</span>';
    status.textContent = '全部已获取元数据';
    status.style.color = 'var(--success)';
  }
}

async function fetchAllLibraryMetadata() {
  if (isFetchingMetadata) return;
  
  const pending = libraryData.filter(a => !a.bangumiId && !a.bangumiMatched);
  if (pending.length === 0) {
    showToast('全部已获取元数据');
    return;
  }

  isFetchingMetadata = true;
  updateFetchMetaButtonState();

  const btn = document.getElementById('libraryFetchMetaBtn');
  const status = document.getElementById('libraryFetchMetaStatus');
  const originalText = btn.innerHTML;

  let successCount = 0;
  let failCount = 0;

  try {
    // High efficiency concurrency: process in batches of 3
    const batchSize = 3;
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      
      const results = await Promise.allSettled(
        batch.map(anime => 
          API.post('/api/bangumi/fetch', { animeId: anime.id })
            .then(() => ({ anime, success: true }))
            .catch(e => ({ anime, success: false, error: e.message }))
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          successCount++;
        } else {
          failCount++;
          const anime = result.status === 'fulfilled' ? result.value.anime : result.reason?.anime;
          console.error('Fetch meta failed for', anime?.id, result.status === 'fulfilled' ? result.value.error : result.reason);
        }
      }

      // Update status in real-time
      status.textContent = `已完成 ${successCount}/${pending.length}，失败 ${failCount}`;
    }

    // Reload library to reflect new metadata
    await loadLibrary();
    showToast(`批量获取完成：成功 ${successCount}，失败 ${failCount}`);
  } catch (e) {
    showToast('批量获取失败: ' + e.message);
  } finally {
    isFetchingMetadata = false;
    updateFetchMetaButtonState();
  }
}

function renderLibrary(filter = '') {
  const grid = document.getElementById('libraryGrid');
  const empty = document.getElementById('libraryEmpty');

  let filtered = libraryData;
  if (filter) {
    const q = filter.toLowerCase();
    filtered = libraryData.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.bangumiTitle && a.bangumiTitle.toLowerCase().includes(q))
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = filtered.map((anime, i) => {
    const coverSrc = anime.localCover ? `/covers/${path.basename(anime.localCover)}?w=400&q=75` : '';
    const downloaded = anime.downloaded;
    const id = escAttr(anime.id);
    return `
      <div class="anime-card" style="animation-delay:${i * 0.05}s" onclick="navigateToDetail('${id}', this)" oncontextmenu="showContextMenu(event, '${id}')">
        ${coverSrc
          ? `<img src="${coverSrc}" loading="lazy" decoding="async" alt="${escAttr(anime.title)}"${!downloaded ? ' style="filter:grayscale(100%) opacity(0.5)"' : ''}>`
          : `<div class="gray-cover"><svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg></div>`
        }
        <div class="overlay">
          <h3>${escHtml(anime.bangumiTitle || anime.title)}</h3>
          <div class="meta">
            ${anime.rating ? `<span class="rating-badge">★ ${anime.rating}</span>` : ''}
            ${anime.season ? `<span class="season-badge">S${anime.season}</span>` : ''}
            <span class="status-badge ${downloaded ? 'downloaded' : 'deleted'}">${downloaded ? '已下载' : '未下载'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function filterLibrary() {
  const q = document.getElementById('librarySearch').value;
  renderLibrary(q);
}

// --- Context Menu ---
function showContextMenu(e, animeId) {
  e.preventDefault();
  e.stopPropagation();
  contextMenuAnimeId = animeId;
  const menu = document.getElementById('contextMenu');
  let x = e.clientX;
  let y = e.clientY;
  menu.classList.add('show');
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function hideContextMenu() {
  document.getElementById('contextMenu').classList.remove('show');
  contextMenuAnimeId = null;
}

async function contextDeleteAnime() {
  const animeId = contextMenuAnimeId;
  hideContextMenu();
  if (!animeId) return;
  const anime = libraryData.find(a => a.id === animeId);
  const title = anime ? anime.title : animeId;
  if (!confirm(`确定要从资料库移除「${title}」吗？\n观看记录将被保留。`)) return;
  try {
    await API.del(`/api/anime/${encodeURIComponent(animeId)}`);
    showToast('已移除');
    loadLibrary();
    loadMemories();
  } catch (e) {
    showToast('移除失败: ' + e.message);
  }
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.context-menu')) hideContextMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
document.getElementById('ctxDelete').addEventListener('click', contextDeleteAnime);

function navigateToDetail(id, cardEl) {
  const img = cardEl.querySelector('img');
  let rect = null;
  let imgSrc = null;
  if (img) {
    rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) rect = null;
    else imgSrc = img.currentSrc || img.src;
  }
  showDetail(id, rect, imgSrc);
}
