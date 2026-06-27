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

describe('Slice2 — 合同入库写满 e2e_acceptance 列（治本列从不写入→staging 永久 SKIP）', () => {
  it('computeContractE2eAcceptance：已带结构化 e2e_acceptance → 原样返回', async () => {
    const { computeContractE2eAcceptance } = await import('../harness-initiative.graph.js');
    const structured = { scenarios: [{ name: 'x', covered_tasks: ['t'], commands: [{ cmd: 'ls' }] }] };
    expect(computeContractE2eAcceptance({ e2e_acceptance: structured, contract_content: 'x' })).toBe(structured);
  });

  it('computeContractE2eAcceptance：无结构化值但 contract_content 含 ## E2E 验收 → 回退解析非空 scenarios', async () => {
    const { computeContractE2eAcceptance } = await import('../harness-initiative.graph.js');
    const contract = '# 合同\n## E2E 验收（final-e2e）\n```bash\nset -e\necho "▶ Golden Path"\n```\n## Test Contract';
    const r = computeContractE2eAcceptance({ contract_content: contract });
    expect(r).not.toBeNull();
    expect(r.scenarios.length).toBeGreaterThan(0);
  });

  it('computeContractE2eAcceptance：既无结构化值也无可解析合同 → null', async () => {
    const { computeContractE2eAcceptance } = await import('../harness-initiative.graph.js');
    expect(computeContractE2eAcceptance({ contract_content: '# 合同\n## 背景\n无 E2E' })).toBeNull();
    expect(computeContractE2eAcceptance(null)).toBeNull();
  });

  it('dbUpsertNode INSERT 列清单含 e2e_acceptance + ON CONFLICT COALESCE + 用 helper 计算', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../harness-initiative.graph.js', import.meta.url), 'utf8');
    const startIdx = src.indexOf('INSERT INTO initiative_contracts');
    const insertBlock = src.slice(startIdx, src.indexOf('RETURNING id', startIdx));
    expect(insertBlock).toContain('e2e_acceptance');
    expect(src).toMatch(/e2e_acceptance\s*=\s*COALESCE\(EXCLUDED\.e2e_acceptance/);
    expect(src).toMatch(/computeContractE2eAcceptance\(state\.ganResult\)/);
  });
});
