/**
 * regression tests for pipeline UI fixes:
 *   1. HARNESS_MERMAID direction = LR (not TD)
 *   2. pipeline-detail planner detection supports harness_initiative type
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../harness.js', import.meta.url), 'utf8');

describe('HARNESS_MERMAID direction', () => {
  it('使用 graph LR（从左到右），不是 graph TD', () => {
    expect(src).toMatch(/const HARNESS_MERMAID\s*=\s*`graph LR/);
    expect(src).not.toMatch(/const HARNESS_MERMAID\s*=\s*`graph TD/);
  });
});

describe('pipeline-detail planner detection', () => {
  it('planner 检测包含 harness_initiative 类型作为回退', () => {
    expect(src).toMatch(/harness_initiative/);
    const plannerLine = src.split('\n').find(l => l.includes('sprint_planner') && l.includes('find'));
    expect(plannerLine).toBeDefined();
  });
});
