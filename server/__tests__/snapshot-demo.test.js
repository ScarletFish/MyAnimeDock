/**
 * Example snapshot tests demonstrating the snapshot testing framework.
 * Run with: node --test __tests__/snapshot-demo.test.js
 * 
 * To update snapshots:
 *   UPDATE_SNAPSHOTS=1 node --test __tests__/snapshot-demo.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { assertSnapshot, listSnapshots } = require('./helpers/snapshot');
const { extractBgmId, parseFolderName } = require('../scanner');

describe('Snapshot Tests Demo', () => {
  
  describe('extractBgmId snapshots', () => {
    it('should match snapshot for valid bgm tag', () => {
      const result = extractBgmId('[bgm12345] 动漫标题');
      assertSnapshot(result, 'scanner/extractBgmId-valid.json');
    });
    
    it('should match snapshot for no bgm tag', () => {
      const result = extractBgmId('普通标题');
      assertSnapshot(result, 'scanner/extractBgmId-none.json');
    });
    
    it('should match snapshot for null input', () => {
      const result = extractBgmId(null);
      assertSnapshot(result, 'scanner/extractBgmId-null.json');
    });
  });
  
  describe('parseFolderName snapshots', () => {
    it('should match snapshot for typical anime folder', () => {
      const result = parseFolderName('[bgm12345] 动漫标题 S01');
      assertSnapshot(result, 'scanner/parseFolderName-typical.json', { sortKeys: false });
    });
    
    it('should match snapshot for empty input', () => {
      try {
        const result = parseFolderName('');
        assertSnapshot(result, 'scanner/parseFolderName-empty.json', { sortKeys: false });
      } catch (e) {
        // parseFolderName may throw on empty input - snapshot the error
        assertSnapshot({ error: e.message }, 'scanner/parseFolderName-empty.json');
      }
    });
  });
  
  describe('Snapshot utilities', () => {
    it('should list existing snapshots', () => {
      const snapshots = listSnapshots();
      assert.ok(Array.isArray(snapshots));
      // Don't assert specific count - snapshots may not exist yet
    });
  });
});
