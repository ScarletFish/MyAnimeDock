/**
 * Copy native module dependencies alongside the pkg-built sidecar exe.
 * 
 * pkg cannot bundle native .node modules (Prisma query engine, ffmpeg, etc.).
 * This script copies them from node_modules to alongside the exe so they
 * can be loaded at runtime via PRISMA_QUERY_ENGINE_LIBRARY and NODE_PATH.
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

// ---- Prisma query engine (root node_modules/.prisma/client) ----
// NOTE: 目标目录使用 prisma-engine 而非 .prisma/client，
//       因为 Rust 的 glob crate 默认不匹配以 . 开头的路径，
//       而 Tauri 的 bundle.resources 使用 glob 验证资源。
const prismaClientSrc = path.join(ROOT, 'node_modules', '.prisma', 'client');
const prismaClientDest = path.join(MODULES_TARGET, 'prisma-engine');
if (fs.existsSync(prismaClientSrc)) {
  if (!fs.existsSync(prismaClientDest)) {
    fs.mkdirSync(prismaClientDest, { recursive: true });
  }
  // Only copy the engine + schema (skip deno/, wasm/ etc.)
  for (const file of ['query_engine-windows.dll.node', 'schema.prisma']) {
    const srcFile = path.join(prismaClientSrc, file);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, path.join(prismaClientDest, file));
      console.log(`  [COPY] prisma-engine/${file}`);
    }
  }
} else {
  console.log('  [SKIP] .prisma/client not found');
}

// ---- @prisma/client (JS code needed at runtime for generator) ----
const prismaJsSrc = path.join(ROOT, 'node_modules', '@prisma');
const prismaJsDest = path.join(MODULES_TARGET, '@prisma');
if (fs.existsSync(prismaJsSrc)) {
  // Copy only @prisma/client (the runtime part)
  const clientSrc = path.join(prismaJsSrc, 'client');
  const clientDest = path.join(prismaJsDest, 'client');
  if (fs.existsSync(clientSrc)) {
    copyRecursive(clientSrc, clientDest);
    console.log('  [COPY] @prisma/client');
  }
  // Also copy runtime dependencies used by @prisma/client
  for (const pkg of ['debug', 'engines-version', 'get-platform']) {
    const pkgSrc = path.join(prismaJsSrc, pkg);
    const pkgDest = path.join(prismaJsDest, pkg);
    if (fs.existsSync(pkgSrc)) {
      copyRecursive(pkgSrc, pkgDest);
      console.log(`  [COPY] @prisma/${pkg}`);
    }
  }
} else {
  console.log('  [SKIP] @prisma not found');
}

// ---- ffmpeg-static binary + UPX compression ----
const serverModules = path.join(ROOT, 'server', 'node_modules');
const ffmpegStaticSrc = path.join(serverModules, 'ffmpeg-static', 'ffmpeg.exe');
const ffmpegDest = path.join(MODULES_TARGET, 'ffmpeg.exe');
if (fs.existsSync(ffmpegStaticSrc)) {
  const srcSizeKB = (fs.statSync(ffmpegStaticSrc).size / 1024).toFixed(1);
  fs.copyFileSync(ffmpegStaticSrc, ffmpegDest);
  console.log(`  [COPY] ffmpeg.exe (${srcSizeKB} KB)`);

  // UPX 压缩 ffmpeg.exe（减小安装包体积）
  const upxPath = path.join(ROOT, 'scripts', 'upx.exe');
  if (fs.existsSync(upxPath)) {
    // 获取压缩前大小
    const beforeBytes = fs.statSync(ffmpegDest).size;
    console.log(`  [UPX]  Compressing ffmpeg.exe (${(beforeBytes / 1024).toFixed(1)} KB → ...)`);
    const { execSync } = require('child_process');
    try {
      execSync(`"${upxPath}" --lzma --best "${ffmpegDest}"`, { stdio: 'pipe', timeout: 120000 });
      const afterBytes = fs.statSync(ffmpegDest).size;
      const saved = ((beforeBytes - afterBytes) / 1024 / 1024).toFixed(1);
      console.log(`  [UPX]  Done: ${(afterBytes / 1024).toFixed(1)} KB (saved ${saved} MB, ${((1 - afterBytes/beforeBytes)*100).toFixed(0)}%)`);
    } catch (e) {
      console.warn(`  [UPX]  Compression failed: ${e.message}, keeping original`);
    }
  } else {
    console.log('  [SKIP] UPX not found at scripts/upx.exe, skipping compression');
  }
} else {
  console.log('  [SKIP] ffmpeg-static not found in server/node_modules');
}

// ---- Generate empty anime.db ----
const { execSync } = require('child_process');
const dbPath = path.join(SIDECAR_DIR, 'anime.db');
if (fs.existsSync(dbPath)) {
  console.log(`  [SKIP] anime.db already exists`);
} else {
  console.log('  [DB]  Generating empty anime.db...');
  const schemaPath = path.join(ROOT, 'prisma', 'schema.prisma');
  try {
    execSync(`npx prisma db push --schema="${schemaPath}" --accept-data-loss`, {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
      stdio: 'pipe',
    });
    console.log(`  [DB]  Created empty anime.db (${(fs.statSync(dbPath).size / 1024).toFixed(1)} KB)`);
  } catch (e) {
    console.error('  [DB]  Failed to create anime.db:', e.message);
    console.error('  [DB]  Make sure Prisma CLI is installed and schema exists at prisma/schema.prisma');
    process.exitCode = 1;
  }
}

console.log('[DONE] Sidecar dependencies copied to src-tauri/sidecar-modules/');
