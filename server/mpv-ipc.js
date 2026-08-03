// @ts-nocheck
// server/mpv-ipc.js — 纯 IPC 通信层
// mpv JSON IPC 协议封装：连接、发送命令、接收事件
// 不涉及 spawn、生命周期、业务逻辑

const net = require('net');
const logger = require('./logger').child('[IPC]');

// ── MpvIpcConnection ────────────────────────────────────────────────────────
// 管理一条到 mpv --input-ipc-server 的 TCP/Named Pipe 连接
//
// 两种通信方式：
//   1. send(obj)   — 即发即忘（当前 observe_property / set 等使用）
//   2. call(args)  — Promise 式请求-响应匹配（支持超时）
//
// 事件通过 onEvent(handler) 订阅

const MAX_RETRIES = 7;

class MpvIpcConnection {
    /**
     * @param {string} pipePath - Named pipe 或 Unix socket 路径
     */
    constructor(pipePath) {
        this.pipePath = pipePath;
        this._client = null;
        this._buffer = '';
        this._eventHandler = null;
        this._onCloseHandler = null;
        this._requestId = 0;
        this._pending = new Map(); // requestId → { resolve, reject, timer }
        this._connected = false;
        this._destroyed = false;
        this._retries = 0;
        this._connectTimer = null;
        this._log = logger.child({ pipe: pipePath });
    }

    // ── 连接 ────────────────────────────────────────────────────────────────

    /**
     * 建立连接（重试逻辑内置）
     * @returns {Promise<void>}
     */
    connect() {
        return new Promise((resolve, reject) => {
            this._doConnect(resolve, reject);
        });
    }

    _doConnect(resolve, reject) {
        if (this._destroyed) {
            reject(new Error('Connection was destroyed'));
            return;
        }

        this._client = net.connect(this.pipePath, () => {
            this._connected = true;
            this._retries = 0;
            this._log.info('IPC connected');
            resolve();
        });

        this._client.on('data', (data) => {
            this._buffer += data.toString('utf-8');
            const lines = this._buffer.split('\n');
            this._buffer = lines.pop();
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    this._dispatch(JSON.parse(line));
                } catch (e) {
                    this._log.debug('Parse error:', line.substring(0, 100));
                }
            }
        });

        this._client.on('error', (err) => {
            this._log.warn('IPC socket error:', err.message);
            this._cleanupClient();
            if (!this._connected && !this._destroyed) {
                // 连接建立前的错误 → 重试
                this._retries++;
                if (this._retries < MAX_RETRIES) {
                    const delay = Math.min(1000 * Math.pow(1.5, this._retries - 1), 10000);
                    this._log.info(`Retrying IPC connection in ${delay}ms (${this._retries}/${MAX_RETRIES})`);
                    this._connectTimer = setTimeout(() => this._doConnect(resolve, reject), delay);
                } else {
                    const msg = 'IPC connection failed after max retries';
                    this._log.error(msg);
                    reject(new Error(msg));
                }
            }
        });

        this._client.on('close', () => {
            this._cleanupClient();
            if (this._onCloseHandler) this._onCloseHandler();
        });
    }

    // ── 发送 ────────────────────────────────────────────────────────────────

    /**
     * 即发即忘发送 JSON 命令（对应旧 ipcWrite）
     * @param {object} obj - { command: [...], ... }
     */
    send(obj) {
        if (!this._client || !this._connected) {
            this._log.warn('send skipped, not connected');
            return;
        }
        try {
            this._client.write(JSON.stringify(obj) + '\n');
        } catch (e) {
            this._log.warn('send failed:', e.message);
        }
    }

    /**
     * Promise 式调用，通过 request_id 匹配响应
     * @param {string} cmd     - 命令名，如 'set_property'
     * @param  {...any} args   - 参数
     * @param {number} [timeout=5000] - 超时毫秒
     * @returns {Promise<any>} 响应 data
     */
    call(cmd, ...args) {
        const timeout = typeof args[args.length - 1] === 'number' ? args.pop() : 5000;
        return this._callWithId(cmd, args, timeout);
    }

    _callWithId(cmd, args, timeout) {
        return new Promise((resolve, reject) => {
            if (!this._client || !this._connected) {
                reject(new Error('IPC not connected'));
                return;
            }
            const id = ++this._requestId;
            const obj = { command: [cmd, ...args], request_id: id };

            const timer = setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`IPC call timeout: ${cmd}`));
                }
            }, timeout);

            this._pending.set(id, { resolve, reject, timer });
            try {
                this._client.write(JSON.stringify(obj) + '\n');
            } catch (e) {
                this._pending.delete(id);
                clearTimeout(timer);
                reject(e);
            }
        });
    }

    /**
     * 快捷：observe_property（即发即忘）
     */
    observeProperty(id, name) {
        this.send({ command: ['observe_property', id, name] });
    }

    // ── 事件 ────────────────────────────────────────────────────────────────

    /**
     * 注册事件回调（所有非 request_id 响应的消息）
     * @param {function} handler - (msg) => void
     */
    onEvent(handler) {
        this._eventHandler = handler;
    }

    /**
     * 注册连接关闭回调
     * @param {function} handler
     */
    onClose(handler) {
        this._onCloseHandler = handler;
    }

    // ── 生命周期 ────────────────────────────────────────────────────────────

    /**
     * 是否已连接
     */
    isConnected() {
        return this._connected && this._client !== null;
    }

    /**
     * 关闭连接
     */
    close() {
        this._destroyed = true;
        if (this._connectTimer) {
            clearTimeout(this._connectTimer);
            this._connectTimer = null;
        }
        this._cleanupClient();
        // Reject all pending calls
        for (const [id, { reject, timer }] of this._pending) {
            clearTimeout(timer);
            reject(new Error('IPC connection closed'));
        }
        this._pending.clear();
    }

    // ── 内部 ────────────────────────────────────────────────────────────────

    _dispatch(msg) {
        // request_id 匹配 → 响应 pending call
        if (msg.request_id !== undefined && this._pending.has(msg.request_id)) {
            const { resolve, timer } = this._pending.get(msg.request_id);
            this._pending.delete(msg.request_id);
            clearTimeout(timer);
            resolve(msg);
            return;
        }
        // 否则作为事件派发
        if (this._eventHandler) {
            try { this._eventHandler(msg); } catch (e) {
                this._log.warn('event handler threw:', e.message);
            }
        }
    }

    _cleanupClient() {
        if (this._client) {
            try { this._client.destroy(); } catch (_) {}
            this._client = null;
        }
        this._connected = false;
    }
}

// ── 便利函数 ────────────────────────────────────────────────────────────────

/**
 * 生成唯一 IPC 管道/套接字名
 * @param {number} [sessionId] - 可选的会话标识
 * @param {number} [counter]   - 可选的计数器，防冲突
 * @returns {{ pipeName: string, pipePath: string }}
 */
function generatePipePath(sessionId, counter) {
    const isWin = process.platform === 'win32';
    const pid = process.pid;
    const ts = Date.now();
    const seq = counter || 0;
    const pipeName = `myanimedock-mpv-${pid}-${ts}-${seq}${sessionId ? '-' + sessionId : ''}`;
    const pipePath = isWin
        ? `\\\\.\\pipe\\${pipeName}`
        : require('path').join(require('os').tmpdir(), pipeName);
    return { pipeName, pipePath };
}

module.exports = { MpvIpcConnection, generatePipePath };
