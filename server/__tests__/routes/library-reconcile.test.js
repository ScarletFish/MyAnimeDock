// server/__tests__/routes/library-reconcile.test.js
// Unit tests for reconcileEpisodes (磁盘对账纯函数) + handleDeleteEpisode (单集删除端点)
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { mockReq, mockRes, mockState } = require('../helpers/mock-http');
const lib = require('../../dist/routes/library');

// helper: run reconcileEpisodes against an anime object
function reconcile(episodes, diskVideos) {
  const anime = { episodes };
  const changed = lib.reconcileEpisodes(anime, diskVideos);
  return { anime, changed };
}

describe('reconcileEpisodes', () => {
  it('returns false and unchanged when nothing differs', () => {
    const { anime, changed } = reconcile(
      [{ number: 1, filePath: '/a/1.mkv', fileName: '1.mkv', fileSize: 100 }],
      [{ path: '/a/1.mkv', name: '1.mkv', size: 100 }]
    );
    assert.strictEqual(changed, false);
    assert.strictEqual(anime.episodes.length, 1);
    assert.strictEqual(anime.episodes[0].fileSize, 100);
  });

  it('appends new files with number starting at max+1', () => {
    const { anime, changed } = reconcile(
      [{ number: 1, filePath: '/a/1.mkv', fileName: '1.mkv', fileSize: 100 }],
      [
        { path: '/a/1.mkv', name: '1.mkv', size: 100 },
        { path: '/a/2.mkv', name: '2.mkv', size: 200 },
        { path: '/a/3.mkv', name: '3.mkv', size: 300 },
      ]
    );
    assert.strictEqual(changed, true);
    assert.strictEqual(anime.episodes.length, 3);
    assert.strictEqual(anime.episodes[1].number, 2);
    assert.strictEqual(anime.episodes[2].number, 3);
    const e2 = anime.episodes[1];
    assert.strictEqual(e2.filePath, '/a/2.mkv');
    assert.strictEqual(e2.fileName, '2.mkv');
    assert.strictEqual(e2.fileSize, 200);
    assert.strictEqual(e2.duration, null);
    assert.strictEqual(e2.watched, false);
    assert.strictEqual(e2.progress, 0);
  });

  it('starts numbering at 1 when there are no existing episodes', () => {
    const { anime, changed } = reconcile([], [{ path: '/a/1.mkv', name: '1.mkv', size: 100 }]);
    assert.strictEqual(changed, true);
    assert.strictEqual(anime.episodes[0].number, 1);
  });

  it('filters extra videos (NCOP/NCED etc.) so they are not appended', () => {
    const { anime, changed } = reconcile(
      [],
      [
        { path: '/a/1.mkv', name: '1.mkv', size: 100 },
        { path: '/a/NCOP1.mkv', name: 'NCOP1.mkv', size: 50 },
      ]
    );
    assert.strictEqual(changed, true);
    assert.strictEqual(anime.episodes.length, 1);
    assert.strictEqual(anime.episodes[0].number, 1);
    assert.strictEqual(anime.episodes[0].filePath, '/a/1.mkv');
  });

  it('marks missing=true when file disappeared from disk, without persisting change', () => {
    const { anime, changed } = reconcile(
      [
        { number: 1, filePath: '/a/1.mkv', fileName: '1.mkv', fileSize: 100 },
        { number: 2, filePath: '/a/2.mkv', fileName: '2.mkv', fileSize: 100 },
      ],
      [{ path: '/a/1.mkv', name: '1.mkv', size: 100 }]
    );
    assert.strictEqual(anime.episodes[0].missing, false);
    assert.strictEqual(anime.episodes[1].missing, true);
    // missing 是读时计算，不触发落盘
    assert.strictEqual(changed, false);
  });

  it('recomputes missing=false when a previously-missing file is restored', () => {
    // simulate lingering missing=true in memory from a prior scan
    const episodes = [
      { number: 1, filePath: '/a/1.mkv', fileName: '1.mkv', fileSize: 100, missing: true },
    ];
    const { anime } = reconcile(episodes, [{ path: '/a/1.mkv', name: '1.mkv', size: 100 }]);
    assert.strictEqual(anime.episodes[0].missing, false);
  });

  it('updates fileSize when the same path has a different size', () => {
    const { anime, changed } = reconcile(
      [{ number: 1, filePath: '/a/1.mkv', fileName: '1.mkv', fileSize: 100 }],
      [{ path: '/a/1.mkv', name: '1.mkv', size: 999 }]
    );
    assert.strictEqual(changed, true);
    assert.strictEqual(anime.episodes[0].fileSize, 999);
    assert.strictEqual(anime.episodes[0].missing, false);
  });

  it('regression: middle deletion then append uses max+1, not length+1 (no number collision)', () => {
    // start 1,2,3
    const anime = {
      episodes: [
        { number: 1, filePath: '/a/1.mkv', fileName: '1.mkv', fileSize: 100 },
        { number: 2, filePath: '/a/2.mkv', fileName: '2.mkv', fileSize: 100 },
        { number: 3, filePath: '/a/3.mkv', fileName: '3.mkv', fileSize: 100 },
      ],
    };
    // disk episode 2 removed → marked missing (kept)
    lib.reconcileEpisodes(anime, [
      { path: '/a/1.mkv', name: '1.mkv', size: 100 },
      { path: '/a/3.mkv', name: '3.mkv', size: 100 },
    ]);
    assert.strictEqual(anime.episodes[1].missing, true);
    // 防御性保留：即使存在 [1,3] 这样的编号空洞（旧数据/外部干预），
    // 新文件也必须追加到 max+1=4，而不是 length+1=3（会与现有 3 冲突）
    anime.episodes = anime.episodes.filter(e => e.number !== 2);
    assert.deepStrictEqual(anime.episodes.map(e => e.number), [1, 3]);
    // a new disk file appears → must append at number 4 (max+1), NOT 3 (length+1 would collide with existing 3)
    const changed = lib.reconcileEpisodes(anime, [
      { path: '/a/1.mkv', name: '1.mkv', size: 100 },
      { path: '/a/3.mkv', name: '3.mkv', size: 100 },
      { path: '/a/4.mkv', name: '4.mkv', size: 100 },
    ]);
    assert.strictEqual(changed, true);
    const numbers = anime.episodes.map(e => e.number);
    assert.deepStrictEqual(numbers, [1, 3, 4]);
    // no duplicate numbers (would violate Episode_animeId_number_key)
    assert.strictEqual(new Set(numbers).size, numbers.length);
  });
});

