/**
 * cortex.js — classifyTimeoutReason 单元测试
 * 覆盖三种根因：quota_exhausted / prompt_too_long / network_timeout
 */

import { describe, it, expect } from 'vitest';
import { classifyTimeoutReason } from '../cortex.js';

describe('classifyTimeoutReason', () => {
  it('HTTP 429 → quota_exhausted', () => {
    const err = Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    expect(classifyTimeoutReason(err)).toBe('quota_exhausted');
  });

  it('HTTP 400 + token 关键词 → prompt_too_long', () => {
    const err = Object.assign(new Error('max token length exceeded'), { status: 400 });
    expect(classifyTimeoutReason(err)).toBe('prompt_too_long');
  });

  it('HTTP 400 + context 关键词 → prompt_too_long', () => {
    const err = Object.assign(new Error('context window too large'), { status: 400 });
    expect(classifyTimeoutReason(err)).toBe('prompt_too_long');
  });

  it('HTTP 400 + length 关键词 → prompt_too_long', () => {
    const err = Object.assign(new Error('input length exceeds limit'), { status: 400 });
    expect(classifyTimeoutReason(err)).toBe('prompt_too_long');
  });

  it('HTTP 400 无 token/context 关键词 → unknown', () => {
    const err = Object.assign(new Error('bad request'), { status: 400 });
    expect(classifyTimeoutReason(err)).toBe('unknown');
  });

  it('degraded=true → network_timeout', () => {
    const err = Object.assign(new Error('bridge degraded'), { degraded: true });
    expect(classifyTimeoutReason(err)).toBe('network_timeout');
  });

  it('message 含 timed out → network_timeout', () => {
    const err = new Error('Request timed out after 300000ms');
    expect(classifyTimeoutReason(err)).toBe('network_timeout');
  });

  it('message 含 timeout → network_timeout', () => {
    const err = new Error('Connection timeout');
    expect(classifyTimeoutReason(err)).toBe('network_timeout');
  });

  it('未知错误 → unknown', () => {
    const err = new Error('Something went wrong');
    expect(classifyTimeoutReason(err)).toBe('unknown');
  });

  it('statusCode（兼容 axios 风格）→ quota_exhausted', () => {
    const err = Object.assign(new Error('Too Many Requests'), { statusCode: 429 });
    expect(classifyTimeoutReason(err)).toBe('quota_exhausted');
  });
});
