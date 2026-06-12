const fs = require('fs');
const path = require('path');
const { Parser } = require('anitomy');

const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.webm']);
const anitomy = new Parser();

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
 * Parse folder name to extract clean title and season number.
 * Uses anitomy for structured parsing, falls back to name cleaning.
 */
function parseFolderName(name) {
  // 1. Remove Anime- prefix and bracket content
  let base = name.replace(/^Anime-[\s\-]*/i, '');
  base = base.replace(/\[[^\]]*\]/g, '');
  base = base.trim();

  // 2. Run anitomy for structure extraction
  let parsed = {};
  try {
    parsed = anitomy.parse(base);
  } catch (e) {}

  // 3. Season from anitomy or episode 2-20
  let season = null;
  if (parsed.season) {
    season = parseInt(parsed.season);
  }
  if (!season && parsed.episode && parsed.episode.number) {
    const ep = parseInt(parsed.episode.number);
    if (ep >= 2 && ep <= 20) season = ep;
  }

  // 4. Pick title: prefer anitomy when it extracted something valid
  //    and the remaining part of base looks like metadata (not a real title word)
  let title = base;
  if (parsed.title) {
    const aTitle = parsed.title.trim();
    const leftover = base.slice(aTitle.length).trim();
    if (base.startsWith(aTitle) && !leftover) {
      title = aTitle;
    } else if (base.startsWith(aTitle) && leftover) {
      // Heuristic: if leftover contains only metadata tokens → use anitomy title
      const metaTokens = leftover.split(/[\s()]+/).filter(Boolean);
      const allMeta = metaTokens.length > 0 && metaTokens.every(t =>
        /^\d{4}$/.test(t) ||
        /^S\d+$/i.test(t) || /^Season$/i.test(t) ||
        /^\d+(st|nd|rd)$/i.test(t) || /^[2-9]\d*$/.test(t) ||
        /^(BD|DVD|WEB|WEBRip|HDRip|BluRay|x264|x265|HEVC|AAC|FLAC|DTS|AC[34]|Opus|Vorbis|Ma10p)$/i.test(t) ||
        /^\d{3,4}p$/i.test(t) || /^[xH]\d{3,4}p$/i.test(t)
      );
      if (allMeta) title = aTitle;
    }
  }

  // 5. Strip season markers from title
  title = title.replace(/\s*S\d+\s*$/i, ' ').trim();
  title = title.replace(/\s*Season\s*\d+\s*/i, ' ').trim();
  title = title.replace(/第(\d+)季/g, ' ').trim();

  // 6. Season regex fallback (raw name, anitomy missed it)
  if (!season) {
    const sm = title.match(/(?:^|\s)Season\s*(\d+)/i)
      || title.match(/(?:^|\s)S(\d+)\s*$/i);
    if (sm) {
      season = parseInt(sm[1]);
      title = title.replace(sm[0], '');
    }
  }

  // 7. Strip parenthetical metadata
  title = title.replace(/\([^)]*\)/g, '');
  title = title.replace(/\s{2,}/g, ' ').trim();

  // 8. Clean separators and trailing year
  title = title.replace(/[_|]+/g, ' ');
  title = title.replace(/\s{2,}/g, ' ');
  title = title.trim();
  title = title.replace(/\s+\d{4}\s*$/, '');

  // 9. Trailing number 2-20 → season
  const trailingNum = title.match(/\s+(\d+)\s*$/);
  if (trailingNum && parseInt(trailingNum[1]) >= 2 && parseInt(trailingNum[1]) <= 20) {
    const prefix = title.slice(0, trailingNum.index).replace(/\s*$/, '');
    const isVolume = /(?:Vol|Volume|Part)\b/i.test(prefix);
    if (!isVolume) {
      if (!season) season = parseInt(trailingNum[1]);
      title = title.replace(trailingNum[0], '');
    }
  }

  // Season 1 is the implicit default; only S2+ is worth annotating
  if (season === 1) season = null;

  return { title: title.trim(), season };
}

/**
 * Build an anime entry from a directory path
 */
function buildAnimeEntry(fullPath, folderName) {
  const videos = findVideos(fullPath);
  if (videos.length === 0) return null;
  const parsed = parseFolderName(folderName);
  return {
    folderPath: fullPath,
    folderName,
    parsedTitle: parsed.title,
    parsedSeason: parsed.season,
    videoCount: videos.length,
    totalSize: videos.reduce((sum, v) => sum + v.size, 0),
  };
}

/**
 * Scan a media directory for anime folders
 *
 * Smart depth detection:
 * - If a folder has video files directly → single anime
 * - If a folder only has sub-folders with videos → each sub-folder is a separate season
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
        // Single anime directory (videos directly inside)
        const anime = buildAnimeEntry(fullPath, entry.name);
        if (anime) results.push(anime);
      } else {
        // Series directory — scan sub-folders as separate seasons
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
 * If the folder name is just a season indicator (e.g. "Season 1", "S1"),
 * walks up parentChain to find the anime title.
 * parentChain is an array of ancestor folder names from mediaDir to parent.
 */
function buildLeaf(dirPath, name, parentName, parentChain) {
  const videos = findVideos(dirPath);
  if (videos.length === 0) return null;
  let parsed = parseFolderName(name);
  if (!parsed.title) {
    const chain = parentChain || [];
    for (let i = chain.length - 1; i >= 0; i--) {
      const pParsed = parseFolderName(chain[i]);
      if (pParsed.title) {
        parsed = { title: pParsed.title, season: parsed.season || pParsed.season };
        break;
      }
    }
    if (!parsed.title && parentName) {
      const parentParsed = parseFolderName(parentName);
      parsed = { title: parentParsed.title, season: parsed.season || parentParsed.season };
    }
  }
  return {
    name,
    path: dirPath,
    type: 'leaf',
    parsedTitle: parsed.title,
    parsedSeason: parsed.season,
    videoCount: videos.length,
    totalSize: videos.reduce((sum, v) => sum + v.size, 0),
    videos: videos.map(v => ({ name: v.name, size: v.size })),
    parentChain: parentChain || [],
  };
}

/**
 * Recursively scan a directory's sub-directories for anime entries.
 * Returns an array of tree nodes (branch or leaf).
 * chain — ancestor folder names from mediaDir to dirPath (excluding dirPath).
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
 * Used by both scanMediaDirTree and the scan endpoint for per-dir progress.
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
 * Top-level entries can be either leaves (direct anime) or branches (series containers).
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
 * Each leaf has a parentChain array of ancestor folder names.
 * Skips directories without direct video files (no branch nodes).
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
