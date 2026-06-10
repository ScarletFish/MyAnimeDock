const MPV = require('node-mpv');

const SAVE_INTERVAL_MS = 10000;
const WATCHED_RATIO = 0.9;
let sessionIdCounter = 0;

function startMpv(mpvPath, filePath, position, callbacks) {
  const sessionId = ++sessionIdCounter;
  let currentPos = position || 0;
  let currentDuration = 0;
  let isPaused = false;
  let saveTimer = null;
  let running = true;

  const mpv = new MPV({
    binary: mpvPath,
    socket: process.platform === 'win32'
      ? '\\\\.\\pipe\\mpv-anime-manager'
      : '/tmp/mpv-anime-manager.sock',
    time_update: 1,
    debug: false,
    verbose: false,
  });

  function save() {
    if (!running) return;
    callbacks.onProgress({
      filePath,
      progress: currentPos,
      watched: currentDuration > 0 && currentPos / currentDuration >= WATCHED_RATIO,
      duration: currentDuration,
    });
  }

  function cleanup() {
    if (!running) return;
    running = false;
    clearInterval(saveTimer);
    try { mpv.quit(); } catch (e) {}
  }

  mpv.on('started', () => {
    if (sessionId !== sessionIdCounter) return;
    if (position > 0) {
      setTimeout(() => { mpv.goToPosition(position); }, 300);
    }
    saveTimer = setInterval(() => {
      if (!isPaused) save();
    }, SAVE_INTERVAL_MS);
  });

  mpv.on('timeposition', (pos) => {
    if (sessionId !== sessionIdCounter) return;
    currentPos = pos;
  });

  mpv.on('statuschange', (status) => {
    if (sessionId !== sessionIdCounter) return;
    if (status.duration != null) currentDuration = status.duration;
    if (status.pause != null) isPaused = status.pause;
  });

  mpv.on('paused', () => { isPaused = true; });
  mpv.on('resumed', () => { isPaused = false; });

  mpv.on('stopped', () => {
    if (sessionId !== sessionIdCounter) return;
    save();
    cleanup();
  });

  mpv.on('error', (err) => {
    if (sessionId !== sessionIdCounter) return;
    console.error('mpv error:', err);
    if (callbacks.onError) callbacks.onError(String(err));
    cleanup();
  });

  const startOpts = position > 0 ? [`start=${position}`] : undefined;
  mpv.load(filePath, 'replace', startOpts).catch(err => {
    if (sessionId !== sessionIdCounter) return;
    console.error('mpv load failed:', err);
    if (callbacks.onError) callbacks.onError(String(err));
    cleanup();
  });

  return {
    stop: () => {
      save();
      if (mpv) { try { mpv.stop(); } catch (e) {} }
    },
    kill: () => {
      if (mpv) { try { mpv.quit(); } catch (e) {} }
    },
  };
}

let activeSession = null;

function start(mpvPath, filePath, position, callbacks) {
  if (activeSession) {
    const old = activeSession;
    activeSession = null;
    old.kill();
  }
  activeSession = startMpv(mpvPath, filePath, position, callbacks);
  return activeSession;
}

function stopCurrent() {
  if (activeSession) {
    activeSession.kill();
    activeSession = null;
  }
}

module.exports = { startMpv: start, stopCurrent };