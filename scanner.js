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
 * Parse folder name to extract clean title and season number
 * Rules (from requirements doc):
 * 1. Remove "Anime-" prefix (case-insensitive)
 * 2. Remove all [bracket] content
 * 3. Remove resolution/encoding words
 * 4. Remove fansub group names from blacklist
 * 5. Match and remove season number (Season \d+, S\d+, 第\d+季)
 * 6. Clean hyphens/underscores, collapse whitespace
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

  return { title: title.trim(), season };
}

/**
 * Scan a media directory for anime folders
 * Returns array of discovered anime with parsed info
 */
function scanMediaDir(mediaDir) {
  const results = [];

  try {
    const entries = fs.readdirSync(mediaDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'covers') continue;

      const fullPath = path.join(mediaDir, entry.name);
      const videos = findVideos(fullPath);
      if (videos.length === 0) continue;

      const parsed = parseFolderName(entry.name);

      results.push({
        folderPath: fullPath,
        folderName: entry.name,
        parsedTitle: parsed.title,
        parsedSeason: parsed.season,
        videoCount: videos.length,
        totalSize: videos.reduce((sum, v) => sum + v.size, 0),
      });
    }
  } catch (e) {
    throw new Error('Failed to scan media directory: ' + e.message);
  }

  return results;
}

module.exports = { scanMediaDir, parseFolderName, findVideos, VIDEO_EXTS };
