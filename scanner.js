const fs = require('fs');
const path = require('path');

const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.avi', '.mov', '.webm']);

// Fansub group blacklist for title parsing
const BLACKLIST = [
  'VCB-Studio', 'Airota', 'Rabbit House', 'Coalgirls', 'Commie',
  'FFF', 'HorribleSubs', 'SubGroup', 'EncodeBy', 'ADN', 'Ohys-Raws',
  'Lilith-Raws', 'ANK-Raws', 'Kaleido-subs', 'Snow-Raws', 'Ma10p',
  'Ma10p_1080p', 'BDrip', 'BDRip', 'WEB-DL', 'WEBRip', 'HDRip',
  'DVDrip', 'DVDRip', 'BluRay', 'x264', 'x265', 'x265-10bit',
  'HEVC', 'AAC', 'FLAC', 'DTS', 'AC3', 'Opus', 'Vorbis',
  '1080p', '720p', '480p', '4K', '2160p', 'Ma10p',
];

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
 * Parse folder name to extract clean title and season number
 * Rules:
 * 1. Remove "Anime-" prefix
 * 2. Remove all [bracket] content
 * 3. Remove resolution/encoding words
 * 4. Extract season number (Season \d+, S\d+, 第\d+季, or trailing number)
 * 5. Clean separators and whitespace
 * 6. Remove trailing year and trailing hyphen
 */
function parseFolderName(name) {
  let title = name;

  // 1. Remove Anime- prefix
  title = title.replace(/^Anime-[\s\-]*/i, '');

  // 2. Remove all [bracket] content
  title = title.replace(/\[[^\]]*\]/g, '');

  // 3. Remove resolution/encoding words
  for (const word of BLACKLIST) {
    const regex = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    title = title.replace(regex, '');
  }

  // 4. Extract season number
  let season = null;
  const seasonMatch = title.match(/Season\s*(\d+)/i)
    || title.match(/S(\d+)/i)
    || title.match(/第(\d+)季/);
  if (seasonMatch) {
    season = parseInt(seasonMatch[1]);
    title = title.replace(seasonMatch[0], '');
  }

  // 5. Clean separators and whitespace
  title = title.replace(/[\-_|]+/g, ' ');
  title = title.replace(/\s{2,}/g, ' ');
  title = title.trim();

  // 6. Remove trailing year (4 digits)
  title = title.replace(/\s+\d{4}\s*$/, '');

  // 7. Remove trailing hyphen and anything after
  title = title.replace(/\s*-\s*[^-]*$/, '');

  // 8. Trailing number → season (e.g., "Yuru Yuri 2" → season 2)
  if (!season) {
    const trailingNum = title.match(/\s+(\d+)\s*$/);
    if (trailingNum && parseInt(trailingNum[1]) >= 2 && parseInt(trailingNum[1]) <= 20) {
      season = parseInt(trailingNum[1]);
      title = title.replace(trailingNum[0], '');
    }
  }

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
 * falls back to parentName for the anime title while keeping the season number.
 */
function buildLeaf(dirPath, name, parentName) {
  const videos = findVideos(dirPath);
  if (videos.length === 0) return null;
  let parsed = parseFolderName(name);
  if (!parsed.title && parentName) {
    const parentParsed = parseFolderName(parentName);
    parsed = { title: parentParsed.title, season: parsed.season || parentParsed.season };
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
  };
}

/**
 * Recursively scan a directory's sub-directories for anime entries.
 * Returns an array of tree nodes (branch or leaf).
 */
function scanDir(dirPath) {
  const children = [];
  const parentName = path.basename(dirPath);
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && e.name !== 'covers');
    for (const entry of dirs) {
      const fullPath = path.join(dirPath, entry.name);
      if (hasDirectVideos(fullPath)) {
        const leaf = buildLeaf(fullPath, entry.name, parentName);
        if (leaf) children.push(leaf);
      } else {
        const sub = scanDir(fullPath);
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
    return buildLeaf(fullPath, dirName);
  }
  const children = scanDir(fullPath);
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

module.exports = { scanMediaDir, scanMediaDirTree, scanTopDir, parseFolderName, findVideos, hasDirectVideos, VIDEO_EXTS };
