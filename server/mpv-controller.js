const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');
const logger = require('./logger').child('[MPV]');

const MAX_IPC_RETRIES = 7;

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
        return { stop: () => {} };
    }
    logger.info(`mpv spawned with pid=${mpvProcess.pid}`);

    function ipcWrite(obj) {
        if (!ipcClient || !running) return;
        try {
            ipcClient.write(JSON.stringify(obj) + '\n');
        } catch (e) {
            logger.warn('ipcWrite failed:', e.message);
        }
    }

    let ipcRetries = 0;

    function connectIPC() {
        if (!running) return;
        if (ipcRetries >= MAX_IPC_RETRIES) {
            logger.error('IPC connection failed after max retries');
            if (callbacks.onError) callbacks.onError('无法连接到 mpv 播放器进程');
            return;
        }

        ipcClient = net.connect(pipePath, () => {
            logger.info(`IPC connected to ${pipeName}`);
            ipcRetries = 0;
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
                } catch (e) {
                    logger.debug('IPC parse error:', line.substring(0, 100));
                }
            }
        });

        ipcClient.on('error', (err) => {
            logger.error('IPC error:', err.message);
            try { ipcClient.destroy(); } catch (_) {}
            ipcClient = null;
            ipcRetries++;
            if (running && ipcRetries < MAX_IPC_RETRIES) {
                const delay = Math.min(1000 * Math.pow(1.5, ipcRetries - 1), 10000);
                setTimeout(connectIPC, delay);
            } else if (running) {
                logger.error('IPC connection failed after max retries');
                if (callbacks.onError) callbacks.onError('无法连接到 mpv 播放器进程');
            }
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
            watched: false, // 不再自动标记 — 由前端弹窗决定
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
            watched: false, // 不再自动标记 — 由前端弹窗决定
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
        stop: () => { if (running && mpvProcess) mpvProcess.kill(); }
    };
}

let activeSession = null;

function start(mpvPath, filePath, position, callbacks, sessionId) {
    if (activeSession) { activeSession.stop(); activeSession = null; }
    activeSession = startMpv(mpvPath, filePath, position, callbacks, sessionId);
    return activeSession;
}

function stopCurrent() {
    if (activeSession) { activeSession.stop(); activeSession = null; }
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
