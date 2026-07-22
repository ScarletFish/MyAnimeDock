const fs = require('fs');
const path = require('path');
const { Parser } = require('anitomy');

const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.webm']);
const anitomy = new Parser();

// Non-episode video patterns: NCOP, NCED, PV, CM, Menu, Preview, Trailer
// Note: NCOP1/NCED2 etc. now match because `\d*` moves the word boundary past digits
const EXTRA_VIDEO_RE = /\b(NCOP\d*|NCED\d*|PV\s*\d*|CM[ \d]*|Menu\d*|Preview|Trailer)\b/i;

function isExtraVideo(fileName) {
  return EXTRA_VIDEO_RE.test(fileName.replace(/\[[^\]]*\]/g, ' '));
}

// No `g` flag: test() without `g` is not stateful and avoids false negatives
// when the same regex instance is reused across multiple calls.
const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/;

function hasLatinLetters(str) {
  return (str || '').replace(/[^a-zA-Z]/g, '').length >= 3;
}

// ── File operations (async) ─────────────────────────────────────

/**
 * Find all video files recursively in a directory.
 * Now async — does not block the event loop.
 */
async function findVideos(dir) {
  const results = [];
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await findVideos(full));
      } else if (VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.promises.stat(full);
        results.push({ path: full, name: entry.name, size: stat.size });
      }
    }
  } catch (e) {
    // Skip unreadable dirs but log for debugging
    console.error(`[Scanner] findVideos: cannot read ${dir}: ${e.message}`);
  }
  return results;
}

/**
 * Check if a directory has video files directly (not in sub-directories).
 */
async function hasDirectVideos(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.some(e => !e.isDirectory() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase()));
  } catch (e) {
    console.error(`[Scanner] hasDirectVideos: cannot read ${dir}: ${e.message}`);
    return false;
  }
}

// ── Folder name parsing ─────────────────────────────────────────

/**
 * Parse folder name to extract structured anime info using anitomy.
 * Returns rich metadata for precise Bangumi matching.
 */
function parseFolderName(name) {
  // Strip trailing slash and clean up
  name = name.replace(/\/+$/, '').trim();
  // Strip leading and all trailing bracket groups
  const base = name.replace(/^\[[^\]]+\]\s*/, '').replace(/(\s*\[[^\]]+\])*$/, '').trim();

  // ── Phase 1: anitomy parsing + CJK detection ──
  // 1. Try anitomy on original name first (handles [Group] brackets natively)
  let parsed = {};
  try { parsed = anitomy.parse(name); } catch (e) {}

  // 2. If no title found, retry with brackets stripped
  if (!parsed.title) {
    try { parsed = anitomy.parse(base); } catch (e) {}
  }

  // 3. Extract CJK title from original name (Bangumi prefers Japanese/Chinese)
  let cjkTitle = null;
  const cjkOnly = base.replace(/[^\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '')
    .replace(/第\d*期/g, '').replace(/Season\d*/gi, '').replace(/S\d+/gi, '').trim();
  if (cjkOnly) cjkTitle = cjkOnly;

  // 4. If anitomy title has both CJK and Latin, use CJK part (Latin is usually truncated/wrong)
  let anitomyTitle = parsed.title?.trim() || base;
  if (cjkTitle && anitomyTitle && /[\u4e00-\u9fff]/.test(anitomyTitle) && /[a-zA-Z]/.test(anitomyTitle)) {
    anitomyTitle = cjkTitle;
  }

  // 4b. Detect anitomy title truncation (e.g., "Yuru Yuri" → "Yuru")
  // If anitomy title is significantly shorter than base, use base instead
  if (anitomyTitle && base && !cjkTitle) {
    const titleLen = anitomyTitle.replace(/\s/g, '').length;
    const baseLen = base.replace(/\s/g, '').length;
    if (titleLen > 0 && baseLen > titleLen + 3) {
      anitomyTitle = base;
    }
  }

  // ── Phase 2: Build structured result object ──
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

  // ── Phase 3: Season + title + metadata ──
  // 6. Season determination (priority: anitomy.season > anitomy.episode 2-20 > regex fallback)
  const isEpisodeRange = parsed.episode?.numberAlt != null;
  if (result.seasonRaw) {
    result.season = result.seasonRaw;
  } else if (!isEpisodeRange && result.episode && result.episode >= 2 && result.episode <= 20) {
    result.season = result.episode;
  }

  // 7. Year extraction
  const yearMatch = name.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) result.year = parseInt(yearMatch[1]);

  // 8. Clean title: strip season markers, special suffix, preserve punctuation
  let cleanTitle = result.title;
  cleanTitle = cleanTitle.replace(/\s*S\d+\s*$/i, '').trim();
  cleanTitle = cleanTitle.replace(/\s*Season\s*\d+\s*/i, '').trim();
  cleanTitle = cleanTitle.replace(/第(\d+)季/g, '').trim();
  cleanTitle = cleanTitle.replace(/\s*[~～][^~～]*[~～]\s*$/, '').trim();
  cleanTitle = cleanTitle.replace(/[~～]/g, '').trim();
  result.cleanTitle = cleanTitle;
  // Also strip S\d+ from result.title (not just cleanTitle), for cleaner display title
  result.title = result.title.replace(/\s*S\d+\s*$/i, '').trim();

  // 9. Regex fallback for season (raw base, when anitomy missed)
  if (!result.season) {
    const sm = base.match(/(?:^|\s)Season\s*(\d+)/i) || base.match(/(?:^|\s)S(\d+)(?:\s|$)/i);
    if (sm) result.season = parseInt(sm[1]);
  }

  // 10. Symbol-based season markers: ♪♪=2, ♪♪♪=3, ！！=2, etc.
  // Note: ? and ？ are excluded — they are part of actual titles (e.g. Gochuumon wa Usagi Desu ka??)
  if (!result.season) {
    const symbolMatch = base.match(/([！!♪♫★☆♥♡])\1+/);
    if (symbolMatch) {
      const count = symbolMatch[0].length;
      if (count >= 2 && count <= 5) result.season = count;
    }
  }

  // 11. Strip parenthetical metadata from cleanTitle only
  result.cleanTitle = result.cleanTitle.replace(/\([^)]*\)/g, '').trim();

  // 12. Extract special suffix (~...~) for OVA/special detection (retain in title for display)
  result.specialSuffix = null;
  const suffixMatch = result.title.match(/([~～][^~～]*[~～])\s*$/);
  if (suffixMatch) result.specialSuffix = suffixMatch[1].trim();

  // 13. Trailing number 2-20 → season (only if not volume)
  const trailingNum = result.cleanTitle.match(/\s+(\d+)\s*$/);
  if (trailingNum && parseInt(trailingNum[1]) >= 2 && parseInt(trailingNum[1]) <= 20) {
    const prefix = result.cleanTitle.slice(0, trailingNum.index).replace(/\s*$/, '');
    const isVolume = /(?:Vol|Volume|Part)\b/i.test(prefix);
    if (!isVolume && !result.season) result.season = parseInt(trailingNum[1]);
  }

  // Season 1 is implicit default; only S2+ worth annotating
  if (result.season === 1) result.season = null;

  // 14. Extract bangumiId from path: [bgmN]
  result.bangumiId = extractBgmId(name);

  return result;
}

