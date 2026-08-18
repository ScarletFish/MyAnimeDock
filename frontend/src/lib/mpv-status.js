// Global mpv-status SSE listener — playback end feedback on any page.
// Progress data is persisted by server per event; this module handles the UI feedback
// at the moment playback ends: auto-focus window + toast + pending "mark finished" prompt.
// Side-effect module: importing starts the listener.

import { showToast } from '../components/Toast.svelte';
import { API } from './api.js';
import { currentView } from './router.js';
import { handleDetailPlaybackEnded } from '../views/Detail.svelte';
import { loadLibrary } from '../views/Library.svelte';
import { pendingFinishAnimeId } from './ui-state.js';

let gMpvActive = false;
let gMpvAnimeId = null;

function focusAppWindow() {
  if (!(window.__TAURI__ && window.__TAURI__.window)) return;
  try {
    var win = window.__TAURI__.window.getCurrentWindow();
    win.unminimize().then(function () { return win.setFocus(); }).catch(function () {});
  } catch (_) {}
}

function onGlobalMpvStatus(active, payload) {
  if (active) {
    gMpvActive = true;
    gMpvAnimeId = payload.animeId || null;
    return;
  }
  if (!gMpvActive) return;
  gMpvActive = false;
  var endedAnimeId = gMpvAnimeId;
  gMpvAnimeId = null;

  focusAppWindow();

  if (currentView === 'detail' && handleDetailPlaybackEnded(endedAnimeId)) {
    return;
  }

  showToast(t('app.playbackEndedProgressUpdated'), 'success');
  if (endedAnimeId) pendingFinishAnimeId.set(endedAnimeId);
  // 非详情页（如 Dashboard）停留时刷新库数据，让「继续观看」卡片立即反映最新进度
  loadLibrary();
}

export function startGlobalMpvStatus() {
  var es = new EventSource('/api/events/mpv-status');
  es.onmessage = function (e) {
    try { var p = JSON.parse(e.data); onGlobalMpvStatus(p.active, p); } catch (_) {}
  };
  API.get('/api/mpv-status').then(function (st) { onGlobalMpvStatus(st.active, st); }).catch(function () {});
}
