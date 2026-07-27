// ─── Calendar: Weekly anime schedule view ───

const CALENDAR_STATUS_OPTIONS = ['watching', 'wish', 'on_hold'];
const CALENDAR_STATUS_LABELS = { watching: '在看', wish: '想看', on_hold: '搁置' };
const CALENDAR_CACHE_TTL = 30 * 60 * 1000; // 30 分钟缓存

let _openCalendarMenu = null;
const _calendarCache = createTimedCache(CALENDAR_CACHE_TTL);

async function loadCalendar() {
  const container = document.getElementById('calendarGrid');
  const seasonEl = document.getElementById('calendarSeason');
  if (!container) return;

  // 检查缓存
  const cached = _calendarCache.get();
  if (cached) {
    renderCalendar(cached, container, seasonEl);
    return;
  }

  container.innerHTML = '<div class="calendar-loading">加载中…</div>';

  try {
    const data = await API.get('/api/calendar');
    if (!data || data.length === 0) {
      container.innerHTML = '<div class="calendar-loading">暂无本季放送数据</div>';
      return;
    }
    // 写入缓存
    _calendarCache.set(data);
    renderCalendar(data, container, seasonEl);
  } catch (e) {
    if (window.location.origin !== 'http://localhost:3456') return;
    container.innerHTML = '<div class="calendar-error">加载失败: ' + escHtml(e.message) + '</div>';
  }
}

