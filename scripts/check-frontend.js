#!/usr/bin/env node
/**
 * Frontend one-shot check: JS syntax + CSS token compliance + build.
 *
 * 串起改前端后必须做的三件事（漏任一都会出诡异问题）：
 *   1. node --check 全部 frontend/src/lib/*.js   —— 语法检查（Vite concat 跳过校验）
 *   2. npm run check:css -- --strict            —— CSS token 合规（违规即失败）
 *   3. npm run build:frontend                   —— 重建 dist/（生产模式从 dist/ 读）
 *
 * 前两步失败则退出，不执行构建（避免把坏源码写进 dist/）。
 *
 * Usage: npm run check:frontend   (repo root)
 */
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');

const ROOT = resolve(__dirname, '..');
const JS_DIR = join(ROOT, 'frontend', 'src', 'lib');
const FRONTEND_DIR = join(ROOT, 'frontend');
const isWin = process.platform === 'win32';

function run(cmd, args, cwd, useShell) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf-8', shell: useShell });
}

let failed = false;

// ─── 1. JS 语法检查 ───
// node --check 直接走二进制（shell:false），避免含空格的路径被 shell 拆开
const jsFiles = readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
for (const f of jsFiles) {
  const r = run(process.execPath, ['--check', join(JS_DIR, f)], ROOT, false);
  if (r.status !== 0) {
    failed = true;
    console.error(`✖ Syntax error: ${f}`);
    if (r.stderr) console.error(r.stderr.trim());
  }
}
if (!failed) console.log(`✅ node --check passed (${jsFiles.length} files)`);
if (failed) {
  console.error('\n✖ check:frontend failed at JS syntax check — 不执行后续步骤');
  process.exit(1);
}

// ─── 2. CSS token 合规（--strict：有违规即失败） ───
const css = run('npm', ['run', 'check:css', '--', '--strict'], FRONTEND_DIR, isWin);
process.stdout.write(css.stdout || '');
process.stderr.write(css.stderr || '');
if (css.status !== 0) {
  failed = true;
  console.error('\n✖ check:frontend failed at CSS token check — 不执行构建');
  process.exit(1);
}

// ─── 3. 重建 dist/ ───
const build = run('npm', ['run', 'build:frontend'], ROOT, isWin);
process.stdout.write(build.stdout || '');
process.stderr.write(build.stderr || '');
if (build.status !== 0) {
  console.error('\n✖ check:frontend failed at build:frontend');
  process.exit(1);
}

console.log('\n✅ check:frontend passed (JS syntax + CSS tokens + dist rebuilt)');
