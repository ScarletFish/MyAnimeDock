/**
 * Shared HTTP utilities for scrapers.
 * Extracted from bangumi.js + anilist.js to eliminate code duplication.
 *
 * Fixes:
 * - spawnSync → spawn (async, non-blocking)
 * - spawn timeout buffer (> curl --max-time)
 * - Shared curl fallback state across scrapers
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { nodeFetch } = require('../scrapers/node-fetch');
const logger = require('../logger').child('[HTTP]');

const DEFAULT_TIMEOUT = 5000;
const USER_AGENT = 'anime-manager (https://github.com/ScarletFish/Gallery)';

// Shared curl fallback state (one set for all scrapers)
let useCurlFallback = false;
let curlFallbackUntil = 0;
const CURL_COOLDOWN = 60000;

/**
 * Spawn a child process and return { stdout, stderr } as strings.
 * Uses spawn (async) — does NOT block the event loop.
 * @param {string} cmd
 * @param {string[]} args
 * @param {number} [timeout] - Safety net kill timeout (ms)
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function spawnAsync(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { encoding: 'utf-8', timeout });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
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
async function curlFetch(method, url, body) {
  const CURL_MAX_TIME = 8;
  const args = ['-s', '--max-time', String(CURL_MAX_TIME), '-X', method];
  if (body) args.push('-H', 'Content-Type: application/json', '-d', body);
  args.push('-H', `User-Agent: ${USER_AGENT}`, url);
  const { stdout, stderr } = await spawnAsync('curl', args, (CURL_MAX_TIME + 2) * 1000);
  if (stderr) logger.error('curl stderr:', stderr);
  if (!stdout || !stdout.trim()) throw new Error('curl 返回空响应');
  return JSON.parse(stdout);
}

/**
 * Async curl binary download via spawn (non-blocking).
 * spawn timeout = maxTimeSec + 2s buffer.
 * @returns {Promise<Buffer>}
 */
async function curlDownload(url, maxTimeSec = 5) {
  const args = ['-s', '--max-time', String(maxTimeSec), url];
  const { stdout } = await spawnAsync('curl', args, (maxTimeSec + 2) * 1000);
  return stdout;
}

/**
 * fetch with AbortController timeout.
 */
async function fetchWithTimeout(url, options = {}, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const fetcher = typeof fetch === 'function' ? fetch : nodeFetch;
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
function isNetworkError(e) {
  const msg = e && e.message ? e.message : '';
  return !!(msg.includes('fetch failed') || msg.includes('ECONNREFUSED') ||
            msg.includes('ENOTFOUND') || msg.includes('请求超时'));
}

/**
 * Check if response text indicates Cloudflare/proxy interference.
 */
function isCloudflareInterference(status, text) {
  return text.includes('illegal base64 data') ||
    text.includes("can't decode request body") ||
    (status === 403 && text.includes('<html'));
}

/**
 * Activate curl fallback mode for CURL_COOLDOWN ms.
 */
function activateCurlFallback() {
  useCurlFallback = true;
  curlFallbackUntil = Date.now() + CURL_COOLDOWN;
  logger.info(`Activated curl fallback for ${CURL_COOLDOWN / 1000}s`);
}

/**
 * Check if curl fallback is currently active.
 * Resets the flag if cooldown has expired.
 */
function isCurlFallbackActive() {
  if (useCurlFallback && Date.now() > curlFallbackUntil) {
    useCurlFallback = false;
    logger.info('Curl fallback cooldown expired, reset to fetch');
  }
  return useCurlFallback;
}

/**
 * Download an image file with curl fallback support.
 * @param {string} imageUrl
 * @param {string} destDir
 * @param {string} filename
 * @param {object} [options]
 * @param {number} [options.timeout=5000]
 * @param {function} [options.onSaved] - callback(filepath) after successful save
 * @returns {Promise<string|null>} filepath or null if no imageUrl
 */
async function downloadImage(imageUrl, destDir, filename, options = {}) {
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

module.exports = {
  curlFetch,
  curlDownload,
  fetchWithTimeout,
  downloadImage,
  isNetworkError,
  isCloudflareInterference,
  isCurlFallbackActive,
  activateCurlFallback,
  DEFAULT_TIMEOUT,
  USER_AGENT,
};
