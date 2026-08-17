# MyList + Bangumi Sync 流

## MyList 状态

### Get MyList（含 firstPlayedAt）
```
GET /api/mylist
  → routes/mylist.ts:handleGetMyList()
  → 对每个有本地文件的条目，附加 firstPlayedAt = 该动画最早一条 PlaySession.startTime
  → 用途：状态弹窗打开时，若 startedAt 为空，用 firstPlayedAt 的本地日期预填"开始日期"，
    避免用户回忆（frontend/src/views/Mylist.svelte:localDateStr — 注意本地日期转换，勿 substring(0,10)）
  → 纯推导、不落盘；仅当用户在弹窗保存时才随 startedAt 写入 MyList
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
