const fs = require('fs');
const path = require('path');

const BANGUMI_API = 'https://api.bgm.tv';
const USER_AGENT = 'anime-manager (https://github.com/ScarletFish/Gallery)';

const TIMEOUT = 10000;

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

async function searchSubjects(keyword) {
  const url = `${BANGUMI_API}/v0/search/subjects`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ keyword, filter: { type: 2 } }),
  });
  if (!res.ok) throw new Error(`Bangumi search failed: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

async function getSubjectDetail(id) {
  const url = `${BANGUMI_API}/v0/subjects/${id}`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Bangumi subject fetch failed: ${res.status}`);
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

  const res = await fetchWithTimeout(imageUrl);
  if (!res.ok) throw new Error(`Cover download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
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
