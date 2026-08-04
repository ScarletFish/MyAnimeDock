/**
 * Shared HTTP utilities for scrapers.
 * Extracted from bangumi.js + anilist.js to eliminate code duplication.
 *
 * Fixes:
 * - spawnSync → spawn (async, non-blocking)
 * - spawn timeout buffer (> curl --max-time)
 * - Shared curl fallback state across scrapers
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { nodeFetch } from '../scrapers/node-fetch';
import { Logger } from '../logger';

const logger: Logger = require('../logger').child('[HTTP]');

export const DEFAULT_TIMEOUT = 5000;
export const USER_AGENT = 'anime-manager (https://github.com/ScarletFish/Gallery)';

// Shared curl fallback state (one set for all scrapers)
let useCurlFallback = false;
let curlFallbackUntil = 0;
const CURL_COOLDOWN = 60000;

/**
 * Spawn a child process and return { stdout, stderr } as strings.
 * Uses spawn (async) — does NOT block the event loop.
 */
function spawnAsync(cmd: string, args: string[], timeout?: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { encoding: 'utf-8', timeout } as any);
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', d => { stdout += d; });
    child.stderr!.on('data', d => { stderr += d; });
    child.on('error', err => reject(new Error(`${cmd} 启动失败: ${err.message}`)));
    child.on('close', (code, signal) => {
      if (signal) {
        reject(new Error(`${cmd} 被信号 ${signal} 终止`));
      } else if (code !== 0 && !stdout.trim()) {
        reject(new Error(`${cmd} 退出码 ${code}: ${stderr || '未知错误'}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Async curl JSON request via spawn (non-blocking).
 * spawn timeout = curl --max-time + 2s buffer.
 */
async function curlFetch(method: string, url: string, body?: string): Promise<unknown> {
  const CURL_MAX_TIME = 8;
  const args = ['-s', '--max-time', String(CURL_MAX_TIME), '-X', method];
  if (body) args.push('-H', 'Content-Type: application/json', '-d', body);
  args.push('-H', `User-Agent: ${USER_AGENT}`, url);
  const { stdout, stderr } = await spawnAsync('curl', args, (CURL_MAX_TIME + 2) * 1000);
  if (stderr) logger.error('curl stderr:', stderr);
  if (!stdout || !stdout.trim()) throw new Error('curl 返回空响应');
  return JSON.parse(stdout) as any;
}

/**
 * Async curl binary download via spawn (non-blocking).
 * spawn timeout = maxTimeSec + 2s buffer.
 */
async function curlDownload(url: string, maxTimeSec = 5): Promise<Buffer> {
  const args = ['-s', '--max-time', String(maxTimeSec), url];
  const { stdout } = await spawnAsync('curl', args, (maxTimeSec + 2) * 1000);
  return stdout as unknown as Buffer;
}

/**
 * fetch with AbortController timeout.
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout: number = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const fetcher: any = typeof fetch === 'function' ? fetch : nodeFetch;
    return await fetcher(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时');
    if (e.code === 'ECONNREFUSED') throw new Error('无法连接到 API，请检查网络');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if error message indicates a network-level failure
 * that should trigger curl fallback.
 */
function isNetworkError(e: unknown): boolean {
  const msg = e && (e as any).message ? (e as any).message : '';
  return !!(msg.includes('fetch failed') || msg.includes('ECONNREFUSED') ||
            msg.includes('ENOTFOUND') || msg.includes('请求超时'));
}

/**
 * Check if response text indicates Cloudflare/proxy interference.
 */
function isCloudflareInterference(status: number, text: string): boolean {
  return text.includes('illegal base64 data') ||
    text.includes("can't decode request body") ||
    (status === 403 && text.includes('<html'));
}

/**
 * Activate curl fallback mode for CURL_COOLDOWN ms.
 */
function activateCurlFallback(): void {
  useCurlFallback = true;
  curlFallbackUntil = Date.now() + CURL_COOLDOWN;
  logger.info(`Activated curl fallback for ${CURL_COOLDOWN / 1000}s`);
}

/**
 * Check if curl fallback is currently active.
 * Resets the flag if cooldown has expired.
 */
function isCurlFallbackActive(): boolean {
  if (useCurlFallback && Date.now() > curlFallbackUntil) {
    useCurlFallback = false;
    logger.info('Curl fallback cooldown expired, reset to fetch');
  }
  return useCurlFallback;
}

/**
 * Download an image file with curl fallback support.
 */
async function downloadImage(
  imageUrl: string,
  destDir: string,
  filename: string,
  options: { timeout?: number; onSaved?: (filepath: string) => void } = {},
): Promise<string | null> {
  if (!imageUrl) return null;
  const { timeout = DEFAULT_TIMEOUT, onSaved } = options;

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const filepath = path.join(destDir, filename);
  if (fs.existsSync(filepath)) return filepath;

  let buffer;
  if (isCurlFallbackActive()) {
    buffer = await curlDownload(imageUrl, Math.ceil(timeout / 1000));
  } else {
    const res = await fetchWithTimeout(imageUrl, {}, timeout);
    if (!res.ok) throw new Error(`下载失败: ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  }

  fs.writeFileSync(filepath, buffer);
  if (onSaved) onSaved(filepath);
  return filepath;
}

export {
  curlFetch,
  curlDownload,
  fetchWithTimeout,
  downloadImage,
  isNetworkError,
  isCloudflareInterference,
  isCurlFallbackActive,
  activateCurlFallback,
};
