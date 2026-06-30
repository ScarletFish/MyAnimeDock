// My List view — 全生命周期总览
let mylistData = [];
let mylistFilter = 'all';

const MYLIST_LABELS = {
  watching: '当前观看',
  wish: '计划中',
  completed: '已完成',
  on_hold: '搁置',
  dropped: '抛弃'
};

async function loadMyList() {
  try {
    mylistData = await API.get('/api/mylist');
    renderMyList();
  } catch (e) {
    if (window.location.origin !== 'http://localhost:3456') return;
    showToast('加载我的列表失败: ' + e.message);
  }
}

function renderMyList() {
  const empty = document.getElementById('mylistEmpty');
  const grid = document.getElementById('mylistGrid');

  // Filter
  let filtered = mylistData;
  if (mylistFilter !== 'all') {
    filtered = mylistData.filter(item => item.status === mylistFilter);
  }

  if (filtered.length === 0) {
    killMyListAnimations();
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    // Restore empty state text
    const p = empty ? empty.querySelector('p') : null;
    if (p) p.textContent = mylistFilter === 'all' ? '暂无内容' : '暂无"' + (MYLIST_LABELS[mylistFilter] || '') + '"的条目';
    return;
  }

  if (empty) empty.style.display = 'none';

  if (mylistFilter === 'all') {
    renderAllTab(filtered);
  } else {
    renderFilteredTab(filtered);
  }

  // Apply grid zoom to match library
  if (typeof applyGridZoom === 'function') applyGridZoom();

  // Card reveal animation
  document.querySelectorAll('#mylistView .anime-card').forEach(card => {
    card.style.animation = 'cardReveal 300ms var(--ease-out) forwards';
  });
}

function killMyListAnimations() {
  // Placeholder if needed
}

function renderAllTab(items) {
  // Group by status
  const groups = {};
  for (const item of items) {
    const s = item.status || 'wish';
    if (!groups[s]) groups[s] = [];
    groups[s].push(item);
  }

  // Defined order
  const order = ['watching', 'wish', 'completed', 'on_hold', 'dropped'];

  let html = '';
  for (const status of order) {
    const group = groups[status];
    if (!group || group.length === 0) continue;
    html += `
      <div class="mylist-section">
        <div class="mylist-section-header">
          <span class="mylist-section-title">${MYLIST_LABELS[status]}</span>
          <span class="mylist-section-count">${group.length}</span>
        </div>
        <div class="grid-container">
          ${group.map(item => renderMyListCard(item)).join('')}
        </div>
      </div>`;
  }

  document.getElementById('mylistGrid').innerHTML = html || '';
}

function renderFilteredTab(items) {
  const grid = document.getElementById('mylistGrid');
  grid.innerHTML = `
    <div class="grid-container">
      ${items.map(item => renderMyListCard(item)).join('')}
    </div>`;
}

function renderMyListCard(item) {
  const isWish = item.source === 'wishlist';
  const id = escAttr(item.id);
  const title = escHtml(item.bangumiTitle || item.title);
  const coverSrc = item.localCover
    ? `/covers/${path.basename(item.localCover)}?w=400&q=75`
    : (item.coverUrl || '');
  const cardClass = isWish ? 'anime-card anime-card--wish' : 'anime-card';
  const coverStyle = isWish ? 'opacity:0.45;filter:grayscale(0.6)' : '';

  const onClick = isWish
    ? `showWishlistDetail('${id}')`
    : `navigateToMyListDetail('${id}', this)`;

  // "..." more button — always slightly visible, full on hover
  const moreBtn = isWish ? '' :
    `<div class="card-more-btn" onclick="event.stopPropagation();toggleStatusPopover(event, '${id}')" title="设置状态">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
      </svg>
    </div>`;

  return `
    <div class="${cardClass}" onclick="${onClick}" oncontextmenu="showMyListContextMenu(event, '${id}')" data-source="${item.source}" data-anime-id="${id}">
      ${coverSrc
        ? `<img src="${coverSrc}" loading="lazy" decoding="async" alt="${title}" style="${coverStyle}">`
        : `<div class="gray-cover"><svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/></svg></div>`
      }
      ${moreBtn}
      <div class="overlay">
        <h3>${title}</h3>
        <div class="meta">
          ${item.rating ? `<span class="rating-badge">★ ${item.rating}</span>` : ''}
          ${isWish ? '<span class="wishlist-badge">愿望</span>' : ''}
        </div>
      </div>
    </div>`;
}

