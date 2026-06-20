const fs = require('fs');
const path = require('path');
const { Parser } = require('anitomy');

const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.webm']);
const anitomy = new Parser();

const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g;

function hasLatinLetters(str) {
  return (str || '').replace(/[^a-zA-Z]/g, '').length >= 3;
}

/**
 * Find all video files recursively in a directory
 */
function findVideos(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findVideos(full));
      } else if (VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
        const stat = fs.statSync(full);
        results.push({ path: full, name: entry.name, size: stat.size });
      }
    }
  } catch (e) { /* skip unreadable dirs */ }
  return results;
}

/**
 * Check if a directory has video files directly (not in sub-directories)
 */
function hasDirectVideos(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.some(e => !e.isDirectory() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase()));
  } catch (e) { return false; }
}

/**
 * Parse folder name to extract structured anime info using anitomy.
 * Returns rich metadata for precise Bangumi matching.
 */
function parseFolderName(name) {
  const base = name.replace(/^\[[^\]]+\]\s*/, '').replace(/\s*\[[^\]]+\]$/, '').trim();

  // 1. Try anitomy on original name first (handles [Group] brackets natively)
  let parsed = {};
  try { parsed = anitomy.parse(name); } catch (e) {}

  // 2. If no title found, retry with brackets stripped
  if (!parsed.title) {
    try { parsed = anitomy.parse(base); } catch (e) {}
  }

  // 3. Extract CJK title from original name (Bangumi prefers Japanese/Chinese)
  let cjkTitle = null;
  const cjkOnly = base.replace(/[^\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '').trim();
  if (cjkOnly) cjkTitle = cjkOnly;

  // 4. If anitomy title has both CJK and Latin, use CJK part (Latin is usually truncated/wrong)
  let anitomyTitle = parsed.title?.trim() || base;
  if (cjkTitle && anitomyTitle && /[\u4e00-\u9fff]/.test(anitomyTitle) && /[a-zA-Z]/.test(anitomyTitle)) {
    anitomyTitle = cjkTitle;
  }

  // 5. Extract all useful fields from anitomy result
  const result = {
    title: anitomyTitle,
    cjkTitle,
    cleanTitle: null,
    season: null,
    year: null,
    animeTitle: parsed.anime_title?.trim(),
    episode: parsed.episode?.number ? parseInt(parsed.episode.number) : null,
    seasonRaw: parsed.season ? parseInt(parsed.season) : null,
    resolution: parsed.video_resolution,
    source: parsed.source,
    videoCodec: parsed.video_codec,
    audioCodec: parsed.audio_codec,
    releaseGroup: parsed.release_group,
    _raw: parsed,
  };

  // 6. Season determination (priority: anitomy.season > anitomy.episode 2-20 > regex fallback)
  const isEpisodeRange = parsed.episode?.numberAlt != null;
  const nameNoBrackets = name.replace(/\[[^\]]*\]/g, ' ');
  const epHasDash = result.episode && new RegExp('[-–]\\s*' + result.episode + '\\b').test(nameNoBrackets);
  const epIsTitleSuffix = result.episode && !epHasDash && nameNoBrackets.trim().endsWith(String(result.episode));
  if (result.seasonRaw) {
    result.season = result.seasonRaw;
  } else if (!isEpisodeRange && !epIsTitleSuffix && result.episode && result.episode >= 2 && result.episode <= 20) {
    result.season = result.episode;
  }

  // 7. Year extraction
  const yearMatch = name.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) result.year = parseInt(yearMatch[1]);

  // 8. Clean title: strip season markers, preserve punctuation
  let cleanTitle = result.title;
  cleanTitle = cleanTitle.replace(/\s*S\d+\s*$/i, '').trim();
  cleanTitle = cleanTitle.replace(/\s*Season\s*\d+\s*/i, '').trim();
  cleanTitle = cleanTitle.replace(/第(\d+)季/g, '').trim();
  result.cleanTitle = cleanTitle;

  // 9. Regex fallback for season (raw base, when anitomy missed)
  if (!result.season) {
    const sm = base.match(/(?:^|\s)Season\s*(\d+)/i) || base.match(/(?:^|\s)S(\d+)\s*$/i);
    if (sm) result.season = parseInt(sm[1]);
  }

  // 10. Strip parenthetical metadata from cleanTitle only
  result.cleanTitle = result.cleanTitle.replace(/\([^)]*\)/g, '').trim();

  // 11. Trailing number 2-20 → season (only if not volume)
  const trailingNum = result.cleanTitle.match(/\s+(\d+)\s*$/);
  if (trailingNum && parseInt(trailingNum[1]) >= 2 && parseInt(trailingNum[1]) <= 20) {
    const prefix = result.cleanTitle.slice(0, trailingNum.index).replace(/\s*$/, '');
    const isVolume = /(?:Vol|Volume|Part)\b/i.test(prefix);
    if (!isVolume && !result.season && !epIsTitleSuffix) result.season = parseInt(trailingNum[1]);
  }

  // Season 1 is implicit default; only S2+ worth annotating
  if (result.season === 1) result.season = null;

  return result;
}

