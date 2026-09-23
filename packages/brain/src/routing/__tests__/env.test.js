/**
 * routing/env.js —— 六问链路的 env 读取与默认值。
 *
 * 本文件由 qiumi-jev-client.test.js 按源文件拆出（lint-test-pairing 要求
 * src/routing/ 下每个源文件配一个同目录 __tests__/<name>.test.js），断言一字未改。
 */
import { describe, it, expect } from 'vitest';
import { qiumiEnv } from '../env.js';

describe('qiumiEnv', () => {
  it('缺省值与 JSON 解析', () => {
    const e = qiumiEnv({ JEV_API_KEY: 'k' });
    expect(e.jevEndpoint).toBe('https://api.typesafe.ai/v1/systemone');
    expect(e.jevModel).toBe('jev-latest');
    expect(e.fallbackModel).toBe('gpt-5.6-terra');
    expect(e.mmvConcurrency).toBe(2);
    expect(e.dispatchEnabled).toBe(false);
    expect(e.departments).toEqual(['main', 'infra', 'dev', 'media', 'people', 'fde']);
    expect(e.modelMap.claude).toBe('claude-cli/claude-sonnet-5');
    expect(e.deviceKeywords).toContain('朋友圈');
    expect(qiumiEnv({ QIUMI_MMV_CONCURRENCY: '3', QIUMI_DISPATCH_ENABLED: 'true', QIUMI_DEPARTMENTS: '["main"]' }))
      .toMatchObject({ mmvConcurrency: 3, dispatchEnabled: true, departments: ['main'] });
  });
});
