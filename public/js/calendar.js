// ─── Calendar: Weekly anime schedule view ───

const CALENDAR_STATUS_OPTIONS = ['watching', 'wish', 'on_hold'];
const CALENDAR_STATUS_LABELS = { watching: '在看', wish: '想看', on_hold: '搁置' };
const CALENDAR_CACHE_TTL = 30 * 60 * 1000; // 30 分钟缓存

let _calendarAllData = null; // raw unfiltered data
let _calendarFilter = { hideLongRunning: true, country: 'jp' }; // 'all' | 'jp' | 'cn'
const _calendarCache = createTimedCache(CALENDAR_CACHE_TTL);

// ─── Filter helpers ───

const CALENDAR_LONG_RUNNING_THRESHOLD = 100;

function getCalendarFilters() {
  // Always return hardcoded defaults — JP only + hide long-running
  return { hideLongRunning: true, country: 'jp' };
}

function saveCalendarFilters() {
  // no-op: filters are fixed defaults
}

function applyCalFilters(data) {
  return data.map(function(day) {
    var filteredItems = (day.items || []).filter(function(item) {
      // Country filter
      if (_calendarFilter.country !== 'all' && item.country !== _calendarFilter.country) return false;
      // Long-running filter
      if (_calendarFilter.hideLongRunning && item.totalEpisodes != null && item.totalEpisodes >= CALENDAR_LONG_RUNNING_THRESHOLD) return false;
      return true;
    });
    return { weekday: day.weekday, items: filteredItems };
  }).filter(function(day) { return day.items.length > 0; });
}

// ─── Load & render (two-phase progressive) ───

async function loadCalendar() {
  var container = document.getElementById('calendarGrid');
  var seasonEl = document.getElementById('calendarSeason');
  if (!container) return;

  // Restore filter state (hardcoded defaults)
  _calendarFilter = getCalendarFilters();

  // Check full cache first
  var cached = _calendarCache.get();
  if (cached) {
    _calendarAllData = cached;
    renderCalendar(applyCalFilters(cached), container, seasonEl);
    return;
  }

  container.innerHTML = '<div class="calendar-loading">加载中…</div>';

  try {
    // Phase 1: load basic calendar (fast, 1 API call, no per-subject enrichment)
    var basicData = await API.get('/api/calendar?basic=true');
    if (!basicData || basicData.length === 0) {
      container.innerHTML = '<div class="calendar-loading">暂无本季放送数据</div>';
      return;
    }

    _calendarAllData = basicData;
    renderCalendar(applyCalFilters(basicData), container, seasonEl);
    container.querySelectorAll('img').forEach(function(img) { img.loading = 'lazy'; });

    // Phase 2: load enriched calendar with subject details
    // Only if the server cache is cold; once cached, subsequent loads skip phase 1.
    try {
      var fullData = await API.get('/api/calendar');
      if (fullData && fullData.length > 0) {
        _calendarCache.set(fullData);
        _calendarAllData = fullData;
        renderCalendar(applyCalFilters(fullData), container, seasonEl);
        container.querySelectorAll('img').forEach(function(img) { img.loading = 'lazy'; });
      }
    } catch (e2) {
      // Phase 2 failed — keep phase 1 result (good enough)
      if (window.location.origin === 'http://localhost:3456') {
        console.warn('Calendar enrich failed, keeping basic view:', e2.message);
      }
    }
  } catch (e) {
    // Phase 1 failed — fallback to full endpoint (may be slow but works)
    try {
      var data = await API.get('/api/calendar');
      if (!data || data.length === 0) {
        container.innerHTML = '<div class="calendar-loading">暂无本季放送数据</div>';
        return;
      }
      _calendarCache.set(data);
      _calendarAllData = data;
      renderCalendar(applyCalFilters(data), container, seasonEl);
      container.querySelectorAll('img').forEach(function(img) { img.loading = 'lazy'; });
    } catch (e2) {
      if (window.location.origin !== 'http://localhost:3456') return;
      container.innerHTML = '<div class="calendar-error">加载失败: ' + escHtml(e2.message) + '</div>';
    }
  }
}

// ─── Render ───

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

  if (data.length === 0 || data.every(function(d) { return d.items.length === 0; })) {
    container.innerHTML = '<div class="calendar-loading">当前筛选条件下没有内容</div>';
    return;
  }

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

    // Sort items by rating descending (null ratings at bottom)
    var sortedItems = (day.items || []).slice().sort(function(a, b) {
      var ra = a.rating || 0;
      var rb = b.rating || 0;
      return rb - ra;
    });

    for (var ii = 0; ii < sortedItems.length; ii++) {
      var item = sortedItems[ii];
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

      // 常显标题条（可通过设置关闭）
      if (getCardTitleVisible('calendar')) {
        html += '<div class="cal-title-strip">';
        html += '<div class="cal-card-title">' + escHtml(title) + '</div>';
        html += '</div>';
      }

      // Hover 时出现的完整叠加层
      html += '<div class="cal-overlay">';
      html += '<div class="cal-card-title">' + escHtml(title) + '</div>';
      html += '<div class="cal-card-meta">';
      html += '<span class="rating-badge">★ ' + rating + '</span>';

      if (hasStatus) {
        html += '<span class="cal-status-badge">' + CALENDAR_STATUS_LABELS[item.mylistStatus] + '</span>';
      } else {
        html += '<button class="cal-follow-btn" onclick="event.stopPropagation(); setCalendarStatus(\'' + bgmId + '\', \'wish\')" aria-label="想看" data-tooltip="加入到计划中">';
        html += '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
        html += '</button>';
      }

      html += '</div>'; // cal-card-meta
      html += '</div>'; // cal-overlay
      html += '</div>'; // calendar-card
    }

    html += '</div>'; // calendar-day-col
  }

  container.innerHTML = html;
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
  // 卡片点击
  var card = e.target.closest('.calendar-card');
  if (!card) return;
  if (e.target.closest('.cal-follow-btn')) return;

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
