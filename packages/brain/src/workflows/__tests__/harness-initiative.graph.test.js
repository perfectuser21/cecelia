/**
 * harness-initiative.graph.test.js — exact-name pairing stub for lint-test-pairing
 *
 * 真实测试在 harness-initiative.graph.full.test.js（PR #2640 + #2646 引入）。
 * 此文件仅满足 lint 同名要求 + 验证模块可 import。
 */
import { describe, it, expect } from 'vitest';

describe('harness-initiative.graph module (pairing stub)', () => {
  it('exports compileHarnessFullGraph', async () => {
    const mod = await import('../harness-initiative.graph.js');
    expect(typeof mod.compileHarnessFullGraph).toBe('function');
  });

  it('imports parseDockerOutput / loadSkillContent from harness-shared (post-retirement)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../harness-initiative.graph.js', import.meta.url), 'utf8');
    expect(src).toMatch(/from\s+['"]\.\.\/harness-shared\.js['"]/);
    expect(src).not.toMatch(/from\s+['"]\.\.\/harness-graph\.js['"]/);
  });
});
