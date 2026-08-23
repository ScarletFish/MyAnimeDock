# Download Dock — 下载器聚合层

> qBittorrent 集成的设计决策、API 契约、踩坑记录。

## 架构定位

**Dock = 聚合层，不替代 qB WebUI。** 复杂操作（RSS 规则、批量管理、重命名）留给 qB 自己做。MyAnimeDock 只做：
- 状态一览（进度、速度、文件列表）
- 一键推送（magnet / torrent URL）
- 基础控制（暂停/恢复/删除/限速）

### 为什么自封装 client

已有 npm 包（`qbittorrent-api-v2`、`@ctrl/qbittorrent`）质量差或停更。qB WebAPI 本身很简单——HTTP + form-urlencoded，约 200 行足够。自封装好处：
- 零依赖
- 完全控制 cookie/CSRF 处理
- 不被第三方包的 bug 或 breaking change 卡住

## qB WebAPI 机制

### 登录流程

```
POST /api/v2/auth/login
Content-Type: application/x-www-form-urlencoded
Referer: http://localhost:<port>

username=admin&password=xxx
```

响应：
- `200` + `Set-Cookie: QBT_SID_<port>=xxx` → 成功
- `200` 但无 SID cookie → 密码错误（qB 不区分"用户不存在"和"密码错"）
- `403` → IP 被封禁（多次登录失败），需重启 qB 解除

### Cookie 名自适应

qBittorrent 4.6+ 使用 `QBT_SID_<端口>` 作为 cookie 名（如 `QBT_SID_8080`），老版本用 `SID`。客户端自动匹配：

```ts
const m = c.match(/^(QBT_SID_\d+|SID)=([^;]+)/);
```

后续请求一律带 `Cookie: <cookieName>=<sid>`。

### Referer CSRF 保护

qB 所有 API 请求（包括登录）必须带 `Referer` 头，值为 qB WebUI 的完整 URL（`http://localhost:<port>`）。缺失则返回 403。

### 自动重登

`qbRequest()` 检测 403 响应 → 自动调用 `qbLogin()` → 用新 SID 重试一次。缓存变量：
- `cachedSid` — 当前 SID 值
- `cachedCookieName` — cookie 名（`SID` 或 `QBT_SID_<port>`）
- `cachedPort` — 端口，变化时强制重新登录

### 常见错误排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 登录 403 | IP 被封禁 | 重启 qBittorrent |
| 登录 200 但无 SID | 密码错误 | 检查密码 |
| API 调用 403 | SID 过期 | 客户端自动重登，无需处理 |
| API 调用 403 重登后仍失败 | Referer 缺失 | 确认代码带了 Referer 头 |

## API 路由

所有路由在 `server/routes/qb.ts`，通过 `server.ts` 注册。

| 方法 | 路径 | 功能 | 请求体/参数 | 响应 |
|------|------|------|------------|------|
| POST | `/api/qb/test` | 测试连接 | `{ port, username, password }` | `{ ok, version }` 或 `{ ok:false, error }` |
| GET | `/api/qb/torrents` | 获取种子列表 | — | qB `/api/v2/torrents/info` 原始响应 |
| GET | `/api/qb/files?hash=xxx` | 获取种子文件列表 | `hash` query 参数 | qB `/api/v2/torrents/files` 原始响应 |
| POST | `/api/qb/add` | 添加种子 | `{ urls, savepath? }` | `{ ok: true }` |
| POST | `/api/qb/action` | 操作种子 | `{ action, hashes?, deleteFiles?, limit? }` | `{ ok: true }` |

### action 枚举

| action | 说明 | 必需参数 |
|--------|------|---------|
| `pause` | 暂停种子 | `hashes`（默认 `all`） |
| `resume` | 恢复种子 | `hashes`（默认 `all`） |
| `delete` | 删除种子 | `hashes`、`deleteFiles` |
| `pauseAll` | 暂停全部 | — |
| `resumeAll` | 恢复全部 | — |
| `setDownloadLimit` | 设置下载限速 | `limit`（bytes/s，0=无限） |

### 测试连接的特殊设计

`/api/qb/test` 支持 POST 传入当前表单值，不依赖服务器已保存的 config。原因：用户改了端口/密码后直接点测试，如果读 saved config 会用旧值。

其他路由通过 `getCreds(state)` 从 `state.config` 读取已保存的配置。

## 前端设置页

### 结构

```
Tab: 下载器
├── qBittorrent（标题，form-group 外层）
│   └── div.qb-config
│       ├── form-group: 端口（inline label + input）
│       ├── form-group: 用户名
│       ├── form-group: 密码（带 toggle 按钮）
│       └── form-group: 测试连接（按钮 + 状态文本）
```

### CSS 模式

- `.qb-config` — 内部 form-group 使用 flex 行布局（label 左，input 右）
- `.qb-config .form-group > label` — `min-width: 4em` 统一对齐
- `.password-input-wrapper` — 相对定位容器，toggle 按钮绝对定位在右侧
- `.qb-test-btn` — 圆形按钮，spinning 动画表示 loading

### 测试按钮行为

1. 用户输入端口/用户名/密码（绑定到 reactive 变量 `qbPort`/`qbUsername`/`qbPassword`）
2. 点击测试 → `api.post('/api/qb/test', { port, username, password })`
3. 服务器直接用请求体中的值登录 qB，不读 saved config
4. 结果显示在按钮旁边：✓ 已连接 v5.x.x 或 ✗ 错误信息

## 文件清单

| 文件 | 职责 |
|------|------|
| `server/lib/qb-client.ts` | qB WebAPI 客户端（登录/请求/所有操作） |
| `server/routes/qb.ts` | 5 个 API 代理路由 |
| `server/lib/config.ts` | `ConfigShape` 中的 `qbPort`/`qbUsername`/`qbPassword` |
| `server/routes/config.ts` | POST /api/config 保存 qB 配置 |
| `frontend/src/views/Settings.svelte` | 下载器 tab（`activeTab === 'downloader'`） |
| `frontend/src/css/components/forms.css` | `.qb-config`、`.password-*`、`.qb-test-*` 样式 |
