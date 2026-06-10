const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
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
  let mpv = null;

  const ipcId = crypto.randomUUID().slice(0, 8);
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\mpv-anime-${ipcId}`
    : `/tmp/mpv-anime-${ipcId}.sock`;

  // node-mpv 内部 spawn 时给 binary 加引号导致反斜杠路径出错。
  // 解决：将目录加入 PATH，只传可执行文件名给 node-mpv。
  const mpvDir = path.dirname(mpvPath);
  const mpvExe = path.basename(mpvPath);
  const hasDir = mpvDir && mpvDir !== '.' && mpvDir !== mpvPath;
  if (hasDir) {
    process.env.PATH = mpvDir + path.delimiter + (process.env.PATH || '');
  }
  const binaryName = hasDir ? mpvExe : mpvPath;

  function cleanup() {
    if (!running) return;
    running = false;
    clearInterval(saveTimer);
    try { mpv.quit(); } catch (e) {}
    mpv = null;
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(socketPath); } catch (e) {}
    }
  }

  function save() {
    if (!running) return;
    callbacks.onProgress({
      filePath,
      progress: currentPos,
      watched: currentDuration > 0 && currentPos / currentDuration >= WATCHED_RATIO,
      duration: currentDuration,
    });
  }

  mpv = new MPV({
    binary: binaryName,
    socket: socketPath,
    time_update: 1,
    debug: false,
    verbose: false,
  });

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
  mpv.load(filePath, 'replace', startOpts);

  return {
    stop: () => {
      save();
      try { mpv.stop(); } catch (e) {}
    },
    kill: () => {
      cleanup();
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
