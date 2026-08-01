#!/usr/bin/env node
/**
 * CSS Token Compliance Checker
 *
 * Scans views/*.css, layouts/*.css, and components/*.css for hardcoded values
 * that should use design tokens from tokens.css instead.
 *
 * Usage: node scripts/check-css-tokens.js
 *        node scripts/check-css-tokens.js --quiet   # only summary
 *        node scripts/check-css-tokens.js --strict  # exit 1 on violations
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(__dirname, '..');

const args = process.argv.slice(2);
const QUIET = args.includes('--quiet');
const STRICT = args.includes('--strict');

const SCAN_DIRS = ['src/css/views', 'src/css/layouts', 'src/css/components'];

// ─── Helpers ───

/** Strip CRLF and trim a line */
function clean(line) {
  return line.replace(/\r$/, '').trim();
}

/** Extract the value portion after the first colon, trimmed */
function valueOf(line) {
  const idx = line.indexOf(':');
  if (idx === -1) return '';
  return clean(line.slice(idx + 1)).replace(/;$/, '');
}

/** Check if a value string contains any raw px/rem that should be a token */
function hasRawSpacing(val) {
  return /\b\d+px\b/.test(val) || /\b\d+\.?\d*rem\b/.test(val);
}

/** Check if a value string contains raw hex or rgba */
function hasRawColor(val) {
  if (/#[0-9a-fA-F]{3,8}\b/.test(val)) return true;
  if (/rgba?\s*\(/.test(val)) return true;
  return false;
}

/** Check if a value string contains raw font-size (px/rem without token) */
function hasRawFontSize(val) {
  return /(\d+\.?\d*)(px|rem)\b/.test(val);
}

/** Check if a value string contains raw font-weight number */
function hasRawFontWeight(val) {
  return /^\d{3}$/.test(val);
}

/** Check if a value string contains raw border-radius px */
function hasRawRadius(val) {
  return /\b\d+px\b/.test(val);
}

// ─── Rules ───

const ALLOWED_RAW = /^(0|auto|transparent|none|inherit|initial|unset|100%|100vh|100vw)(\s|$)/;
const GRADIENT = /(linear|radial|conic|repeating-linear)-gradient\(/;
const HAS_VAR = /\bvar\(--/;

// Config-type custom properties set at call sites (not design tokens).
// They are consumed with a fallback (var(--x, default)) and defined
// per-instance via CSS or data-* attributes — exempt from GHOST-TOKEN.
const CONFIG_VARS = new Set(['cols', 'gap']);

/** Collect all --token references in a line */
const VAR_REF = /var\(--([a-zA-Z0-9_-]+)/g;

const rules = [
  {
    label: 'SPACING',
    severity: 'error',
    match: line => /^\s*(padding|gap|margin)\s*:/.test(line),
    check: line => {
      const val = valueOf(line);
      if (!val) return false;
      // Allow margin:0, padding:0 etc
      if (ALLOWED_RAW.test(val)) return false;
      // Already using a token
      if (HAS_VAR.test(line)) return false;
      // Has raw px → violation
      return hasRawSpacing(val);
    },
    msg: line => `  Use var(--space-*) instead of raw px: ${clean(line).slice(0, 120)}`,
  },
  {
    label: 'RADIUS',
    severity: 'error',
    match: line => /^\s*border-radius\s*:/.test(line),
    check: line => {
      const val = valueOf(line);
      if (!val) return false;
      if (/^(50%|9999px|100px)$/.test(val)) return false;
      if (HAS_VAR.test(line)) return false;
      return hasRawRadius(val);
    },
    msg: line => `  Use var(--radius-*) instead of raw px: ${clean(line).slice(0, 120)}`,
  },
  {
    label: 'COLOR',
    severity: 'warn',
    match: line => /^\s*(color|background|background-color|border-color|outline-color)\s*:/.test(line),
    check: line => {
      const val = valueOf(line);
      if (!val) return false;
      // Skip gradients, images, none, transparent
      if (GRADIENT.test(line)) return false;
      if (/url\(/.test(line)) return false;
      if (ALLOWED_RAW.test(val)) return false;
      // Already using a token
      if (HAS_VAR.test(line)) return false;
      // Has raw hex or rgb(a) → violation
      return hasRawColor(val);
    },
    msg: line => `  Use var(--bg-*)/var(--fg-*)/var(--accent-*) for: ${clean(line).slice(0, 120)}`,
  },
  {
    label: 'FONT-SIZE',
    severity: 'warn',
    match: line => /^\s*font-size\s*:/.test(line),
    check: line => {
      const val = valueOf(line);
      if (!val) return false;
      if (HAS_VAR.test(line)) return false;
      return hasRawFontSize(val);
    },
    msg: line => `  Use var(--text-*) instead of raw font-size: ${clean(line).slice(0, 120)}`,
  },
  {
    label: 'FONT-WEIGHT',
    severity: 'warn',
    match: line => /^\s*font-weight\s*:/.test(line),
    check: line => {
      const val = valueOf(line);
      if (!val) return false;
      if (HAS_VAR.test(line)) return false;
      if (/bold|normal|bolder|lighter|inherit|initial/.test(val)) return false;
      return hasRawFontWeight(val);
    },
    msg: line => `  Use var(--fw-*) instead of raw number: ${clean(line).slice(0, 120)}`,
  },
  {
    label: 'BOX-SHADOW',
    severity: 'warn',
    match: line => /^\s*box-shadow\s*:/.test(line),
    check: line => {
      const val = valueOf(line);
      if (!val) return false;
      if (val === 'none') return false;
      if (HAS_VAR.test(line)) return false;
      // Has raw shadow values (not using --shadow-* token)
      return /\d+px\b/.test(val) && !/var\(--shadow/.test(line);
    },
    msg: line => `  Use var(--shadow-*) instead of raw box-shadow: ${clean(line).slice(0, 120)}`,
  },
  {
    label: 'BORDER-SHORTHAND',
    severity: 'warn',
    match: line => /^\s*border\s*:/.test(line) && !/border-radius|border-color|border-width|border-style/.test(line),
    check: line => {
      const val = valueOf(line);
      if (!val) return false;
      if (HAS_VAR.test(line)) return false;
      // Has raw color in border shorthand (e.g. border: 1px solid #fff)
      return hasRawColor(val);
    },
    msg: line => `  Use var(--border) or var(--border-color) for: ${clean(line).slice(0, 120)}`,
  },
  {
    label: 'GHOST-TOKEN',
    severity: 'error',
    match: line => HAS_VAR.test(line),
    check: line => {
      // Find all --xxx references in this line
      const refs = [];
      let m;
      const re = /var\(--([a-zA-Z0-9_-]+)/g;
      while ((m = re.exec(line)) !== null) refs.push(m[1]);
      // Check each reference against known tokens (read from tokens.css)
      // Config vars (--cols, --gap) are exempt — set at call sites, not tokens
      return refs.some(name => !knownTokens.has(name) && !CONFIG_VARS.has(name));
    },
    msg: line => {
      const refs = [];
      let m;
      const re = /var\(--([a-zA-Z0-9_-]+)/g;
      while ((m = re.exec(line)) !== null) refs.push(m[1]);
      const unknown = refs.filter(n => !knownTokens.has(n) && !CONFIG_VARS.has(n));
      return `  Unknown token${unknown.length > 1 ? 's' : ''}: ${unknown.map(n => `--${n}`).join(', ')} in: ${clean(line).slice(0, 100)}`;
    },
  },
];

// ─── Token Registry ───

let knownTokens = new Set();

function buildTokenRegistry() {
  const tokensFile = resolve(FRONTEND, 'src/css/tokens.css');
  const content = readFileSync(tokensFile, 'utf-8');
  const re = /--([a-zA-Z0-9_-]+)\s*:/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    knownTokens.add(m[1]);
  }
}

// ─── Scan ───

let totalViolations = 0;
let totalWarnings = 0;
let totalGhostTokens = 0;

// Build registry first
buildTokenRegistry();

for (const dir of SCAN_DIRS) {
  const absDir = resolve(FRONTEND, dir);
  if (!statSync(absDir, { throwIfNoEntry: false })) continue;

  const files = readdirSync(absDir).filter(f => f.endsWith('.css'));

  for (const file of files) {
    const filePath = resolve(absDir, file);
    const content = readFileSync(filePath, 'utf-8');
    // Split by any line ending (handles CRLF)
    const lines = content.split(/\r?\n/);
    let fileViolations = 0;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = clean(raw);

      // Skip empty lines
      if (!trimmed) continue;

      // Skip comments and at-rules (but NOT class/ID selectors)
      if (/^\s*(\/\/|\/\*|\*)/.test(trimmed)) continue;
      if (/^\s*@/.test(trimmed)) continue;

      for (const rule of rules) {
        if (rule.match(trimmed) && rule.check(trimmed)) {
          const isError = rule.severity === 'error';
          if (isError) totalViolations++;
          else totalWarnings++;

          fileViolations++;
          if (!QUIET) {
            const prefix = isError ? '✖' : '⚠';
            console.log(`  ${prefix} ${dir}/${file}:${i + 1}`);
            console.log(rule.msg(trimmed));
          }
        }
      }
    }

    if (fileViolations > 0 && !QUIET) {
      console.log();
    }
  }
}

// ─── Report ───

const total = totalViolations + totalWarnings;
if (total === 0) {
  const scanned = SCAN_DIRS.flatMap(d => {
    const absDir = resolve(FRONTEND, d);
    if (!statSync(absDir, { throwIfNoEntry: false })) return [];
    return readdirSync(absDir).filter(f => f.endsWith('.css'));
  });
  console.log(`✅ CSS token check passed (${scanned.length} files scanned)`);
} else {
  console.log(`📊 Summary: ${totalViolations} errors, ${totalWarnings} warnings`);
  if (!QUIET) {
    console.log('   Run with --quiet for summary only');
  }
  if (STRICT && totalViolations > 0) {
    process.exit(1);
  }
}
