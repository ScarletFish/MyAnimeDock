const { describe, it, before, after } = require('node:test');
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
});