// ─── Tab switching ───

function setMyListFilter(filter) {
  mylistFilter = filter;
  document.querySelectorAll('.mylist-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === filter);
  });
  renderMyList();
}

// ─── Card click handlers ───

function navigateToMyListDetail(id, cardEl) {
  const img = cardEl.querySelector('img');
  let rect = null;
  let imgSrc = null;
  if (img && img.naturalWidth > 0) {
    rect = img.getBoundingClientRect();
    if (rect.width && rect.height) imgSrc = img.currentSrc || img.src;
  }
  detailSourceView = 'mylist';
  showDetail(id, rect, imgSrc);
}

function showWishlistDetail(id) {
  const item = mylistData.find(i => i.id === id);
  if (!item) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = function (e) { if (e.target === this) this.remove(); };

  const coverSrc = item.coverUrl || '';
  overlay.innerHTML = `
    <div class="modal wishlist-detail-modal">
      ${coverSrc ? `<div class="wishlist-detail-cover"><img src="${coverSrc}" alt="${escAttr(item.bangumiTitle || item.title)}" loading="lazy" decoding="async"></div>` : ''}
      <h2>${escHtml(item.bangumiTitle || item.title)}</h2>
      ${item.rating ? `<div class="wishlist-detail-rating">★ ${item.rating}</div>` : ''}
      ${item.summary ? `<p class="wishlist-detail-summary">${escHtml(item.summary)}</p>` : ''}
      <div class="wishlist-detail-actions">
        <a class="btn btn-primary" href="https://bgm.tv/subject/${item.bangumiId}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          在 Bangumi 中打开
        </a>
        <button class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">关闭</button>
      </div>
      <button class="modal-close-btn" onclick="this.closest('.modal-overlay').remove()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
}

// ─── Hover status popover ───

let activeStatusPopover = null;

function toggleStatusPopover(e, id) {
  e.stopPropagation();

  if (activeStatusPopover) {
    const wasSame = activeStatusPopover._targetId === id;
    activeStatusPopover.remove();
    activeStatusPopover = null;
    if (wasSame) return;
  }

  const card = e.currentTarget.closest('.anime-card');
  if (!card) return;
  const cardRect = card.getBoundingClientRect();

  // Find current status — check mylistData first, then fall back to libraryData
  let currentStatus = null;
  const myItem = mylistData.find(i => i.id === id);
  if (myItem) {
    currentStatus = myItem.status;
  } else if (typeof libraryData !== 'undefined') {
    const libItem = libraryData.find(a => a.id === id);
    if (libItem && libItem.myListStatus) currentStatus = libItem.myListStatus;
  }

  const popover = document.createElement('div');
  popover.className = 'status-popover';
  popover._targetId = id;

  const statuses = [
    { value: 'watching', label: '当前观看' },
    { value: 'wish', label: '计划中' },
    { value: 'completed', label: '已完成' },
    { value: 'on_hold', label: '搁置' },
    { value: 'dropped', label: '抛弃' },
  ];

  popover.innerHTML = statuses.map(s => {
    const active = s.value === currentStatus;
    return `
      <div class="status-popover-item${active ? ' status-popover-item--active' : ''}"
           data-status="${s.value}">${s.label}</div>`;
  }).join('') + `
      <div class="status-popover-separator"></div>
      <div class="status-popover-item status-popover-item--danger"
           data-action="remove">移除</div>`;

  popover.addEventListener('click', (ev) => {
    const itemEl = ev.target.closest('.status-popover-item');
    if (!itemEl) return;
    if (itemEl.dataset.action === 'remove') {
      popover.remove();
      activeStatusPopover = null;
      removeMyListItem(id);
      return;
    }
    const status = itemEl.dataset.status;
    if (!status) return;
    popover.remove();
    activeStatusPopover = null;
    setMyListItemStatus(id, status);
  });

  popover._targetCard = card;
  document.body.appendChild(popover);
  // Measure at full scale (add .show temporarily, no paint between)
  popover.classList.add('show');
  const popRect = popover.getBoundingClientRect();
  popover.classList.remove('show');

  // Center on card
  let top = cardRect.top + (cardRect.height - popRect.height) / 2;
  let left = cardRect.left + (cardRect.width - popRect.width) / 2;
  if (top < 4) top = 4;
  if (left < 4) left = 4;
  if (top + popRect.height > window.innerHeight - 4) top = window.innerHeight - popRect.height - 4;
  if (left + popRect.width > window.innerWidth - 4) left = window.innerWidth - popRect.width - 4;
  popover.style.top = top + 'px';
  popover.style.left = left + 'px';

  requestAnimationFrame(() => popover.classList.add('show'));
  activeStatusPopover = popover;
}

// Close popover on outside click
document.addEventListener('click', function closeStatusPopover(e) {
  if (activeStatusPopover && !activeStatusPopover.contains(e.target)) {
    activeStatusPopover.remove();
    activeStatusPopover = null;
  }
});

// Auto-close popover when mouse is >100px away from card bounds
document.addEventListener('mousemove', function proximityCheck(e) {
  if (!activeStatusPopover) return;
  const card = activeStatusPopover._targetCard;
  if (!card || !card.isConnected) { activeStatusPopover = null; return; }
  const r = card.getBoundingClientRect();
  const margin = 100;
  if (e.clientX < r.left - margin || e.clientX > r.right + margin ||
      e.clientY < r.top - margin || e.clientY > r.bottom + margin) {
    activeStatusPopover.remove();
    activeStatusPopover = null;
  }
});

document.addEventListener('keydown', function escStatusPopover(e) {
  if (e.key === 'Escape' && activeStatusPopover) {
    activeStatusPopover.remove();
    activeStatusPopover = null;
  }
});

// ─── Context menu (right-click status change) ───

function showMyListContextMenu(e, id) {
  e.preventDefault();
  e.stopPropagation();
  const item = mylistData.find(i => i.id === id);
  if (!item) return;

  const menu = document.getElementById('contextMenu');

  if (item.source === 'wishlist') {
    // Wishlist items: only show remove option
    menu.innerHTML = `
      <div class="context-menu-item context-menu-danger" onclick="event.stopPropagation();deleteWishlistItem('${id}')">从愿望单移除</div>`;
  } else {
    // Library items: show status options
    const statuses = [
      { value: 'watching', label: '当前观看' },
      { value: 'wish', label: '计划中' },
      { value: 'completed', label: '已完成' },
      { value: 'on_hold', label: '搁置' },
      { value: 'dropped', label: '抛弃' },
    ];

    menu.innerHTML = statuses.map(s => {
      const active = s.value === item.status;
      return `
        <div class="context-menu-item${active ? ' context-menu-item--active' : ''}"
             onclick="event.stopPropagation();setMyListItemStatus('${id}', '${s.value}');hideContextMenu()">
          ${active ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align:middle;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          ${s.label}
        </div>`;
    }).join('') + `
      <div class="context-menu-divider"></div>
      <div class="context-menu-item context-menu-danger" onclick="event.stopPropagation();removeMyListItem('${id}')">移除</div>`;
  }

  // Position
  let x = e.clientX;
  let y = e.clientY;
  menu.classList.add('show');
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

async function setMyListItemStatus(id, status) {
  try {
    await API.put(`/api/mylist/${encodeURIComponent(id)}/status`, { status });
    showToast('状态已更新');
    hideContextMenu();
    loadMyList();
    if (typeof loadLibrary === 'function') loadLibrary();
  } catch (e) {
    showToast('更新失败: ' + e.message);
  }
}

async function deleteWishlistItem(id) {
  hideContextMenu();
  if (!(await showConfirm('从愿望单移除？'))) return;
  try {
    await API.del(`/api/wishlist/${encodeURIComponent(id)}`);
    showToast('已移除');
    loadMyList();
  } catch (e) {
    showToast('移除失败: ' + e.message);
  }
}

async function removeMyListItem(id) {
  hideContextMenu();
  const item = mylistData.find(i => i.id === id);
  const name = item ? (item.bangumiTitle || item.title || id) : id;
  if (!(await showConfirm(`将「${name}」从列表中移除？<br><small style="color:var(--text2)">资料库中的条目不受影响</small>`))) return;
  try {
    await API.del(`/api/mylist/${encodeURIComponent(id)}`);
    showToast('已移除');
    loadMyList();
  } catch (e) {
    showToast('移除失败: ' + e.message);
  }
}
