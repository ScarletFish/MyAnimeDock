const { spawn } = require('child_process');

const SAVE_INTERVAL_MS = 10000;
const WATCHED_RATIO = 0.9;
let sessionIdCounter = 0;

// 将 "01:23:45" 或 "23:45" 转为秒数
function parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    if (parts.length === 2) return parts[0]*60 + parts[1];
    return 0;
}

function startMpv(mpvPath, filePath, position, callbacks) {
    const sessionId = ++sessionIdCounter;
    let currentPos = position || 0;
    let currentDuration = 0;
    let isPaused = false;
    let saveTimer = null;
    let running = true;
    let mpvProcess = null;

    // 参数：使用 --term-status-msg 输出 JSON 到 stderr
    const args = [
        filePath,
        `--start=${currentPos}`,
        '--idle',
        '--keep-open=yes',
        '--quiet',
        '--no-terminal',
        '--ontop',
        '--term-status-msg={"time-pos":${=time-pos},"duration":${=duration},"pause":${=pause}}'
    ];

    mpvProcess = spawn(mpvPath, args, { windowsHide: false });

    let stderrBuffer = '';

    mpvProcess.stderr.on('data', (data) => {
        if (!running) return;
        stderrBuffer += data.toString();
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop();
        for (const line of lines) {
            try {
                const match = line.match(/\{.*"time-pos".*?\}/);
                if (match) {
                    const status = JSON.parse(match[0]);
                    if (typeof status['time-pos'] === 'number') currentPos = status['time-pos'];
                    if (typeof status.duration === 'number') currentDuration = status.duration;
                    if (typeof status.pause === 'boolean') isPaused = status.pause;
                }
            } catch (e) {}
        }
    });

    mpvProcess.on('close', (code) => {
        if (!running) return;
        if (saveTimer) clearInterval(saveTimer);
        callbacks.onProgress({
            filePath,
            progress: currentPos,
            watched: currentDuration > 0 && currentPos / currentDuration >= WATCHED_RATIO,
            duration: currentDuration,
        });
        running = false;
        mpvProcess = null;
    });

    mpvProcess.on('error', (err) => {
        if (!running) return;
        console.error('mpv error:', err);
        if (callbacks.onError) callbacks.onError(String(err));
        if (saveTimer) clearInterval(saveTimer);
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