describe('handleDeleteEpisode', () => {
  it('returns 404 when anime not found', async () => {
    const state = mockState({ data: { library: [] } });
    const req = mockReq({ url: '/api/anime/nonexistent/episode/1', method: 'DELETE' });
    const res = mockRes();
    await lib.handleDeleteEpisode(req, res, state);
    assert.strictEqual(res._status, 404);
    assert.strictEqual(res._body.error, 'Anime not found');
  });

  it('returns 404 when episode number not found', async () => {
    const state = mockState({
      data: { library: [{ id: 'anime-1', episodes: [{ number: 1, filePath: '/a/1.mkv' }] }] },
    });
    const req = mockReq({ url: '/api/anime/anime-1/episode/99', method: 'DELETE' });
    const res = mockRes();
    await lib.handleDeleteEpisode(req, res, state);
    assert.strictEqual(res._status, 404);
    assert.strictEqual(res._body.error, 'Episode not found');
  });

  it('deletes episode, persists, and returns the updated anime', async () => {
    let saved = false;
    const state = mockState({
      data: {
        library: [{
          id: 'anime-1', title: 'Test',
          episodes: [
            { number: 1, filePath: '/a/1.mkv' },
            { number: 2, filePath: '/a/2.mkv' },
          ],
        }],
      },
      db: { saveLibrary: async () => { saved = true; } },
    });
    const req = mockReq({ url: '/api/anime/anime-1/episode/2', method: 'DELETE' });
    const res = mockRes();
    await lib.handleDeleteEpisode(req, res, state);
    assert.strictEqual(res._status, 200);
    assert.deepStrictEqual(res._body.episodes.map(e => e.number), [1]);
    assert.strictEqual(saved, true);
  });

  it('renumbers remaining episodes to stay contiguous after deleting a middle episode', async () => {
    let savedEpisodes = null;
    const state = mockState({
      data: {
        library: [{
          id: 'anime-1', title: 'Test',
          episodes: [
            { number: 1, filePath: '/a/1.mkv' },
            { number: 2, filePath: '/a/2.mkv' },
            { number: 3, filePath: '/a/3.mkv' },
            { number: 4, filePath: '/a/4.mkv' },
          ],
        }],
      },
      db: {
        saveLibrary: async (data, ids) => { savedEpisodes = data.library[0].episodes.map(e => e.number); },
        savePlaySessions: async () => {},
      },
    });
    const req = mockReq({ url: '/api/anime/anime-1/episode/2', method: 'DELETE' });
    const res = mockRes();
    await lib.handleDeleteEpisode(req, res, state);
    assert.strictEqual(res._status, 200);
    // 删除集号 2 → 集号 3,4 顺移为 2,3
    assert.deepStrictEqual(res._body.episodes.map(e => e.number), [1, 2, 3]);
    assert.deepStrictEqual(savedEpisodes, [1, 2, 3]);
  });

  it('renumbers watch state (watched/progress) along with the file it belongs to', async () => {
    const state = mockState({
      data: {
        library: [{
          id: 'anime-1', title: 'Test',
          episodes: [
            { number: 1, filePath: '/a/1.mkv', watched: true, progress: 1 },
            { number: 2, filePath: '/a/2.mkv', watched: false, progress: 0.5 },
            { number: 3, filePath: '/a/3.mkv', watched: false, progress: 0 },
          ],
        }],
      },
      db: { saveLibrary: async () => {}, savePlaySessions: async () => {} },
    });
    const req = mockReq({ url: '/api/anime/anime-1/episode/1', method: 'DELETE' });
    const res = mockRes();
    await lib.handleDeleteEpisode(req, res, state);
    assert.strictEqual(res._status, 200);
    const eps = res._body.episodes;
    assert.deepStrictEqual(eps.map(e => e.number), [1, 2]);
    // 集号 2（旧）顺移为 1，其 watched=false/progress=0.5 跟随文件
    assert.strictEqual(eps[0].filePath, '/a/2.mkv');
    assert.strictEqual(eps[0].watched, false);
    assert.strictEqual(eps[0].progress, 0.5);
    assert.strictEqual(eps[1].filePath, '/a/3.mkv');
  });

  it('renumbers playSessions for the same anime to match shifted episode numbers', async () => {
    let sessionsSaved = false;
    const state = mockState({
      data: {
        library: [{
          id: 'anime-1', title: 'Test',
          episodes: [
            { number: 1, filePath: '/a/1.mkv' },
            { number: 2, filePath: '/a/2.mkv' },
            { number: 3, filePath: '/a/3.mkv' },
          ],
        }],
        playSessions: [
          { animeId: 'anime-1', episodeNumber: 3, sessionId: 's1', startTime: '2026-08-01T10:00:00.000Z' },
          { animeId: 'anime-1', episodeNumber: 1, sessionId: 's2', startTime: '2026-07-01T10:00:00.000Z' },
          { animeId: 'other-anime', episodeNumber: 3, sessionId: 's3', startTime: '2026-08-01T10:00:00.000Z' },
        ],
      },
      db: {
        saveLibrary: async () => {},
        savePlaySessions: async () => { sessionsSaved = true; },
      },
    });
    const req = mockReq({ url: '/api/anime/anime-1/episode/2', method: 'DELETE' });
    const res = mockRes();
    await lib.handleDeleteEpisode(req, res, state);
    assert.strictEqual(res._status, 200);
    const sessions = state.data.playSessions;
    // 本番：集号 2 删除 → 3 顺移为 2；集号 1 不变；其他番不受影响
    assert.strictEqual(sessions.find(s => s.sessionId === 's1').episodeNumber, 2);
    assert.strictEqual(sessions.find(s => s.sessionId === 's2').episodeNumber, 1);
    assert.strictEqual(sessions.find(s => s.sessionId === 's3').episodeNumber, 3);
    assert.strictEqual(sessionsSaved, true);
  });

  it('skips playSession renumber save when no sessions reference shifted numbers', async () => {
    let sessionsSaved = false;
    const state = mockState({
      data: {
        library: [{
          id: 'anime-1', title: 'Test',
          episodes: [
            { number: 1, filePath: '/a/1.mkv' },
            { number: 2, filePath: '/a/2.mkv' },
            { number: 3, filePath: '/a/3.mkv' },
          ],
        }],
        playSessions: [
          { animeId: 'anime-1', episodeNumber: 1, sessionId: 's1', startTime: '2026-08-01T10:00:00.000Z' },
        ],
      },
      db: {
        saveLibrary: async () => {},
        savePlaySessions: async () => { sessionsSaved = true; },
      },
    });
    const req = mockReq({ url: '/api/anime/anime-1/episode/2', method: 'DELETE' });
    const res = mockRes();
    await lib.handleDeleteEpisode(req, res, state);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(sessionsSaved, false);
  });

  it('returns 500 when persistence fails', async () => {
    const state = mockState({
      data: {
        library: [{ id: 'anime-1', episodes: [{ number: 1, filePath: '/a/1.mkv' }] }],
      },
      db: { saveLibrary: async () => { throw new Error('disk full'); } },
    });
    const req = mockReq({ url: '/api/anime/anime-1/episode/1', method: 'DELETE' });
    const res = mockRes();
    await lib.handleDeleteEpisode(req, res, state);
    assert.strictEqual(res._status, 500);
    assert.strictEqual(res._body.error, 'disk full');
  });
});

