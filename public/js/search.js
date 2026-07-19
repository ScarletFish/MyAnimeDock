// Global search — titlebar search input for anime names and settings
(function() {
  'use strict';

  var input = document.getElementById('globalSearchInput');
  var results = document.getElementById('globalSearchResults');
  var searchTimer = null;

  // ─── Settings search map ───
  var SETTINGS_MAP = [
    { label: '媒体目录路径', tab: 'basic', keywords: '媒体目录 媒体文件夹 目录路径 存储 根目录' },
    { label: 'mpv 播放器路径', tab: 'playback', keywords: 'mpv 播放器 可执行文件 路径' },
    { label: '自动标记已观看', tab: 'playback', keywords: '自动标记 已观看 播放 进度 前序' },
    { label: 'Bangumi API 地址', tab: 'scraper', keywords: 'bangumi api 刮削 元数据 地址 镜像' },
    { label: 'AniList 集成', tab: 'scraper', keywords: 'anilist 罗马音 标题搜索 可选' },
    { label: '动漫库模块布局', tab: 'dashboard', keywords: '模块 统计 继续观看 本地动漫 布局 排序' },
  ];

  var TAB_NAMES = { basic: '基本', playback: '播放', scraper: '刮削', dashboard: '动漫库' };

  // ─── Filter logic ───
  function filterByQuery(query) {
    var q = query.toLowerCase().trim();
    if (!q) return { anime: [], settings: [] };

    // Anime search — libraryData is a global let from library.js
    var animeResults = [];
    if (typeof libraryData !== 'undefined' && libraryData.length) {
      for (var i = 0; i < libraryData.length; i++) {
        var a = libraryData[i];
        var matchFields = [a.bangumiTitle, a.title, a.pinyinTitle]
          .filter(Boolean)
          .map(function(s) { return s.toLowerCase(); });
        var matched = false;
        for (var j = 0; j < matchFields.length; j++) {
          if (matchFields[j].indexOf(q) !== -1) { matched = true; break; }
        }
        if (matched) {
          animeResults.push({
            type: 'anime',
            id: a.id,
            label: a.bangumiTitle || a.title,
            sublabel: a.pinyinTitle || ''
          });
        }
      }
    }

    // Settings search — tab names
    var settingsResults = [];
    for (var tabKey in TAB_NAMES) {
      if (TAB_NAMES[tabKey].toLowerCase().indexOf(q) !== -1) {
        settingsResults.push({ type: 'settings', tab: tabKey, label: TAB_NAMES[tabKey], sublabel: '设置页' });
        break;
      }
    }
    // Search individual setting items
    for (var k = 0; k < SETTINGS_MAP.length; k++) {
      var s = SETTINGS_MAP[k];
      var searchable = (s.label + ' ' + s.keywords).toLowerCase();
      if (searchable.indexOf(q) !== -1) {
        settingsResults.push({ type: 'settings', tab: s.tab, label: s.label, sublabel: TAB_NAMES[s.tab] });
      }
    }

    return { anime: animeResults, settings: settingsResults };
  }

  // ─── Render dropdown ───
  function renderDropdown(filtered) {
    if (!filtered.anime.length && !filtered.settings.length) {
      results.innerHTML = '<div class="titlebar__search-empty">无匹配结果</div>';
      results.classList.remove('hidden');
      return;
    }

    var html = '';

    if (filtered.anime.length) {
      html += '<div class="titlebar__search-group">动漫</div>';
      for (var i = 0; i < filtered.anime.length; i++) {
        var r = filtered.anime[i];
        html += '<div class="titlebar__search-item" data-type="anime" data-id="' + r.id + '">' +
          '<svg class="titlebar__search-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>' +
          '<div class="titlebar__search-item-text">' +
          '<span class="titlebar__search-item-label">' + escHtml(r.label) + '</span>' +
          (r.sublabel ? '<span class="titlebar__search-item-sublabel">' + escHtml(r.sublabel) + '</span>' : '') +
          '</div></div>';
      }
    }

    if (filtered.settings.length) {
      html += '<div class="titlebar__search-group">设置</div>';
      for (var j = 0; j < filtered.settings.length; j++) {
        var s = filtered.settings[j];
        html += '<div class="titlebar__search-item" data-type="settings" data-tab="' + s.tab + '">' +
          '<svg class="titlebar__search-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>' +
          '<div class="titlebar__search-item-text">' +
          '<span class="titlebar__search-item-label">' + escHtml(s.label) + '</span>' +
          '<span class="titlebar__search-item-sublabel">' + escHtml(s.sublabel) + '</span>' +
          '</div></div>';
      }
    }

    results.innerHTML = html;
    results.classList.remove('hidden');
  }

  // ─── Navigation ───
  function navigateTo(itemEl) {
    var type = itemEl.getAttribute('data-type');
    var id = itemEl.getAttribute('data-id');
    var tab = itemEl.getAttribute('data-tab');

    closeDropdown();

    if (type === 'anime' && id) {
      if (typeof showDetail === 'function') {
        showDetail(id);
      }
    } else if (type === 'settings' && tab) {
      if (typeof openSettings === 'function') {
        openSettings().then(function() {
          var btn = document.querySelector('.settings-tab[data-tab="' + tab + '"]');
          if (btn && typeof switchSettingsTab === 'function') {
            switchSettingsTab(btn, tab);
          }
        })['catch'](function() {
          // Silently ignore openSettings failure
        });
      }
    }
  }

  function closeDropdown() {
    results.classList.add('hidden');
    results.innerHTML = '';
  }

  // ─── Input handler (debounced 300ms) ───
  if (input) {
    input.addEventListener('input', function() {
      clearTimeout(searchTimer);
      var q = this.value.trim();
      if (!q) { closeDropdown(); return; }
      searchTimer = setTimeout(function() {
        var filtered = filterByQuery(q);
        renderDropdown(filtered);
      }, 300);
    });

    // Navigate on click
    results.addEventListener('click', function(e) {
      var item = e.target.closest('.titlebar__search-item');
      if (item) navigateTo(item);
    });

    // Escape / Enter
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeDropdown();
        input.blur();
      }
      if (e.key === 'Enter') {
        var first = results.querySelector('.titlebar__search-item');
        if (first) navigateTo(first);
      }
    });
  }

  // ─── Close on outside click ───
  document.addEventListener('click', function(e) {
    var container = document.getElementById('titlebarSearch');
    if (container && !container.contains(e.target)) {
      closeDropdown();
    }
  });

  // ─── Close on scroll ───
  document.addEventListener('scroll', closeDropdown, true);

  // ─── Ctrl+F / Cmd+F → focus search ───
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      if (input) { input.focus(); input.select(); }
    }
  });

})();
