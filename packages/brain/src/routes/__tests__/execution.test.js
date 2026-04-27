/**
 * routes/execution.test.js — exact-name pairing stub for lint-test-pairing
 *
 * routes/execution.js 是 4500+ 行的大文件，已有的细粒度测试散在
 * packages/brain/src/__tests__/execution-*.test.js 中。本文件仅提供
 * lint-test-pairing 要求的同目录 __tests__/<basename>.test.js stub。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('routes/execution module (pairing stub)', () => {
  it('routes/execution.js 不再 dynamic import content-pipeline-orchestrator', () => {
    const src = fs.readFileSync(new URL('../execution.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/import\(.*content-pipeline-orchestrator/);
  });
});
