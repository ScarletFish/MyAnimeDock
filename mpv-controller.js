const net = require('net');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SAVE_INTERVAL_MS = 10000;
const WATCHED_RATIO = 0.9;
const SOCKET_WAIT_TIMEOUT = 5000;

let currentSession = null;

function startMpv(mpvPath, filePath, position, callbacks) {
  if (currentSession) currentSession.stop();

  const socketPath = path.join(os.tmpdir(), `mpv-${Date.now()}-${Math.random().toString(36).slice(2,8)}.sock`);

  const session = {
    process: null, client: null, timer: null,
    socketPath, filePath,
    currentPos: position || 0, duration: 0, paused: false,
    running: true,
    stop() {
      if (!this.running) return;
      callbacks.onProgress({
        progress: this.currentPos,
        watched: this.duration > 0 && this.currentPos / this.duration >= WATCHED_RATIO,
        duration: this.duration,
      });
      this.running = false;
      if (this.timer) clearInterval(this.timer);
      if (this.client) { try { this.client.destroy(); } catch (e) {} }
      if (this.process && !this.process.killed) { try { this.process.kill('SIGTERM'); } catch (e) {} }
      try { fs.unlinkSync(this.socketPath); } catch (e) {}
    }
  };

  currentSession = session;

  const args = [];
  if (position > 0) {
    const h = Math.floor(position / 3600);
    const m = Math.floor((position % 3600) / 60);
    const s = Math.floor(position % 60);
    args.push(`--start=${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
  }
  args.push(`--input-ipc-server=${socketPath}`, '--no-terminal', '--msg-level=all=no', filePath);

  session.process = spawn(mpvPath, args, { stdio: 'ignore' });

  session.process.on('exit', () => session.stop());

  session.process.on('error', (err) => {
    console.error('mpv process error:', err.message);
    callbacks.onError ? callbacks.onError(err.message) : null;
    session.stop();
  });

  waitForSocket(socketPath).then(connected => {
    if (!session.running || !connected) return;
    session.client = net.createConnection(socketPath);

    let buf = '';
    session.client.on('data', data => {
      buf += data.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handleMessage(session, JSON.parse(line), callbacks); } catch (e) { /* skip non-json */ }
      }
    });

    session.client.on('error', () => {});
    session.client.on('close', () => {});

    sendCmd(session.client, ['observe_property', 1, 'time-pos']);
    sendCmd(session.client, ['observe_property', 2, 'duration']);
    sendCmd(session.client, ['observe_property', 3, 'pause']);
    sendCmd(session.client, ['get_property', 'time-pos']);
    sendCmd(session.client, ['get_property', 'duration']);

    session.timer = setInterval(() => {
      if (!session.paused && session.running) {
        callbacks.onProgress({
          progress: session.currentPos,
          watched: session.duration > 0 && session.currentPos / session.duration >= WATCHED_RATIO,
          duration: session.duration,
        });
      }
    }, SAVE_INTERVAL_MS);
  });

  return session;
}

function stopCurrent() {
  if (currentSession) currentSession.stop();
}

function waitForSocket(socketPath) {
  return new Promise(resolve => {
    let waited = 0;
    const check = () => {
      if (fs.existsSync(socketPath)) return resolve(true);
      waited += 200;
      if (waited >= SOCKET_WAIT_TIMEOUT) return resolve(false);
      setTimeout(check, 200);
    };
    check();
  });
}

function sendCmd(client, cmd) {
  if (client && client.writable) {
    client.write(JSON.stringify({ command: cmd }) + '\n');
  }
}

function handleMessage(session, msg, callbacks) {
  switch (msg.event) {
    case 'property-change':
      if (msg.name === 'time-pos') session.currentPos = msg.data || 0;
      else if (msg.name === 'duration') session.duration = msg.data || 0;
      else if (msg.name === 'pause') session.paused = msg.data;
      break;
    case 'end-file':
      if (msg.reason === 'eof' && session.running) {
        const watched = session.duration > 0 && session.currentPos / session.duration >= WATCHED_RATIO;
        callbacks.onProgress({ progress: watched ? session.duration : session.currentPos, watched, duration: session.duration });
      }
      session.stop();
      break;
  }
}

module.exports = { startMpv, stopCurrent };