function renderCalendar(data, container, seasonEl) {
  // 从第一条数据推断季度
  for (var di = 0; di < data.length; di++) {
    var day = data[di];
    if (day.items && day.items.length > 0 && day.items[0].air_date) {
      var d = day.items[0].air_date;
      var y = d.slice(0, 4);
      var m = parseInt(d.slice(5, 7), 10);
      var sq = Math.ceil(m / 3) * 3;
      var sn = { 3: '冬季', 6: '春季', 9: '夏季', 12: '秋季' }[sq] || '';
      if (seasonEl) seasonEl.textContent = y + '年' + sn;
      break;
    }
  }

  var today = new Date();
  var todayDow = today.getDay(); // 0=Sun
  var dayNames = ['日', '一', '二', '三', '四', '五', '六'];

  var html = '';
  for (var di = 0; di < data.length; di++) {
    var day = data[di];
    var dayId = day.weekday?.id || 0;
    var dayCn = day.weekday?.cn || ('星期' + dayNames[dayId]);
    var isToday = dayId === todayDow;

    html += '<div class="calendar-day-col">';
    html += '<div class="calendar-day-header' + (isToday ? ' is-today' : '') + '">';
    html += dayCn;
    html += '<span class="cal-day-num">' + (isToday ? today.getDate() : '') + '</span>';
    html += '</div>';

    for (var ii = 0; ii < day.items.length; ii++) {
      var item = day.items[ii];
      var title = item.name_cn || item.name || '';
      var rating = item.rating != null ? item.rating.toFixed(1) : '';
      var coverSrc = item.coverUrl || '';
      var inLib = item.inLibrary;
      var hasStatus = item.mylistStatus && CALENDAR_STATUS_OPTIONS.indexOf(item.mylistStatus) >= 0;
      var bgmId = item.id;
      var libAnimeId = item.libraryAnimeId || '';

      html += '<div class="calendar-card"'
        + ' data-bangumi-id="' + bgmId + '"'
        + ' data-in-library="' + (inLib ? '1' : '0') + '"'
        + ' data-lib-anime-id="' + libAnimeId + '">';

      // 封面
      if (coverSrc) {
        html += '<img class="cal-cover" src="' + coverSrc + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
      } else {
        html += '<div class="cal-cover" style="background:var(--bg-surface);display:flex;align-items:center;justify-content:center;color:var(--fg-muted);font-size:0.6rem">无图</div>';
      }

      // 库内徽章
      if (inLib) {
        html += '<div class="cal-lib-badge">库内</div>';
      }

      // 始终可见的标题条
      html += '<div class="cal-title-strip">';
      html += '<div class="cal-card-title">' + escHtml(title) + '</div>';
      html += '</div>';

      // Hover 时出现的完整叠加层
      html += '<div class="cal-overlay">';
      html += '<div class="cal-card-title">' + escHtml(title) + '</div>';
      html += '<div class="cal-card-meta">';
      html += '<span class="cal-card-rating">' + rating + '</span>';

      if (hasStatus) {
        html += '<span class="cal-status-label">' + CALENDAR_STATUS_LABELS[item.mylistStatus] + '</span>';
      } else {
        html += '<div class="cal-follow-wrap">';
        html += '<button class="cal-follow-btn" onclick="event.stopPropagation(); toggleCalendarMenu(event, this)">';
        html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
        html += '</button>';
        html += '<div class="cal-follow-menu">';
        html += '<div class="cal-follow-item" data-status="wish">想看</div>';
        html += '<div class="cal-follow-item" data-status="watching">在看</div>';
        html += '<div class="cal-follow-item" data-status="on_hold">搁置</div>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>'; // cal-card-meta
      html += '</div>'; // cal-overlay
      html += '</div>'; // calendar-card
    }

    html += '</div>'; // calendar-day-col
  }

  container.innerHTML = html;
}

// ─── Follow menu toggle ───
function toggleCalendarMenu(ev, btn) {
  ev.stopPropagation();
  var wrap = btn.closest('.cal-follow-wrap');
  if (!wrap) return;
  var menu = wrap.querySelector('.cal-follow-menu');
  if (!menu) return;

  if (_openCalendarMenu && _openCalendarMenu !== menu) {
    _openCalendarMenu.classList.remove('is-open');
  }

  menu.classList.toggle('is-open');
  _openCalendarMenu = menu.classList.contains('is-open') ? menu : null;
}

// ─── Set follow status via MyList API ───
async function setCalendarStatus(bgmId, status) {
  try {
    var card = document.querySelector('.calendar-card[data-bangumi-id="' + bgmId + '"]');
    var title = card ? (card.querySelector('.cal-card-title')?.textContent || '') : '';
    if (!title) title = 'Anime #' + bgmId;
    var coverEl = card ? card.querySelector('.cal-cover') : null;
    var coverUrl = (coverEl && coverEl.tagName === 'IMG') ? coverEl.getAttribute('src') || '' : '';

    await API.post('/api/wishlist', { bangumiId: bgmId, title: title, coverUrl: coverUrl || null });

    var wishId = 'wish-' + bgmId;
    await API.put('/api/mylist/' + encodeURIComponent(wishId) + '/status', { status: status });

    showToast('已设为' + (CALENDAR_STATUS_LABELS[status] || status), 'success');

    // 刷新前先清除缓存，保证拿到最新数据
    _calendarCache.clear();
    loadCalendar();
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

// ─── Global click handler ───
document.addEventListener('click', function(e) {
  // 关闭打开的菜单
  if (_openCalendarMenu && !e.target.closest('.cal-follow-wrap')) {
    _openCalendarMenu.classList.remove('is-open');
    _openCalendarMenu = null;
  }

  // 菜单项点击
  var menuItem = e.target.closest('.cal-follow-item');
  if (menuItem) {
    e.stopPropagation();
    var menu = menuItem.closest('.cal-follow-menu');
    if (!menu) return;
    // 获取 bangumiId: 从最近的 calendar-card 上读
    var card = menuItem.closest('.calendar-card');
    if (!card) return;
    var bgmId = card.getAttribute('data-bangumi-id');
    var status = menuItem.getAttribute('data-status');
    if (bgmId && status) {
      menu.classList.remove('is-open');
      _openCalendarMenu = null;
      setCalendarStatus(bgmId, status);
    }
    return;
  }

  // 卡片点击
  var card = e.target.closest('.calendar-card');
  if (!card) return;
  if (e.target.closest('.cal-follow-btn') || e.target.closest('.cal-follow-menu')) return;

  var inLibrary = card.getAttribute('data-in-library') === '1';
  var libAnimeId = card.getAttribute('data-lib-anime-id');
  var bangumiId = card.getAttribute('data-bangumi-id');

  if (inLibrary && libAnimeId && typeof openAnimeDetail === 'function') {
    openAnimeDetail(libAnimeId);
  } else if (bangumiId) {
    window.open('https://bgm.tv/subject/' + bangumiId, '_blank');
  }
});

window.loadCalendar = loadCalendar;
