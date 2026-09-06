// server/__tests__/http-fetch.test.js — HTTP 层 JSON 解析错误友好化测试
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseApiJsonResponse } = require('../dist/lib/http-fetch');

describe('parseApiJsonResponse', () => {
  it('正常 JSON 直接返回解析结果', () => {
    const data = parseApiJsonResponse('{"code":1,"data":{"name":"test"}}');
    assert.deepStrictEqual(data, { code: 1, data: { name: 'test' } });
  });

  it('空响应抛可读错误', () => {
    assert.throws(() => parseApiJsonResponse('   '), /API 返回了空响应/);
  });

  it('HTML 响应判为网络拦截并给出开头摘要', () => {
    assert.throws(
      () => parseApiJsonResponse('<!DOCTYPE html>\n<html><body>Just a moment...</body></html>'),
      e => /API 返回了网页内容（可能被网络拦截或地址异常）/.test(e.message)
        && /<!DOCTYPE html> <html><body>/.test(e.message),
    );
  });

  it('非 JSON 非 HTML 内容也转成可读错误', () => {
    assert.throws(
      () => parseApiJsonResponse('oops not json at all'),
      /API 返回了无法解析的数据（非 JSON 格式），响应开头: oops not json at all/,
    );
  });

  it('超长响应只保留前 120 字符摘要', () => {
    const longHtml = '<!DOCTYPE html>' + 'x'.repeat(300);
    assert.throws(
      () => parseApiJsonResponse(longHtml),
      e => e.message.length < 160 && e.message.endsWith('…'),
    );
  });
});