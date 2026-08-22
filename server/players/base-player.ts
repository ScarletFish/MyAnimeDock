// base-player.ts — 播放器策略接口（duck typing，非强制基类）

import { Logger } from '../logger';
const logger: Logger = require('../logger');

/**
 * @typedef {Object} PlayerCallbacks
 * @property {function} onProgress - ({ sessionId, filePath, progress, peakPos, watched, duration, final }) => void
 * @property {function} onError    - (msg) => void
 */

/**
 * 播放器策略接口
 *
 * 每个播放器策略应实现以下静态方法和实例方法：
 *
 * ── 静态 ──
 *   static get type()        → string       // 'mpv', 'vlc', 等唯一标识
 *   static get displayName() → string       // 用户可读的名称
 *   static checkAvailable(execPath) → bool  // 检测播放器可执行文件是否存在
 *
 * ── 实例 ──
 *   start(filePath, position, callbacks, sessionId) → { stop: function }
 *     启动播放器、建立通信、追踪进度。
 *     返回一个控制句柄，含 stop() 方法用于终止播放。
 *
 *   stop()
 *     停止当前播放会话（可选，也可通过返回的句柄.stop() 控制）
 */
class BasePlayerStrategy {
    static get type(): string { throw new Error('子类必须定义静态 type'); }
    static get displayName(): string { throw new Error('子类必须定义静态 displayName'); }

    /** 检测播放器可执行文件是否可用 */
    static checkAvailable(execPath: string): boolean { // eslint-disable-line no-unused-vars
        return false;
    }

    /** 启动播放，返回 { stop } 控制句柄 */
    start(filePath: string, position: number, callbacks: any, sessionId: string): { stop: () => void } { // eslint-disable-line no-unused-vars
        throw new Error('子类必须实现 start()');
    }

    stop(): void {}
}

export { BasePlayerStrategy };
