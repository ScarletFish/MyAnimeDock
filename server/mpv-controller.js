const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const logger = require('./logger').child('[MPV]');

const WATCHED_RATIO = 0.9;
let sessionIdCounter = 0;

function startMpv(mpvPath, filePath, position, callbacks, sessionId) {
    let currentPos = position || 0;
    let peakPos = position || 0;
    let currentDuration = 0;
    let isPaused = false;
    let running = true;
    let mpvProcess = null;
    let ipcClient = null;
    let ipcBuffer = '';

    const isWin = process.platform === 'win32';
    // Windows: prefer mpv.exe for proper window foreground behavior
    if (isWin && (mpvPath === 'mpv' || mpvPath === 'mpv.com')) {
        mpvPath = 'mpv.exe';
    }
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

    const spawnTime = Date.now();
    logger.info(`Spawning: ${mpvPath} ${args.join(' ')}`);
    try {
        mpvProcess = spawn(mpvPath, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch (e) {
        logger.error('mpv spawn threw:', e.message);
        if (callbacks.onError) callbacks.onError(`mpv 启动异常: ${e.message}`);
        return { stop: () => {}, kill: () => {} };
    }
    logger.info(`mpv spawned with pid=${mpvProcess.pid}`);

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
            // 窗口已前置弹出，延迟解除 ontop 避免永久置顶
            setTimeout(() => {
                try {
                    if (running) {
                        ipcWrite({ command: ['set', 'ontop', 'no'] });
                        logger.info('ontop disabled after initial show');
                    }
                } catch (e) {
                    logger.warn('ontop disable failed:', e.message);
                }
            }, 2000);
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
            sessionId,
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
        const lived = Date.now() - spawnTime;
        logger.info(`mpv closed: code=${code} lived=${lived}ms`);
        if (code !== 0 && lived < 3000) {
            // mpv crashed shortly after start — report error to frontend
            if (callbacks.onError) callbacks.onError(`mpv 退出 (code=${code})，请检查路径和依赖`);
        }
        callbacks.onProgress({
            sessionId,
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

function start(mpvPath, filePath, position, callbacks, sessionId) {
    if (activeSession) { activeSession.kill(); activeSession = null; }
    activeSession = startMpv(mpvPath, filePath, position, callbacks, sessionId);
    return activeSession;
}

function stopCurrent() {
    if (activeSession) { activeSession.kill(); activeSession = null; }
}

function checkMpvAvailable(mpvPath) {
    const isWin = process.platform === 'win32';
    // Resolve 'mpv' / 'mpv.com' → 'mpv.exe' on Windows (same logic as startMpv)
    if (isWin && (mpvPath === 'mpv' || mpvPath === 'mpv.com')) {
        mpvPath = 'mpv.exe';
    }
    // Absolute path → direct exists check
    if (path.isAbsolute(mpvPath) || mpvPath.includes('/') || mpvPath.includes('\\')) {
        return fs.existsSync(mpvPath);
    }
    // Search PATH
    const cmd = isWin ? 'where' : 'command -v';
    try {
        require('child_process').execSync(`${cmd} ${mpvPath}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

module.exports = { startMpv: start, stopCurrent, checkMpvAvailable };
