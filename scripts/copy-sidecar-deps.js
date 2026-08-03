/**
 * Copy native module dependencies alongside the pkg-built sidecar exe.
 * 
 * pkg cannot bundle native .node modules (better-sqlite3, ffmpeg, etc.).
 * This script copies them from node_modules to alongside the exe so they
 * can be loaded at runtime via NODE_PATH.
 * 
 * Usage: node scripts/copy-sidecar-deps.js
 * Called automatically after npm run build:server.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SIDECAR_DIR = path.join(ROOT, 'src-tauri');
const MODULES_TARGET = path.join(SIDECAR_DIR, 'sidecar-modules');

/** Recursively copy a directory */
function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules/.bin and symlinks
      if (entry.name === '.bin') continue;
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ---- better-sqlite3（原生 SQL 驱动，直接 DB 访问）----
// better-sqlite3 是原生 .node 模块，pkg 无法静态打包，需旁置 + NODE_PATH。
const serverModules = path.join(ROOT, 'server', 'node_modules');
const betterSqlite3Src = path.join(serverModules, 'better-sqlite3');
const betterSqlite3Dest = path.join(MODULES_TARGET, 'better-sqlite3');
if (fs.existsSync(betterSqlite3Src)) {
  copyRecursive(betterSqlite3Src, betterSqlite3Dest);
  console.log('  [COPY] better-sqlite3 (native .node)');
} else {
  console.log('  [SKIP] better-sqlite3 not found');
}

// better-sqlite3 的运行时依赖必须复制到 sidecar-modules 顶层（NODE_PATH 解析）。
// bindings → file-uri-to-path；prebuild-install 仅安装期用，运行时不需要。
for (const dep of ['bindings', 'file-uri-to-path']) {
  const depSrc = path.join(serverModules, dep);
  const depDest = path.join(MODULES_TARGET, dep);
  if (fs.existsSync(depSrc)) {
    copyRecursive(depSrc, depDest);
    console.log(`  [COPY] ${dep} (better-sqlite3 runtime dep)`);
  } else {
    console.log(`  [SKIP] ${dep} not found`);
  }
}

// ---- ffmpeg-static binary — 优先用预压缩版本（scripts/ffmpeg-upx.exe）----
const ffmpegStaticSrc = path.join(serverModules, 'ffmpeg-static', 'ffmpeg.exe');
const ffmpegUpxSrc = path.join(ROOT, 'scripts', 'ffmpeg-upx.exe');
const ffmpegDest = path.join(MODULES_TARGET, 'ffmpeg.exe');
let ffmpegSrc = null;
if (fs.existsSync(ffmpegUpxSrc)) {
  ffmpegSrc = ffmpegUpxSrc;
  console.log(`  [COPY] ffmpeg-upx.exe (pre-compressed)`);
} else if (fs.existsSync(ffmpegStaticSrc)) {
  ffmpegSrc = ffmpegStaticSrc;
  console.log(`  [COPY] ffmpeg.exe (uncompressed — run scripts/upx --best once to create ffmpeg-upx.exe)`);
}
if (ffmpegSrc) {
  fs.copyFileSync(ffmpegSrc, ffmpegDest);
  console.log(`  [COPY] → sidecar-modules/ffmpeg.exe (${(fs.statSync(ffmpegDest).size / 1024 / 1024).toFixed(1)} MB)`);
} else {
  console.log('  [SKIP] ffmpeg binary not found');
}

console.log('[DONE] Sidecar dependencies copied to src-tauri/sidecar-modules/');
