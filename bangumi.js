const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BANGUMI_API = 'https://api.bgm.tv';
const USER_AGENT = 'anime-manager (https://github.com/ScarletFish/Gallery)';
const TIMEOUT = 15000;

// Some proxy/VPN setups intercept Node.js HTTPS but not curl.
// If native fetch fails with the known proxy body-mangling error,
// we fall back to calling curl via child_process.
let useCurlFallback = false;

function curlFetch(method, url, body) {
  const args = ['-s', '--max-time', String(TIMEOUT / 1000), '-X', method];
  if (body) args.push('-H', 'Content-Type: application/json', '-d', body);
  args.push('-H', `User-Agent: ${USER_AGENT}`, url);
  const result = spawnSync('curl', args, { timeout: TIMEOUT, encoding: 'utf-8' });
  if (result.error) throw new Error(`curl 调用失败: ${result.error.message}`);
  if (result.stderr) console.error('curl stderr:', result.stderr);
  return JSON.parse(result.stdout);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Bangumi API 请求超时');
    if (e.code === 'ECONNREFUSED') throw new Error('无法连接到 Bangumi API，请检查网络');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function tryFetch(url, options = {}) {
  if (!useCurlFallback) {
    try {
      const res = await fetchWithTimeout(url, options);
      if (res.ok) return res;
      const text = await res.text();
      // Detect proxy body-mangling: base64 decode error on JSON POST
      if (text.includes('illegal base64 data') || text.includes('can\'t decode request body')) {
        useCurlFallback = true;
        console.log('Detected proxy interference, falling back to curl');
      } else {
        throw new Error(`Bangumi API error (${res.status}): ${text.substring(0, 200)}`);
      }
    } catch (e) {
      if (e.message.includes('fetch failed') || e.message.includes('ECONNREFUSED') || e.message.includes('ENOTFOUND')) {
        useCurlFallback = true;
        console.log('Network fetch failed, falling back to curl');
      } else {
        throw e;
      }
    }
  }

  // Fallback: use curl via child_process
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body || null;
  return { json: () => Promise.resolve(curlFetch(method, url, body)) };
}

async function searchSubjects(keyword) {
  const url = `${BANGUMI_API}/v0/search/subjects`;
  const res = await tryFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ keyword, filter: { type: '2' } }),
  });
  const data = await res.json();
  return data.data || [];
}

async function getSubjectDetail(id) {
  const url = `${BANGUMI_API}/v0/subjects/${id}`;
  const res = await tryFetch(url, { headers: { 'User-Agent': USER_AGENT } });
  return res.json();
}

async function downloadCover(imageUrl, coverDir, subjectId) {
  if (!imageUrl) return null;
  if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });

  const urlPath = new URL(imageUrl).pathname;
  const ext = path.extname(urlPath) || '.jpg';
  const filename = `${subjectId}${ext}`;
  const filepath = path.join(coverDir, filename);

  if (fs.existsSync(filepath)) return filepath;

  let buffer;
  if (useCurlFallback) {
    const result = spawnSync('curl', ['-s', '--max-time', String(TIMEOUT/1000), imageUrl], { timeout: TIMEOUT });
    if (result.error) throw new Error(`封面下载失败: ${result.error.message}`);
    buffer = result.stdout;
  } else {
    const res = await fetchWithTimeout(imageUrl);
    if (!res.ok) throw new Error(`Cover download failed: ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  }
  fs.writeFileSync(filepath, buffer);
  return filepath;
}

async function fetchMetadata(keyword, coverDir, subjectId) {
  let subjectIdToUse = subjectId;
  if (!subjectIdToUse) {
    const results = await searchSubjects(keyword);
    if (results.length === 0) return null;
    subjectIdToUse = results[0].id;
  }
  const detail = await getSubjectDetail(subjectIdToUse);

  let localCover = null;
  if (detail.images && detail.images.large) {
    try {
      localCover = await downloadCover(detail.images.large, coverDir, subjectIdToUse);
    } catch (e) {
      console.error('Cover download failed:', e.message);
    }
  }

  return {
    bangumiId: subjectIdToUse,
    bangumiTitle: detail.name_cn || detail.name || null,
    bangumiTitleJp: detail.name || null,
    summary: detail.summary || null,
    coverUrl: detail.images?.large || null,
    localCover,
    rating: detail.rating?.score ? parseFloat(detail.rating.score.toFixed(1)) : null,
  };
}

module.exports = { searchSubjects, getSubjectDetail, downloadCover, fetchMetadata };
