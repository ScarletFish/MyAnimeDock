// @ts-nocheck
// server/lib/paths.js — 路径单点计算（migration-esm-ts.md R3 缓解）
// 从 __dirname 向上查找含 name=anime-manager-server 的 package.json 目录 = SERVER_ROOT。
// 源布局（server/lib/）与 dist 布局（server/dist/lib/）都成立：dist 目录无 package.json，
// 会继续向上找到 server/。
const path = require('path');
const fs = require('fs');

function findServerRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'anime-manager-server') return dir;
      } catch (_) {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir); // 兜底
}

const SERVER_ROOT = findServerRoot(__dirname);      // server/
const PROJECT_ROOT = path.dirname(SERVER_ROOT);      // 项目根（MyAnimeDocker）

module.exports = { SERVER_ROOT, PROJECT_ROOT };
