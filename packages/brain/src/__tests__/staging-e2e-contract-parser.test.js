/**
 * parseE2eAcceptanceFromContract 单元测试。
 *
 * 验证从真实 contract-draft.md 解析出 scenarios.length > 0，
 * 且输出能通过 normalizeAcceptance 的非空 scenarios 强校验。
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, vi } from 'vitest';

// mock 必须在 await import 之前
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

const { parseE2eAcceptanceFromContract, runStagingE2E } = await import('../staging-e2e-runner.js');
const { normalizeAcceptance } = await import('../harness-final-e2e.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/__tests__ → src → brain → packages → repo root (4 levels)
const REPO_ROOT = resolve(__dirname, '../../../..');

// ─── 真实合同文件测试 ──────────────────────────────────────────────────────────

describe('parseE2eAcceptanceFromContract — 真实 contract-draft.md', () => {
  it('sprints/contract-draft.md → scenarios.length > 0', () => {
    const content = readFileSync(resolve(REPO_ROOT, 'sprints/contract-draft.md'), 'utf8');
    const result = parseE2eAcceptanceFromContract(content);
    expect(result).not.toBeNull();
    expect(result.scenarios.length).toBeGreaterThan(0);
  });

  it('sprints/w26-playground-increment/contract-draft.md → scenarios.length > 0', () => {
    const content = readFileSync(
      resolve(REPO_ROOT, 'sprints/w26-playground-increment/contract-draft.md'), 'utf8'
    );
    const result = parseE2eAcceptanceFromContract(content);
    expect(result).not.toBeNull();
    expect(result.scenarios.length).toBeGreaterThan(0);
  });

  it('sprints/06111220-skill-drift-patrol/contract-draft.md → scenarios.length > 0', () => {
    const content = readFileSync(
      resolve(REPO_ROOT, 'sprints/06111220-skill-drift-patrol/contract-draft.md'), 'utf8'
    );
    const result = parseE2eAcceptanceFromContract(content);
    expect(result).not.toBeNull();
    expect(result.scenarios.length).toBeGreaterThan(0);
  });
});

// ─── 输出格式校验 ──────────────────────────────────────────────────────────────

describe('parseE2eAcceptanceFromContract — 输出格式', () => {
  const INLINE_BASH = `
# Sprint Contract

## E2E 验收（target_environment: local_api）

**journey_type**: autonomous

\`\`\`bash
#!/bin/bash
set -e
curl -sf http://localhost:5221/api/brain/health | jq -e '.status == "ok"'
echo "✅ E2E 通过"
\`\`\`

**通过标准**: 脚本 exit 0

## Workstreams
`;

  it('内联 bash 块 → 一个 scenario，name/covered_tasks/commands 齐全', () => {
    const result = parseE2eAcceptanceFromContract(INLINE_BASH);
    expect(result).not.toBeNull();
    const sc = result.scenarios[0];
    expect(sc.name).toBe('E2E 验收');
    expect(Array.isArray(sc.covered_tasks)).toBe(true);
    expect(sc.covered_tasks.length).toBeGreaterThan(0);
    expect(Array.isArray(sc.commands)).toBe(true);
    expect(sc.commands.length).toBeGreaterThan(0);
    expect(typeof sc.commands[0].cmd).toBe('string');
    expect(sc.commands[0].cmd).toContain('curl');
  });

  it('内联 bash 块输出可过 normalizeAcceptance 非空 scenarios 检查（行 93-97）', () => {
    const result = parseE2eAcceptanceFromContract(INLINE_BASH);
    expect(() => normalizeAcceptance(result)).not.toThrow();
    const { scenarios } = normalizeAcceptance(result);
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it('多个 bash 块 → 多个 scenarios，name 有序编号', () => {
    const multi = `
## E2E 验收

\`\`\`bash
echo "block 1"
\`\`\`

\`\`\`bash
echo "block 2"
\`\`\`
`;
    const result = parseE2eAcceptanceFromContract(multi);
    expect(result.scenarios.length).toBe(2);
    expect(result.scenarios[0].name).toBe('E2E 验收');
    expect(result.scenarios[1].name).toBe('E2E 验收 #2');
  });

  it('脚本文件引用 (.sh) → bash 命令', () => {
    const scriptRef = `
## E2E 验收

script: scripts/e2e/check.sh

## Next Section
`;
    const result = parseE2eAcceptanceFromContract(scriptRef);
    expect(result).not.toBeNull();
    expect(result.scenarios[0].commands[0].cmd).toContain('bash');
    expect(result.scenarios[0].commands[0].cmd).toContain('check.sh');
  });

  it('脚本文件引用 (.ps1) → powershell 命令', () => {
    const scriptRef = `
## E2E 验收

run: scripts/e2e/test.ps1
`;
    const result = parseE2eAcceptanceFromContract(scriptRef);
    expect(result).not.toBeNull();
    expect(result.scenarios[0].commands[0].type).toBe('powershell');
    expect(result.scenarios[0].commands[0].cmd).toContain('powershell');
  });

  it('无 E2E 验收段 → null', () => {
    expect(parseE2eAcceptanceFromContract('# 只是个标题\n没有 E2E 段')).toBeNull();
  });

  it('E2E 验收段有但无代码块无脚本引用 → null', () => {
    const empty = '## E2E 验收\n\n只有文字描述\n\n## 下一节\n';
    expect(parseE2eAcceptanceFromContract(empty)).toBeNull();
  });

  it('null / 空字符串输入 → null', () => {
    expect(parseE2eAcceptanceFromContract(null)).toBeNull();
    expect(parseE2eAcceptanceFromContract('')).toBeNull();
    expect(parseE2eAcceptanceFromContract(123)).toBeNull();
  });
});

// ─── loadE2eAcceptance 兜底逻辑（通过 runStagingE2E opts.loadAcceptance 注入） ──

describe('runStagingE2E — e2e_acceptance 为 null 时回退解析 contract_content', () => {
  it('loadAcceptance 返回解析结果 → 不 SKIP no_contract', async () => {
    const contractContent = `
## E2E 验收

\`\`\`bash
echo "staging ok"
\`\`\`
`;
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const acceptance = parseE2eAcceptanceFromContract(contractContent);
    const loadAcceptance = vi.fn().mockResolvedValue(acceptance);
    const exec = vi.fn(() => '');
    const deploy = vi.fn(() => ({ status: 'success', output: '', stagingPort: 5222 }));

    const task = { id: 'task-uuid-001', payload: { initiative_id: 'init-001', pr_url: 'https://github.com/x/y/pull/1' } };
    const result = await runStagingE2E(task, { pool: mockPool, loadAcceptance, deploy, exec });

    expect(loadAcceptance).toHaveBeenCalledWith(mockPool, 'init-001');
    expect(deploy).toHaveBeenCalled();
    expect(result.verdict).not.toBe('SKIP');
  });

  it('loadAcceptance 返回 null → SKIP no_contract', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const loadAcceptance = vi.fn().mockResolvedValue(null);
    const deploy = vi.fn();

    const task = { id: 'task-uuid-002', payload: { initiative_id: 'init-002' } };
    const result = await runStagingE2E(task, { pool: mockPool, loadAcceptance, deploy });

    expect(deploy).not.toHaveBeenCalled();
    expect(result.verdict).toBe('SKIP');
    expect(result.reason).toBe('no_contract');
  });
});
