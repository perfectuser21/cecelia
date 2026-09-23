/**
 * routing/redact.js —— 发问前打码，正文里的 token/密钥不进模型。
 *
 * 本文件由 qiumi-jev-client.test.js 按源文件拆出（lint-test-pairing 要求
 * src/routing/ 下每个源文件配一个同目录 __tests__/<name>.test.js），断言一字未改。
 */
import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../redact.js';

describe('redactSecrets', () => {
  it('打码 key/token/密码/bearer/sk-，不动普通文本', () => {
    const s = redactSecrets('api_key=abc123 token: xyz Bearer eyJhbGci sk-live-999 密码：p@ss 正文照旧');
    expect(s).not.toMatch(/abc123|xyz|eyJhbGci|sk-live-999|p@ss/);
    expect(s).toContain('正文照旧');
    expect(s).toMatch(/\[REDACTED\]/);
  });
});
