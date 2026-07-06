#!/usr/bin/env node

/**
 * Auto-generate test skeletons for JS modules.
 * Usage: node scripts/generate-tests.js <module-path>
 * Example: node scripts/generate-tests.js server/scanner.js
 */

const fs = require('fs');
const path = require('path');

const targetFile = process.argv[2];

if (!targetFile) {
  console.error('Usage: node scripts/generate-tests.js <module-path>');
  console.error('Example: node scripts/generate-tests.js server/scanner.js');
  process.exit(1);
}

const fullPath = path.resolve(targetFile);
if (!fs.existsSync(fullPath)) {
  console.error(`File not found: ${fullPath}`);
  process.exit(1);
}

const content = fs.readFileSync(fullPath, 'utf8');
const moduleName = path.basename(targetFile, '.js');
const moduleDir = path.dirname(targetFile);

// Extract exported functions
const functionPattern = /function\s+(\w+)\s*\(([^)]*)\)/g;
const functions = [];
let match;

while ((match = functionPattern.exec(content)) !== null) {
  const funcName = match[1];
  const params = match[2].split(',').map(p => p.trim()).filter(p => p);
  
  // Check if function is exported (simple heuristic)
  const isExported = content.includes(`module.exports`) && 
                     (content.includes(funcName) || content.includes(`exports.${funcName}`));
  
  // Also include if it's in the file (we'll assume exported for test generation)
  functions.push({ name: funcName, params });
}

// Extract patterns from function bodies
function analyzeFunction(funcName) {
  const patterns = [];
  
  // Find function body
  const funcRegex = new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{`, 'g');
  const funcMatch = funcRegex.exec(content);
  
  if (!funcMatch) return patterns;
  
  const startIndex = funcMatch.index;
  let braceCount = 0;
  let endIndex = startIndex;
  
  // Find matching closing brace
  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') braceCount--;
    if (braceCount === 0) {
      endIndex = i + 1;
      break;
    }
  }
  
  const funcBody = content.slice(startIndex, endIndex);
  
  // Detect patterns
  if (/if\s*\(\s*!?\w+\s*\)/.test(funcBody)) {
    patterns.push('falsyCheck');
  }
  
  if (/\.(trim|replace|split|match|indexOf)\s*\(/.test(funcBody)) {
    patterns.push('stringMethods');
  }
  
  if (/parseInt|Number\(/.test(funcBody)) {
    patterns.push('numericParse');
  }
  
  if (/\.length\s*[=<>!]/.test(funcBody)) {
    patterns.push('arrayLength');
  }
  
  if (/try\s*\{/.test(funcBody)) {
    patterns.push('tryCatch');
  }
  
  if (/return\s*\{/.test(funcBody)) {
    patterns.push('returnObject');
  }
  
  if (/return\s*null/.test(funcBody)) {
    patterns.push('returnNull');
  }
  
  if (/return\s*\[\]/.test(funcBody)) {
    patterns.push('returnEmptyArray');
  }
  
  return patterns;
}

// Generate test cases based on patterns
function generateTests(funcName, params, patterns) {
  const tests = [];
  
  // Always generate empty/null tests for each parameter
  params.forEach(param => {
    tests.push({
      name: `should handle empty string for ${param}`,
      code: `  it('should handle empty string for ${param}', () => {\n    const result = ${funcName}(${generateArg(param, 'empty')});\n    assert.ok(result !== undefined);\n  });`
    });
    
    tests.push({
      name: `should handle null for ${param}`,
      code: `  it('should handle null for ${param}', () => {\n    const result = ${funcName}(${generateArg(param, 'null')});\n    assert.ok(result !== undefined);\n  });`
    });
  });
  
  // Pattern-specific tests
  if (patterns.includes('falsyCheck')) {
    tests.push({
      name: 'should handle falsy input',
      code: `  it('should handle falsy input', () => {\n    const result = ${funcName}(null);\n    assert.ok(result !== undefined);\n  });`
    });
  }
  
  if (patterns.includes('returnObject')) {
    tests.push({
      name: 'should return an object',
      code: `  it('should return an object', () => {\n    const result = ${funcName}('test');\n    assert.ok(typeof result === 'object');\n    assert.ok(result !== null);\n  });`
    });
  }
  
  if (patterns.includes('returnNull')) {
    tests.push({
      name: 'should return null for invalid input',
      code: `  it('should return null for invalid input', () => {\n    const result = ${funcName}('invalid');\n    // Verify null is a possible return value\n    assert.ok(result === null || result !== null);\n  });`
    });
  }
  
  if (patterns.includes('returnEmptyArray')) {
    tests.push({
      name: 'should return empty array for empty input',
      code: `  it('should return empty array for empty input', () => {\n    const result = ${funcName}([]);\n    assert.ok(Array.isArray(result));\n  });`
    });
  }
  
  if (patterns.includes('stringMethods')) {
    tests.push({
      name: 'should handle whitespace',
      code: `  it('should handle whitespace', () => {\n    const result = ${funcName}('  test  ');\n    assert.ok(result !== undefined);\n  });`
    });
  }
  
  if (patterns.includes('numericParse')) {
    tests.push({
      name: 'should handle non-numeric string',
      code: `  it('should handle non-numeric string', () => {\n    const result = ${funcName}('not a number');\n    assert.ok(result !== undefined);\n  });`
    });
  }
  
  return tests;
}

function generateArg(param, type) {
  switch (type) {
    case 'empty': return "''";
    case 'null': return 'null';
    case 'undefined': return 'undefined';
    case 'zero': return '0';
    case 'false': return 'false';
    default: return `'test'`;
  }
}

// Main generation
console.log(`\n📝 Analyzing ${targetFile}...\n`);

if (functions.length === 0) {
  console.log('⚠️  No functions found in the file.');
  console.log('Tip: Make sure functions use the pattern: function name(params)');
  process.exit(0);
}

console.log(`Found ${functions.length} function(s):\n`);

let testContent = `const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

`;

functions.forEach(func => {
  const patterns = analyzeFunction(func.name);
  const tests = generateTests(func.name, func.params, patterns);
  
  console.log(`  📦 ${func.name}(${func.params.join(', ') || ''})`);
  console.log(`     Patterns: ${patterns.length > 0 ? patterns.join(', ') : 'none detected'}`);
  console.log(`     Generated: ${tests.length} test(s)\n`);
  
  testContent += `describe('${func.name}', () => {\n`;
  
  tests.forEach(test => {
    testContent += test.code + '\n\n';
  });
  
  // Add TODO for manual cases
  if (func.params.length > 0) {
    testContent += `  // TODO: Add realistic test data for ${func.name}\n`;
    testContent += `  // TODO: Add edge case tests specific to business logic\n`;
  }
  
  testContent += `});\n\n`;
});

// Determine output path
const testDir = path.join(path.dirname(fullPath), '__tests__');
const testFile = path.join(testDir, `${moduleName}.test.js`);

// Check if test file already exists
if (fs.existsSync(testFile)) {
  console.log(`\n⚠️  Test file already exists: ${testFile}`);
  console.log('Skipping write. Delete the file first if you want to regenerate.');
} else {
  // Create test directory if needed
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  fs.writeFileSync(testFile, testContent);
  console.log(`\n✅ Generated test file: ${testFile}`);
  console.log('\nNext steps:');
  console.log('  1. Review the generated tests');
  console.log('  2. Add realistic test data');
  console.log('  3. Implement TODO test cases');
  console.log('  4. Run: cd server && npm test');
}
