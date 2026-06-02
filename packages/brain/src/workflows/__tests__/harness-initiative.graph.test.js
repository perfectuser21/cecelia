/**
 * harness-initiative.graph.test.js — exact-name pairing stub for lint-test-pairing
 *
 * 真实测试在 harness-initiative.graph.full.test.js（PR #2640 + #2646 引入）。
 * 此文件仅满足 lint 同名要求 + 验证模块可 import。
 * B51: 新增 prepInitiativeNode + dbUpsertNode 约定显式化测试。
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

describe('B51 — prepInitiativeNode + dbUpsertNode 约定显式化', () => {
  it('prepInitiativeNode 代码中 initiativeId 始终取 task.id（不再读 payload.initiative_id）', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../harness-initiative.graph.js', import.meta.url), 'utf8');
    // B51 修复后：prepInitiativeNode 只用 state.task?.id，不再有旧兼容链
    const prepFnMatch = src.match(/export async function prepInitiativeNode[\s\S]*?^}/m);
    expect(prepFnMatch).not.toBeNull();
    const prepFn = prepFnMatch[0];
    expect(prepFn).toMatch(/initiativeId\s*=\s*state\.task\?\.id/);
    expect(prepFn).not.toMatch(/payload\.initiative_id\s*\|\|/);
  });

  it('dbUpsertNode 包含 initiative_id 不匹配时强制覆盖的逻辑', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../harness-initiative.graph.js', import.meta.url), 'utf8');
    // B51 修复后：dbUpsertNode 有 taskPlanForUpsert 覆盖逻辑
    expect(src).toMatch(/taskPlanForUpsert/);
    expect(src).toMatch(/initiative_id.*!==.*state\.initiativeId/);
  });

  it('prepInitiativeNode 包含 journey_id 缺失 WARN 日志', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../harness-initiative.graph.js', import.meta.url), 'utf8');
    expect(src).toMatch(/journey_id missing in task\.payload/);
  });
});
