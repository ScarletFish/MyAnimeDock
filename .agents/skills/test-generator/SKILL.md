---
name: test-generator
description: Generate test skeletons for JS modules using static analysis. Analyzes function signatures, branches, and error paths to create comprehensive test cases. Use when the user wants to add tests to an existing module or needs help designing test cases.
---

# Test Generator

Automatically generate test skeletons for JavaScript modules by analyzing code patterns.

## How It Works

The generator uses static analysis to:
1. Extract function signatures and parameter types
2. Identify branching logic (if/else, switch)
3. Detect error paths (try/catch, return null, throw)
4. Match common patterns to generate appropriate test cases

## Usage

### Step 1: Analyze the Module

Read the target module and identify:
- Exported functions
- Parameter types and usage
- Branch conditions
- Return value patterns
- Error handling paths

### Step 2: Generate Test Skeleton

Create a test file following the project's convention:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { functionName } = require('../module');

describe('functionName', () => {
  // Generated test cases
});
```

### Step 3: Apply Test Patterns

For each pattern detected, generate appropriate tests:

#### Pattern: Falsy Check (`if (!param)`)

```js
// Source pattern
function extractId(name) {
  if (!name) return null;
  // ...
}

// Generated tests
it('should handle empty string', () => {
  assert.equal(extractId(''), null);
});

it('should handle null input', () => {
  assert.equal(extractId(null), null);
});

it('should handle undefined input', () => {
  assert.equal(extractId(undefined), null);
});
```

#### Pattern: String Methods (`.trim()`, `.replace()`, `.match()`)

```js
// Source pattern
function parseName(name) {
  return name.replace(/\/+$/, '').trim();
}

// Generated tests
it('should handle empty string', () => {
  const result = parseName('');
  assert.equal(result, '');
});

it('should handle whitespace', () => {
  const result = parseName('  hello  ');
  assert.equal(result, 'hello');
});

it('should handle special characters', () => {
  const result = parseName('test@#$%');
  assert.ok(typeof result === 'string');
});
```

#### Pattern: Numeric Parse (`parseInt`, `Number()`)

```js
// Generated tests
it('should return null for non-numeric content', () => {
  assert.equal(extractId('no number'), null);
});

it('should handle empty string', () => {
  assert.equal(extractId(''), null);
});

it('should handle floating point', () => {
  const result = extractId('12.5');
  assert.ok(result !== undefined);
});
```

#### Pattern: Array/Length Check

```js
// Source pattern
function processItems(items) {
  if (!items || items.length === 0) return [];
  // ...
}

// Generated tests
it('should handle empty array', () => {
  assert.deepEqual(processItems([]), []);
});

it('should handle null input', () => {
  assert.deepEqual(processItems(null), []);
});

it('should handle undefined input', () => {
  assert.deepEqual(processItems(undefined), []);
});
```

#### Pattern: Try/Catch

```js
// Source pattern
function readFile(path) {
  try {
    return fs.readFileSync(path);
  } catch (e) {
    return null;
  }
}

// Generated tests
it('should handle invalid path gracefully', () => {
  const result = readFile('/nonexistent/path');
  assert.equal(result, null);
});
```

#### Pattern: Return Object

```js
// Source pattern
function parseFolderName(name) {
  if (!name) return { title: '', season: 0 };
  // ...
  return { title, season };
}

// Generated tests
it('should return object with expected keys', () => {
  const result = parseFolderName('test');
  assert.ok(result.hasOwnProperty('title'));
  assert.ok(result.hasOwnProperty('season'));
});

it('should return default values for empty input', () => {
  const result = parseFolderName('');
  assert.equal(result.title, '');
  assert.equal(result.season, 0);
});
```

### Step 4: Mark Manual Supplements

Add TODO comments for cases that require human judgment:

```js
// TODO: Add test with realistic anime folder name
// TODO: Add test for CJK character handling
// TODO: Add test for edge case: multiple season tags
```

## Example: Complete Generated Test File

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractBgmId, parseFolderName } = require('../scanner');

describe('extractBgmId', () => {
  // Pattern: Falsy check
  it('should return null for empty string', () => {
    assert.equal(extractBgmId(''), null);
  });

  it('should return null for null input', () => {
    assert.equal(extractBgmId(null), null);
  });

  // Pattern: String match
  it('should extract ID from [bgm12345]', () => {
    assert.equal(extractBgmId('[bgm12345] Title'), 12345);
  });

  // TODO: Add test for uppercase [BGM12345]
  // TODO: Add test for ID in middle of string
});

describe('parseFolderName', () => {
  // Pattern: Return object
  it('should return object with title and season', () => {
    const result = parseFolderName('test');
    assert.ok(result.hasOwnProperty('title'));
    assert.ok(result.hasOwnProperty('season'));
  });

  // Pattern: Falsy check
  it('should handle empty input', () => {
    const result = parseFolderName('');
    assert.equal(result.title, '');
  });

  // TODO: Add test with realistic anime folder name
  // TODO: Add test for anitomy parsing
});
```

## Quality Checklist

After generating tests, verify:

- [ ] All exported functions have at least one test
- [ ] Empty/null/undefined inputs are tested for each parameter
- [ ] Normal happy path is tested
- [ ] Error paths are tested
- [ ] TODO markers are added for manual cases
- [ ] Tests follow project conventions (node:test + node:assert)
- [ ] Test file is in correct location (`__tests__/*.test.js`)
