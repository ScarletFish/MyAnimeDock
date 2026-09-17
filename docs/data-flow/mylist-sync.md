# MyList + Bangumi Sync 流

## MyList 状态

### Get MyList（列表全集 / filter=local 子集）
```
GET /api/mylist[?filter=local]
  → routes/mylist.ts:handleGetMyList()
  → lib/list-item.ts:buildListItems() 唯一投影：
     全集 = mylist 行（animeId 非空）∪ 无 mylist 行的 library 行（合成 status=null）
     filter=local → 仅 animeId 非空 && downloaded===true（旧 GET /api/library 语义）
  → firstPlayedAt（最早）/ lastPlayedAt（最晚）由 playSessions 聚合注入
  → 列表不下发 episodes[]，改 episodeCount/episodesWatched 聚合
  → 用途：状态弹窗打开时，若 startedAt 为空，用 firstPlayedAt 的本地日期预填"开始日期"，
    避免用户回忆（frontend/src/views/Mylist.svelte:localDateStr — 注意本地日期转换，勿 substring(0,10)）
  → 纯推导、不落盘；仅当用户在弹窗保存时才随 startedAt 写入 MyList
```

### Detail-open reconcile projection（详情页打开对账投影）
```
GET /api/anime/:id
  → routes/library.ts:handleGetAnimeDetail()
  → 打开详情页时对账：findVideos 追加新集 / 更新 fileSize、renumber 填补编号空洞、懒维护 downloaded
  → 对账/重排后附 item = buildListItems(data, { ids: [anime.id] })[0]（与 /api/mylist?ids= 同一投影入口）
  → Detail.svelte:syncLibraryItem：比对前端 lib/ui-state.js libraryItemChanged 的语义字段
      ├─ 有变化 → patchLibraryItem(item) 就地 patch 库页 store + 发失效（续播卡片/集数徽标联动刷新）
      └─ 无变化 → 静默跳过，零请求零通知（不重复拉 /api/mylist）
  意义：详情页对账发现的磁盘变更（新集、进度、本地状态）随详情响应推送到库页，
  无需重开 App / 强制刷新即可在库列表看到最新集数与续播进度。
  边界：详情页打开时库页未挂载、事件无人接收 → Library.svelte 视图打开沿静默补刷 loadContinue()。
```

### Status Change（手动）
```
PUT /api/mylist/:id/status
  → routes/mylist.ts:handleUpdateMyListStatus()
  → Body: { status: 'watching'|'wish'|'completed'|'on_hold'|'dropped' }
  → Find MyList entry by animeId
  → Update status + updatedAt
  → db.saveMyList(data) — only writes mylist table
  → bangumiSync.pushStatusChange(animeId, data) — async fire-and-forget to Bangumi
```

### Auto-creation on Import
```
POST /api/import (or autoImportNewFolders)
  → After anime record saved to library
  → Create MyList entry: { animeId, status: 'watching' }
  → db.saveMyList(data)
```

### Auto-completion on Delete
```
DELETE /api/anime/:id
  → After removing anime from data.library
  → Find MyList entry → set status: 'completed'
  → db.saveMyList(data) + db.saveLibrary(data)
```

## Bangumi 同步

### Full Sync (Pull → Merge → Push)
```
POST /api/bangumi/sync
  → routes/bangumi.ts:handleBangumiSync()
  → Body: { dryRun?: boolean }
  → bangumiSync.syncMyList(data, { dryRun })
      ├─ Pull: fetch user's Bangumi collection (anime + episodes)
      ├─ Merge: compare local MyList with Bangumi collection
      │   ├─ Local has, Bangumi doesn't → push to Bangumi
      │   ├─ Bangumi has, local doesn't → pull from Bangumi
      │   └─ Both have → reconcile by updatedAt
      └─ Push: batch update Bangumi collection
  → Return sync result (created/updated/deleted counts)
```

### Per-Item Push (on status change)
```
PUT /api/mylist/:id/status
  → After local status update
  → bangumiSync.pushStatusChange(animeId, data) — async fire-and-forget
  → Sends single status update to Bangumi API
```
