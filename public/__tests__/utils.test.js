/**
 * Unit tests for public/js/utils.js
 * Run with: npm run test:frontend
 */

import { describe, it, expect } from 'vitest';
import {
  escHtml,
  escAttr,
  basename,
  dirname,
  extname,
  STATUS_LABELS,
  STATUS_VALUES,
  normalizeSearchText,
  truncate,
  clamp,
  formatFileSize,
  formatDuration,
  formatDate,
  formatDateTime,
  getAnimeSeason
} from '../js/utils.js';

describe('escHtml', () => {
  it('escapes ampersand', () => {
    expect(escHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes less than', () => {
    expect(escHtml('a<b')).toBe('a&lt;b');
  });

  it('escapes greater than', () => {
    expect(escHtml('a>b')).toBe('a&gt;b');
  });

  it('escapes multiple entities', () => {
    // escHtml only escapes &, <, > (not quotes - use escAttr for attribute values)
    expect(escHtml('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
  });

  it('handles empty string', () => {
    expect(escHtml('')).toBe('');
  });

  it('handles null/undefined', () => {
    expect(escHtml(null)).toBe('null');
    expect(escHtml(undefined)).toBe('undefined');
  });

  it('handles numbers', () => {
    expect(escHtml(123)).toBe('123');
  });
});

describe('escAttr', () => {
  it('escapes double quotes', () => {
    expect(escAttr('a"b')).toBe('a&quot;b');
  });

  it('escapes single quotes', () => {
    expect(escAttr("a'b")).toBe('a&#39;b');
  });

  it('escapes HTML entities', () => {
    expect(escAttr('<div class="test">')).toBe('&lt;div class=&quot;test&quot;&gt;');
  });

  it('handles empty string', () => {
    expect(escAttr('')).toBe('');
  });
});

describe('basename', () => {
  it('extracts filename from Unix path', () => {
    expect(basename('/path/to/file.txt')).toBe('file.txt');
  });

  it('extracts filename from Windows path', () => {
    expect(basename('C:\\path\\to\\file.txt')).toBe('file.txt');
  });

  it('handles mixed separators', () => {
    expect(basename('path/to\\file.txt')).toBe('file.txt');
  });

  it('returns empty string for empty input', () => {
    expect(basename('')).toBe('');
  });

  it('returns empty string for null', () => {
    expect(basename(null)).toBe('');
  });

  it('returns filename without directory', () => {
    expect(basename('file.txt')).toBe('file.txt');
  });
});

describe('dirname', () => {
  it('extracts directory from Unix path', () => {
    expect(dirname('/path/to/file.txt')).toBe('/path/to');
  });

  it('extracts directory from Windows path', () => {
    // dirname normalizes to forward slashes
    expect(dirname('C:\\path\\to\\file.txt')).toBe('C:/path/to');
  });

  it('returns . for filename only', () => {
    expect(dirname('file.txt')).toBe('.');
  });

  it('handles empty string', () => {
    expect(dirname('')).toBe('');
  });
});

describe('extname', () => {
  it('extracts extension', () => {
    expect(extname('file.txt')).toBe('.txt');
  });

  it('extracts multi-part extension', () => {
    expect(extname('file.test.js')).toBe('.js');
  });

  it('returns empty for no extension', () => {
    expect(extname('file')).toBe('');
  });

  it('returns empty for hidden file', () => {
    expect(extname('.gitignore')).toBe('');
  });

  it('handles empty string', () => {
    expect(extname('')).toBe('');
  });
});

describe('STATUS_LABELS', () => {
  it('has all status labels', () => {
    expect(STATUS_LABELS.watching).toBe('进行中');
    expect(STATUS_LABELS.wish).toBe('计划中');
    expect(STATUS_LABELS.completed).toBe('已完成');
    expect(STATUS_LABELS.on_hold).toBe('搁置');
    expect(STATUS_LABELS.dropped).toBe('抛弃');
  });
});

describe('STATUS_VALUES', () => {
  it('contains all status keys', () => {
    expect(STATUS_VALUES).toContain('watching');
    expect(STATUS_VALUES).toContain('wish');
    expect(STATUS_VALUES).toContain('completed');
    expect(STATUS_VALUES).toContain('on_hold');
    expect(STATUS_VALUES).toContain('dropped');
  });
});

describe('normalizeSearchText', () => {
  it('converts to lowercase', () => {
    expect(normalizeSearchText('ABC')).toBe('abc');
  });

  it('removes diacritics', () => {
    expect(normalizeSearchText('café')).toBe('cafe');
  });

  it('trims whitespace', () => {
    expect(normalizeSearchText('  hello  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(normalizeSearchText('')).toBe('');
  });

  it('handles CJK characters', () => {
    expect(normalizeSearchText('动漫')).toBe('动漫');
  });
});

describe('truncate', () => {
  it('returns original if shorter than max', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates and adds suffix', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('handles null', () => {
    expect(truncate(null, 10)).toBe('');
  });

  it('uses custom suffix', () => {
    expect(truncate('hello world', 8, '…')).toBe('hello w…');
  });
});

describe('clamp', () => {
  it('returns value within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles equal min and max', () => {
    expect(clamp(5, 5, 5)).toBe(5);
  });
});

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(100)).toBe('100.0 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1073741824)).toBe('1.0 GB');
  });
});

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2:05');
  });

  it('formats hours, minutes, seconds', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('handles null/undefined', () => {
    expect(formatDuration(null)).toBe('0:00');
    expect(formatDuration(undefined)).toBe('0:00');
  });
});