// ── Leaf building ──────────────────────────────────────────────

/**
 * Check if a title is just a season/volume marker without anime name.
 */
function isSeasonOnly(title) {
  return /^(?:Season\s*\d+|S\d+|第\d+季)$/i.test(title.trim());
}

/**
 * Propagate bangumiId from ancestor folder names (parentName first, then chain).
 * Used when the leaf folder itself has no [bgmN] identifier.
 */
function propagateBgmIdFromChain(parentName, chain) {
  const candidates = [parentName, ...(chain || [])].filter(Boolean);
  for (const c of candidates) {
    const id = extractBgmId(c);
    if (id) return id;
  }
  return null;
}

/**
 * Fallback to first video filename for title/season when the folder
 * name doesn't resolve to a valid title.
 */
function fallbackToVideoTitle(parsed, videos) {
  if (!parsed.title || (!hasLatinLetters(parsed.title) && !CJK_RE.test(parsed.title))) {
    const vp = parseFolderName(videos[0].name);
    if (vp.title) {
      parsed.title = vp.title;
      if (!parsed.episode && vp.episode) parsed.episode = vp.episode;
      if (!parsed.season && vp.season) parsed.season = vp.season;
    }
  }
  return parsed;
}

/**
 * Build a leaf node for a folder that directly contains video files.
 * parentChain is an array of ancestor folder names from mediaDir to parent.
 * parentName is the immediate parent folder name (may differ from chain[-1]).
 */
