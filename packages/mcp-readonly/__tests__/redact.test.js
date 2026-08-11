import { describe, it, expect } from 'vitest';
import { redact } from '../src/redact.js';

describe('redact', () => {
  it('遮盖 Bearer token，只留后4位', () => {
    const input = 'Authorization: Bearer abcdef1234567890';
    expect(redact(input)).toBe('Authorization: Bearer ****7890');
  });

  it('遮盖 postgres 连接串密码段', () => {
    const input = 'postgres://user:s3cr3tpass@localhost:5432/cecelia';
    expect(redact(input)).toBe('postgres://user:****@localhost:5432/cecelia');
  });

  it('遮盖 OpenAI 风格密钥 sk-xxx', () => {
    const input = 'using key sk-abcdefghijklmnopqrstuvwx';
    expect(redact(input)).toContain('sk-****');
    expect(redact(input)).not.toContain('abcdefghijklmnopqrstuvwx');
  });

  it('遮盖 GitHub token ghp_xxx', () => {
    const input = 'token=ghp_1234567890abcdefghijklmnopqrstuv';
    expect(redact(input)).toContain('ghp_****');
  });

  it('遮盖小写/大写 bearer token（大小写不敏感）', () => {
    expect(redact('authorization: bearer abcdef1234567890')).toBe(
      'authorization: bearer ****7890'
    );
    expect(redact('AUTHORIZATION: BEARER abcdef1234567890')).toBe(
      'AUTHORIZATION: BEARER ****7890'
    );
  });

  it('无敏感内容原样返回', () => {
    const input = 'schema version is 405';
    expect(redact(input)).toBe(input);
  });
});
