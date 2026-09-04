// server/routes/config.ts — 配置、健康检查、通知路由
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { jsonResp, readBody } from '../lib/utils';
import { saveConfig } from '../lib/config';
import * as registry from '../players/registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = any;

// ── Zod schema: 前端发来的配置更新（所有字段可选） ──
const mikanTagEntrySchema = z.object({
  key: z.string(),
  name: z.string(),
  regex: z.string().refine((r) => { try { new RegExp(r); return true; } catch { return false; } }, '正则表达式无效'),
});
const mikanTagLibrarySchema = z.object({
  include: z.array(mikanTagEntrySchema),
  exclude: z.array(mikanTagEntrySchema),
}).optional();
const mikanLangOptionSchema = z.object({
  key: z.string(),
  label: z.string(),
  bit: z.number().int(),
  regex: z.string().refine((r) => { try { new RegExp(r); return true; } catch { return false; } }, '正则表达式无效'),
});
const mikanLangOptionsSchema = z.array(mikanLangOptionSchema).optional();
const ConfigUpdateSchema = z.object({
  mediaDir: z.string().optional(),
  playerMode: z.string().optional(),
  mpvPath: z.string().optional(),
  theme: z.string().optional(),
  themeMode: z.string().optional(),
  autoMarkWatched: z.boolean().optional(),
  uiScale: z.number().optional().transform(v => v == null ? v : Math.min(2, Math.max(0.5, v))),
  startupFullscreen: z.boolean().optional(),
  closeBehavior: z.enum(['tray', 'exit']).optional(),
  reduceMotion: z.boolean().optional(),
  apiSources: z.array(z.object({ type: z.string(), url: z.string(), key: z.string() })).optional(),
  qbPort: z.number().int().min(1).max(65535).optional(),
  qbUsername: z.string().optional(),
  qbPassword: z.string().optional(),
  bangumiClientId: z.string().optional(),
  bangumiClientSecret: z.string().optional(),
  mikanMirror: z.string().optional(),
  mikanTagLibrary: mikanTagLibrarySchema,
  mikanLangOptions: mikanLangOptionsSchema,
  mikanDefaultRequired: z.array(z.string()).optional(),
  mikanDefaultExcluded: z.array(z.string()).optional(),
});

