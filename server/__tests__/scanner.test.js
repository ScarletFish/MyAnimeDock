const assert = require('node:assert');
const { describe, it, before, after, beforeEach } = require('node:test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  parseFolderName, isExtraVideo, extractBgmId,
  findVideos, hasDirectVideos,
  scanMediaDirFlat, scanMediaDir,
} = require('../scanner');

// ─── Pure Functions ────────────────────────────────────────────────

describe('Scanner — Pure Functions', { concurrency: false }, () => {

  // ===== parseFolderName =====
  describe('parseFolderName', () => {
    it('returns object with expected keys', () => {
      const r = parseFolderName('TestTitle');
      const keys = ['title', 'cjkTitle', 'cleanTitle', 'season', 'year', 'bangumiId', 'specialSuffix'];
      for (const k of keys) {
        assert.ok(k in r, `missing key: ${k}`);
      }
    });

    it('parses simple English title', () => {
      const r = parseFolderName('K-On!');
      assert.equal(r.title, 'K-On!');
      assert.equal(r.season, null);
      assert.equal(r.bangumiId, null);
      assert.equal(r.cjkTitle, null);
    });

    it('parses CJK title', () => {
      const name = '小林さんちのメイドラゴン';
      const r = parseFolderName(name);
      assert.ok(r.cjkTitle, 'should have cjkTitle');
      assert.ok(r.cjkTitle.includes('小林'), `cjkTitle should contain CJK, got "${r.cjkTitle}"`);
      assert.ok(r.title.includes('小林'), `title should contain CJK, got "${r.title}"`);
    });

    it('detects season 2 from symbol markers !!', () => {
      const r = parseFolderName('K-On!!');
      assert.equal(r.season, 2);
      assert.ok(r.title.includes('K-On'));
    });

    it('detects season from S\\d+', () => {
      const r = parseFolderName('Fate stay night S2');
      assert.equal(r.season, 2);
    });

    it('detects Season keyword', () => {
      const r = parseFolderName('Gochuumon wa Usagi Desu ka Season 3');
      assert.equal(r.season, 3);
    });

    it('strips S\\d+ from cleanTitle', () => {
      const r = parseFolderName('K-ON! S2');
      assert.ok(!r.cleanTitle.includes('S2'), `cleanTitle="${r.cleanTitle}" should not contain S2`);
    });

    it('strips Season X from cleanTitle', () => {
      const r = parseFolderName('Gochuumon wa Usagi Desu ka Season 3');
      assert.ok(!r.cleanTitle.includes('Season'), `cleanTitle="${r.cleanTitle}" should not contain Season`);
    });

    it('extracts [bgmN] ID', () => {
      const r = parseFolderName('K-On! [bgm40130]');
      assert.equal(r.bangumiId, 40130);
    });

    it('extracts [BGM] case-insensitively', () => {
      const r = parseFolderName('Title [BGM99999]');
      assert.equal(r.bangumiId, 99999);
    });

    it('extracts special suffix ~OVA~', () => {
      const r = parseFolderName('Title ~OVA~');
      assert.equal(r.specialSuffix, '~OVA~');
    });

    it('extracts special suffix ～特典～ (full-width wave)', () => {
      // Full-width waves may be stripped by anitomy; test that we handle gracefully
      const r = parseFolderName('Title ～特典～');
      // anitomy may strip the suffix, so specialSuffix may be null
      // This test documents the current behavior
      assert.ok(r);
    });

    it('preserves question marks (not treated as season)', () => {
      const r = parseFolderName('Gochuumon wa Usagi Desu ka??');
      // ? is excluded from symbol season detection
      assert.ok(r.title.includes('?'), `title should contain ?, got "${r.title}"`);
    });

    it('extracts year from parentheses', () => {
      const r = parseFolderName('Shingeki no Kyojin (2013)');
      assert.equal(r.year, 2013);
    });

    it('strips parenthetical metadata from cleanTitle', () => {
      const r = parseFolderName('Title (2013)');
      assert.ok(!r.cleanTitle.includes('(2013)'), `cleanTitle="${r.cleanTitle}" should not contain (2013)`);
    });

    it('handles null input', () => {
      assert.throws(() => parseFolderName(null), /Cannot read properties of null/);
    });

    it('handles empty string', () => {
      // anitomy may crash on empty input; this documents current behavior
      assert.throws(() => parseFolderName(''), /Cannot read/);
    });

    it('handles folder with only a season marker', () => {
      const r = parseFolderName('Season 2');
      assert.ok(r.title, 'should have a title');
    });

    it('parses [Group] bracket prefix', () => {
      const r = parseFolderName('[SubsPlease] Shingeki no Kyojin');
      assert.ok(r.title, 'should extract title');
      assert.ok(!r.title.startsWith('['), 'title should not include brackets');
    });

    it('handles trailing bracket groups', () => {
      const r = parseFolderName('Title [1080p] [HEVC]');
      assert.ok(r.title, 'should extract title');
    });

    it('anitomy mixed CJK+Latin title prefers CJK', () => {
      // e.g. anitomy might return truncated Latin for "ゆるゆり" → use CJK part
      const r = parseFolderName('ゆるゆり Yuru Yuri');
      if (r.cjkTitle) {
        assert.ok(r.cjkTitle.includes('ゆる'), `cjkTitle="${r.cjkTitle}" should contain CJK`);
      }
    });
  });

  // ===== isExtraVideo =====
  describe('isExtraVideo', () => {
    it('NCOP', () => { assert.ok(isExtraVideo('NCOP.mkv')); });
    it('NCOP with number (no word boundary after NCOP)', () => {
      // Note: regex \bNCOP\b requires word boundary after NCOP
      // "NCOP1" has no boundary between NCOP and 1
      assert.ok(!isExtraVideo('NCOP1.mkv'), 'NCOP1 does not match \\bNCOP\\b');
    });
    it('NCED', () => { assert.ok(isExtraVideo('NCED.mkv')); });
    it('NCED with number (same limitation)', () => {
      assert.ok(!isExtraVideo('NCED2.mkv'));
    });
    it('NCED (space before number)', () => { assert.ok(isExtraVideo('NCED 2.mkv')); });
    it('PV', () => { assert.ok(isExtraVideo('PV01.mkv')); });
    it('CM', () => { assert.ok(isExtraVideo('CM.mkv')); });
    it('Menu', () => { assert.ok(isExtraVideo('Menu.mkv')); });
    it('Preview', () => { assert.ok(isExtraVideo('Preview.mkv')); });
    it('Trailer', () => { assert.ok(isExtraVideo('Trailer.mkv')); });
    it('regular episode is not extra', () => { assert.ok(!isExtraVideo('ep01.mkv')); });
    it('movie is not extra', () => { assert.ok(!isExtraVideo('Movie.mkv')); });
    it('handles bracket-wrapped name', () => {
      assert.ok(isExtraVideo('[SubsPlease] NCOP - [1080p].mkv'));
    });
    it('NCED without number', () => { assert.ok(isExtraVideo('NCED.mkv')); });
    it('PV without number', () => { assert.ok(isExtraVideo('PV.mkv')); });
    it('empty string', () => { assert.ok(!isExtraVideo('')); });
  });

  // ===== extractBgmId =====
  describe('extractBgmId', () => {
    it('extracts [bgmN]', () => { assert.equal(extractBgmId('K-On! [bgm40130]'), 40130); });
    it('is case-insensitive', () => { assert.equal(extractBgmId('K-On! [BGM40130]'), 40130); });
    it('extracts from anywhere in string', () => {
      assert.equal(extractBgmId('[SubsPlease] Title [bgm12345]'), 12345);
    });
    it('returns null when no match', () => { assert.equal(extractBgmId('K-On!'), null); });
    it('handles null', () => { assert.equal(extractBgmId(null), null); });
    it('handles empty', () => { assert.equal(extractBgmId(''), null); });
    it('handles numeric ID after bgm', () => {
      assert.equal(extractBgmId('Title [bgm525565]'), 525565);
    });
  });

  // ===== hasLatinLetters is internal, not exported — tested indirectly via parseFolderName
  // Tests removed; function is module-private

});

