// server/players/registry.ts — 播放器策略注册与调度
//
// 职责：
//   1. 维护策略类注册表
//   2. 检测可用播放器
//   3. 按配置调度默认策略
//   4. 提供测试注入接口

import { Logger } from '../logger';

const logger: Logger = require('../logger').child('[Players]');

/** 播放器策略类的构造器签名（duck typing，与 base-player 的接口契约一致） */
type PlayerStrategyClass = {
    type: string;
    displayName?: string;
    checkAvailable(execPath: string): boolean;
};

/** @type {Map<string, PlayerStrategyClass>} */
const _registry = new Map<string, PlayerStrategyClass>();

// ── 注册 ────────────────────────────────────────────────────────────────────

/**
 * 注册一个播放器策略类
 * @param {PlayerStrategyClass} strategyClass
 */
function register(strategyClass: PlayerStrategyClass): void {
    const type = strategyClass.type;
    if (!type) {
        logger.warn('Skipping strategy registration: missing static type');
        return;
    }
    _registry.set(type, strategyClass);
    logger.info(`Registered player strategy: ${type} (${strategyClass.displayName || type})`);
}

// ── 查询 ────────────────────────────────────────────────────────────────────

/**
 * 获取指定类型的策略类
 * @param {string} type - 'mpv', 'vlc', 等
 * @returns {PlayerStrategyClass|null}
 */
function getStrategy(type: string): PlayerStrategyClass | null {
    return _registry.get(type) || null;
}

/**
 * 检测所有已注册策略的可用性
 * @param {object} config - 应用配置，含各播放器路径设置
 * @returns {Array<{ type: string, displayName: string, available: boolean }>}
 */
function getAvailable(config: Record<string, unknown>): Array<{ type: string; displayName: string; available: boolean }> {
    const results: Array<{ type: string; displayName: string; available: boolean }> = [];
    for (const [type, cls] of _registry) {
        const configKey = type === 'mpv' ? 'mpvPath' : type + 'Path';
        const execPath = (config?.[configKey] as string) || type;
        const available = cls.checkAvailable(execPath);
        results.push({
            type,
            displayName: cls.displayName || type,
            available,
        });
    }
    return results;
}

/**
 * 获取默认策略类（按配置的首选播放器，回退到 mpv）
 * @param {object} config
 * @returns {PlayerStrategyClass|null}
 */
function getDefault(config: Record<string, unknown>): PlayerStrategyClass | null {
    const preferred = (config?.playerMode as string) || 'mpv';
    const strategy = _registry.get(preferred);
    if (strategy) return strategy;
    // 回退到第一个已注册的
    for (const [, cls] of _registry) return cls;
    return null;
}

/**
 * 列出所有已注册策略类型
 * @returns {string[]}
 */
function listTypes(): string[] {
    return Array.from(_registry.keys());
}

// ── 测试注入 ────────────────────────────────────────────────────────────────

/**
 * 替换或添加一个策略（用于测试）
 * @param {string} type
 * @param {PlayerStrategyClass} strategyClass
 */
function _setMock(type: string, strategyClass: PlayerStrategyClass): void {
    _registry.set(type, strategyClass);
}

/**
 * 清空注册表（用于测试）
 */
function _reset(): void {
    _registry.clear();
}

export {
    register,
    getStrategy,
    getAvailable,
    getDefault,
    listTypes,
    // 测试用（以下划线前缀标记内部）
    _setMock,
    _reset,
};
