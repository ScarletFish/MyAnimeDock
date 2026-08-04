import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/**
 * Node.js native fetch fallback for pkg mode where global fetch() is not available.
 * Implements enough of the Response interface for the scrapers to work.
 */
function nodeFetch(urlStr: string, options: any = {}, timeoutMs: number = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: Object.assign({}, options.headers, options.body ? {
        'Content-Length': Buffer.byteLength(options.body)
      } : {}),
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const status = res.statusCode || 500;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: res.statusMessage || '',
          headers: res.headers,
          text: () => Promise.resolve(buf.toString('utf-8')),
          json: () => JSON.parse(buf.toString('utf-8')),
          arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
        });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('Request timeout'), { name: 'AbortError' })); });

    if (options.body) req.write(options.body);
    req.end();

    // Support AbortController signal
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        req.destroy();
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      }, { once: true });
    }
  });
}

export { nodeFetch };