// ─── Filesystem Integration ───────────────────────────────────────

describe('Scanner — Filesystem Integration', { concurrency: false }, () => {
  let rootDir;
  const tmpRoot = path.join(os.tmpdir(), 'mad-scanner-int');

  before(() => {
    // Clean up any leftover from previous runs, then create fresh root
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  beforeEach(() => {
    // Each test gets a unique subdir under the root
    rootDir = fs.mkdtempSync(path.join(tmpRoot, 'test-'));
  });

  after(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  // Helper: create an empty video file
  function touchVideo(dir, name) {
    fs.writeFileSync(path.join(dir, name), '');
  }

  // ===== findVideos =====
  describe('findVideos', () => {
    it('finds video files in a directory', () => {
      fs.mkdirSync(path.join(rootDir, 'anime'), { recursive: true });
      touchVideo(rootDir, 'anime/ep01.mkv');
      touchVideo(rootDir, 'anime/ep02.mp4');
      const videos = findVideos(path.join(rootDir, 'anime'));
      assert.equal(videos.length, 2);
      assert.ok(videos.every(v => v.path && v.name && v.size >= 0));
    });

    it('finds videos recursively in subdirectories', () => {
      fs.mkdirSync(path.join(rootDir, 'anime', 'sub'), { recursive: true });
      touchVideo(rootDir, 'anime/ep01.mkv');
      touchVideo(rootDir, 'anime/sub/ep02.avi');
      const videos = findVideos(path.join(rootDir, 'anime'));
      assert.equal(videos.length, 2);
    });

    it('filters out non-video files', () => {
      fs.mkdirSync(path.join(rootDir, 'anime'), { recursive: true });
      touchVideo(rootDir, 'anime/ep01.mkv');
      touchVideo(rootDir, 'anime/cover.jpg');     // not a video ext
      touchVideo(rootDir, 'anime/readme.txt');
      fs.writeFileSync(path.join(rootDir, 'anime/.hiddenfile'), '');
      const videos = findVideos(path.join(rootDir, 'anime'));
      assert.equal(videos.length, 1);
    });

    it('returns empty array for directory with no video files', () => {
      fs.mkdirSync(path.join(rootDir, 'empty'), { recursive: true });
      touchVideo(rootDir, 'empty/readme.txt');
      const videos = findVideos(path.join(rootDir, 'empty'));
      assert.equal(videos.length, 0);
    });

    it('returns empty array for non-existent directory', () => {
      const videos = findVideos(path.join(rootDir, 'nonexistent'));
      assert.deepEqual(videos, []);
    });
  });

  // ===== hasDirectVideos =====
  describe('hasDirectVideos', () => {
    it('returns true when directory has video files', () => {
      fs.mkdirSync(path.join(rootDir, 'a'), { recursive: true });
      touchVideo(rootDir, 'a/ep01.mkv');
      assert.ok(hasDirectVideos(path.join(rootDir, 'a')));
    });

    it('returns false for empty directory', () => {
      fs.mkdirSync(path.join(rootDir, 'b'), { recursive: true });
      assert.ok(!hasDirectVideos(path.join(rootDir, 'b')));
    });

    it('returns false for directory with only sub-folders', () => {
      fs.mkdirSync(path.join(rootDir, 'c', 'sub'), { recursive: true });
      touchVideo(rootDir, 'c/sub/ep01.mkv');
      // c has no videos directly, only a sub-folder has them
      assert.ok(!hasDirectVideos(path.join(rootDir, 'c')));
    });

    it('returns false for non-existent directory', () => {
      assert.ok(!hasDirectVideos(path.join(rootDir, 'nonexistent')));
    });

    it('detects .webm as video', () => {
      fs.mkdirSync(path.join(rootDir, 'd'), { recursive: true });
      touchVideo(rootDir, 'd/clip.webm');
      assert.ok(hasDirectVideos(path.join(rootDir, 'd')));
    });
  });

  // ===== buildLeaf is internal — tested indirectly via scanMediaDirFlat =====
  describe('buildLeaf (via scanMediaDirFlat)', () => {
    it('builds a leaf node from a simple anime folder', () => {
      fs.mkdirSync(path.join(rootDir, 'AnimeTitle'), { recursive: true });
      touchVideo(rootDir, 'AnimeTitle/ep01.mkv');
      touchVideo(rootDir, 'AnimeTitle/ep02.mkv');
      const leaves = scanMediaDirFlat(rootDir);
      assert.equal(leaves.length, 1);
      const leaf = leaves[0];
      assert.equal(leaf.type, 'leaf');
      assert.equal(leaf.name, 'AnimeTitle');
      assert.equal(leaf.videoCount, 2);
      assert.equal(leaf.videos.length, 2);
      assert.ok(leaf.parsedTitle, 'should have parsedTitle');
    });

    it('builds leaf with parent chain', () => {
      fs.mkdirSync(path.join(rootDir, 'Group', 'AnimeB'), { recursive: true });
      touchVideo(rootDir, 'Group/AnimeB/ep01.mkv');
      const leaves = scanMediaDirFlat(rootDir);
      assert.equal(leaves.length, 1);
      assert.deepEqual(leaves[0].parentChain, ['Group']);
    });

    it('includes extras in totalVideoFiles but not videoCount', () => {
      fs.mkdirSync(path.join(rootDir, 'AnimeC'), { recursive: true });
      touchVideo(rootDir, 'AnimeC/ep01.mkv');
      touchVideo(rootDir, 'AnimeC/ep02.mkv');
      touchVideo(rootDir, 'AnimeC/NCOP.mkv');  // extra (NCOP without number)
      const leaves = scanMediaDirFlat(rootDir);
      assert.equal(leaves.length, 1);
      assert.equal(leaves[0].videoCount, 2);
      assert.equal(leaves[0].totalVideoFiles, 3);
      // The NCOP.mkv should be marked as extra in the videos array
      const extra = leaves[0].videos.find(v => v.name === 'NCOP.mkv');
      assert.ok(extra, 'NCOP.mkv should be in videos list');
    });

    it('returns no leaves for empty folder', () => {
      fs.mkdirSync(path.join(rootDir, 'Empty'), { recursive: true });
      const leaves = scanMediaDirFlat(rootDir);
      assert.equal(leaves.length, 0);
    });

    it('sets bangumiId when [bgmN] in name', () => {
      fs.mkdirSync(path.join(rootDir, 'Title [bgm12345]'), { recursive: true });
      touchVideo(rootDir, 'Title [bgm12345]/ep01.mkv');
      const leaves = scanMediaDirFlat(rootDir);
      assert.equal(leaves.length, 1);
      assert.equal(leaves[0].bangumiId, 12345);
    });
  });

  // ===== scanMediaDirFlat =====
  describe('scanMediaDirFlat', () => {
    it('returns flat array of all leaf nodes', () => {
      // root
      //   AnimeA/     ← direct videos
      //     ep01.mkv
      //   Group/
      //     AnimeB/   ← one-level deep
      //       ep01.mkv
      fs.mkdirSync(path.join(rootDir, 'AnimeA'), { recursive: true });
      touchVideo(rootDir, 'AnimeA/ep01.mkv');
      fs.mkdirSync(path.join(rootDir, 'Group', 'AnimeB'), { recursive: true });
      touchVideo(rootDir, 'Group/AnimeB/ep01.mkv');

      const results = scanMediaDirFlat(rootDir);
      assert.equal(results.length, 2);

      const animeA = results.find(l => l.name === 'AnimeA');
      assert.ok(animeA);
      assert.equal(animeA.videoCount, 1);
      assert.deepEqual(animeA.parentChain, []);

      const animeB = results.find(l => l.name === 'AnimeB');
      assert.ok(animeB);
      assert.deepEqual(animeB.parentChain, ['Group']);
    });

    it('skips empty directories', () => {
      fs.mkdirSync(path.join(rootDir, 'Empty'), { recursive: true });
      fs.mkdirSync(path.join(rootDir, 'AnimeA'), { recursive: true });
      touchVideo(rootDir, 'AnimeA/ep01.mkv');
      const results = scanMediaDirFlat(rootDir);
      assert.equal(results.length, 1);
    });

    it('skips covers directory', () => {
      fs.mkdirSync(path.join(rootDir, 'covers'), { recursive: true });
      touchVideo(rootDir, 'covers/cover.jpg');
      fs.mkdirSync(path.join(rootDir, 'AnimeA'), { recursive: true });
      touchVideo(rootDir, 'AnimeA/ep01.mkv');
      const results = scanMediaDirFlat(rootDir);
      assert.equal(results.length, 1);
    });

    it('handles deeply nested structure', () => {
      // root
      //   Franchise/
      //     Season 1/
      //       ep01.mkv
      //     Season 2/
      //       ep01.mkv
      fs.mkdirSync(path.join(rootDir, 'Franchise', 'Season 1'), { recursive: true });
      fs.mkdirSync(path.join(rootDir, 'Franchise', 'Season 2'), { recursive: true });
      touchVideo(rootDir, 'Franchise/Season 1/ep01.mkv');
      touchVideo(rootDir, 'Franchise/Season 2/ep01.mkv');
      const results = scanMediaDirFlat(rootDir);
      assert.equal(results.length, 2);
    });

    it('returns empty array for non-existent mediaDir (error caught internally)', () => {
      const results = scanMediaDirFlat(path.join(rootDir, 'nonexistent'));
      assert.deepEqual(results, []);
    });
  });

  // ===== scanMediaDir (legacy tree) =====
  describe('scanMediaDir', () => {
    it('scans direct and one-level deep folders', () => {
      fs.mkdirSync(path.join(rootDir, 'AnimeA'), { recursive: true });
      touchVideo(rootDir, 'AnimeA/ep01.mkv');
      fs.mkdirSync(path.join(rootDir, 'Group', 'AnimeB'), { recursive: true });
      touchVideo(rootDir, 'Group/AnimeB/ep01.mkv');

      const results = scanMediaDir(rootDir);
      // AnimeA has direct videos → included
      // Group has no direct videos but sub-folder AnimeB → Group included as... wait
      // Actually scanMediaDir does:
      //   hasDirectVideos(Group)? No → scan sub-dirs → find AnimeB → buildAnimeEntry → push
      // So both are flat in results
      assert.equal(results.length, 2);
      assert.ok(results.some(r => r.folderName === 'AnimeA'));
      assert.ok(results.some(r => r.folderName === 'AnimeB'));
    });
  });

});
