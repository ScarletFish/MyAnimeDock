// ─── XSS 防护 ───

export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── 路径工具 ───

export function basename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

export function dirname(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || parts.join('\\') || '.';
}

export function extname(p) {
  if (!p) return '';
  const base = basename(p);
  const dotIndex = base.lastIndexOf('.');
  return dotIndex <= 0 ? '' : base.slice(dotIndex);
}

// ─── 字符串工具 ───

export function normalizeSearchText(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function truncate(str, maxLength, suffix = '...') {
  if (!str || str.length <= maxLength) return str || '';
  return str.slice(0, maxLength - suffix.length) + suffix;
}

// ─── 数字工具 ───

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── 日期工具 ───

export function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

export function formatDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toISOString();
}

// ─── 季节工具 ───

/**
 * Get anime season from date string (Japanese anime conventions):
 * 春 (Spring): Apr-Jun | 夏 (Summer): Jul-Sep | 秋 (Autumn): Oct-Dec | 冬 (Winter): Jan-Mar
 * @param {string} dateStr - Date string in YYYY-MM-DD or YYYY/MM/DD format
 * @returns {'spring'|'summer'|'autumn'|'winter'|null}
 */
export function getAnimeSeason(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^(\d{4})[-/](\d{1,2})/);
  if (!match) return null;
  const month = parseInt(match[2], 10);
  if (month >= 4 && month <= 6) return 'spring';
  if (month >= 7 && month <= 9) return 'summer';
  if (month >= 10 && month <= 12) return 'autumn';
  if (month >= 1 && month <= 3) return 'winter';
  return null;
}

// ─── TTL 缓存工具 ───

/**
 * 创建一个带过期时间的单值缓存
 * @param {number} ttlMs - 过期时间（毫秒）
 * @returns {{ get: () => any, set: (data: any) => void, clear: () => void }}
 */
export function createTimedCache(ttlMs) {
  let _data = null, _ts = 0;
  return {
    get() { return (Date.now() - _ts < ttlMs) ? _data : null; },
    set(data) { _data = data; _ts = Date.now(); },
    clear() { _data = null; _ts = 0; },
  };
}

/**
 * 创建一个带过期时间的多键缓存（Map 模式）
 * 适用场景：按 ID 缓存推荐列表、关联条目等
 * @param {number} ttlMs - 过期时间（毫秒）
 * @returns {{ get: (key: string) => any, set: (key: string, data: any) => void, clear: (key?: string) => void }}
 */
export function createTimedCacheMap(ttlMs) {
  const _map = new Map();
  return {
    get(key) {
      const entry = _map.get(key);
      if (!entry || Date.now() - entry.ts >= ttlMs) return null;
      return entry.data;
    },
    set(key, data) { _map.set(key, { data, ts: Date.now() }); },
    clear(key) { if (key) _map.delete(key); else _map.clear(); },
  };
}
