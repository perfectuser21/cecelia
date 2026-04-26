/**
 * 验证：executor.js 不再有 HARNESS_USE_FULL_GRAPH env 检查 — harness_initiative 永远走 full graph。
 * 静态断言代码形状（不实际跑 executor，避免 LangGraph compile 副作用）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('executor.js harness_initiative full graph default', () => {
  const SRC = fs.readFileSync(new URL('../executor.js', import.meta.url), 'utf8');

  it('源码中不存在 HARNESS_USE_FULL_GRAPH 引用', () => {
    expect(SRC).not.toMatch(/HARNESS_USE_FULL_GRAPH/);
  });

  it('源码中不存在 HARNESS_INITIATIVE_RUNTIME 引用（fallback runner 已删）', () => {
    expect(SRC).not.toMatch(/HARNESS_INITIATIVE_RUNTIME/);
  });

  it('源码中不再 import harness-initiative-runner.js（runInitiative 兜底已删）', () => {
    // import 语句在文件顶部静态写法，dynamic import 在 fallback 分支
    expect(SRC).not.toMatch(/from\s+['"]\.\/harness-initiative-runner\.js['"]/);
    expect(SRC).not.toMatch(/import\(['"]\.\/harness-initiative-runner\.js['"]\)/);
  });
});
