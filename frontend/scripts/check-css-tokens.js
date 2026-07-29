#!/usr/bin/env node
/**
 * CSS Token Compliance Checker
 *
 * Scans views/*.css and layouts/*.css for hardcoded values
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

const SCAN_DIRS = ['src/css/views', 'src/css/layouts'];

// ─── Rules ───
// Each rule: { match, check, label }
// match: function(line) → true if this rule applies
// check: function(line) → true if VIOLATION (hardcoded when should be token)

const ALLOWED_RAW = /^(0|auto|transparent|none|inherit|initial|unset|100%|100vh|100vw)(\s|;|$)/;
const GRADIENT = /(linear|radial|conic|repeating-linear)-gradient\(/;
const HAS_VAR = /\bvar\(--/;
const HAS_TOKEN = /\bvar\(--/;
const SKIP_LINE = /^\s*(@|\/\/|\/\*|\.|\#|\:root|body|html|\})/;

const rules = [
  {
    label: 'SPACING',
    severity: 'error',
    match: line => /^\s*(padding|gap|margin)\s*:/.test(line),
    check: line => {
      // Allow margin:0, padding:0 etc
      if (ALLOWED_RAW.test(line.replace(/.*:\s*/, ''))) return false;
      // Already using a token
      if (HAS_TOKEN.test(line)) return false;
      // Has raw px → violation
      return /\b\d+px\b/.test(line);
    },
    msg: line => `  Use var(--space-*) instead of raw px: ${line.trim()}`,
  },
  {
    label: 'RADIUS',
    severity: 'error',
    match: line => /^\s*border-radius\s*:/.test(line),
    check: line => {
      const val = line.replace(/.*:\s*/, '').replace(/;.*$/, '').trim();
      if (/^(50%|9999px|100px)$/.test(val)) return false;
      if (HAS_TOKEN.test(line)) return false;
      return /\b\d+px\b/.test(line);
    },
    msg: line => `  Use var(--radius-*) instead of raw px: ${line.trim()}`,
  },
  {
    label: 'COLOR',
    severity: 'warn',
    match: line => /^\s*(color|background|background-color|border-color|outline-color)\s*:/.test(line),
    check: line => {
      // Skip gradients, images, none, transparent
      if (GRADIENT.test(line)) return false;
      if (/url\(/.test(line)) return false;
      if (ALLOWED_RAW.test(line.replace(/.*:\s*/, ''))) return false;
      if (HAS_TOKEN.test(line)) return false;
      // Has raw hex or rgb(a) → violation
      return /#[0-9a-fA-F]{3,8}\b/.test(line) || /rgba?\s*\(/.test(line);
    },
    msg: line => `  Use var(--bg-*)/var(--fg-*)/var(--accent-*) for: ${line.trim()}`,
  },
  {
    label: 'FONT-SIZE',
    severity: 'warn',
    match: line => /^\s*font-size\s*:/.test(line),
    check: line => {
      if (HAS_TOKEN.test(line)) return false;
      return /(\d+\.?\d*)(px|rem)/.test(line);
    },
    msg: line => `  Use var(--text-*) instead of raw font-size: ${line.trim()}`,
  },
  {
    label: 'FONT-WEIGHT',
    severity: 'warn',
    match: line => /^\s*font-weight\s*:/.test(line),
    check: line => {
      if (HAS_TOKEN.test(line)) return false;
      if (/bold|normal|bolder|lighter|inherit|initial/.test(line.replace(/.*:\s*/, ''))) return false;
      return /^\d{3}$/.test(line.replace(/.*:\s*/, '').replace(/;.*$/, '').trim());
    },
    msg: line => `  Use var(--fw-*) instead of raw number: ${line.trim()}`,
  },
];

// ─── Scan ───

let totalViolations = 0;
let totalWarnings = 0;

for (const dir of SCAN_DIRS) {
  const absDir = resolve(FRONTEND, dir);
  if (!statSync(absDir, { throwIfNoEntry: false })) continue;

  const files = readdirSync(absDir).filter(f => f.endsWith('.css'));

  for (const file of files) {
    const filePath = resolve(absDir, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    let fileViolations = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim() || SKIP_LINE.test(line)) continue;

      for (const rule of rules) {
        if (rule.match(line) && rule.check(line)) {
          const isError = rule.severity === 'error';
          if (isError) totalViolations++;
          else totalWarnings++;

          fileViolations++;
          if (!QUIET) {
            const prefix = isError ? '✖' : '⚠';
            console.log(`  ${prefix} ${dir}/${file}:${i + 1}`);
            console.log(rule.msg(line));
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
  console.log(`✅ CSS token check passed (${['views', 'layouts'].flatMap(d =>
    readdirSync(resolve(FRONTEND, d), { withFileTypes: true })
      .filter(f => f.isFile() && f.name.endsWith('.css'))
  ).length} files scanned)`);
} else {
  console.log(`📊 Summary: ${totalViolations} errors, ${totalWarnings} warnings`);
  if (!QUIET) {
    console.log('   Run with --quiet for summary only');
  }
  if (STRICT && totalViolations > 0) {
    process.exit(1);
  }
}
