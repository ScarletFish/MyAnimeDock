// server/players/mpv-strategy.js — mpv 播放器策略
//
// 职责：spawn mpv 进程 + 通过 JSON IPC 追踪播放进度
// 通信层委派给 mpv-ipc.js，本模块只关心 mpv 特有的生命周期

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MpvIpcConnection } = require('../mpv-ipc');
const { BasePlayerStrategy } = require('./base-player');
const logger = require('../logger').child('[MPV]');

class MpvPlayerStrategy extends BasePlayerStrategy {
    static get type() { return 'mpv'; }
    static get displayName() { return 'MPV'; }

    constructor() {
        super();
        this._session = null; // 当前播放会话状态
    }

    // ── 静态：检测 ──────────────────────────────────────────────────────────

    /**
     * 检测 mpv 可执行文件是否可用
     * @param {string} execPath - 配置中的路径或 'mpv'
     * @returns {boolean}
     */
    static checkAvailable(execPath) {
        const isWin = process.platform === 'win32';
        let mpvPath = execPath || 'mpv';
        // Windows: resolve 'mpv'/'mpv.com' → 'mpv.exe'
        if (isWin && (mpvPath === 'mpv' || mpvPath === 'mpv.com')) {
            mpvPath = 'mpv.exe';
        }
        // 绝对路径或含分隔符 → 直接检查文件存在
        if (path.isAbsolute(mpvPath) || mpvPath.includes('/') || mpvPath.includes('\\')) {
            return fs.existsSync(mpvPath);
        }
        // 搜索 PATH
        const cmd = isWin ? 'where' : 'command -v';
        try {
            require('child_process').execSync(`${cmd} ${mpvPath}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    // ── 实例：启动 ──────────────────────────────────────────────────────────

    /**
     * 启动 mpv 并开始追踪进度
     *
     * @param {string} mpvPath   - mpv 可执行文件路径
     * @param {string} filePath  - 媒体文件路径
     * @param {number} position  - 起始播放位置（秒）
     * @param {object} callbacks - { onProgress, onError }
     * @param {string} sessionId - 会话 ID
     * @returns {{ stop: function }}
     */
    start(mpvPath, filePath, position, callbacks, sessionId) {
        // 停止前一会话
        this.stop();

        const isWin = process.platform === 'win32';
        // Windows: prefer mpv.exe for proper window foreground behavior
        let resolvedMpv = mpvPath || 'mpv';
        if (isWin && (resolvedMpv === 'mpv' || resolvedMpv === 'mpv.com')) {
            resolvedMpv = 'mpv.exe';
        }

        const pipeName = `mpv-ipc-${process.pid}-${sessionId}`;
        const pipePath = isWin
            ? `\\\\.\\pipe\\${pipeName}`
            : path.join(os.tmpdir(), pipeName);

        const args = [
            filePath,
            '--keep-open=yes',
            '--ontop',
            `--input-ipc-server=${pipePath}`,
        ];

        // ── 状态 ──
        let currentPos = position || 0;
        let peakPos = position || 0;
        let currentDuration = 0;
        let isPaused = false;
        const spawnTime = Date.now();
        let mpvProcess = null;
        let ipc = null;
        let running = true;

        // ── Spawn ──
        logger.info(`Spawning: ${resolvedMpv} ${args.join(' ')}`);
        try {
            mpvProcess = spawn(resolvedMpv, args, { stdio: ['pipe', 'ignore', 'ignore'] });
        } catch (e) {
            logger.error('mpv spawn threw:', e.message);
            if (callbacks.onError) callbacks.onError(`mpv 启动异常: ${e.message}`);
            return { stop: () => {} };
        }
        logger.info(`mpv spawned with pid=${mpvProcess.pid}`);

        // ── IPC ──
        ipc = new MpvIpcConnection(pipePath);

        ipc.onEvent((msg) => {
            if (!running) return;
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
        });

        ipc.onClose(() => {
            // IPC 关闭可能是 mpv 退出触发，不做额外操作
        });

        // 连接（带重试，完成后注册观测属性）
        ipc.connect()
            .then(() => {
                if (!running) return;
                if (currentPos > 0) {
                    logger.info(`Seeking to ${currentPos}s via IPC`);
                    ipc.send({ command: ['seek', currentPos, 'absolute'] });
                }
                ipc.observeProperty(1, 'time-pos');
                ipc.observeProperty(2, 'duration');
                ipc.observeProperty(3, 'pause');
                // 窗口已前置弹出，延迟解除 ontop 避免永久置顶
                setTimeout(() => {
                    try {
                        if (running) {
                            ipc.send({ command: ['set', 'ontop', 'no'] });
                            logger.info('ontop disabled after initial show');
                        }
                    } catch (e) {
                        logger.warn('ontop disable failed:', e.message);
                    }
                }, 2000);
            })
            .catch((err) => {
                if (!running) return;
                logger.error('IPC connection failed:', err.message);
                if (callbacks.onError) callbacks.onError('无法连接到 mpv 播放器进程');
            });

        // ── 进程事件 ──
        mpvProcess.on('close', (code) => {
            if (!running) return;
            const lived = Date.now() - spawnTime;
            logger.info(`mpv closed: code=${code} lived=${lived}ms`);
            if (code !== 0 && lived < 3000) {
                if (callbacks.onError) callbacks.onError(`mpv 退出 (code=${code})，请检查路径和依赖`);
            }
            callbacks.onProgress({
                sessionId,
                filePath,
                progress: currentPos,
                peakPos,
                watched: false,
                duration: currentDuration,
                final: true,
            });
            if (ipc) { ipc.close(); ipc = null; }
            if (!isWin) {
                try { fs.unlinkSync(pipePath); } catch (_) {}
            }
            running = false;
            mpvProcess = null;
        });

        mpvProcess.on('error', (err) => {
            if (!running) return;
            logger.error('mpv error:', err);
            if (callbacks.onError) callbacks.onError(String(err));
            if (ipc) { ipc.close(); ipc = null; }
            running = false;
            mpvProcess = null;
        });

        // ── 保存会话引用 ──
        this._session = {
            process: mpvProcess,
            ipc,
            pipePath,
            isWin,
            stop: () => {
                if (mpvProcess) {
                    mpvProcess.kill();
                    mpvProcess = null;
                }
                running = false;
            },
        };

        return { stop: () => this._session.stop() };
    }

    // ── 实例：停止 ──────────────────────────────────────────────────────────

    stop() {
        if (this._session) {
            this._session.stop();
            this._session = null;
        }
    }
}

// ── 自注册 ──────────────────────────────────────────────────────────────────
const registry = require('./registry');
registry.register(MpvPlayerStrategy);

module.exports = { MpvPlayerStrategy };
