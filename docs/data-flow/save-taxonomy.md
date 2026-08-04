# Save 函数分类

## 函数总表

| Function | Writes | When to use |
|----------|--------|-------------|
| `db.saveLibrary(data)` | anime + episode tables | Import, delete, metadata fetch, auto-import |
| `db.saveMyList(data)` | mylist table | Import, auto-import, status change |
| `db.savePlaySessions(data)` | playSession table | Play start, mpv final/error |
| `db.updateEpisodeProgress(id, n, fields)` | single episode row | mpv final (mpv 关闭时一次性落盘), manual update |
| `db.updateEpisodesWatched(id, numbers[])` | batch episode rows | Auto-mark previous episodes as watched |
| `db.updatePlaySession(sid, fields)` | single playSession row | mpv final (mpv 关闭时一次性落盘) |
| `db.saveAll(data)` | all tables in parallel | Composite fallback for multi-table saves |
| `saveScannedTree(tree)` | `scanned-tree.json` (sync) | Scan, exclude, unlink, metadata |

> `saveScannedTree()` 定义在 `lib/config.ts`，不是 `db.ts`。其余函数均定义在 `db.ts`。

**saveLibrary uniqueness checks**: Before upserting each anime, `saveLibrary` checks:
- `bangumiId` uniqueness — if another anime already owns the same `bangumiId`, skip the current entry
- `anilistId` uniqueness — if another anime already owns the same `anilistId`, clear the old owner's AniList fields (current record wins; manual match takes priority)

## Call Site → Save Function Mapping

| Scenario | Save function used |
|----------|-------------------|
| Scan/browse | `saveScannedTree()` |
| Exclude/Include node | `saveScannedTree()` |
| Unlink anime from library | `db.saveLibrary()` + `saveScannedTree()` |
| Import (manual/auto) | `db.saveLibrary()` + `saveScannedTree()` (or `db.saveMyList()` for auto-import) |
| Delete anime | `db.saveLibrary()` + `db.saveMyList()` (status → completed) |
| Fetch metadata | `db.saveLibrary()` + `saveScannedTree()` |
| MyList status change | `db.saveMyList()` + `bangumiSync.pushStatusChange()` |
| Bangumi full sync | `bangumiSync.syncMyList()` (handles own persistence) |
| Play start | `db.savePlaySessions()` + `db.updateEpisodesWatched()` (auto-mark) |
| mpv final/error | `db.savePlaySessions()` |
| Episode progress (manual/mpv) | `db.updateEpisodeProgress()` |

## `db.loadData()`

```
async loadData() {
  ├─ ensureSchema() — auto-create tables if missing
  ├─ Read all Anime + Episode from SQLite
  ├─ Read all PlaySession from SQLite
  ├─ Read ScannedTree from SQLite (JSON stringified in single row)
  ├─ Convert SQLite rows → legacy JSON format
  └─ Return → server.ts assigns to global `data`
}
```

## Persistence Architecture

```
SQLite (anime.db): primary store for library, playSessions
  → Fine-grained writes: each function writes only its table
  → Full-state sync: db.saveAll() writes all three tables

scanned-tree.json: exclusive JSON file for scan tree
  → sync write, separate from SQLite
  → `db.loadData()` 也会从 SQLite ScannedTree 表读取，但 `init()` 中用 JSON 版盖写
    （SQLite 表仅在从旧 `anime-data.json` 迁移时写入一次，之后只读 JSON）

config.json: independent JSON file for settings
  → Managed separately, never in SQLite
```

## Gotchas

- **Fine-grained saves**: Each API endpoint only writes the SQLite table(s) it actually modifies. Never use `db.saveAll()` unless you're changing data in multiple tables simultaneously.
- **Save order matters**: Auto-import always calls `db.saveLibrary()` before `db.saveMyList()` — MyList has a foreign key constraint on animeId, so the anime record must exist first.
- **anilistId=-1 → null normalization**: `saveLibrary()` converts sentinel `-1` to `null` before writing to SQLite. `db.updateAnime()` does NOT normalize (keeps `-1` in DB).
- **Auto-mark requires DB save**: When auto-marking episodes, `db.updateEpisodesWatched()` must be called, otherwise the state is only in memory and lost on restart.
