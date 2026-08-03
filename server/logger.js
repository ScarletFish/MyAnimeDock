// server/logger.js — Dev/source-require shim.
//
// logger.ts is the real implementation and compiles to dist/logger.js.
// Source modules (db.js, scrapers/*.js, etc.) still `require('./logger')`
// during development and tests, so this shim forwards to the compiled CJS
// output. It is excluded from tsc compilation (see tsconfig exclude) so it
// never overwrites dist/logger.js. `npm test` / `test:routes` build dist
// first via `tsc`.
module.exports = require('./dist/logger.js');