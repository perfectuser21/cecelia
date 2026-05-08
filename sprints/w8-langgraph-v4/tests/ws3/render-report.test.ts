import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  renderAcceptanceReport,
  renderLeadEvidence,
  writeReportFiles,
} from '../../../../scripts/acceptance/w8-v4/render-report.mjs';

const SAMPLE_FIXTURE = {
  taskId: '5eb2718b-48c7-43a1-88cb-8995a4b49bff',
  dispatchTs: 1715140000,
  initiativeId: 'harness-acceptance-v4-2026-05-08',
  nodeEvents: [
    { node: 'prep', count: 1 },
    { node: 'planner', count: 1 },
    { node: 'parsePrd', count: 1 },
    { node: 'ganLoop', count: 4 },
    { node: 'inferTaskPlan', count: 1, propose_branch: 'cp-harness-propose-r2-5eb2718b' },
    { node: 'dbUpsert', count: 1 },
    { node: 'pick_sub_task', count: 1 },
    { node: 'run_sub_task', count: 2 },
    { node: 'evaluate', count: 2 },
    { node: 'advance', count: 1 },
    { node: 'retry', count: 1 },
    { node: 'terminal_fail', count: 1 },
    { node: 'final_evaluate', count: 1 },
    { node: 'report', count: 1 },
  ],
  faultInjections: [
    { kind: 'A', injectedAt: '2026-05-08T09:30:00Z', reactedAt: '2026-05-08T09:30:08Z', healedAt: '2026-05-08T09:32:00Z' },
    { kind: 'B', injectedAt: '2026-05-08T09:45:00Z', reactedAt: '2026-05-08T09:55:00Z', resumedAt: '2026-05-08T09:56:00Z' },
    { kind: 'C', injectedAt: '2026-05-08T10:10:00Z', reactedAt: '2026-05-08T10:13:00Z', reattemptAt: '2026-05-08T10:14:00Z' },
  ],
  v3Diff: { v3FailItem: 'inferTaskPlan branch mismatch', v4Status: 'PASS' },
  krProgress: 7,
};

describe('Workstream 3 — render report [BEHAVIOR]', () => {
  it('renderAcceptanceReport 普通 mode 输出 ≥ 2000 字节且含 6 个关键章节', async () => {
    const md = await renderAcceptanceReport(SAMPLE_FIXTURE);
    expect(md.length).toBeGreaterThanOrEqual(2000);
    for (const kw of ['graph_node_update', '故障注入 A', '故障注入 B', '故障注入 C', 'v3', 'watchdog']) {
      expect(md).toContain(kw);
    }
  });

  it('renderAcceptanceReport mode=dryrun-nodes-only 含 14/14 字面量', async () => {
    const md = await renderAcceptanceReport({ ...SAMPLE_FIXTURE, mode: 'dryrun-nodes-only' });
    expect(md).toContain('14/14');
  });

  it('renderAcceptanceReport 节点不足 14 时输出含 missing 标记', async () => {
    const partial = { ...SAMPLE_FIXTURE, nodeEvents: SAMPLE_FIXTURE.nodeEvents.slice(0, 13) };
    const md = await renderAcceptanceReport({ ...partial, mode: 'dryrun-nodes-only' });
    expect(md).toMatch(/13\/14|missing|缺/i);
  });

  it('renderLeadEvidence 输出 ≥ 1000 字节且含 5 个 lead 关键字', async () => {
    const lead = await renderLeadEvidence({
      brainHead: 'aaaaaaaa',
      mainHead: 'aaaaaaaa',
      brainStatus: 'normal',
      accTaskId: SAMPLE_FIXTURE.taskId,
      terminalStatus: 'completed',
      taskEventsSummary: 'rows: 14',
    });
    expect(lead.length).toBeGreaterThanOrEqual(1000);
    for (const kw of ['rev-parse', 'brain/status', '/api/brain/tasks', 'task_events', 'status FROM tasks']) {
      expect(lead).toContain(kw);
    }
  });

  it('writeReportFiles 不存在的嵌套目录会先 mkdir 再写文件', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'w8v4-test-'));
    const reportPath = path.join(tmpRoot, 'docs/superpowers/reports/sample.md');
    const leadPath = path.join(tmpRoot, '.agent-knowledge/harness-langgraph-14-node/lead.md');
    await writeReportFiles({
      reportPath,
      reportContent: '# REPORT',
      leadPath,
      leadContent: '# LEAD',
    });
    const r = await fs.readFile(reportPath, 'utf8');
    const l = await fs.readFile(leadPath, 'utf8');
    expect(r).toBe('# REPORT');
    expect(l).toBe('# LEAD');
    await fs.rm(tmpRoot, { recursive: true });
  });
});