// ── 单字段校验 schema ──
const FIELD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  mediaDir: z.string()
    .min(1, '媒体目录不能为空')
    .refine(v => !/[<>"|?*]/.test(v), '路径包含非法字符（<>"|?*）'),
  mpvPath: z.string()
    .min(1, '播放器路径不能为空')
    .refine(v => !/[<>"|?*]/.test(v), '路径包含非法字符（<>"|?*）'),
  bangumiUrl: z.string()
    .min(1, 'Bangumi URL 不能为空')
    .url('URL 格式不正确')
    .refine(v => {
      try {
        const h = new URL(v).hostname;
        const dotIdx = h.lastIndexOf('.');
        return /[a-zA-Z]/.test(h) && dotIdx >= 1 && h.length - dotIdx - 1 >= 2;
      } catch { return false; }
    }, '域名格式不正确（如 api.bgm.tv）'),
  bangumiClientId: z.string().optional(),
  bangumiClientSecret: z.string().optional(),
};

// ── Normalize（保存时统一处理） ──
function normalizePath(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^["']|["']$/g, '');
  s = s.replace(/\\/g, '/');
  s = s.replace(/\/+$/, '');
  return s;
}

function normalizeUrl(raw: string): string {
  let s = raw.trim();
  if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

// 字段映射：config key → transform（无 transform 则直接赋值）
const FIELD_MAP: Record<string, (v: unknown) => unknown> = {
  playerMode:    v => v,
  mpvPath:       v => v,
  theme:         v => v,
  themeMode:     v => v,
  autoMarkWatched: v => !!v,
  uiScale:       v => v,
  startupFullscreen: v => !!v,
  closeBehavior: v => v,
  reduceMotion:  v => !!v,
  apiSources:    v => v,
  qbPort:        v => v,
  qbUsername:    v => v,
  qbPassword:    v => v,
  mikanMirror:   v => v,
  mikanTagLibrary: v => v,
  mikanLangOptions: v => v,
  mikanDefaultRequired: v => v,
  mikanDefaultExcluded: v => v,
};

function handleGetConfig(req: any, res: any, state: State) {
    const { config, data } = state;
    const dirValid = config.mediaDir
        ? fs.existsSync(config.mediaDir) && fs.statSync(config.mediaDir).isDirectory()
        : false;
    const firstRun = !config.mediaDir && (!data?.library || data.library.length === 0);
    // 附上可用播放器列表供前端渲染选择器
    const players = registry.getAvailable(config);
    const { qbPassword, ...configWithoutPw } = config;
    jsonResp(res, 200, { ...configWithoutPw, qbPasswordSet: !!qbPassword, players, dirValid, firstRun, autoImport: { count: 0, message: '' } });
}

function handleGetNotifications(req: any, res: any, state: State) {
    const notifs = state.pendingNotifications.splice(0);
    jsonResp(res, 200, { notifications: notifs });
}

async function handlePostConfig(req: any, res: any, state: State) {
    const { config, bangumiPersonal } = state;
    try {
        const body = await readBody(req);
        const result = ConfigUpdateSchema.safeParse(JSON.parse(body));
        if (!result.success) {
            jsonResp(res, 400, { error: 'Invalid config', details: result.error.issues });
            return;
        }
        const parsed = result.data;

        // mediaDir：normalize + 校验目录存在
        if (parsed.mediaDir !== undefined) {
            const normalized = normalizePath(parsed.mediaDir);
            const resolved = path.resolve(normalized);
            if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
                jsonResp(res, 400, { error: 'Directory does not exist: ' + resolved });
                return;
            }
            config.mediaDir = resolved;
        }

        // mpvPath：normalize
        if (parsed.mpvPath !== undefined) {
            config.mpvPath = normalizePath(parsed.mpvPath);
        }

        // bangumiUrl：normalize
        // 注意：bangumiUrl 不在 config 里，前端直接传 apiSources
        // 但 bangumiClientId/bangumiClientSecret 需要同步 bangumiPersonal

        // 通用字段：声明式赋值
        const raw = parsed as Record<string, unknown>;
        for (const [key, transform] of Object.entries(FIELD_MAP)) {
            if (raw[key] === undefined) continue;
            if (key === 'qbPassword') {
                const v = raw[key];
                if (typeof v === 'string' && v.length > 0) config.qbPassword = v; // 空字符串 = 不修改
                continue;
            }
            (config as any)[key] = transform(raw[key]);
        }

        // 副作用：bangumiPersonal 同步
        if (parsed.bangumiClientId !== undefined) {
            config.bangumiClientId = parsed.bangumiClientId;
            bangumiPersonal.clientId = parsed.bangumiClientId;
        }
        if (parsed.bangumiClientSecret !== undefined) {
            config.bangumiClientSecret = parsed.bangumiClientSecret;
            bangumiPersonal.clientSecret = parsed.bangumiClientSecret;
        }

        saveConfig(config);
        const { qbPassword, ...configWithoutPw } = config;
        jsonResp(res, 200, { ok: true, ...configWithoutPw, qbPasswordSet: !!qbPassword });
    } catch (e) {
        jsonResp(res, 400, { error: 'Invalid request body' });
    }
}

async function handleConfigValidate(req: any, res: any, _state: State) {
    try {
        const body = JSON.parse(await readBody(req));
        const { field, value } = body;
        if (!field || typeof value === 'undefined') {
            jsonResp(res, 400, { error: 'Missing field or value' });
            return;
        }
        const schema = FIELD_SCHEMAS[field];
        if (!schema) {
            jsonResp(res, 200, { ok: true });
            return;
        }
        // normalize 后再校验
        let normalized = value;
        if (field === 'mediaDir' || field === 'mpvPath') normalized = normalizePath(String(value));
        if (field === 'bangumiUrl') normalized = normalizeUrl(String(value));

        const result = schema.safeParse(normalized);
        if (result.success) {
            jsonResp(res, 200, { ok: true, normalized });
        } else {
            const msg = result.error.issues[0]?.message || '校验失败';
            jsonResp(res, 200, { ok: false, error: msg });
        }
    } catch {
        jsonResp(res, 400, { error: 'Invalid request body' });
    }
}

export {
    handleGetConfig,
    handleGetNotifications,
    handlePostConfig,
    handleConfigValidate,
};
