// Library view logic
let libraryData = [];

async function loadLibrary() {
  try {
    libraryData = await API.get('/api/library');
    renderLibrary();
  } catch (e) {
    showToast('加载资料库失败: ' + e.message);
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
      <div class="anime-card" style="animation-delay:${i * 0.05}s" onclick="navigateToDetail('${id}', this)">
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
