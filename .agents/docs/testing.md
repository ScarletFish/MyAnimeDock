# MyAnimeDock — 测试指南

> 测试流程标准、模式惯例、已知行为和陷阱记录。

## Test Runner

使用 **Node.js 内置 test runner**（`node:test`，Node 20+）：

```js
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
```

无需 Jest/Mocha/Chai 依赖。

## 运行测试

```bash
cd server && npm test            # 全量测试（当前 198 tests: 25 DB + 65 scanner + 66 scrapers + 42 playback）
cd server && npx node --test --test-name-pattern="parseFolderName" __tests__/scanner.test.js  # 筛选单个 describe
cd server && npx node --test --test-name-pattern="NCOP" __tests__/scanner.test.js              # 筛选单个 it
cd server && node --test __tests__/scrapers.test.js                                           # 仅匹配逻辑测试（改匹配时用）
```

## 测试分类

### 1. 纯函数测试（无 IO）

**适用场景**：`parseFolderName`, `isExtraVideo`, `extractBgmId` 等无副作用函数。

**模式**：
- 每个 describe 内按函数分组
- 测试名直接描述行为：`it('parses CJK title')`
- 边界值必测：null, 空字符串, 特殊字符
- **已知行为直接记录而非遮掩**——如果函数对 null 抛异常，测试 `assert.throws()` 并加注释说明

**示例模式**：
```js
describe('parseFolderName', () => {
  it('returns object with expected keys', () => {
    const r = parseFolderName('TestTitle');
    const keys = ['title', 'cjkTitle', 'cleanTitle', 'season', 'year', 'bangumiId', 'specialSuffix'];
    for (const k of keys) {
      assert.ok(k in r, `missing key: ${k}`);
    }
  });
  it('handles null input', () => {
    assert.throws(() => parseFolderName(null), /Cannot read properties of null/);
  });
});
```

### 2. 文件系统集成测试（有 IO）

**适用场景**：`findVideos`, `hasDirectVideos`, `scanMediaDirFlat` 等操作文件系统的函数。

**模式**：
- 使用 `os.tmpdir()` 创建临时目录，`beforeEach` 中 `fs.mkdtempSync` 确保隔离
- `after` 中 `fs.rmSync(tmpRoot, { recursive: true, force: true })` 清理
- **每个测试独立目录**，互不干扰
- 辅助函数如 `touchVideo(dir, name)` 创建空视频文件

```js
const tmpRoot = path.join(os.tmpdir(), 'mad-scanner-int');

before(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(tmpRoot, { recursive: true });
});

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(tmpRoot, 'test-'));
});

after(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});
```

**私有的模块函数**（如 `buildLeaf`, `hasLatinLetters`）**不直接测试**，通过其公共调用者（如 `scanMediaDirFlat`）间接覆盖。

### 3. 数据库集成测试（SQLite）

**适用场景**：`db.js` 的数据持久化操作。

**模式**：
- 使用 `__tests__/fixtures/db/__test-source.db` 作为测试 DB
- 每个独立的 `describe` 块内创建/清理数据
- **关键路径必须测"修改 → loadData() 重载 → 验证"**（仅测内存状态不够）
- lifecycle test（如 `Import → Play → Archive`）按顺序子测试编号，模拟完整用户流程

**已建立的全生命周期测试**：
```
Step 1: Import anime with 5 episodes
Step 2: Play episode 1 (first episode, no auto-mark)
Step 3: Play episode 3 → auto-mark ep01-02 as watched
Step 4: Complete all episodes → status change to completed
Step 5: Completed items appear in myList with rating and thoughts
Step 6: Delete anime → remove from library and myList
```

## 已知行为记录

这些是当前代码的实际行为，测试明确记载而非修改：

| 行为 | 文件 | 说明 |
|------|------|------|
| `parseFolderName(null)` throws | `scanner.test.js:108` | 生产不会传 null，不修复 |
| `parseFolderName('')` throws | `scanner.test.js:114` | anitomy 空输入崩溃 |
| `isExtraVideo('NCOP1')` 返回 false | `scanner.test.js:148` | 正则 `\bNCOP\b` 在 `NCOP1` 无 word boundary |
| `isExtraVideo('NCED2')` 返回 false | `scanner.test.js:152` | 同上 |
| `parseFolderName('Title ～特典～')` 可能返回 `specialSuffix: null` | `scanner.test.js:86` | anitomy 可能剥离全角波浪线 |

## 测试编写指南

### 文件位置

```
server/__tests__/
├── db.test.js            # 数据库集成测试（25 tests）
├── scanner.test.js       # Scanner 纯函数 + 文件系统集成（65 tests）
├── scrapers.test.js      # 元数据匹配逻辑（66 tests）— 改匹配时只跑这个
└── playback-encoding.test.js  # 播放路径编码验证（42 tests）
```

### 覆盖率目标

| 模块类型 | 必须覆盖 |
|----------|----------|
| 纯函数 | 正常输入、边界值（null/空/特殊字符）、至少 1 个极端案例 |
| 文件系统函数 | 正常目录、空目录、不存在目录、子目录递归、特殊文件过滤 |
| DB 操作 | CRUD 每种至少 1 个、loadData 重载验证、异常回滚 |
| API 路由 | 200 响应体结构、400 参数错误、404、边界参数（可选） |
| 全生命周期 | 至少 1 个完整场景贯穿多个操作 |

### 命名惯例

- 文件名：`{module}.test.js`
- describe：`模块名 — 分类`（如 `Scanner — Pure Functions`, `Scanner — Filesystem Integration`）
- it：行为描述，英文（小写开头，无句号）

### assert 风格

```js
// 推荐
assert.equal(actual, expected);
assert.ok(condition);
assert.deepEqual(actual, expected);
assert.throws(() => fn(bad), /error pattern/);

// 避免
assert.strictEqual (除非需要 === 语义)
```

### 禁止事项

- ❌ 依赖外部网络（API 调用、爬虫）
- ❌ 依赖真实媒体文件（使用空文件模拟）
- ❌ 测试间共享可变状态（每个 `it` 应可独立运行）
- ❌ 修改实际配置或数据库文件（使用 fixtures 副本）
- ❌ 在测试中 `require()` 生产模块时连带触发副作用（如自动扫描）

## 关联验证层级

参考 AGENTS.md Development Workflow — 四层验证：

| 层级 | 内容 | 耗时 |
|------|------|------|
| Tier 0 | Rust 类型检查 (`npm run check:rust`) | ~20s |
| Tier 1 | JS 改动 nodemon 自动重启 | 秒级 |
| Tier 2 | Rust 改动 + Tauri 调试 | ~1min |
| Tier 3 | 最终打包 | ~5min |

单元/集成测试在 **Tier 1** 层执行，修改 server/ 代码后通过 `cd server && npm test` 验证。