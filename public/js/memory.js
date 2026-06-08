// Memory functionality
let memoriesData = [];
let currentMemoryAnimeId = null;

async function loadMemories() {
  try {
    memoriesData = await API.get('/api/memories');
    renderMemories();
  } catch (e) {
    showToast('加载观看历史失败: ' + e.message);
  }
}

function renderMemories() {
  const list = document.getElementById('memoriesList');
  const empty = document.getElementById('memoriesEmpty');

  if (memoriesData.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = memoriesData.map(m => {
    const coverSrc = m.coverLocal ? `/covers/${path.basename(m.coverLocal)}` : '';
    const dateStr = m.watchedAt ? new Date(m.watchedAt).toLocaleDateString('zh-CN') : '';
    const ratingStars = m.rating ? '★'.repeat(Math.floor(m.rating)) + (m.rating % 1 ? '☆' : '') : '';
    return `
      <div class="memory-card" onclick="showDetail('${escAttr(m.animeId)}')">
        <div class="memory-cover${!coverSrc ? ' grayed' : ''}">
          ${coverSrc
            ? `<img src="${coverSrc}" loading="lazy" decoding="async">`
            : `<div class="gray-cover" style="height:100%;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="32" height="32" fill="#555"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></div>`
          }
        </div>
        <div class="memory-info">
          <h3>${escHtml(m.bangumiTitle || m.title)}</h3>
          ${m.rating ? `<div class="rating">${ratingStars} ${m.rating}/10</div>` : ''}
          ${m.thoughts ? `<div class="thoughts">${escHtml(m.thoughts)}</div>` : ''}
          <div class="date">${dateStr}</div>
        </div>
      </div>
    `;
  }).join('');
}

function openMemoryEditor() {
  if (!currentAnime) return;
  currentMemoryAnimeId = currentAnime.id;

  const existing = memoriesData.find(m => m.animeId === currentAnime.id);
  document.getElementById('memoryRating').value = existing ? existing.rating || 7 : 7;
  document.getElementById('memoryRatingValue').textContent = existing ? existing.rating || 7 : 7;
  document.getElementById('memoryThoughts').value = existing ? existing.thoughts || '' : '';
  document.getElementById('memoryNotes').value = existing ? existing.notes || '' : '';

  document.getElementById('memoryModal').classList.add('show');
}

function closeMemoryEditor() {
  document.getElementById('memoryModal').classList.remove('show');
  currentMemoryAnimeId = null;
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
    showToast('感想已保存');
    closeMemoryEditor();
    loadMemories();
  } catch (e) {
    showToast('保存失败: ' + e.message);
  }
}

// Rating slider live update
document.getElementById('memoryRating').addEventListener('input', function() {
  document.getElementById('memoryRatingValue').textContent = this.value;
});
