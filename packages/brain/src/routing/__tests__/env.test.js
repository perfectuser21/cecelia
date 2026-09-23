/**
 * routing/env.js —— 六问链路的 env 读取与默认值。
 *
 * 本文件由 qiumi-jev-client.test.js 按源文件拆出（lint-test-pairing 要求
 * src/routing/ 下每个源文件配一个同目录 __tests__/<name>.test.js），断言一字未改。
 */
import { describe, it, expect } from 'vitest';
import { qiumiEnv, resolveModelRef } from '../env.js';

describe('qiumiEnv', () => {
  it('缺省值与 JSON 解析', () => {
    const e = qiumiEnv({ JEV_API_KEY: 'k' });
    expect(e.jevEndpoint).toBe('https://api.typesafe.ai/v1/systemone');
    expect(e.jevModel).toBe('jev-latest');
    expect(e.fallbackModel).toBe('gpt-5.6-terra');
    expect(e.mmvConcurrency).toBe(2);
    expect(e.dispatchEnabled).toBe(false);
    expect(e.departments).toEqual(['main', 'infra', 'dev', 'media', 'people', 'fde']);
    expect(e.modelMap.claude).toBe('anthropic/claude-sonnet-5');
    expect(e.deviceKeywords).toContain('朋友圈');
    expect(qiumiEnv({ QIUMI_MMV_CONCURRENCY: '3', QIUMI_DISPATCH_ENABLED: 'true', QIUMI_DEPARTMENTS: '["main"]' }))
      .toMatchObject({ mmvConcurrency: 3, dispatchEnabled: true, departments: ['main'] });
  });
});

describe('QIUMI_MODEL_ALLOWLIST + resolveModelRef', () => {
  const env = qiumiEnv({ QIUMI_MODEL_ALLOWLIST: JSON.stringify([
    'openai/gpt-5.6-terra', 'openai/gpt-5.6-sol', 'anthropic/claude-opus-5', 'anthropic/claude-opus-5-5',
    'anthropic/claude-haiku-4-5', 'anthropic/claude-haiku-4-5-20251001', 'xai/grok-4.7', 'xai/grok-4.20-reasoning',
  ]) });
  it('缺失/非法 JSON → 空清单', () => {
    expect(qiumiEnv({}).modelAllowlist).toEqual([]);
    expect(qiumiEnv({ QIUMI_MODEL_ALLOWLIST: '{bad' }).modelAllowlist).toEqual([]);
  });
  it('全名命中', () => expect(resolveModelRef('xai/grok-4.7', env)).toBe('xai/grok-4.7'));
  it('短名 = split 后全等：grok-4.7 / grok-4.20-reasoning', () => {
    expect(resolveModelRef('grok-4.7', env)).toBe('xai/grok-4.7');
    expect(resolveModelRef('grok-4.20-reasoning', env)).toBe('xai/grok-4.20-reasoning');
  });
  it('短名 = 以 -token 结尾：sol → gpt-5.6-sol，opus-5 → claude-opus-5（不误吞 opus-5-5）', () => {
    expect(resolveModelRef('sol', env)).toBe('openai/gpt-5.6-sol');
    expect(resolveModelRef('opus-5', env)).toBe('anthropic/claude-opus-5');
    expect(resolveModelRef('opus-5-5', env)).toBe('anthropic/claude-opus-5-5');
  });
  it('多个候选（haiku-4-5 同时结尾匹配两条）→ 优先全等短名；无全等且多候选 → null', () => {
    expect(resolveModelRef('haiku-4-5', env)).toBe('anthropic/claude-haiku-4-5');
    const env2 = qiumiEnv({ QIUMI_MODEL_ALLOWLIST: JSON.stringify(['a/x-pro', 'b/y-pro']) });
    expect(resolveModelRef('pro', env2)).toBeNull();
  });
  it('短名全等有多条（a/x 与 b/x）→ 不猜，null', () => {
    const env3 = qiumiEnv({ QIUMI_MODEL_ALLOWLIST: JSON.stringify(['a/pro-max', 'b/pro-max', 'c/y-pro-max']) });
    expect(resolveModelRef('pro-max', env3)).toBeNull();   // 全等两条 → null（不落到 suffix 分支去捡 c/y-pro-max）
    expect(resolveModelRef('y-pro-max', env3)).toBe('c/y-pro-max');
  });
  it('不在清单 / 太短 / 空 → null', () => {
    expect(resolveModelRef('claude', env)).toBeNull();
    expect(resolveModelRef('so', env)).toBeNull();
    expect(resolveModelRef('', env)).toBeNull();
  });
  it('claude 引擎默认映射改为 anthropic 原生通道', () => {
    expect(qiumiEnv({}).modelMap.claude).toBe('anthropic/claude-sonnet-5');
  });
});
