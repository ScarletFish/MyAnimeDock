/**
 * Snapshot testing utilities for regression tests.
 * No external dependencies - uses only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const SNAPSHOTS_DIR = path.join(__dirname, '..', 'snapshots');

/**
 * Assert that actual value matches a stored snapshot.
 * 
 * Usage:
 *   const { assertSnapshot } = require('./helpers/snapshot');
 *   assertSnapshot({ key: 'value' }, 'my-test-snapshot.json');
 * 
 * To update snapshots:
 *   UPDATE_SNAPSHOTS=1 node --test __tests__/*.test.js
 * 
 * @param {*} actual - The value to compare
 * @param {string} snapshotPath - Relative path within snapshots directory
 * @param {Object} options - Optional settings
 * @param {boolean} options.sortKeys - Sort object keys before comparison (default: true)
 */
function assertSnapshot(actual, snapshotPath, options = {}) {
  const { sortKeys = true } = options;
  const fullPath = path.join(SNAPSHOTS_DIR, snapshotPath);
  
  // Normalize the actual value
  let normalized = actual;
  if (sortKeys && typeof actual === 'object' && actual !== null) {
    normalized = sortObjectKeys(actual);
  }
  
  const actualJson = JSON.stringify(normalized, null, 2);
  
  // Update mode
  if (process.env.UPDATE_SNAPSHOTS) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, actualJson + '\n');
    console.log(`📸 Snapshot updated: ${snapshotPath}`);
    return;
  }
  
  // Compare mode
  if (!fs.existsSync(fullPath)) {
    // First run - create the snapshot
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, actualJson + '\n');
    console.log(`📸 Snapshot created: ${snapshotPath}`);
    return;
  }
  
  const expectedJson = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n').trim();

  try {
    assert.equal(actualJson.trim(), expectedJson);
  } catch (error) {
    const errorMsg = `\n📸 Snapshot mismatch: ${snapshotPath}\n\n` +
      `Expected:\n${expectedJson}\n\n` +
      `Actual:\n${actualJson}\n\n` +
      `To update: UPDATE_SNAPSHOTS=1 node --test __tests__/*.test.js`;
    throw new Error(errorMsg);
  }
}

/**
 * Sort object keys recursively for stable comparison.
 */
function sortObjectKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = sortObjectKeys(obj[key]);
        return sorted;
      }, {});
  }
  
  return obj;
}

/**
 * Create a snapshot file from data (useful for one-time setup).
 * 
 * @param {*} data - Data to snapshot
 * @param {string} snapshotPath - Relative path within snapshots directory
 */
function createSnapshot(data, snapshotPath) {
  const fullPath = path.join(SNAPSHOTS_DIR, snapshotPath);
  const normalized = typeof data === 'object' ? sortObjectKeys(data) : data;
  const json = JSON.stringify(normalized, null, 2);
  
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, json + '\n');
  console.log(`📸 Snapshot created: ${snapshotPath}`);
}

/**
 * Delete a snapshot file.
 * 
 * @param {string} snapshotPath - Relative path within snapshots directory
 */
function deleteSnapshot(snapshotPath) {
  const fullPath = path.join(SNAPSHOTS_DIR, snapshotPath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    console.log(`🗑️  Snapshot deleted: ${snapshotPath}`);
  }
}

/**
 * List all snapshot files.
 * 
 * @returns {string[]} Array of relative snapshot paths
 */
function listSnapshots() {
  const results = [];
  
  function walkDir(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        walkDir(fullPath, relPath);
      } else if (entry.name.endsWith('.json')) {
        results.push(relPath);
      }
    }
  }
  
  if (fs.existsSync(SNAPSHOTS_DIR)) {
    walkDir(SNAPSHOTS_DIR);
  }
  
  return results;
}

module.exports = {
  assertSnapshot,
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  SNAPSHOTS_DIR
};