describe('handleGetAnimeDetail', () => {
  it('marks all episodes missing when local folder does not exist, without calling saveLibrary', async () => {
    let saved = false;
    const state = mockState({
      data: {
        library: [{
          id: 'anime-1', title: 'Test Anime', folderPath: '/nonexistent/does-not-exist',
          downloaded: false, // pre-set so the downloaded lazy-maintenance branch does not save
          episodes: [
            { number: 1, filePath: '/a/1.mkv', fileName: '1.mkv', fileSize: 100 },
            { number: 2, filePath: '/a/2.mkv', fileName: '2.mkv', fileSize: 100 },
          ],
        }],
      },
      db: { saveLibrary: async () => { saved = true; } },
      thumbnailQueue: { enqueue: () => {} },
    });
    const req = mockReq({ url: '/api/anime/anime-1' });
    const res = mockRes();
    await lib.handleGetAnimeDetail(req, res, state);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._body.downloaded, false);
    assert.strictEqual(res._body.episodes.length, 2);
    for (const e of res._body.episodes) {
      assert.strictEqual(e.missing, true);
    }
    // missing 是响应时派生字段，不落盘
    assert.strictEqual(saved, false);
  });

  it('leaves existing missing flags untouched when folder exists with matching videos', async () => {
    // sanity: with a real folder + matching video, missing should be recomputed to false (no stale true)
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'libr-'));
    const video = path.join(tmpDir, '1.mkv');
    fs.writeFileSync(video, 'data');
    const state = mockState({
      data: {
        library: [{
          id: 'anime-1', title: 'Test Anime', folderPath: tmpDir,
          downloaded: true,
          episodes: [{ number: 1, filePath: video, fileName: '1.mkv', fileSize: 4, missing: true }],
        }],
      },
      thumbnailQueue: { enqueue: () => {} },
    });
    const req = mockReq({ url: '/api/anime/anime-1' });
    const res = mockRes();
    await lib.handleGetAnimeDetail(req, res, state);
    assert.strictEqual(res._status, 200);
    assert.strictEqual(res._body.episodes[0].missing, false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-renumbers legacy number gaps on detail read and persists (self-healing)', async () => {
    // 存量数据：历史删除未顺移，编号 1-6,8,9,10（缺 7）→ 进详情页应自动重排为 1..9 并落盘
    let librarySaved = false;
    let sessionsSaved = false;
    const state = mockState({
      data: {
        library: [{
          id: 'anime-1', title: 'Test Anime', folderPath: '/nonexistent/legacy-gap',
          downloaded: false,
          episodes: [1, 2, 3, 4, 5, 6, 8, 9, 10].map((n) => ({
            number: n, filePath: `/a/${n}.mkv`, fileName: `${n}.mkv`, fileSize: 100,
          })),
        }],
        playSessions: [
          // 指向重排前集号 8 的会话应顺移到 7；缺失的旧 7（已删）无会话
          { animeId: 'anime-1', episodeNumber: 8, sessionId: 's1', startTime: '2026-08-01T10:00:00.000Z' },
        ],
      },
      db: {
        saveLibrary: async () => { librarySaved = true; },
        savePlaySessions: async () => { sessionsSaved = true; },
      },
      thumbnailQueue: { enqueue: () => {} },
    });
    const req = mockReq({ url: '/api/anime/anime-1' });
    const res = mockRes();
    await lib.handleGetAnimeDetail(req, res, state);
    assert.strictEqual(res._status, 200);
    assert.deepStrictEqual(
      res._body.episodes.map((e) => e.number),
      [1, 2, 3, 4, 5, 6, 7, 8, 9]
    );
    // 会话顺移：8 → 7
    assert.strictEqual(state.data.playSessions[0].episodeNumber, 7);
    assert.strictEqual(librarySaved, true);
    assert.strictEqual(sessionsSaved, true);
  });

  it('does not renumber or save when episode numbers are already contiguous', async () => {
    let librarySaved = false;
    let sessionsSaved = false;
    const state = mockState({
      data: {
        library: [{
          id: 'anime-1', title: 'Test Anime', folderPath: '/nonexistent/contiguous',
          downloaded: false,
          episodes: [1, 2, 3].map((n) => ({
            number: n, filePath: `/a/${n}.mkv`, fileName: `${n}.mkv`, fileSize: 100,
          })),
        }],
        playSessions: [
          { animeId: 'anime-1', episodeNumber: 3, sessionId: 's1', startTime: '2026-08-01T10:00:00.000Z' },
        ],
      },
      db: {
        saveLibrary: async () => { librarySaved = true; },
        savePlaySessions: async () => { sessionsSaved = true; },
      },
      thumbnailQueue: { enqueue: () => {} },
    });
    const req = mockReq({ url: '/api/anime/anime-1' });
    const res = mockRes();
    await lib.handleGetAnimeDetail(req, res, state);
    assert.strictEqual(res._status, 200);
    assert.deepStrictEqual(res._body.episodes.map((e) => e.number), [1, 2, 3]);
    assert.strictEqual(state.data.playSessions[0].episodeNumber, 3);
    // 连续编号 → 无变更 → 不应落盘
    assert.strictEqual(librarySaved, false);
    assert.strictEqual(sessionsSaved, false);
  });
});