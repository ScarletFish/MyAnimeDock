const net = require('net');
const { spawn } = require('child_process');

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
  let mpvProcess = null;
  let socket = null;
  let buf = '';

  function sendCommand(command, args) {
    if (!socket || !socket.writable) return;
    const msg = JSON.stringify({ command: [command, ...(args || [])] }) + '\n';
    socket.write(msg);
  }

  function cleanup() {
    if (!running) return;
    running = false;
    clearInterval(saveTimer);
    if (socket) {
      socket.removeAllListeners();
      try { socket.end(); socket.destroy(); } catch (e) {}
      socket = null;
    }
    if (mpvProcess) {
      mpvProcess.removeAllListeners();
      try { mpvProcess.kill('SIGTERM'); } catch (e) {}
      mpvProcess = null;
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

  function processMessage(msg) {
    if (msg.event === 'playback-restart') {
      if (currentDuration <= 0) {
        clearInterval(saveTimer);
        saveTimer = setInterval(() => {
          if (!isPaused) save();
        }, SAVE_INTERVAL_MS);
      }
      if (position > 0) {
        setTimeout(() => sendCommand('seek', [position, 'absolute', 'exact']), 300);
      }
      return;
    }
    if (msg.event === 'idle' || msg.event === 'end-file') {
      save();
      cleanup();
      return;
    }
    if (msg.event === 'pause') { isPaused = true; return; }
    if (msg.event === 'unpause') { isPaused = false; return; }
    if (msg.event === 'property-change') {
      if (msg.name === 'time-pos' && msg.data != null) {
        currentPos = msg.data;
      } else if (msg.name === 'duration') {
        if (msg.data != null) currentDuration = msg.data;
      } else if (msg.name === 'pause') {
        if (msg.data != null) isPaused = msg.data;
      }
    }
  }

  // 获取可用 TCP 端口
  const portServer = net.createServer();
  portServer.on('error', (err) => {
    if (sessionId !== sessionIdCounter) return;
    console.error('port allocation error:', err);
    if (callbacks.onError) callbacks.onError(String(err));
  });
  portServer.listen(0, '127.0.0.1', () => {
    const port = portServer.address().port;
    portServer.close(() => {
      if (sessionId !== sessionIdCounter) return;

      mpvProcess = spawn(mpvPath, [
        `--input-ipc-server=tcp://127.0.0.1:${port}`,
        '--idle',
        '--really-quiet',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      mpvProcess.on('error', (err) => {
        if (sessionId !== sessionIdCounter) return;
        console.error('mpv error:', err);
        if (callbacks.onError) callbacks.onError(String(err));
        cleanup();
      });

      mpvProcess.on('exit', (code, signal) => {
        if (sessionId !== sessionIdCounter) return;
        if (running) {
          const reason = code !== null ? `exit code ${code}` : `signal ${signal}`;
          console.error('mpv process ended:', reason);
          if (callbacks.onError) callbacks.onError('播放器异常退出');
          cleanup();
        }
      });

      let connectAttempts = 0;

      function tryConnect() {
        if (sessionId !== sessionIdCounter) return;
        connectAttempts++;
        if (connectAttempts > 30) {
          if (callbacks.onError) callbacks.onError('无法连接到 mpv IPC');
          cleanup();
          return;
        }

        socket = new net.Socket();
        socket.connect(port, '127.0.0.1', () => {
          sendCommand('observe_property', [0, 'time-pos']);
          sendCommand('observe_property', [1, 'duration']);
          sendCommand('observe_property', [2, 'pause']);
          sendCommand('loadfile', [filePath, 'replace']);
        });

        socket.on('data', (data) => {
          if (sessionId !== sessionIdCounter) return;
          buf += data.toString();
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line) continue;
            try { processMessage(JSON.parse(line)); } catch (e) { /* skip malformed */ }
          }
        });

        socket.on('error', () => {
          if (socket) {
            socket.removeAllListeners();
            try { socket.destroy(); } catch (e) {}
            socket = null;
          }
          if (running) setTimeout(tryConnect, 200);
        });

        socket.on('close', () => {
          if (sessionId !== sessionIdCounter) return;
          if (running) {
            save();
            cleanup();
          }
        });
      }

      setTimeout(tryConnect, 400);
    });
  });

  return {
    stop: () => {
      if (running) save();
      sendCommand('stop');
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
