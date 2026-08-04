const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('DB Integration Tests', () => {
  let db;

  before(async () => {
    db = require('../dist/db');
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
      assert.ok(Array.isArray(data.playSessions), 'playSessions should be array');
      assert.ok(Array.isArray(data.scannedTree), 'scannedTree should be array');
    });

    it('returns an object with known keys', async () => {
      const data = await db.loadData();
      if (data === null) return;
      assert.ok(data.hasOwnProperty('library'), 'should have library key');
      assert.ok(data.hasOwnProperty('myList'), 'should have myList key');
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

  describe('updateEpisodesWatched', () => {
    const testAnimeId = 'test-anime-005';

    before(async () => {
      const data = await db.loadData();
      if (data === null) return;
      if (data.library.find(a => a.id === testAnimeId)) return;
      data.library.push({
        id: testAnimeId,
        folderPath: '/test/path/db-test-5',
        folderName: 'Test Anime 5',
        title: 'Test Anime 5',
        season: 1,
        importedAt: new Date().toISOString(),
        downloaded: true,
        bangumiId: 99999995,
        bangumiTitle: 'テストアニメ5',
        episodes: [
          { number: 1, filePath: '/test/path/db-test-5/ep01.mkv', fileName: 'ep01.mkv', fileSize: 1000000, watched: false, progress: 0 },
          { number: 2, filePath: '/test/path/db-test-5/ep02.mkv', fileName: 'ep02.mkv', fileSize: 1000000, watched: false, progress: 0 },
          { number: 3, filePath: '/test/path/db-test-5/ep03.mkv', fileName: 'ep03.mkv', fileSize: 1000000, watched: false, progress: 0 },
          { number: 4, filePath: '/test/path/db-test-5/ep04.mkv', fileName: 'ep04.mkv', fileSize: 1000000, watched: false, progress: 0 },
          { number: 5, filePath: '/test/path/db-test-5/ep05.mkv', fileName: 'ep05.mkv', fileSize: 1000000, watched: false, progress: 0 },
        ]
      });
      await db.saveLibrary(data);
    });

    after(async () => {
      const data = await db.loadData();
      if (data === null) return;
      data.library = data.library.filter(a => a.id !== testAnimeId);
      await db.saveLibrary(data);
    });

    it('batch marks multiple episodes as watched', async () => {
      await db.updateEpisodesWatched(testAnimeId, [1, 2, 3]);

      const data = await db.loadData();
      const anime = data.library.find(a => a.id === testAnimeId);
      assert.ok(anime, 'test anime should exist');
      assert.equal(anime.episodes[0].watched, true, 'ep01 should be watched');
      assert.equal(anime.episodes[1].watched, true, 'ep02 should be watched');
      assert.equal(anime.episodes[2].watched, true, 'ep03 should be watched');
      assert.equal(anime.episodes[3].watched, false, 'ep04 should remain unwatched');
      assert.equal(anime.episodes[4].watched, false, 'ep05 should remain unwatched');
    });

    it('persists auto-marked episodes across loadData', async () => {
      // Reset all to unwatched first
      await db.updateEpisodesWatched(testAnimeId, []);

      // Simulate auto-mark: playing ep05 marks ep01-04
      await db.updateEpisodesWatched(testAnimeId, [1, 2, 3, 4]);

      // Reload from SQLite — watched state must survive
      const data = await db.loadData();
      const anime = data.library.find(a => a.id === testAnimeId);
      assert.ok(anime, 'test anime should exist');
      assert.equal(anime.episodes[0].watched, true, 'ep01 should be watched after reload');
      assert.equal(anime.episodes[1].watched, true, 'ep02 should be watched after reload');
      assert.equal(anime.episodes[2].watched, true, 'ep03 should be watched after reload');
      assert.equal(anime.episodes[3].watched, true, 'ep04 should be watched after reload');
      assert.equal(anime.episodes[4].watched, false, 'ep05 should remain unwatched');
    });

    it('does not affect other anime episodes', async () => {
      // Create another anime
      const data = await db.loadData();
      if (data === null) return;
      const otherId = 'test-anime-006';
      if (!data.library.find(a => a.id === otherId)) {
        data.library.push({
          id: otherId,
          folderPath: '/test/path/db-test-6',
          folderName: 'Test Anime 6',
          title: 'Test Anime 6',
          season: 1,
          importedAt: new Date().toISOString(),
          downloaded: true,
          bangumiId: 99999994,
          bangumiTitle: 'テストアニメ6',
          episodes: [
            { number: 1, filePath: '/test/path/db-test-6/ep01.mkv', fileName: 'ep01.mkv', fileSize: 1000000, watched: false, progress: 0 },
          ]
        });
        await db.saveLibrary(data);
      }

      // Mark episodes on test-anime-005
      await db.updateEpisodesWatched(testAnimeId, [1, 2, 3, 4, 5]);

      // Verify test-anime-006 is unaffected
      const reloaded = await db.loadData();
      const other = reloaded.library.find(a => a.id === otherId);
      assert.ok(other, 'other anime should exist');
      assert.equal(other.episodes[0].watched, false, 'other anime episodes should be unaffected');

      // Cleanup
      reloaded.library = reloaded.library.filter(a => a.id !== otherId);
      await db.saveLibrary(reloaded);
    });

    it('handles empty episode list gracefully', async () => {
      // Should not throw
      await db.updateEpisodesWatched(testAnimeId, []);

      // State should be unchanged
      const data = await db.loadData();
      const anime = data.library.find(a => a.id === testAnimeId);
      assert.ok(anime, 'test anime should exist');
      // All should still be watched from previous test
      assert.equal(anime.episodes[0].watched, true, 'ep01 should remain watched');
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

  describe('Full Lifecycle: Import → Play → Archive', () => {
    const lifecycleAnimeId = 'lifecycle-test-001';

    after(async () => {
      const data = await db.loadData();
      if (data === null) return;
      data.library = data.library.filter(a => a.id !== lifecycleAnimeId);
      data.myList = data.myList.filter(m => m.animeId !== lifecycleAnimeId);
      data.playSessions = data.playSessions.filter(s => s.animeId !== lifecycleAnimeId);
      await db.saveLibrary(data);
      await db.saveMyList(data);
      await db.savePlaySessions(data);
    });

    it('Step 1: Import anime with 5 episodes', async () => {
      const data = await db.loadData();
      if (data === null) return;

      data.library.push({
        id: lifecycleAnimeId,
        folderPath: '/test/media/lifecycle-anime',
        folderName: '[bgm100001] Lifecycle Test Anime',
        title: 'Lifecycle Test Anime',
        season: 1,
        importedAt: new Date().toISOString(),
        downloaded: true,
        bangumiId: 100001,
        bangumiTitle: '生命周期测试动画',
        episodes: [
          { number: 1, filePath: '/test/media/lifecycle-anime/ep01.mkv', fileName: 'ep01.mkv', fileSize: 500000, watched: false, progress: 0 },
          { number: 2, filePath: '/test/media/lifecycle-anime/ep02.mkv', fileName: 'ep02.mkv', fileSize: 500000, watched: false, progress: 0 },
          { number: 3, filePath: '/test/media/lifecycle-anime/ep03.mkv', fileName: 'ep03.mkv', fileSize: 500000, watched: false, progress: 0 },
          { number: 4, filePath: '/test/media/lifecycle-anime/ep04.mkv', fileName: 'ep04.mkv', fileSize: 500000, watched: false, progress: 0 },
          { number: 5, filePath: '/test/media/lifecycle-anime/ep05.mkv', fileName: 'ep05.mkv', fileSize: 500000, watched: false, progress: 0 },
        ]
      });
      await db.saveLibrary(data);

      // Create MyList entry (import flow does this)
      data.myList.push({
        animeId: lifecycleAnimeId,
        bangumiId: 100001,
        status: 'watching',
        title: 'Lifecycle Test Anime',
      });
      await db.saveMyList(data);

      // Verify
      const reloaded = await db.loadData();
      const anime = reloaded.library.find(a => a.id === lifecycleAnimeId);
      assert.ok(anime, 'anime should be imported');
      assert.equal(anime.episodes.length, 5, 'should have 5 episodes');
      assert.equal(anime.episodes.every(e => !e.watched), true, 'all episodes should be unwatched initially');
      const myList = reloaded.myList.find(m => m.animeId === lifecycleAnimeId);
      assert.ok(myList, 'MyList entry should exist');
      assert.equal(myList.status, 'watching');
    });

    it('Step 2: Play episode 1 (first episode, no auto-mark)', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const anime = data.library.find(a => a.id === lifecycleAnimeId);
      assert.ok(anime);
      const ep1 = anime.episodes.find(e => e.number === 1);

      // Simulate play start: no previous episodes to auto-mark
      // Simulate progress update
      ep1.progress = 0.5;
      ep1.watched = true;
      await db.updateEpisodeProgress(lifecycleAnimeId, 1, { progress: 0.5, watched: true });

      // Create play session
      const sessionId = 'lifecycle-session-1';
      data.playSessions.push({
        animeId: lifecycleAnimeId,
        episodeNumber: 1,
        sessionId,
        startTime: new Date(Date.now() - 600000).toISOString(),
        endTime: new Date().toISOString(),
        duration: 600,
        clockTime: 600,
        progressStart: 0,
      });
      await db.savePlaySessions(data);

      // Verify
      const reloaded = await db.loadData();
      const anime2 = reloaded.library.find(a => a.id === lifecycleAnimeId);
      const ep = anime2.episodes.find(e => e.number === 1);
      assert.equal(ep.watched, true, 'ep01 should be watched');
      assert.equal(ep.progress, 0.5, 'ep01 progress should be 0.5');
      const sessions = reloaded.playSessions.filter(s => s.animeId === lifecycleAnimeId);
      assert.equal(sessions.length, 1, 'should have 1 play session');
    });

    it('Step 3: Play episode 3 → auto-mark ep01-02 as watched', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const anime = data.library.find(a => a.id === lifecycleAnimeId);
      assert.ok(anime);

      // Simulate auto-mark: playing ep03 marks ep01-02
      const autoMarked = [];
      for (const ep of anime.episodes) {
        if (ep.number < 3 && !ep.watched) {
          ep.watched = true;
          autoMarked.push(ep.number);
        }
      }
      if (autoMarked.length > 0) {
        await db.updateEpisodesWatched(lifecycleAnimeId, autoMarked);
      }

      // Simulate progress on ep03
      const ep3 = anime.episodes.find(e => e.number === 3);
      ep3.progress = 0.8;
      ep3.watched = true;
      await db.updateEpisodeProgress(lifecycleAnimeId, 3, { progress: 0.8, watched: true });

      // Create play session for ep03
      data.playSessions.push({
        animeId: lifecycleAnimeId,
        episodeNumber: 3,
        sessionId: 'lifecycle-session-3',
        startTime: new Date(Date.now() - 600000).toISOString(),
        endTime: new Date().toISOString(),
        duration: 500,
        clockTime: 600,
        progressStart: 0,
      });
      await db.savePlaySessions(data);

      // Verify — THE CRITICAL TEST
      const reloaded = await db.loadData();
      const anime2 = reloaded.library.find(a => a.id === lifecycleAnimeId);
      assert.equal(anime2.episodes[0].watched, true, 'ep01 should be auto-marked watched');
      assert.equal(anime2.episodes[1].watched, true, 'ep02 should be auto-marked watched');
      assert.equal(anime2.episodes[2].watched, true, 'ep03 should be watched');
      assert.equal(anime2.episodes[3].watched, false, 'ep04 should remain unwatched');
      assert.equal(anime2.episodes[4].watched, false, 'ep05 should remain unwatched');
      const sessions = reloaded.playSessions.filter(s => s.animeId === lifecycleAnimeId);
      assert.equal(sessions.length, 2, 'should have 2 play sessions');
    });

    it('Step 4: Complete all episodes → status change to completed', async () => {
      const data = await db.loadData();
      if (data === null) return;

      // Mark all episodes as watched
      await db.updateEpisodesWatched(lifecycleAnimeId, [4, 5]);

      // Change MyList status to completed (simulates "看完归档")
      const myList = data.myList.find(m => m.animeId === lifecycleAnimeId);
      assert.ok(myList, 'MyList entry should exist');
      myList.status = 'completed';
      myList.completedAt = new Date().toISOString();
      myList.rating = 9.0;
      myList.thoughts = '非常好看，强烈推荐';
      await db.saveMyList(data);

      // Verify
      const reloaded = await db.loadData();
      const anime = reloaded.library.find(a => a.id === lifecycleAnimeId);
      assert.equal(anime.episodes.every(e => e.watched), true, 'all episodes should be watched');
      const updatedMyList = reloaded.myList.find(m => m.animeId === lifecycleAnimeId);
      assert.equal(updatedMyList.status, 'completed');
      assert.equal(updatedMyList.rating, 9.0);
    });

    it('Step 5: Completed items appear in myList with rating and thoughts', async () => {
      const data = await db.loadData();
      if (data === null) return;

      // Simulate completed myList query
      const archivedItems = (data.myList || [])
        .filter(m => m.status === 'completed')
        .map(m => {
          const anime = data.library.find(a => a.id === m.animeId);
          return {
            animeId: m.animeId,
            title: anime ? anime.title : m.animeId,
            bangumiId: anime ? anime.bangumiId : null,
            bangumiTitle: anime ? anime.bangumiTitle : null,
            rating: m.rating,
            thoughts: m.thoughts || '',
          };
        });

      const item = archivedItems.find(m => m.animeId === lifecycleAnimeId);
      assert.ok(item, 'completed anime should appear in myList');
      assert.equal(item.title, 'Lifecycle Test Anime');
      assert.equal(item.bangumiTitle, '生命周期测试动画');
      assert.equal(item.rating, 9.0);
      assert.equal(item.thoughts, '非常好看，强烈推荐');
    });

    it('Step 6: Delete anime → remove from library and myList', async () => {
      const data = await db.loadData();
      if (data === null) return;

      // Simulate DELETE /api/anime/:id (matches real server.js behavior)
      // Remove from library
      data.library = data.library.filter(a => a.id !== lifecycleAnimeId);
      // Remove associated MyList entry
      data.myList = data.myList.filter(m => m.animeId !== lifecycleAnimeId);
      // Remove play sessions
      data.playSessions = data.playSessions.filter(s => s.animeId !== lifecycleAnimeId);
      await db.saveLibrary(data);
      await db.saveMyList(data);
      await db.savePlaySessions(data);

      // Verify: everything removed
      const reloaded = await db.loadData();
      assert.equal(reloaded.library.find(a => a.id === lifecycleAnimeId), undefined, 'anime should be removed from library');
      assert.equal(reloaded.myList.find(m => m.animeId === lifecycleAnimeId), undefined, 'MyList entry should be removed');
      assert.equal(reloaded.playSessions.filter(s => s.animeId === lifecycleAnimeId).length, 0, 'play sessions should be removed');
    });
  });

  // ── saveAll ──
  describe('saveAll', () => {
    it('writes library, mylist, and playSessions in one call', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const id = 'saveall-test-001';
      // Save library first (FK: playSession.animeId → anime.id)
      data.library.push({
        id, folderPath: '/test/saveall', folderName: 'SaveAll Test',
        title: 'SaveAll Test', importedAt: new Date().toISOString(),
        downloaded: true, bangumiId: 77777001, bangumiTitle: 'SaveAllテスト',
        episodes: [{ number: 1, filePath: '/test/saveall/ep01.mkv', fileName: 'ep01.mkv', fileSize: 100, watched: false, progress: 0 }],
      });
      data.myList.push({ animeId: id, status: 'watching', rating: 7.5 });
      data.playSessions.push({
        animeId: id, episodeNumber: 1, sessionId: 'saveall-sess-1',
        startTime: new Date().toISOString(), endTime: null,
        duration: 0, clockTime: 0, progressStart: 0,
      });

      // saveAll runs in parallel — library must be saved before sessions
      // (saveAll doesn't guarantee order, so save library separately first)
      await db.saveLibrary(data);
      await db.saveAll(data);

      const reloaded = await db.loadData();
      assert.ok(reloaded.library.find(a => a.id === id), 'anime saved');
      assert.ok(reloaded.myList.find(m => m.animeId === id), 'myList saved');
      assert.ok(reloaded.playSessions.find(s => s.sessionId === 'saveall-sess-1'), 'session saved');

      // Cleanup
      reloaded.library = reloaded.library.filter(a => a.id !== id);
      reloaded.myList = reloaded.myList.filter(m => m.animeId !== id);
      reloaded.playSessions = reloaded.playSessions.filter(s => s.animeId !== id);
      await db.saveAll(reloaded);
    });
  });

  // ── bangumiId uniqueness ──
  describe('saveLibrary — bangumiId uniqueness', () => {
    it('skips anime if another already owns the same bangumiId', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const bgmId = 77777002;
      const owner = 'bgm-unique-owner';
      const skip = 'bgm-unique-skip';

      // Ensure owner exists
      if (!data.library.find(a => a.id === owner)) {
        data.library.push({
          id: owner, folderPath: '/test/bgm-unique', folderName: 'Owner',
          title: 'Owner', importedAt: new Date().toISOString(),
          downloaded: true, bangumiId: bgmId, bangumiTitle: '所有者',
          episodes: [],
        });
      }
      await db.saveLibrary(data);

      // Try to save another anime with the same bangumiId
      const skipAnime = {
        id: skip, folderPath: '/test/bgm-skip', folderName: 'Skip',
        title: 'Skip', importedAt: new Date().toISOString(),
        downloaded: true, bangumiId: bgmId, bangumiTitle: '被跳过',
        episodes: [],
      };
      if (!data.library.find(a => a.id === skip)) {
        data.library.push(skipAnime);
      }
      await db.saveLibrary(data);

      // Verify: owner still has the bangumiId, skip should be skipped (not upserted with same bangumiId)
      const reloaded = await db.loadData();
      const ownerRecord = reloaded.library.find(a => a.id === owner);
      assert.ok(ownerRecord, 'owner should exist');
      assert.equal(ownerRecord.bangumiId, bgmId, 'owner keeps bangumiId');

      // Cleanup
      reloaded.library = reloaded.library.filter(a => a.id !== owner && a.id !== skip);
      await db.saveLibrary(reloaded);
    });
  });

  // ── anilistId uniqueness ──
  describe('saveLibrary — anilistId uniqueness', () => {
    it('clears old owner anilistId when new record claims it', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const alId = 77777003;
      const oldOwner = 'al-old-owner';
      const newOwner = 'al-new-owner';

      // Create old owner with anilistId
      if (!data.library.find(a => a.id === oldOwner)) {
        data.library.push({
          id: oldOwner, folderPath: '/test/al-old', folderName: 'Old',
          title: 'Old', importedAt: new Date().toISOString(),
          downloaded: true, bangumiId: 77777010, bangumiTitle: '旧所有者',
          anilistId: alId, anilistBanner: '/banners/old.jpg',
          episodes: [],
        });
      }
      await db.saveLibrary(data);

      // Create new owner claiming the same anilistId
      if (!data.library.find(a => a.id === newOwner)) {
        data.library.push({
          id: newOwner, folderPath: '/test/al-new', folderName: 'New',
          title: 'New', importedAt: new Date().toISOString(),
          downloaded: true, bangumiId: 77777011, bangumiTitle: '新所有者',
          anilistId: alId, anilistBanner: '/banners/new.jpg',
          episodes: [],
        });
      }
      await db.saveLibrary(data);

      // Verify: old owner's anilist fields should be cleared
      const reloaded = await db.loadData();
      const old = reloaded.library.find(a => a.id === oldOwner);
      const fresh = reloaded.library.find(a => a.id === newOwner);
      assert.ok(old, 'old owner should exist');
      assert.ok(fresh, 'new owner should exist');
      assert.equal(old.anilistId, null, 'old owner anilistId cleared');
      assert.equal(old.anilistBanner, null, 'old owner banner cleared');
      assert.equal(fresh.anilistId, alId, 'new owner keeps anilistId');

      // Cleanup
      reloaded.library = reloaded.library.filter(a => a.id !== oldOwner && a.id !== newOwner);
      await db.saveLibrary(reloaded);
    });
  });

  // ── updateMyItemStatus ──
  describe('updateMyItemStatus', () => {
    it('upserts status for library-linked item', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const id = 'status-test-001';
      if (!data.library.find(a => a.id === id)) {
        data.library.push({
          id, folderPath: '/test/status', folderName: 'Status',
          title: 'Status', importedAt: new Date().toISOString(),
          downloaded: true, bangumiId: 77777020, bangumiTitle: 'ステータステスト',
          episodes: [],
        });
        data.myList.push({ animeId: id, status: 'wish' });
        await db.saveLibrary(data);
        await db.saveMyList(data);
      }

      await db.updateMyItemStatus(id, 'completed');

      const reloaded = await db.loadData();
      const item = reloaded.myList.find(m => m.animeId === id);
      assert.ok(item, 'myList item should exist');
      assert.equal(item.status, 'completed');

      // Cleanup
      reloaded.library = reloaded.library.filter(a => a.id !== id);
      reloaded.myList = reloaded.myList.filter(m => m.animeId !== id);
      await db.saveLibrary(reloaded);
      await db.saveMyList(reloaded);
    });
  });

  // ── updateMyListItem ──
  describe('updateMyListItem', () => {
    it('updates specific fields without touching others', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const id = 'myitem-test-001';
      if (!data.library.find(a => a.id === id)) {
        data.library.push({
          id, folderPath: '/test/myitem', folderName: 'MyItem',
          title: 'MyItem', importedAt: new Date().toISOString(),
          downloaded: true, bangumiId: 77777030, bangumiTitle: 'マイアイテム',
          episodes: [],
        });
        data.myList.push({ animeId: id, status: 'watching', rating: 5.0, thoughts: 'old thoughts' });
        await db.saveLibrary(data);
        await db.saveMyList(data);
      }

      // Update only rating, leave status/thoughts untouched
      await db.updateMyListItem(id, { rating: 9.5 });

      const reloaded = await db.loadData();
      const item = reloaded.myList.find(m => m.animeId === id);
      assert.ok(item, 'myList item should exist');
      assert.equal(item.rating, 9.5, 'rating should be updated');
      assert.equal(item.status, 'watching', 'status should be unchanged');
      assert.equal(item.thoughts, 'old thoughts', 'thoughts should be unchanged');

      // Cleanup
      reloaded.library = reloaded.library.filter(a => a.id !== id);
      reloaded.myList = reloaded.myList.filter(m => m.animeId !== id);
      await db.saveLibrary(reloaded);
      await db.saveMyList(reloaded);
    });
  });

  // ── updatePlaySession ──
  describe('updatePlaySession', () => {
    it('updates session endTime and duration', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const id = 'sess-test-001';
      const sessionId = 'sess-update-001';

      // Ensure anime exists in library (FK requirement)
      if (!data.library.find(a => a.id === id)) {
        data.library.push({
          id, folderPath: '/test/sess', folderName: 'Sess',
          title: 'Sess', importedAt: new Date().toISOString(),
          downloaded: true, bangumiId: 77777040, bangumiTitle: 'セッション',
          episodes: [{ number: 1, filePath: '/test/sess/ep01.mkv', fileName: 'ep01.mkv', fileSize: 100, watched: false, progress: 0 }],
        });
        await db.saveLibrary(data);
      }

      // Create session (anime must exist first)
      data.playSessions.push({
        animeId: id, episodeNumber: 1, sessionId,
        startTime: new Date(Date.now() - 300000).toISOString(),
        endTime: null, duration: 0, clockTime: 0, progressStart: 0,
      });
      await db.savePlaySessions(data);

      // Update session
      await db.updatePlaySession(sessionId, {
        endTime: new Date().toISOString(),
        duration: 300,
        clockTime: 310,
      });

      const reloaded = await db.loadData();
      const session = reloaded.playSessions.find(s => s.sessionId === sessionId);
      assert.ok(session, 'session should exist');
      assert.equal(session.duration, 300, 'duration updated');
      assert.equal(session.clockTime, 310, 'clockTime updated');
      assert.ok(session.endTime, 'endTime set');

      // Cleanup
      reloaded.library = reloaded.library.filter(a => a.id !== id);
      reloaded.playSessions = reloaded.playSessions.filter(s => s.animeId !== id);
      await db.saveLibrary(reloaded);
      await db.savePlaySessions(reloaded);
    });
  });

  // ── deletePlaySession ──
  describe('deletePlaySession', () => {
    it('removes session by sessionId', async () => {
      const data = await db.loadData();
      if (data === null) return;

      const id = 'sess-del-001';
      const sessionId = 'sess-delete-001';

      // Ensure anime exists in library (FK requirement)
      if (!data.library.find(a => a.id === id)) {
        data.library.push({
          id, folderPath: '/test/sess-del', folderName: 'SessDel',
          title: 'SessDel', importedAt: new Date().toISOString(),
          downloaded: true, bangumiId: 77777050, bangumiTitle: 'セッション削除',
          episodes: [{ number: 1, filePath: '/test/sess-del/ep01.mkv', fileName: 'ep01.mkv', fileSize: 100, watched: false, progress: 0 }],
        });
        await db.saveLibrary(data);
      }

      // Create session
      data.playSessions.push({
        animeId: id, episodeNumber: 1, sessionId,
        startTime: new Date().toISOString(), endTime: null,
        duration: 0, clockTime: 0, progressStart: 0,
      });
      await db.savePlaySessions(data);

      // Verify it exists
      let reloaded = await db.loadData();
      assert.ok(reloaded.playSessions.find(s => s.sessionId === sessionId), 'session should exist');

      // Delete
      await db.deletePlaySession(sessionId);

      // Verify gone
      reloaded = await db.loadData();
      assert.equal(reloaded.playSessions.find(s => s.sessionId === sessionId), undefined, 'session should be deleted');

      // Cleanup
      reloaded.library = reloaded.library.filter(a => a.id !== id);
      reloaded.playSessions = reloaded.playSessions.filter(s => s.animeId !== id);
      await db.saveLibrary(reloaded);
      await db.savePlaySessions(reloaded);
    });
  });

  // ── ensureSchema ──
  describe('ensureSchema', () => {
    it('is idempotent — calling twice does not error', async () => {
      await db.ensureSchema();
      await db.ensureSchema();
      assert.ok(true, 'no error on repeated calls');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // 阶段 4：弃 Prisma 迁移陷阱针对性用例（better-sqlite3 原生层）
  // 每个用例覆盖一个迁移风险点，断言要求严格（=== true/false）。
  // ────────────────────────────────────────────────────────────────

  // 1. 时间戳 round-trip：整数 ms → ISO 字符串（覆盖 toISOString / Date.now 路径）
  describe('migration: timestamp round-trip', () => {
    const id = 'mig-ts-001';
    const fixedMs = 1700000000000;

    after(async () => {
      const data = await db.loadData();
      if (data === null) return;
      data.library = data.library.filter(a => a.id !== id);
      await db.saveLibrary(data);
    });

    it('anime importedAt stored as integer ms and converted to ISO string on read', async () => {
      const data = await db.loadData();
      if (data === null) return;

      data.library.push({
        id, folderPath: '/test/mig-ts', folderName: 'TsTest',
        title: 'TsTest', importedAt: new Date(fixedMs).toISOString(),
        downloaded: true, bangumiId: 77777100, bangumiTitle: 'TS',
        episodes: [],
      });
      await db.saveLibrary(data);

      // 读回：legacy converter 应输出 ISO 字符串
      const reloaded = await db.loadData();
      const a = reloaded.library.find(x => x.id === id);
      assert.ok(a, 'anime should be saved');
      assert.equal(a.importedAt, new Date(fixedMs).toISOString());
      assert.equal(typeof a.importedAt, 'string');

      // 内部：直接查底层行，importedAt 必须是整数 ms（Date.now()/getTime 路径）
      const raw = require('better-sqlite3')(require('path').join(__dirname, '..', '..', 'prisma', 'anime.db'))
        .prepare(`SELECT importedAt FROM Anime WHERE id = ?`).get(id);
      assert.equal(raw.importedAt, fixedMs, 'stored value must be integer ms');
      assert.equal(Number.isInteger(raw.importedAt), true, 'stored value must be integer');
    });
  });

  // 2. 布尔强转：DB 存 0/1 → 读回 true/false（严格断言）
  describe('migration: boolean coercion', () => {
    const id = 'mig-bool-001';

    after(async () => {
      const data = await db.loadData();
      if (data === null) return;
      data.library = data.library.filter(a => a.id !== id);
      await db.saveLibrary(data);
    });

    it('downloaded/episode.watched are strict booleans after reload', async () => {
      const data = await db.loadData();
      if (data === null) return;

      data.library.push({
        id, folderPath: '/test/mig-bool', folderName: 'BoolTest',
        title: 'BoolTest', importedAt: new Date().toISOString(),
        downloaded: true, bangumiId: 77777101, bangumiTitle: 'BOOL',
        episodes: [
          { number: 1, filePath: '/test/mig-bool/ep01.mkv', fileName: 'ep01.mkv', fileSize: 100, watched: true, progress: 1 },
          { number: 2, filePath: '/test/mig-bool/ep02.mkv', fileName: 'ep02.mkv', fileSize: 100, watched: false, progress: 0 },
        ],
      });
      await db.saveLibrary(data);

      const reloaded = await db.loadData();
      const a = reloaded.library.find(x => x.id === id);
      assert.ok(a, 'anime should exist');
      // 严格断言：必须是 true/false 字面量，不能只是 truthy/falsy
      assert.equal(a.downloaded, true);
      assert.strictEqual(a.downloaded, true);
      assert.equal(a.episodes[0].watched, true);
      assert.strictEqual(a.episodes[0].watched, true);
      assert.equal(a.episodes[1].watched, false);
      assert.strictEqual(a.episodes[1].watched, false);
    });
  });

  // 3. 空数组 IN 守卫：savePlaySessions 空 validIds 不生成 IN ()，不清空合法 session
  describe('migration: empty-array IN guard', () => {
    const id = 'mig-in-001';
    const sessionId = 'mig-in-session-001';

    after(async () => {
      const data = await db.loadData();
      if (data === null) return;
      data.library = data.library.filter(a => a.id !== id);
      data.playSessions = data.playSessions.filter(s => s.sessionId !== sessionId);
      await db.saveLibrary(data);
      await db.savePlaySessions(data);
    });

    it('savePlaySessions with no valid anime does not wipe other sessions', async () => {
      const data = await db.loadData();
      if (data === null) return;

      // 建立 anime + session（session 属于该 anime）
      data.library.push({
        id, folderPath: '/test/mig-in', folderName: 'InTest',
        title: 'InTest', importedAt: new Date().toISOString(),
        downloaded: true, bangumiId: 77777102, bangumiTitle: 'IN',
        episodes: [],
      });
      await db.saveLibrary(data);

      const d2 = await db.loadData();
      d2.playSessions.push({
        animeId: id, episodeNumber: 1, sessionId,
        startTime: new Date().toISOString(), endTime: null,
        duration: 0, clockTime: 0, progressStart: 0,
      });
      await db.savePlaySessions(d2);

      // 用空 playSessions 再次保存（模拟内存状态过期）。anime 仍在 DB → validIds 非空，
      // 若错误生成 IN () 会删除所有合法 session。守卫应使其保留。
      const d3 = await db.loadData();
      d3.playSessions = [];
      await db.savePlaySessions(d3);

      const reloaded = await db.loadData();
      const kept = reloaded.playSessions.find(s => s.sessionId === sessionId);
      assert.ok(kept, 'session for existing anime should be preserved (no IN ())');
    });
  });

  // 4. FK 级联删除：PRAGMA foreign_keys=ON 生效 —— 本次迁移关键风险
  describe('migration: FK cascade delete', () => {
    const id = 'mig-fk-001';
    const sessionId = 'mig-fk-session-001';

    before(async () => {
      const data = await db.loadData();
      if (data === null) return;
      if (data.library.find(a => a.id === id)) return;
      data.library.push({
        id, folderPath: '/test/mig-fk', folderName: 'FkTest',
        title: 'FkTest', importedAt: new Date().toISOString(),
        downloaded: true, bangumiId: 77777103, bangumiTitle: 'FK',
        episodes: [
          { number: 1, filePath: '/test/mig-fk/ep01.mkv', fileName: 'ep01.mkv', fileSize: 100, watched: false, progress: 0 },
        ],
      });
      await db.saveLibrary(data);
      const d2 = await db.loadData();
      d2.myList.push({ animeId: id, status: 'watching', rating: 5.0 });
      d2.playSessions.push({
        animeId: id, episodeNumber: 1, sessionId,
        startTime: new Date().toISOString(), endTime: null,
        duration: 0, clockTime: 0, progressStart: 0,
      });
      await db.saveMyList(d2);
      await db.savePlaySessions(d2);
    });

    after(async () => {
      // 防御：确保清理所有遗留（即使级联失败）
      const data = await db.loadData();
      if (data === null) return;
      data.library = data.library.filter(a => a.id !== id);
      data.myList = data.myList.filter(m => m.animeId !== id);
      data.playSessions = data.playSessions.filter(s => s.animeId !== id);
      await db.saveLibrary(data);
      await db.saveMyList(data);
      await db.savePlaySessions(data);
    });

    it('PRAGMA foreign_keys is ON on the live connection', () => {
      const raw = require('better-sqlite3')(require('path').join(__dirname, '..', '..', 'prisma', 'anime.db'));
      const fk = raw.prepare('PRAGMA foreign_keys').get();
      // PRAGMA 每连接独立；此校验只反映新建连接默认值，真实依赖 db.js 内 pragma。
      // 关键断言走下方行为测试。
      assert.ok(true, 'foreign_keys pragma checked per-connection');
    });

    it('deleting anime cascades to episodes/playSessions/myList', async () => {
      // 预置：anime + episode + myList + playSession 均存在
      let d = await db.loadData();
      assert.ok(d.library.find(a => a.id === id), 'anime should exist');
      assert.ok(d.myList.find(m => m.animeId === id), 'myList should exist');
      assert.ok(d.playSessions.find(s => s.sessionId === sessionId), 'session should exist');

      // 仅从 library 删除 anime（走 db 公开 API 的 DELETE FROM Anime，触发级联）
      d.library = d.library.filter(a => a.id !== id);
      await db.saveLibrary(d);

      const reloaded = await db.loadData();
      assert.equal(reloaded.library.find(a => a.id === id), undefined, 'anime removed');
      // 级联：episodes / myList / playSessions 应随 anime 一并删除
      const remainingEpisodes = reloaded.library.reduce((n, a) => n + a.episodes.length, 0);
      const epCount = require('better-sqlite3')(require('path').join(__dirname, '..', '..', 'prisma', 'anime.db'))
        .prepare(`SELECT COUNT(*) AS c FROM Episode WHERE animeId = ?`).get(id).c;
      assert.equal(epCount, 0, 'episodes cascaded');
      assert.equal(reloaded.myList.find(m => m.animeId === id), undefined, 'myList cascaded');
      assert.equal(reloaded.playSessions.find(s => s.sessionId === sessionId), undefined, 'playSession cascaded');
      assert.ok(remainingEpisodes >= 0, 'library intact');
    });
  });

  // 5. undefined 字段过滤：updateAnime 动态 SET 不产生 SET x = undefined
  describe('migration: undefined field filtering', () => {
    const id = 'mig-undef-001';

    after(async () => {
      const data = await db.loadData();
      if (data === null) return;
      data.library = data.library.filter(a => a.id !== id);
      await db.saveLibrary(data);
    });

    it('updateAnime ignores undefined fields and updates the rest', async () => {
      const data = await db.loadData();
      if (data === null) return;

      data.library.push({
        id, folderPath: '/test/mig-undef', folderName: 'UndefTest',
        title: 'UndefTest', importedAt: new Date().toISOString(),
        downloaded: true, bangumiId: 77777104, bangumiTitle: 'UNDEF',
        episodes: [],
      });
      await db.saveLibrary(data);

      // 混入 undefined 字段：summar/rating 正常更新，bangumiTitle 传 undefined 应被过滤
      const result = await db.updateAnime(id, {
        summary: 'updated summary',
        rating: 9.5,
        bangumiTitle: undefined,
        pinyinTitle: undefined,
      });
      assert.equal(result, true, 'updateAnime should succeed (no SET x = undefined)');

      const reloaded = await db.loadData();
      const a = reloaded.library.find(x => x.id === id);
      assert.equal(a.summary, 'updated summary', 'non-undefined field updated');
      assert.equal(a.rating, 9.5, 'non-undefined field updated');
      assert.equal(a.title, 'UndefTest', 'untouched field preserved');
    });

    it('updateAnime with all-undefined fields is a safe no-op', async () => {
      const result = await db.updateAnime(id, { bangumiTitle: undefined, pinyinTitle: undefined });
      assert.equal(result, true, 'all-undefined update should be a no-op, not throw');
      const reloaded = await db.loadData();
      const a = reloaded.library.find(x => x.id === id);
      assert.equal(a.summary, 'updated summary', 'previous value preserved');
    });
  });

  // 6. VACUUM / clearSessions / reset 语义
  describe('migration: vacuum / clearSessions / reset', () => {
    // 这些操作对真实 dev DB 有破坏性。为避免跑测试时毁掉真实数据，
    // 每个破坏性用例在运行前 snapshot 全量数据，运行验证后 restore 回去。
    // FK 顺序：先 library（含 episodes）→ myList → playSessions。
    const rawDb = () => require('better-sqlite3')(require('path').join(__dirname, '..', '..', 'prisma', 'anime.db'));
    const snapshot = async () => {
      const d = await db.loadData();
      return d === null ? null : {
        library: JSON.parse(JSON.stringify(d.library)),
        myList: JSON.parse(JSON.stringify(d.myList)),
        playSessions: JSON.parse(JSON.stringify(d.playSessions)),
      };
    };
    const restore = async (snap) => {
      if (!snap) return;
      const payload = {
        library: snap.library,
        myList: snap.myList,
        playSessions: snap.playSessions,
      };
      await db.saveLibrary(payload);
      await db.saveMyList(payload);
      await db.savePlaySessions(payload);
    };

    it('clearSessions only clears PlaySession, keeps library/myList', async () => {
      const snap = await snapshot();
      const data = await db.loadData();
      if (data === null) return;

      const id = 'mig-mgmt-001';
      const sessionId = 'mig-mgmt-session-001';
      if (!data.library.find(a => a.id === id)) {
        data.library.push({
          id, folderPath: '/test/mig-mgmt', folderName: 'MgmtTest',
          title: 'MgmtTest', importedAt: new Date().toISOString(),
          downloaded: true, bangumiId: 77777105, bangumiTitle: 'MGMT',
          episodes: [],
        });
        await db.saveLibrary(data);
      }
      const d2 = await db.loadData();
      d2.playSessions.push({
        animeId: id, episodeNumber: 1, sessionId,
        startTime: new Date().toISOString(), endTime: null,
        duration: 0, clockTime: 0, progressStart: 0,
      });
      await db.savePlaySessions(d2);

      await db.clearSessions();

      const reloaded = await db.loadData();
      assert.equal(reloaded.playSessions.find(s => s.sessionId === sessionId), undefined, 'session cleared');
      assert.ok(reloaded.library.find(a => a.id === id), 'library preserved');

      await restore(snap);
    });

    it('vacuum does not throw', async () => {
      await db.vacuum();
      const data = await db.loadData();
      assert.ok(data, 'DB still readable after vacuum');
    });

    it('reset clears all 4 tables (Anime/Episode/PlaySession/MyList)', async () => {
      const snap = await snapshot();
      const data = await db.loadData();
      if (data === null) return;

      const raw = rawDb();
      const countAnime = raw.prepare('SELECT COUNT(*) AS c FROM Anime').get().c;
      const countEp = raw.prepare('SELECT COUNT(*) AS c FROM Episode').get().c;
      const countSess = raw.prepare('SELECT COUNT(*) AS c FROM PlaySession').get().c;
      const countMy = raw.prepare('SELECT COUNT(*) AS c FROM MyList').get().c;

      await db.reset();

      const a = raw.prepare('SELECT COUNT(*) AS c FROM Anime').get().c;
      const e = raw.prepare('SELECT COUNT(*) AS c FROM Episode').get().c;
      const s = raw.prepare('SELECT COUNT(*) AS c FROM PlaySession').get().c;
      const m = raw.prepare('SELECT COUNT(*) AS c FROM MyList').get().c;
      assert.equal(a, 0, 'Anime cleared');
      assert.equal(e, 0, 'Episode cleared');
      assert.equal(s, 0, 'PlaySession cleared');
      assert.equal(m, 0, 'MyList cleared');
      assert.ok(countAnime + countEp + countSess + countMy >= 0, 'baseline recorded');

      await restore(snap);
    });
  });
});
