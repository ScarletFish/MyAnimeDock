// server/__tests__/helpers/mock-http.js
// Mock req/res/state for route handler integration tests.
// Usage: const { mockReq, mockRes, mockState } = require('./helpers/mock-http');

/**
 * Create a mock HTTP response object that captures writeHead/end calls.
 * 
 * After calling the handler under test, inspect:
 *   res._status  — HTTP status code
 *   res._body   — JSON-parsed response body
 *   res._headers — response headers object
 */
function mockRes() {
  return {
    _status: null,
    _body: null,
    _headers: null,
    writeHead(status, headers) {
      this._status = status;
      this._headers = headers;
      return this;
    },
    end(body) {
      this._body = body ? JSON.parse(body) : null;
      return this;
    },
  };
}

/**
 * Create a mock HTTP request as a Readable-like object.
 * 
 * @param {object} opts
 * @param {string} opts.url     — Request URL (e.g. '/api/mylist/123/status')
 * @param {string} opts.method  — HTTP method (default 'GET')
 * @param {string|null} opts.body — JSON string for request body
 * @param {object} opts.headers — Request headers
 */
function mockReq({ url = '/', method = 'GET', body = null, headers = {} } = {}) {
  const chunks = body ? [Buffer.from(body)] : [];
  let ended = false;
  const listeners = {};

  const req = {
    url,
    method,
    headers,
    on(event, fn) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
      // Auto-fire data+end if body was provided at construction time
      if (event === 'end' && !ended && body !== null) {
        ended = true;
        process.nextTick(() => {
          for (const cb of (listeners.data || [])) cb(chunks[0]);
          for (const cb of (listeners.end || [])) cb();
        });
      }
      return req;
    },
    // For handlers that use req.on('data') directly instead of readBody()
    // Simulate by emitting synchronously when a listener attaches
    _emitData(chunk) {
      for (const cb of (listeners.data || [])) cb(chunk);
    },
    _emitEnd() {
      ended = true;
      for (const cb of (listeners.end || [])) cb();
    },
  };
  return req;
}

/**
 * Create mock state object for route handlers.
 * 
 * @param {object} overrides — Override specific fields (data, db, config, etc.)
 */
function mockState(overrides = {}) {
  return {
    data: {
      library: [],
      myList: [],
      playSessions: [],
      scannedTree: null,
      memories: [],
    },
    config: {
      mediaDir: '',
      mpvPath: 'mpv',
      playerMode: 'mpv',
      theme: 'default',
      themeMode: 'dark',
      autoMarkWatched: true,
      uiScale: 1.25,
    },
    db: {
      saveLibrary: async () => {},
      saveMyList: async () => {},
      savePlaySessions: async () => {},
      updateEpisodeProgress: async () => {},
      updateEpisodesWatched: async () => {},
      updatePlaySession: async () => {},
      updateMyListItem: async () => {},
      deletePlaySession: async () => {},
    },
    logger: {
      info: () => {},
      error: () => {},
      warn: () => {},
    },
    activePlays: new Map(),
    bangumiSync: {
      pushStatusChange: async () => {},
    },
    ...overrides,
    // Deep merge data
    data: {
      library: [],
      myList: [],
      playSessions: [],
      scannedTree: null,
      memories: [],
      ...(overrides.data || {}),
    },
  };
}

module.exports = { mockReq, mockRes, mockState };
