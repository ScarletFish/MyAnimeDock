// Memory functionality (archive poster wall)
let memoriesData = [];
let currentMemoryAnimeId = null;

async function loadMemories() {
  try {
    memoriesData = await API.get('/api/memories');
    renderMemories();
  } catch (e) {
    // Tauri 初始加载时静默失败
    if (window.location.origin !== 'http://localhost:3456') return;
    showToast('加载归档失败: ' + e.message, 'error');
  }
}

function renderMemories() {
  const grid = document.getElementById('memoriesGrid');
  const empty = document.getElementById('memoriesEmpty');
  const statsBar = document.getElementById('memoryStats');

  if (memoriesData.length === 0) {
    grid.innerHTML = '';
    if (statsBar) statsBar.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';

  // Stats
  if (statsBar) {
    statsBar.style.display = 'flex';
    document.getElementById('memoryCount').textContent = memoriesData.length;
    const rated = memoriesData.filter(m => m.rating);
    const avgRating = rated.length > 0
      ? rated.reduce((s, m) => s + m.rating, 0) / rated.length
      : 0;
    document.getElementById('memoryAvgRating').textContent = avgRating > 0
      ? '★ ' + avgRating.toFixed(1)
      : '--';
  }

  grid.innerHTML = memoriesData.map(m => {
    const coverSrc = m.coverLocal ? `/covers/${path.basename(m.coverLocal)}` : '';
    const dateStr = m.watchedAt ? new Date(m.watchedAt).toLocaleDateString('zh-CN') : '';
    const ratingStr = m.rating ? '★ ' + m.rating + '/10' : '';
    const thoughtsPreview = m.thoughts ? escHtml(m.thoughts) : '';
    const title = escHtml(m.bangumiTitle || m.title);

    let coverHtml;
    if (coverSrc) {
      coverHtml = `<div class="memory-card-cover"><img src="${coverSrc}" loading="lazy" decoding="async" alt="${title}"></div>`;
    } else {
      coverHtml = `<div class="memory-card-cover"><div class="memory-card-placeholder"><svg viewBox="0 0 24 24" width="40" height="40" stroke="var(--fg-muted)" fill="none" stroke-width="1.5" opacity="0.3"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg></div></div>`;
    }

    return `
      <div class="memory-card" onclick="showMemoryDetail('${escAttr(m.animeId)}')">
        ${coverHtml}
        <div class="memory-card-overlay">
          <h3>${title}</h3>
          <div>
            ${ratingStr ? `<span class="memory-card-rating">${ratingStr}</span>` : ''}
            <span class="memory-card-date">${dateStr}</span>
          </div>
          ${thoughtsPreview ? `<div class="memory-card-thoughts">${thoughtsPreview}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ─── Archive Detail View ───

function showMemoryDetail(animeId) {
  const memory = memoriesData.find(m => m.animeId === animeId);
  if (!memory) {
    showToast('未找到归档记录', 'info');
    return;
  }

  // Set archive mode flags via AppState (synced to detail.js via subscriptions)
  AppState.set('isArchiveMode', true);
  AppState.set('archiveMemoryData', memory);

  // Build a pseudo-anime from memory data for the detail view
  const pseudoAnime = {
    id: memory.animeId,
    title: memory.title,
    bangumiTitle: memory.bangumiTitle || memory.title,
    localCover: memory.coverLocal,
    rating: memory.rating || null,
    summary: memory.thoughts || '暂无简介',
    season: null,
    episodes: [],
    downloaded: false,
  };

  // Use the detail system
  resetDetailEnter();
  stopDetailRefresh();

  AppState.set('currentAnime', pseudoAnime);
  renderDetail();
  showView('detail');
  AppState.set('detailSourceView', 'memories');

  // Override header to note it's in archive mode
  document.getElementById('headerTitle').textContent = pseudoAnime.bangumiTitle || pseudoAnime.title;
}

// ─── Memory Editor ───

function openMemoryEditor() {
  const ca = AppState.get('currentAnime');
  if (!ca) return;
  currentMemoryAnimeId = ca.id;

  const existing = memoriesData.find(m => m.animeId === ca.id);
  document.getElementById('memoryRating').value = existing ? existing.rating || 7 : 7;
  document.getElementById('memoryRatingValue').textContent = existing ? existing.rating || 7 : 7;
  document.getElementById('memoryThoughts').value = existing ? existing.thoughts || '' : '';
  document.getElementById('memoryNotes').value = existing ? existing.notes || '' : '';

  openModal('memoryModal', {
    onClose: function() { currentMemoryAnimeId = null; }
  });
}

async function saveMemory() {
  if (!currentMemoryAnimeId) return;

  const rating = parseFloat(document.getElementById('memoryRating').value);
  const thoughts = document.getElementById('memoryThoughts').value;
  const notes = document.getElementById('memoryNotes').value;

  try {
    await API.post('/api/memories', {
      animeId: currentMemoryAnimeId,
      rating,
      thoughts,
      notes,
    });
    showToast('感想已保存', 'success');
    closeModal('memoryModal');

    // Reload memory data and re-render
    memoriesData = await API.get('/api/memories');

    // If currently in archive detail view, update it
    const ca = AppState.get('currentAnime');
    if (AppState.get('isArchiveMode') && ca && ca.id === currentMemoryAnimeId) {
      const updated = memoriesData.find(m => m.animeId === currentMemoryAnimeId);
      if (updated) {
        AppState.set('archiveMemoryData', updated);
        ca.rating = updated.rating;
        ca.summary = updated.thoughts || '暂无简介';
        renderDetail();
      }
    }
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

// Rating slider live update
document.getElementById('memoryRating').addEventListener('input', function() {
  document.getElementById('memoryRatingValue').textContent = this.value;
});
