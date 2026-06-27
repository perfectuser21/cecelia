/**
 * Slice1 — staging-e2e contract_content 兜底解析（regression test，永久留 CI）。
 *
 * 复现并守护 P0：e2e_acceptance 列几乎零写入（171 条仅 1 条非空）→ loadE2eAcceptance
 * 必返 null → staging_e2e 永久 finalize('SKIP') → promote 永不触发。
 * 兜底：e2e_acceptance 为空时解析同行 contract_content 的 `## E2E 验收` bash 块。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

const { parseE2eAcceptanceFromContract, loadE2eAcceptance } = await import('../staging-e2e-runner.js');
const { normalizeAcceptance } = await import('../harness-final-e2e.js');

const CONTRACT_WITH_E2E = `# 合同
## 背景
xxx
## E2E 验收（final-e2e — target_environment: local_api）
**target_environment**: local_api
\`\`\`bash
#!/bin/bash
set -e
echo "▶ Step 1"
node "sprints/x/tests/check.mjs"
echo "✅ Golden Path 全过"
\`\`\`
## Test Contract
yyy`;

describe('parseE2eAcceptanceFromContract', () => {
  it('含 ## E2E + bash 块 → 非空 scenarios 且过 normalizeAcceptance', () => {
    const r = parseE2eAcceptanceFromContract(CONTRACT_WITH_E2E, 'init-1');
    expect(r).not.toBeNull();
    expect(r.scenarios.length).toBe(1);
    expect(r.scenarios[0].commands[0].cmd).toContain('Golden Path');
    expect(r.scenarios[0].covered_tasks).toEqual(['init-1']);
    expect(() => normalizeAcceptance(r)).not.toThrow();
  });

  it('无 ## E2E 段 → null', () => {
    expect(parseE2eAcceptanceFromContract('# 合同\n## 背景\nxxx', 'init-1')).toBeNull();
  });

  it('有 ## E2E 段但无 bash 块 → null', () => {
    expect(parseE2eAcceptanceFromContract('## E2E 验收\n纯文字无代码块\n## 下一段', 'init-1')).toBeNull();
  });

  it('空输入 → null', () => {
    expect(parseE2eAcceptanceFromContract(null, 'init-1')).toBeNull();
    expect(parseE2eAcceptanceFromContract('', 'init-1')).toBeNull();
  });
});

describe('loadE2eAcceptance 兜底', () => {
  const mkPool = (row) => ({ query: vi.fn().mockResolvedValue({ rows: row ? [row] : [] }) });

  it('e2e_acceptance=NULL + contract_content 有块 → 兜底非空 scenarios', async () => {
    const pool = mkPool({ e2e_acceptance: null, contract_content: CONTRACT_WITH_E2E });
    const r = await loadE2eAcceptance(pool, 'init-1');
    expect(r).not.toBeNull();
    expect(r.scenarios.length).toBeGreaterThan(0);
  });

  it('e2e_acceptance 非空 → 原样返回（行为保留，零回归）', async () => {
    const existing = { scenarios: [{ name: 'x', covered_tasks: ['t'], commands: [{ cmd: 'ls' }] }] };
    const pool = mkPool({ e2e_acceptance: existing, contract_content: CONTRACT_WITH_E2E });
    const r = await loadE2eAcceptance(pool, 'init-1');
    expect(r).toBe(existing);
  });

  it('两列都空 → null', async () => {
    const pool = mkPool({ e2e_acceptance: null, contract_content: null });
    expect(await loadE2eAcceptance(pool, 'init-1')).toBeNull();
  });

  it('无行 → null', async () => {
    const pool = mkPool(null);
    expect(await loadE2eAcceptance(pool, 'init-1')).toBeNull();
  });
});