/**
 * Build an anime entry from a directory path
 */
function buildAnimeEntry(fullPath, folderName) {
  const videos = findVideos(fullPath);
  if (videos.length === 0) return null;
  const parsed = parseFolderName(folderName);
  const hasCjk = CJK_RE.test(parsed.title);
  if (!parsed.title || (!hasLatinLetters(parsed.title) && !hasCjk)) {
    const vp = parseFolderName(videos[0].name);
    if (vp.title) {
      parsed.title = vp.title;
      if (!parsed.season && vp.season) parsed.season = vp.season;
    }
  }
  return {
    folderPath: fullPath,
    folderName,
    parsedTitle: parsed.title,
    cjkTitle: parsed.cjkTitle || null,
    parsedSeason: parsed.season,
    videoCount: videos.length,
    totalSize: videos.reduce((sum, v) => sum + v.size, 0),
  };
}

/**
 * Scan a media directory for anime folders
 */
function scanMediaDir(mediaDir) {
  const results = [];

  try {
    const entries = fs.readdirSync(mediaDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'covers') continue;

      const fullPath = path.join(mediaDir, entry.name);

      if (hasDirectVideos(fullPath)) {
        const anime = buildAnimeEntry(fullPath, entry.name);
        if (anime) results.push(anime);
      } else {
        const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (!sub.isDirectory()) continue;
          const subPath = path.join(fullPath, sub.name);
          const anime = buildAnimeEntry(subPath, sub.name);
          if (anime) results.push(anime);
        }
      }
    }
  } catch (e) {
    throw new Error('Failed to scan media directory: ' + e.message);
  }

  return results;
}

/**
 * Build a leaf node for a folder that directly contains video files.
 * parentChain is an array of ancestor folder names from mediaDir to parent.
 */
