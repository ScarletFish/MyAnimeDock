// DB management (搬移自 app.js —— 零逻辑改动)

// ─── DB Management ───

async function refreshDbInfo() {
  const container = document.getElementById('dbInfoContainer');
  const cacheContainer = document.getElementById('dbCacheContainer');
  if (!container) return;
  try {
    const info = await API.get('/api/db/info');
    const dbSizeStr = info.dbSize > 1048576
      ? (info.dbSize / 1048576).toFixed(1) + ' MB'
      : info.dbSize > 1024
        ? (info.dbSize / 1024).toFixed(1) + ' KB'
        : info.dbSize + ' B';
    const configSizeStr = info.configSize > 1024
      ? (info.configSize / 1024).toFixed(1) + ' KB'
      : info.configSize + ' B';
    container.innerHTML = '<div class="db-info-grid">' +
      '<div class="db-info-item db-info-item--full"><span class="db-info-label">' + t('app.dbLocation') + '</span><span class="db-info-value db-info-path" data-tooltip="' + escAttr(info.dbPath) + '">' + escHtml(info.dbPath) + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">' + t('app.dbSize') + '</span><span class="db-info-value">' + dbSizeStr + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">' + t('app.animeCount') + '</span><span class="db-info-value">' + info.counts.anime + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">' + t('app.episodeCount') + '</span><span class="db-info-value">' + info.counts.episodes + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">' + t('app.playSessionCount') + '</span><span class="db-info-value">' + info.counts.playSessions + '</span></div>' +
      '<div class="db-info-item"><span class="db-info-label">' + t('app.myListCount') + '</span><span class="db-info-value">' + info.counts.myList + '</span></div>' +
    '</div>';

    // 渲染缓存信息
    if (cacheContainer) {
      if (info.cache) {
        var cacheHtml = '<div class="db-info-grid">';
        for (var key in info.cache) {
          var c = info.cache[key];
          var label = {thumbs:t('app.cacheVideoThumbs'), covers:t('app.cacheCovers'), banners:t('app.cacheBanners')}[key] || key;
          cacheHtml += '<div class="db-info-item">' +
            '<span class="db-info-label">' + label + '</span>' +
            '<span class="db-info-value">' + formatSize(c.size) + '</span>' +
            '<span class="db-info-label" style="margin-top:1px">' + t('app.cacheFilesCount', { count: c.files }) + '</span>' +
          '</div>';
        }
        cacheHtml += '</div>' +
          '<div class="db-action-row mt-2">' +
            '<button class="btn btn-sm" onclick="dbClearCache(\'thumbs\')" data-tooltip="' + t('app.clearCacheTooltipThumbs') + '">' + t('app.clearCacheBtnThumbs') + '</button>' +
            '<button class="btn btn-sm" onclick="dbClearCache(\'covers\')" data-tooltip="' + t('app.clearCacheTooltipCovers') + '">' + t('app.clearCacheBtnCovers') + '</button>' +
            '<button class="btn btn-sm" onclick="dbClearCache(\'banners\')" data-tooltip="' + t('app.clearCacheTooltipBanners') + '">' + t('app.clearCacheBtnBanners') + '</button>' +
            '<button class="btn btn-sm" onclick="dbClearCache(\'all\')" data-tooltip="' + t('app.clearCacheTooltipAll') + '">' + t('app.clearCacheBtnAll') + '</button>' +
          '</div>';
        cacheContainer.innerHTML = cacheHtml;
      } else {
        cacheContainer.innerHTML = '<p class="form-hint">' + t('app.noCacheData') + '</p>';
      }
    }
  } catch (e) {
    container.innerHTML = '<p class="form-hint text-error">' + t('app.dbInfoLoadFailed', { error: escHtml(e.message) }) + '</p>';
  }
}

async function dbClearCache(target) {
  var label = {thumbs:t('app.cacheLabelThumbs'), covers:t('app.cacheLabelCovers'), banners:t('app.cacheLabelBanners'), all:t('app.cacheLabelAll')}[target] || target;
  var confirmed = await showConfirm(t('app.confirmClearCache', { label: label }));
  if (!confirmed) return;

  try {
    var res = await API.post('/api/db/clear-cache', { target: target === 'all' ? undefined : target });
    if (res.ok) {
      var parts = [];
      for (var key in res.results) {
        var r = res.results[key];
        if (r.cleared > 0) parts.push(key + ': ' + formatSize(r.size) + ' (' + t('app.cacheFilesCount', { count: r.cleared }) + ')');
      }
      showToast(t('app.cacheCleared', { label: label, parts: parts.length ? parts.join(' | ') : '' }), 'success');
      refreshDbInfo();
    }
  } catch (e) {
    showToast(t('app.clearCacheFailed', { error: e.message }), 'error');
  }
}