describe('formatDate', () => {
  it('formats valid date', () => {
    expect(formatDate('2024-01-15')).toBe('2024-01-15');
  });

  it('handles empty string', () => {
    expect(formatDate('')).toBe('');
  });

  it('handles null', () => {
    expect(formatDate(null)).toBe('');
  });

  it('handles invalid date', () => {
    expect(formatDate('not-a-date')).toBe('');
  });
});

describe('formatDateTime', () => {
  it('formats valid datetime', () => {
    const result = formatDateTime('2024-01-15T12:30:00Z');
    expect(result).toContain('2024-01-15');
  });

  it('handles empty string', () => {
    expect(formatDateTime('')).toBe('');
  });

  it('handles null', () => {
    expect(formatDateTime(null)).toBe('');
  });
});

describe('getAnimeSeason', () => {
  it('returns spring for April', () => {
    expect(getAnimeSeason('2024-04-15')).toBe('spring');
  });

  it('returns spring for June', () => {
    expect(getAnimeSeason('2024-06-30')).toBe('spring');
  });

  it('returns summer for July', () => {
    expect(getAnimeSeason('2024-07-01')).toBe('summer');
  });

  it('returns summer for September', () => {
    expect(getAnimeSeason('2024-09-30')).toBe('summer');
  });

  it('returns autumn for October', () => {
    expect(getAnimeSeason('2024-10-01')).toBe('autumn');
  });

  it('returns autumn for December', () => {
    expect(getAnimeSeason('2024-12-31')).toBe('autumn');
  });

  it('returns winter for January', () => {
    expect(getAnimeSeason('2024-01-15')).toBe('winter');
  });

  it('returns winter for March', () => {
    expect(getAnimeSeason('2024-03-31')).toBe('winter');
  });

  it('handles YYYY/MM/DD format', () => {
    expect(getAnimeSeason('2024/07/15')).toBe('summer');
  });

  it('returns null for empty string', () => {
    expect(getAnimeSeason('')).toBe(null);
  });

  it('returns null for null', () => {
    expect(getAnimeSeason(null)).toBe(null);
  });

  it('returns null for undefined', () => {
    expect(getAnimeSeason(undefined)).toBe(null);
  });

  it('returns null for invalid format', () => {
    expect(getAnimeSeason('not-a-date')).toBe(null);
  });
});
