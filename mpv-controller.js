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
    // 注意：不能加 --no-terminal（会抑制 --term-status-msg）
    const args = [
        filePath,
        `--start=${currentPos}`,
        '--idle',
        '--keep-open=yes',
        '--quiet',
        '--ontop',
        '--term-status-msg={"time-pos":${=time-pos},"duration":${=duration},"pause":${=pause}}'
    ];

    const isWin = process.platform === 'win32';
    mpvProcess = spawn(mpvPath, args, { windowsHide: isWin });

    let stderrBuffer = '';

    mpvProcess.stderr.on('data', (data) => {
        if (!running) return;
        // 用 buffer 直接匹配 JSON 行，避免 Windows GBK 编码干扰
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        stderrBuffer += chunk.toString('latin1');
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop();
        for (const line of lines) {
            try {
                const match = line.match(/\{.*"time-pos".*?\}/);
                if (match) {
                    // mpv ${=pause} 输出 "yes"/"no" 而非 JSON true/false，需要预处理
                    const json = match[0]
                        .replace(/\bno\b/g, 'false')
                        .replace(/\byes\b/g, 'true');
                    const status = JSON.parse(json);
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
            final: true,
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