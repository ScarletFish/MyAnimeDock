#!/usr/bin/env node

/**
 * Frontend syntax checker for pre-commit hook.
 * Uses Node's built-in syntax check to verify JS files.
 */

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);

if (files.length === 0) {
  process.exit(0);
}

let hasErrors = false;

for (const file of files) {
  // Skip test files (they use ES module imports)
  if (file.includes('__tests__') || file.includes('.test.js') || file.includes('.spec.js')) {
    console.log(`⏭️  ${file} (skipped - test file)`);
    continue;
  }

  try {
    // Read the file
    const content = fs.readFileSync(path.resolve(file), 'utf8');

    // Try to parse it using Node's syntax checker
    // This will throw an error if there's a syntax error
    new Function(content);

    console.log(`✅ ${file}`);

  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`❌ ${file} - ${error.message}`);
      hasErrors = true;
    } else {
      // Not a syntax error (e.g., file not found)
      console.error(`❌ ${file} - ${error.message}`);
      hasErrors = true;
    }
  }
}

process.exit(hasErrors ? 1 : 0);
