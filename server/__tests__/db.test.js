const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('DB Integration Tests', () => {
  let db;

  before(async () => {
    db = require('../db');
  });

  describe('loadData', () => {
    it('returns data structure with expected keys', async () => {
      const data = await db.loadData();
      if (data === null) {
        assert.ok(true, 'DB not available, loadData returns null');
        return;
      }
      assert.ok(Array.isArray(data.library), 'library should be array');
      assert.ok(Array.isArray(data.myList), 'myList should be array');
      assert.ok(Array.isArray(data.memories), 'memories should be array');
      assert.ok(Array.isArray(data.playSessions), 'playSessions should be array');
      assert.ok(Array.isArray(data.scannedTree), 'scannedTree should be array');
    });

    it('returns an object with known keys', async () => {
      const data = await db.loadData();
      if (data === null) return;
      assert.ok(data.hasOwnProperty('library'), 'should have library key');
      assert.ok(data.hasOwnProperty('myList'), 'should have myList key');
      assert.ok(data.hasOwnProperty('memories'), 'should have memories key');
      assert.ok(data.hasOwnProperty('playSessions'), 'should have playSessions key');
      assert.ok(data.hasOwnProperty('scannedTree'), 'should have scannedTree key');
    });
  });

  describe('saveLibrary', () => {
    it('saves and retrieves anime', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const testAnime = {
        id: 'test-anime-001',
        folderPath: '/test/path/db-test',
        folderName: 'Test Anime',
        title: 'Test Anime',
        season: 1,
        importedAt: new Date().toISOString(),
        downloaded: true,
        bangumiId: 99999999,
        bangumiTitle: 'テストアニメ',
        episodes: [
          {
            number: 1,
            filePath: '/test/path/db-test/ep01.mkv',
            fileName: 'ep01.mkv',
            fileSize: 1000000,
            watched: false,
            progress: 0
          }
        ]
      };

      // Append to existing library
      data.library.push(testAnime);
      await db.saveLibrary(data);

      const reloaded = await db.loadData();
      const saved = reloaded.library.find(a => a.id === 'test-anime-001');
      assert.ok(saved, 'anime should be saved');
      assert.equal(saved.bangumiTitle, 'テストアニメ');
      assert.equal(saved.episodes.length, 1);
      assert.equal(saved.episodes[0].fileName, 'ep01.mkv');
      assert.equal(saved.episodes[0].watched, false);

      // Cleanup: remove test anime from library and re-save
      reloaded.library = reloaded.library.filter(a => a.id !== 'test-anime-001');
      await db.saveLibrary(reloaded);
    });

    it('persists episode watched state', async () => {
      const data = await db.loadData();
      if (data === null) return;

      // Ensure test anime exists
      let testAnime = data.library.find(a => a.id === 'test-anime-002');
      if (!testAnime) {
        testAnime = {
          id: 'test-anime-002',
          folderPath: '/test/path/db-test-2',
          folderName: 'Test Anime 2',
          title: 'Test Anime 2',
          season: 1,
          importedAt: new Date().toISOString(),
          downloaded: true,
          bangumiId: 99999998,
          bangumiTitle: 'テストアニメ2',
          episodes: [
            { number: 1, filePath: '/test/path/db-test-2/ep01.mkv', fileName: 'ep01.mkv', fileSize: 1000000, watched: false, progress: 0 },
            { number: 2, filePath: '/test/path/db-test-2/ep02.mkv', fileName: 'ep02.mkv', fileSize: 1000000, watched: false, progress: 0 }
          ]
        };
        data.library.push(testAnime);
        await db.saveLibrary(data);
      }

      // Mark ep01 as watched
      const reloaded = await db.loadData();
      const anime = reloaded.library.find(a => a.id === 'test-anime-002');
      assert.ok(anime, 'test anime should exist');
      anime.episodes[0].watched = true;
      anime.episodes[0].progress = 1;
      await db.saveLibrary(reloaded);

      // Verify persisted
      const reloaded2 = await db.loadData();
      const anime2 = reloaded2.library.find(a => a.id === 'test-anime-002');
      assert.equal(anime2.episodes[0].watched, true, 'ep01 should be watched');
      assert.equal(anime2.episodes[1].watched, false, 'ep02 should remain unwatched');

      // Cleanup
      reloaded2.library = reloaded2.library.filter(a => a.id !== 'test-anime-002');
      await db.saveLibrary(reloaded2);
    });
  });

  describe('saveMyList', () => {
    it('saves and retrieves MyList item linked to an existing anime', async () => {
      const data = await db.loadData();
      if (data === null) return;

      // Ensure test anime exists in library (MyList animeId has FK to Anime)
      let testAnime = data.library.find(a => a.id === 'test-anime-003');
      if (!testAnime) {
        testAnime = {
          id: 'test-anime-003',
          folderPath: '/test/path/db-test-3',
          folderName: 'Test Anime 3',
          title: 'Test Anime 3',
          season: 1,
          importedAt: new Date().toISOString(),
          downloaded: true,
          bangumiId: 99999997,
          bangumiTitle: 'テストアニメ3',
          episodes: []
        };
        data.library.push(testAnime);
        await db.saveLibrary(data);
      }

      // Add MyList entry
      const reloaded = await db.loadData();
      reloaded.myList.push({
        animeId: 'test-anime-003',
        status: 'watching',
        rating: 8.5,
        thoughts: 'great show'
      });
      await db.saveMyList(reloaded);

      const reloaded2 = await db.loadData();
      const saved = reloaded2.myList.find(m => m.animeId === 'test-anime-003');
      assert.ok(saved, 'MyList item should be saved');
      assert.equal(saved.status, 'watching');
      assert.equal(saved.rating, 8.5);
      assert.equal(saved.thoughts, 'great show');

      // Cleanup: remove MyList item, then remove anime
      reloaded2.myList = reloaded2.myList.filter(m => m.animeId !== 'test-anime-003');
      await db.saveMyList(reloaded2);
      reloaded2.library = reloaded2.library.filter(a => a.id !== 'test-anime-003');
      await db.saveLibrary(reloaded2);
    });

    it('saves MyList wish-only item (bangumiId, no animeId)', async () => {
      const data = await db.loadData();
      if (data === null) return;

      // Wish-only item: has bangumiId but no animeId (FK not required for bangumiId)
      data.myList.push({
        animeId: null,
        bangumiId: 88888888,
        title: 'Wish Only Anime',
        status: 'wish'
      });
      await db.saveMyList(data);

      const reloaded = await db.loadData();
      const saved = reloaded.myList.find(m => m.bangumiId === 88888888);
      assert.ok(saved, 'wish-only MyList item should be saved');
      assert.equal(saved.status, 'wish');

      // Cleanup
      reloaded.myList = reloaded.myList.filter(m => m.bangumiId !== 88888888);
      await db.saveMyList(reloaded);
    });

    it('updates existing MyList status', async () => {
      const data = await db.loadData();
      if (data === null) return;

      // Ensure test anime exists
      let testAnime = data.library.find(a => a.id === 'test-anime-004');
      if (!testAnime) {
        testAnime = {
          id: 'test-anime-004',
          folderPath: '/test/path/db-test-4',
          folderName: 'Test Anime 4',
          title: 'Test Anime 4',
          season: 1,
          importedAt: new Date().toISOString(),
          downloaded: true,
          bangumiId: 99999996,
          bangumiTitle: 'テストアニメ4',
          episodes: []
        };
        data.library.push(testAnime);
        await db.saveLibrary(data);
      }

      // Create MyList entry
      const reloaded = await db.loadData();
      reloaded.myList.push({ animeId: 'test-anime-004', status: 'watching' });
      await db.saveMyList(reloaded);

      // Update status
      const reloaded2 = await db.loadData();
      const item = reloaded2.myList.find(m => m.animeId === 'test-anime-004');
      assert.ok(item, 'MyList item should exist');
      item.status = 'completed';
      item.rating = 9.0;
      await db.saveMyList(reloaded2);

      // Verify update
      const reloaded3 = await db.loadData();
      const updated = reloaded3.myList.find(m => m.animeId === 'test-anime-004');
      assert.equal(updated.status, 'completed');
      assert.equal(updated.rating, 9.0);

      // Cleanup
      reloaded3.myList = reloaded3.myList.filter(m => m.animeId !== 'test-anime-004');
      await db.saveMyList(reloaded3);
      reloaded3.library = reloaded3.library.filter(a => a.id !== 'test-anime-004');
      await db.saveLibrary(reloaded3);
    });
  });
});
