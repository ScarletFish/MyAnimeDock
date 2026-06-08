// Discovery view logic
let discoveryData = [];

async function loadDiscovery() {
  try {
    const result = await API.get('/api/refresh');
    discoveryData = result.discovered || [];
    renderDiscovery();
  } catch (e) {
    showToast('扫描失败: ' + e.message);
  }
}

function renderDiscovery() {
  const grid = document.getElementById('discoveryGrid');
  const empty = document.getElementById('discoveryEmpty');

  if (discoveryData.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = discoveryData.map((item, i) => {
    const sizeStr = formatSize(item.totalSize);
    const isImported = false; // Will check against library
    return `
      <div class="anime-card" style="animation-delay:${i * 0.05}s">
        <div class="gray-cover">
          <svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg>
        </div>
        <div class="overlay">
          <h3>${escHtml(item.parsedTitle)}</h3>
          <div class="meta">
            ${item.parsedSeason ? `<span class="season-badge">Season ${item.parsedSeason}</span>` : ''}
            <span>${item.videoCount} 集</span>
            <span>${sizeStr}</span>
          </div>
          <button class="import-badge" onclick="importAnime(event, ${i})">导入</button>
        </div>
      </div>
    `;
  }).join('');
}

async function importAnime(event, index) {
  event.stopPropagation();
  const item = discoveryData[index];
  const btn = event.target;
  btn.textContent = '导入中...';
  btn.disabled = true;

  try {
    await API.post('/api/import', item);
    btn.textContent = '已导入';
    btn.classList.add('imported');
    showToast(`已导入「${item.parsedTitle}」`);
    loadLibrary();
  } catch (e) {
    btn.textContent = '导入';
    btn.disabled = false;
    showToast('导入失败: ' + e.message);
  }
}

function refreshDiscovery() {
  loadDiscovery();
  loadLibrary();
}
