# 蜜柑计划聚合下载功能计划

> 创建时间：2026-08-24
> 状态：计划阶段

## 一、需求概述

在MyAnimeDock中集成蜜柑计划（Mikan Project）的动漫资源聚合功能，让用户可以直接浏览一周新番、选择字幕组、一键下载到qBittorrent。

## 二、技术背景

### 蜜柑计划API情况

| 接口 | URL | 说明 |
|------|-----|------|
| 首页 | `/` | 按星期分组展示新番 |
| 季度筛选 | JavaScript参数 | `data-year="2026" data-season="夏"` |
| 搜索 | `/Home/Search?searchstr=关键词` | 返回HTML页面 |
| 详情页 | `/Home/Bangumi/{id}` | 包含字幕组和下载链接 |
| RSS订阅 | `/RSS/Bangumi?bangumiId={id}` | 标准RSS格式 |
| 备用域名 | `mikanime.tv` | 国内可用 |

**重要发现**：
- 蜜柑计划没有官方API，需要网页抓取
- 蜜柑计划的`bangumiId`与Bangumi API的ID**不是同一个**
- 首页HTML中每个番剧都有`data-bangumiid`属性和番剧名字

### 本地已实现

| 功能 | 状态 | 文件 |
|------|------|------|
| qBittorrent集成 | ✅ 完成 | `server/lib/qb-client.ts` |
| 下载页面 | ✅ 完成 | `frontend/src/views/Download.svelte` |
| HTTP工具 | ✅ 完成 | `server/lib/http-fetch.ts` |
| Scraper架构 | ✅ 完成 | `server/scrapers/index.ts` |
| Bangumi搜索 | ✅ 完成 | `searchBangumi()` / `matchSeason()` |

## 三、架构设计

### 核心思路

```
蜜柑计划 → 只提供番剧名字 + 下载链接
现有路径 → 用名字搜索匹配 → 获取元数据
qBittorrent → 处理下载
```

### 数据流

```
1. 蜜柑计划首页 → 解析番剧名字列表
2. 用名字调用 searchBangumi() / matchSeason() → 获取元数据
3. 用户选择字幕组 → 从蜜柑计划详情页获取下载链接
4. 调用 /api/qb/add → 添加到qBittorrent
```

## 四、功能模块

### 1. 新番列表模块

**后端API**：
- `GET /api/mikan/weekly` → 一周内更新的新番
- `GET /api/mikan/season?year=2026&season=夏` → 按季度筛选

**实现逻辑**：
1. 抓取蜜柑计划首页HTML
2. 解析`data-dayofweek`属性获取星期分组
3. 提取每个番剧的名字（从`<a>`标签的`title`属性或文本内容）
4. 返回番剧名字列表

**前端展示**：
- 按星期分组展示番剧卡片
- 支持季度切换（2026夏、2026春等）

### 2. 字幕组资源模块

**后端API**：
- `GET /api/mikan/bangumi?name=番剧名` → 获取该番剧的所有字幕组资源

**实现逻辑**：
1. 用番剧名字搜索蜜柑计划（`/Home/Search?searchstr=名字`）
2. 从搜索结果中找到对应的详情页
3. 抓取详情页HTML
4. 解析字幕组名称、文件大小、下载链接（磁力/torrent）
5. 返回字幕组资源列表

**前端展示**：
- 点击番剧后弹窗展示字幕组列表
- 显示字幕组名称、文件大小、发布日期
- 选择字幕组后点击下载

### 3. 下载模块

**后端API**：
- 复用现有 `/api/qb/add`

**实现逻辑**：
1. 用户选择字幕组资源
2. 获取磁力链接或torrent文件URL
3. 调用qBittorrent API添加下载
4. 可选：指定下载路径（`savepath`参数）

**前端交互**：
- 选择字幕组后点击"下载"按钮
- 显示下载进度（复用现有Download.svelte的SSE）

## 五、技术实现细节

### HTML解析

使用正则表达式或HTML解析器提取：
- 番剧名字：`<a>`标签的`title`属性或文本内容
- 星期分组：`data-dayofweek`属性
- 详情页链接：`href="/Home/Bangumi/{id}"`

### 网络请求

复用现有的`http-fetch.ts`工具：
- `fetchWithTimeout()` - 带超时的fetch
- `curlFetch()` - curl降级方案

### 错误处理

- 蜜柑计划不可用时显示错误提示
- 网络超时时自动重试
- 备用域名切换（`mikanani.me` → `mikanime.tv`）

## 六、工作量评估

| 部分 | 预估行数 | 复杂度 |
|------|---------|--------|
| 后端scraper | ~100行 | 简单（HTML解析） |
| 后端API | ~80行 | 简单 |
| 前端视图 | ~250行 | 中等 |
| **总计** | ~430行 | 简单-中等 |

## 七、实现阶段

### 阶段1：基础功能（MVP）
1. 后端：抓取蜜柑计划首页，解析番剧名字
2. 后端：实现`/api/mikan/weekly`接口
3. 前端：展示一周新番列表
4. 前端：调用现有API获取元数据

### 阶段2：字幕组资源
1. 后端：实现详情页抓取，解析字幕组资源
2. 后端：实现`/api/mikan/bangumi`接口
3. 前端：实现字幕组选择弹窗
4. 前端：集成下载功能

### 阶段3：季度筛选
1. 后端：实现季度筛选接口
2. 前端：实现季度切换UI

### 后续扩展（记录备忘）
- 文件管理：下载完成后文件夹重命名、移动
- 路径模板：支持变量（`{bangumiTitle}`、`{subgroup}`等）
- 搜索功能：关键词搜索蜜柑计划资源

## 八、注意事项

1. **ID映射**：蜜柑计划的`bangumiId`与Bangumi ID不是同一个，需要用名字搜索匹配
2. **反爬虫**：需要合理控制请求频率，避免被封禁
3. **CORS**：需要后端代理请求，前端不能直接访问蜜柑计划
4. **备用域名**：国内用户可能需要使用`mikanime.tv`

## 九、文件清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `server/scrapers/mikan.ts` | 蜜柑计划抓取器 |
| `server/routes/mikan.ts` | 蜜柑计划API路由 |
| `frontend/src/views/Mikan.svelte` | 蜜柑计划视图组件 |
| `frontend/src/css/views/mikan.css` | 蜜柑计划样式 |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `server/server.ts` | 注册mikan路由 |
| `frontend/src/App.svelte` | 添加Mikan视图 |
| `frontend/src/components/Sidebar.svelte` | 添加导航按钮 |

## 十、验证计划

### 后端验证
```bash
npm run typecheck
cd server && npm test
```

### 前端验证
```bash
npm run check:frontend
```

### 功能验证
1. 启动开发服务器：`npm run dev`
2. 访问蜜柑计划页面
3. 验证一周新番列表显示
4. 验证字幕组资源获取
5. 验证下载功能

## 十一、相关文档

- `docs/dev/download-dock.md` - qBittorrent集成文档
- `docs/dev/backend.md` - 后端开发规范
- `docs/dev/frontend.md` - 前端开发规范
- `docs/data-flow/import-metadata.md` - 元数据获取流程
