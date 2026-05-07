import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync, constants } from 'node:fs';
import { execSync } from 'node:child_process';

const FIXED_UUID = '39d535f3-520a-4a92-a2b6-b31645e11664';
const VERIFY_SCRIPT = 'scripts/acceptance/w8-v2/verify-checklist.sh';
const REPORT = 'docs/superpowers/reports/2026-05-07-harness-langgraph-acceptance-v2.md';
const NODES = [
  'prep', 'planner', 'parsePrd', 'ganLoop', 'inferTaskPlan',
  'dbUpsert', 'pick_sub_task', 'run_sub_task', 'evaluate', 'advance',
  'retry', 'terminal_fail', 'final_evaluate', 'report',
];

describe('Workstream 3 — verify-checklist.sh [BEHAVIOR]', () => {
  it('脚本文件存在 + shebang + set -euo pipefail', () => {
    expect(() => accessSync(VERIFY_SCRIPT, constants.R_OK)).not.toThrow();
    const c = readFileSync(VERIFY_SCRIPT, 'utf8');
    expect(c).toMatch(/^#!\/bin\/bash/);
    expect(c).toMatch(/set -[eu]+o\s+pipefail/);
  });

  it('脚本含 14 distinct nodeName 计数断言（数字 14 + DISTINCT nodeName）', () => {
    const c = readFileSync(VERIFY_SCRIPT, 'utf8');
    expect(c).toMatch(/count\(DISTINCT[^)]*nodeName/i);
    expect(c).toContain('14');
  });

  it('脚本含 thin feature PR merged 校验 (gh pr list --state merged)', () => {
    const c = readFileSync(VERIFY_SCRIPT, 'utf8');
    expect(c).toMatch(/gh pr list[^\n]+--state merged/);
  });

  it('脚本含 3 故障注入终态聚合 (docker_oom_killed + interrupt_resumed + watchdog_overdue)', () => {
    const c = readFileSync(VERIFY_SCRIPT, 'utf8');
    expect(c).toContain('docker_oom_killed');
    expect(c).toContain('interrupt_resumed');
    expect(c).toContain('watchdog_overdue');
  });

  it('脚本含 KR 进度增量校验 (kr-snapshot-before.json + /api/brain/okr/current + harness-reliability)', () => {
    const c = readFileSync(VERIFY_SCRIPT, 'utf8');
    expect(c).toContain('kr-snapshot-before.json');
    expect(c).toContain('/api/brain/okr/current');
    expect(c).toContain('harness-reliability');
  });

  it('脚本含至少 3 处 exit 1（失败显式退出）', () => {
    const c = readFileSync(VERIFY_SCRIPT, 'utf8');
    const exits = (c.match(/exit\s+1/g) || []).length;
    expect(exits).toBeGreaterThanOrEqual(3);
  });

  it('脚本 bash -n 语法合法', () => {
    expect(() => execSync(`bash -n ${VERIFY_SCRIPT}`, { stdio: 'pipe' })).not.toThrow();
  });
});

describe('Workstream 3 — acceptance 报告 [BEHAVIOR]', () => {
  it('报告文件存在', () => {
    expect(() => accessSync(REPORT, constants.R_OK)).not.toThrow();
  });

  it('报告含 4 个固定 H2 标题（结论 / 14 节点事件计数 / 故障注入终态 / KR 进度增量）', () => {
    const c = readFileSync(REPORT, 'utf8');
    for (const h of ['## 结论', '## 14 节点事件计数', '## 故障注入终态', '## KR 进度增量']) {
      expect(c, `missing H2: ${h}`).toContain(h);
    }
  });

  it('报告含 fixed UUID 字面量', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toContain(FIXED_UUID);
  });

  it('报告含 14 节点全部 nodeName 列表', () => {
    const c = readFileSync(REPORT, 'utf8');
    for (const n of NODES) {
      expect(c, `missing node: ${n}`).toContain(n);
    }
  });

  it('报告含 3 个故障注入子节标题（场景 A / 场景 B / 场景 C）', () => {
    const c = readFileSync(REPORT, 'utf8');
    expect(c).toContain('场景 A');
    expect(c).toContain('场景 B');
    expect(c).toContain('场景 C');
  });
});