async function buildLeaf(dirPath, name, parentName, parentChain) {
  const allVideos = await findVideos(dirPath);
  if (allVideos.length === 0) return null;

  let parsed = parseFolderName(name);
  const chain = parentChain || [];

  // If parsed title is just a season indicator, clear it so parent chain fills in
  if (parsed.title && isSeasonOnly(parsed.title)) {
    parsed.title = null;
  }

  // Walk ancestors for title fallback and CJK discovery
  let nearestCjk = null;

  // 1. Check parentName (immediate parent) — always checks CJK + title independently
  if (parentName) {
    const pp = parseFolderName(parentName);
    if (pp.cjkTitle) nearestCjk = pp.cjkTitle;
    if (!parsed.title && pp.title && !isSeasonOnly(pp.title)) {
      parsed = { ...parsed, title: pp.title, cjkTitle: parsed.cjkTitle || pp.cjkTitle, season: parsed.season || pp.season };
    }
  }

  // 2. Walk parentChain (closest first) — CJK short-circuits further traversal
  for (let i = 0; i < chain.length; i++) {
    const pp = parseFolderName(chain[i]);
    if (pp.cjkTitle && !nearestCjk) { nearestCjk = pp.cjkTitle; break; }
    if (!parsed.title && pp.title && !isSeasonOnly(pp.title)) {
      parsed = { ...parsed, title: pp.title, cjkTitle: parsed.cjkTitle || pp.cjkTitle, season: parsed.season || pp.season };
      break;
    }
  }

  // 3. Propagate bangumiId from ancestor (parentName → chain)
  const bgmId = propagateBgmIdFromChain(parentName, chain);
  const flattenChain = !parsed.bangumiId && !!bgmId;
  if (!parsed.bangumiId) parsed.bangumiId = bgmId;

  // 4. If leaf title is Latin-only and ancestor has CJK, prefer ancestor's CJK
  if (nearestCjk && parsed.title && !CJK_RE.test(parsed.title)) {
    parsed.title = nearestCjk;
  }
  if (!parsed.cjkTitle && nearestCjk) parsed.cjkTitle = nearestCjk;

  // 5. Fallback to first video filename if still no valid title
  parsed = fallbackToVideoTitle(parsed, allVideos);

  // 6. Build return object
  const videoCount = allVideos.filter(v => !isExtraVideo(v.name)).length;
  return {
    name,
    path: dirPath,
    type: 'leaf',
    parsedTitle: parsed.title,
    cjkTitle: parsed.cjkTitle || null,
    parsedSeason: parsed.season,
    specialSuffix: parsed.specialSuffix || null,
    bangumiId: parsed.bangumiId || null,
    videoCount,
    totalVideoFiles: allVideos.length,
    totalSize: allVideos.reduce((sum, v) => sum + v.size, 0),
    videos: allVideos.map(v => ({ name: v.name, size: v.size, isExtra: isExtraVideo(v.name) })),
    parentChain: flattenChain ? [] : chain,
  };
}

// ── Directory scanning ─────────────────────────────────────────

/**
 * Unified recursive directory walker.
 * Returns a tree of branch/leaf nodes.
 * When `collect` is provided, each discovered leaf is also pushed to the collector
 * (enabling `scanMediaDirFlat` without a separate recursive implementation).
 */
async function walkDirs(dirPath, chain, collect) {
  const children = [];
  const parentName = path.basename(dirPath);
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && e.name !== 'covers');
    for (const entry of dirs) {
      const fullPath = path.join(dirPath, entry.name);
      if (await hasDirectVideos(fullPath)) {
        const leaf = await buildLeaf(fullPath, entry.name, parentName, chain);
        if (leaf) {
          if (collect) collect(leaf);
          children.push(leaf);
        }
      } else {
        const sub = await walkDirs(fullPath, [...(chain || []), entry.name], collect);
        if (sub.length > 0) {
          children.push({ name: entry.name, path: fullPath, type: 'branch', children: sub });
        }
      }
    }
  } catch (e) {
    console.error(`[Scanner] walkDirs: cannot read ${dirPath}: ${e.message}`);
  }
  return children;
}

/**
 * Recursively scan a directory's sub-directories for anime entries (tree).
 */
async function scanDir(dirPath, chain) {
  return walkDirs(dirPath, chain || [], null);
}

/**
 * Scan a single top-level directory and return its tree node.
 */
async function scanTopDir(mediaDir, dirName) {
  const fullPath = path.join(mediaDir, dirName);
  if (await hasDirectVideos(fullPath)) {
    return buildLeaf(fullPath, dirName, null, []);
  }
  const children = await scanDir(fullPath, [dirName]);
  if (children.length > 0) {
    return { name: dirName, path: fullPath, type: 'branch', children };
  }
  return null;
}

/**
 * Scan media dir and return a flat array of leaf nodes.
 */
async function scanMediaDirFlat(mediaDir) {
  const results = [];
  try {
    await walkDirs(mediaDir, [], l => results.push(l));
  } catch (e) {
    // Preserve stack: re-throw with original error as cause
    throw new Error(`Failed to scan media directory: ${e.message}`, { cause: e });
  }
  return results;
}

// ── Utilities ─────────────────────────────────────────────────

/**
 * Extract Bangumi ID from folder name or path.
 * Matches [bgm525565], [bgm12345] at any position.
 */
function extractBgmId(name) {
  if (!name) return null;
  const m = name.match(/\[bgm(\d+)\]/i);
  return m ? parseInt(m[1]) : null;
}

module.exports = { scanMediaDirFlat, scanTopDir, parseFolderName, findVideos, hasDirectVideos, isExtraVideo, extractBgmId, VIDEO_EXTS };
