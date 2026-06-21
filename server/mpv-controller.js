const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const logger = require('./logger').child('[MPV]');

const WATCHED_RATIO = 0.9;
let sessionIdCounter = 0;

function startMpv(mpvPath, filePath, position, callbacks) {
    const sessionId = ++sessionIdCounter;
    let currentPos = position || 0;
    let peakPos = position || 0;
    let currentDuration = 0;
    let isPaused = false;
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

    mpvProcess = spawn(mpvPath, args, { windowsHide: isWin, stdio: ['pipe', 'ignore', 'ignore'] });

    function ipcWrite(obj) {
        if (ipcClient && running) {
            ipcClient.write(JSON.stringify(obj) + '\n');
        }
    }

    function connectIPC() {
        if (!running) return;

        ipcClient = net.connect(pipePath, () => {
            logger.info(`IPC connected to ${pipeName}`);
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
                            if (msg.data > peakPos) peakPos = msg.data;
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
            logger.error('IPC error:', err.message);
            ipcClient = null;
            if (running) setTimeout(connectIPC, 1000);
        });

        ipcClient.on('close', () => { ipcClient = null; });
    }

    setTimeout(connectIPC, 500);

    const progressInterval = setInterval(() => {
        if (!running) return;
        callbacks.onProgress({
            filePath,
            progress: currentPos,
            peakPos,
            watched: currentDuration > 0 && peakPos / currentDuration >= WATCHED_RATIO,
            duration: currentDuration,
            final: false,
        });
    }, 10000);

    mpvProcess.on('close', (code) => {
        if (!running) return;
        clearInterval(progressInterval);
        callbacks.onProgress({
            filePath,
            progress: currentPos,
            peakPos,
            watched: currentDuration > 0 && peakPos / currentDuration >= WATCHED_RATIO,
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
        clearInterval(progressInterval);
        logger.error('mpv error:', err);
        if (callbacks.onError) callbacks.onError(String(err));
        if (ipcClient) { ipcClient.destroy(); ipcClient = null; }
        running = false;
        mpvProcess = null;
    });

    return {
        stop: () => { if (running && mpvProcess) mpvProcess.kill(); },
        kill: () => { if (running && mpvProcess) { mpvProcess.kill(); running = false; } }
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