function dbBackup() {
  const btn = document.getElementById('btnDbBackup');
  btn.disabled = true;
  btn.textContent = t('app.downloadingBackup');
  // 直接用 fetch 获取二进制
  fetch('/api/db/backup')
    .then(res => {
      if (!res.ok) throw new Error(t('app.dbBackupError'));
      return res.blob();
    })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = blob.name || `myanimedock-backup-${new Date().toISOString().slice(0, 10)}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(t('app.backupDownloaded'), 'success');
    })
    .catch(e => showToast(t('app.backupFailed', { error: e.message }), 'error'))
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8"/><path d="M5 5l3-3 3 3"/><path d="M8 2v9"/></svg> ' + t('app.downloadDbBackup');
    });
}

async function dbBackupAll() {
  const btn = document.getElementById('btnDbBackupAll');
  btn.disabled = true;
  btn.textContent = t('app.packingBackup');
  try {
    const res = await fetch('/api/db/backup/download-all', { method: 'POST' });
    if (!res.ok) throw new Error(t('app.packBackupError'));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `myanimedock-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(t('app.fullBackupDownloaded'), 'success');
  } catch (e) {
    showToast(t('app.backupFailed', { error: e.message }), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8v5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8"/><path d="M5 5l3-3 3 3"/><path d="M8 2v9"/></svg> ' + t('app.fullBackupWithConfig');
  }
}

async function dbRestore(input) {
  const file = input.files[0];
  if (!file) return;

  const confirmed = await showConfirm(t('app.confirmRestoreBackup'));
  if (!confirmed) {
    input.value = '';
    return;
  }

  // Show loading state on the file input's sibling buttons
  showToast(t('app.restoringDatabase'), 'info');

  try {
    // 读取文件为 base64
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onload = () => {
        const result = reader.result;
        const commaIdx = result.indexOf(',');
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const res = await API.post('/api/db/restore', { file: base64 });
    if (res.ok) {
      showToast(t('app.databaseRestored'), 'success');
      refreshDbInfo();
      if (typeof refreshLibrary === 'function') refreshLibrary();
    }
  } catch (e) {
    showToast(t('app.restoreFailed', { error: e.message }), 'error');
  } finally {
    input.value = '';
  }
}

async function dbClearSessions() {
  const confirmed = await showConfirm(t('app.confirmClearSessions'));
  if (!confirmed) return;

  const btn = document.getElementById('btnDbClearSessions');
  btn.disabled = true;
  btn.textContent = t('app.clearingSessions');
  try {
    const res = await API.post('/api/db/clear-sessions', {});
    if (res.ok) {
      showToast(t('app.sessionsCleared'), 'success');
      refreshDbInfo();
    }
  } catch (e) {
    showToast(t('app.clearSessionsFailed', { error: e.message }), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4h14"/><path d="M3 4v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4"/><path d="M6 4V2h4v2"/></svg> ' + t('app.clearSessionsBtn');
  }
}

async function dbVacuum() {
  const confirmed = await showConfirm(t('app.confirmVacuum'));
  if (!confirmed) return;

  const btn = document.getElementById('btnDbVacuum');
  btn.disabled = true;
  btn.textContent = t('app.vacuuming');
  try {
    const res = await API.post('/api/db/vacuum', {});
    if (res.ok) {
      const newSize = res.dbSize > 1048576
        ? (res.dbSize / 1048576).toFixed(1) + ' MB'
        : (res.dbSize / 1024).toFixed(1) + ' KB';
      showToast(t('app.vacuumComplete', { size: newSize }), 'success');
      refreshDbInfo();
    }
  } catch (e) {
    showToast(t('app.vacuumFailed', { error: e.message }), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="7"/><path d="M8 5v3"/><path d="M8 11h.01"/></svg> ' + t('app.vacuumBtn');
  }
}

async function dbReset() {
  const step1 = await showConfirm(t('app.confirmResetDbStep1'));
  if (!step1) return;

  const step2 = await showConfirm(t('app.confirmResetDbStep2'));
  if (!step2) return;

  const btn = document.getElementById('btnDbReset');
  btn.disabled = true;
  btn.textContent = t('app.resettingDb');
  try {
    const res = await API.post('/api/db/reset', {});
    if (res.ok) {
      showToast(t('app.databaseReset'), 'info');
      refreshDbInfo();
      // 刷新各个界面
      if (typeof refreshLibrary === 'function') refreshLibrary();
      if (typeof renderMyList === 'function') renderMyList();
    }
  } catch (e) {
    showToast(t('app.resetFailed', { error: e.message }), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l4 4"/><path d="M10 6l-4 4"/><circle cx="8" cy="8" r="7"/></svg> ' + t('app.resetDbBtn');
  }
}

// ─── ESM exports for onclick handlers ───
window.dbBackup = dbBackup;
window.dbBackupAll = dbBackupAll;
window.dbRestore = dbRestore;
window.dbVacuum = dbVacuum;
window.dbReset = dbReset;
window.dbClearCache = dbClearCache;
window.dbClearSessions = dbClearSessions;