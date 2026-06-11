const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');

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
    let ipcClient = null;
    let ipcBuffer = '';

    const isWin = process.platform === 'win32';
    const pipeName = `mpv-ipc-${process.pid}-${sessionId}`;
    const pipePath = isWin
        ? `\\\\.\\pipe\\${pipeName}`
        : path.join(os.tmpdir(), pipeName);

    const args = [
        filePath,
        `--start=${currentPos}`,
        '--keep-open=yes',
        '--ontop',
        `--input-ipc-server=${pipePath}`,
    ];

    mpvProcess = spawn(mpvPath, args, { windowsHide: isWin });

    function ipcWrite(obj) {
        if (ipcClient && running) {
            ipcClient.write(JSON.stringify(obj) + '\n');
        }
    }

    function connectIPC() {
        if (!running) return;

        ipcClient = net.connect(pipePath, () => {
            console.log(`[mpv IPC] Connected to ${pipeName}`);
            ipcWrite({ command: ['observe_property', 1, 'time-pos'] });
            ipcWrite({ command: ['observe_property', 2, 'duration'] });
            ipcWrite({ command: ['observe_property', 3, 'pause'] });
        });

        ipcClient.on('data', (data) => {
            if (!running) return;
            ipcBuffer += data.toString('utf-8');
            const lines = ipcBuffer.split('\n');
            ipcBuffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.event === 'property-change') {
                        if (msg.name === 'time-pos' && typeof msg.data === 'number') {
                            currentPos = msg.data;
                        } else if (msg.name === 'duration' && typeof msg.data === 'number') {
                            currentDuration = msg.data;
                        } else if (msg.name === 'pause' && typeof msg.data === 'boolean') {
                            isPaused = msg.data;
                        }
                    }
                } catch (e) {}
            }
        });

        ipcClient.on('error', (err) => {
            console.error('[mpv IPC] Error:', err.message);
            ipcClient = null;
            if (running) setTimeout(connectIPC, 1000);
        });

        ipcClient.on('close', () => { ipcClient = null; });
    }

    setTimeout(connectIPC, 500);

    mpvProcess.on('close', (code) => {
        if (!running) return;
        if (saveTimer) clearInterval(saveTimer);
        callbacks.onProgress({
            filePath,
            progress: currentPos,
            watched: currentDuration > 0 && currentPos / currentDuration >= WATCHED_RATIO,
            duration: currentDuration,
            final: true,
        });
        if (ipcClient) { ipcClient.destroy(); ipcClient = null; }
        if (!isWin) {
            try { fs.unlinkSync(pipePath); } catch (e) {}
        }
        running = false;
        mpvProcess = null;
    });

    mpvProcess.on('error', (err) => {
        if (!running) return;
        console.error('mpv error:', err);
        if (callbacks.onError) callbacks.onError(String(err));
        if (saveTimer) clearInterval(saveTimer);
        if (ipcClient) { ipcClient.destroy(); ipcClient = null; }
        running = false;
        mpvProcess = null;
    });

    saveTimer = setInterval(() => {
        if (running && !isPaused) {
            callbacks.onProgress({
                filePath,
                progress: currentPos,
                watched: currentDuration > 0 && currentPos / currentDuration >= WATCHED_RATIO,
                duration: currentDuration,
            });
        }
    }, SAVE_INTERVAL_MS);

    return {
        stop: () => { if (running && mpvProcess) mpvProcess.kill(); },
        kill: () => { if (running && mpvProcess) { mpvProcess.kill(); running = false; if (saveTimer) clearInterval(saveTimer); } }
    };
}

let activeSession = null;

function start(mpvPath, filePath, position, callbacks) {
    if (activeSession) { activeSession.kill(); activeSession = null; }
    activeSession = startMpv(mpvPath, filePath, position, callbacks);
    return activeSession;
}

function stopCurrent() {
    if (activeSession) { activeSession.kill(); activeSession = null; }
}

module.exports = { startMpv: start, stopCurrent };