function buildLeaf(dirPath, name, parentName, parentChain) {
  const videos = findVideos(dirPath);
  if (videos.length === 0) return null;
  let parsed = parseFolderName(name);
  // If parsed title is just a season indicator, fall through to parent chain lookup
  if (parsed.title && /^(?:Season\s*\d+|S\d+|第\d+季)$/i.test(parsed.title.trim())) {
    parsed.title = null;
  }
  const chain = parentChain || [];
  // Check parentName first (immediate parent, highest priority for CJK)
  let nearestCjk = null;
  if (parentName) {
    const parentParsed = parseFolderName(parentName);
    if (parentParsed.cjkTitle) nearestCjk = parentParsed.cjkTitle;
    if (!parsed.title && parentParsed.title) {
      const isDuplicate = parentParsed.title === name;
      parsed = { title: parentParsed.title, cjkTitle: parsed.cjkTitle || parentParsed.cjkTitle, season: parsed.season || parentParsed.season };
      if (isDuplicate) parsed.season = parsed.season || parentParsed.season;
    }
  }
  // Walk parentChain (closest first) for more distant ancestors
  for (let i = 0; i < chain.length; i++) {
    const pParsed = parseFolderName(chain[i]);
    if (pParsed.cjkTitle && !nearestCjk) { nearestCjk = pParsed.cjkTitle; break; }
    if (!parsed.title && pParsed.title) {
      const isDuplicate = pParsed.title === name || pParsed.title === parsed.title;
      parsed = { title: pParsed.title, cjkTitle: parsed.cjkTitle || pParsed.cjkTitle, season: parsed.season || pParsed.season };
      if (isDuplicate) parsed.season = parsed.season || pParsed.season;
      break;
    }
  }
  // If leaf title is Latin-only and ancestor has CJK, prefer ancestor's CJK
  if (nearestCjk && parsed.title && !/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(parsed.title)) {
    parsed.title = nearestCjk;
  }
  if (!parsed.cjkTitle && nearestCjk) parsed.cjkTitle = nearestCjk;
  let episode = parsed.episode;
  const hasCjkTitle = CJK_RE.test(parsed.title);
  if (!parsed.title || (!hasLatinLetters(parsed.title) && !hasCjkTitle)) {
    const vp = parseFolderName(videos[0].name);
    if (vp.title) {
      parsed.title = vp.title;
      if (!episode && vp.episode) episode = vp.episode;
      if (!parsed.season && vp.season) parsed.season = vp.season;
    }
  }
  return {
    name,
    path: dirPath,
    type: 'leaf',
    parsedTitle: parsed.title,
    cjkTitle: parsed.cjkTitle || null,
    parsedSeason: parsed.season,
    videoCount: videos.length,
    totalSize: videos.reduce((sum, v) => sum + v.size, 0),
    videos: videos.map(v => ({ name: v.name, size: v.size })),
    parentChain: chain,
  };
}

/**
 * Recursively scan a directory's sub-directories for anime entries.
 */
function scanDir(dirPath, chain) {
  const children = [];
  const parentName = path.basename(dirPath);
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && e.name !== 'covers');
    for (const entry of dirs) {
      const fullPath = path.join(dirPath, entry.name);
      if (hasDirectVideos(fullPath)) {
        const leaf = buildLeaf(fullPath, entry.name, parentName, chain);
        if (leaf) children.push(leaf);
      } else {
        const sub = scanDir(fullPath, [...(chain || []), entry.name]);
        if (sub.length > 0) {
          children.push({ name: entry.name, path: fullPath, type: 'branch', children: sub });
        }
      }
    }
  } catch (e) {}
  return children;
}

/**
 * Scan a single top-level directory and return its tree node.
 */
function scanTopDir(mediaDir, dirName) {
  const fullPath = path.join(mediaDir, dirName);
  if (hasDirectVideos(fullPath)) {
    return buildLeaf(fullPath, dirName, null, []);
  }
  const children = scanDir(fullPath, [dirName]);
  if (children.length > 0) {
    return { name: dirName, path: fullPath, type: 'branch', children };
  }
  return null;
}

/**
 * Scan media dir and return a tree of anime folders.
 */
function scanMediaDirTree(mediaDir) {
  const results = [];
  try {
    const entries = fs.readdirSync(mediaDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && e.name !== 'covers');
    for (const entry of dirs) {
      const node = scanTopDir(mediaDir, entry.name);
      if (node) results.push(node);
    }
  } catch (e) {
    throw new Error('Failed to scan media directory: ' + e.message);
  }
  return results;
}

/**
 * Scan media dir and return a flat array of leaf nodes.
 */
function scanMediaDirFlat(mediaDir) {
  const results = [];
  function walk(dir, chain) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && e.name !== 'covers');
      for (const entry of dirs) {
        const fullPath = path.join(dir, entry.name);
        if (hasDirectVideos(fullPath)) {
          const leaf = buildLeaf(fullPath, entry.name, null, chain);
          if (leaf) results.push(leaf);
        } else {
          walk(fullPath, [...chain, entry.name]);
        }
      }
    } catch (e) {}
  }
  try {
    walk(mediaDir, []);
  } catch (e) {
    throw new Error('Failed to scan media directory: ' + e.message);
  }
  return results;
}

module.exports = { scanMediaDir, scanMediaDirTree, scanMediaDirFlat, scanTopDir, parseFolderName, findVideos, hasDirectVideos, VIDEO_EXTS };
