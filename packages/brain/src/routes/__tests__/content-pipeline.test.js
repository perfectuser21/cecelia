/**
 * routes/content-pipeline.test.js — exact-name pairing stub for lint-test-pairing
 *
 * 真正的功能测试在 packages/brain/src/__tests__/content-pipeline-routes.test.js
 * （26 个 case 覆盖 GET / POST / batch / run / e2e-trigger / pre-publish-check / ...）。
 * 本文件仅提供 lint-test-pairing 要求的同目录 __tests__/<basename>.test.js stub。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('routes/content-pipeline module (pairing stub)', () => {
  it('routes/content-pipeline.js 不再 import 已删除的 content-pipeline-* 实现模块', () => {
    const src = fs.readFileSync(new URL('../content-pipeline.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/content-pipeline-orchestrator/);
    expect(src).not.toMatch(/content-pipeline-graph-runner/);
    expect(src).not.toMatch(/content-pipeline-graph(?!-)/);  // 排除 -graph-runner / -graph-docker
    expect(src).not.toMatch(/content-pipeline-executors/);
  });

  it('POST /:id/run-langgraph endpoint 已删（404 by Express）', () => {
    const src = fs.readFileSync(new URL('../content-pipeline.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/run-langgraph/);
  });
});
