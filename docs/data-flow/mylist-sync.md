# MyList + Bangumi Sync 流

## MyList 状态

### Status Change（手动）
```
PUT /api/mylist/:id/status
  → routes/mylist.js:handleUpdateMyListStatus()
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
  → routes/bangumi.js:handleBangumiSync()
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
