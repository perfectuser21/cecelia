import { describe, it, expect, vi } from 'vitest';

// @ts-expect-error: lib not yet implemented (red phase)
import * as report from '../../../harness-acceptance-v3/lib/render-report.mjs';

const FIXTURE = {
  acceptanceTaskId: 't-acc-1',
  initiativeId: 'harness-acceptance-v3-2026-05-07',
  nodeReport: {
    nodes: Object.fromEntries([
      'prep', 'planner', 'parsePrd', 'ganLoop', 'inferTaskPlan', 'dbUpsert',
      'pick_sub_task', 'run_sub_task', 'evaluate', 'advance', 'retry',
      'terminal_fail', 'final_evaluate', 'report',
    ].map((n) => [n, { count: 1, first_at: '2026-05-07T12:00:00Z', last_at: '2026-05-07T12:30:00Z' }])),
  },
  injections: {
    A: { injected_at: '2026-05-07T12:10:00Z', reacted_at: '2026-05-07T12:11:00Z', healed_state: 'PASS' },
    B: { injected_at: '2026-05-07T12:20:00Z', reacted_at: '2026-05-07T12:21:00Z', healed_state: 'failed (abort)' },
    C: { injected_at: '2026-05-07T12:30:00Z', reacted_at: '2026-05-07T12:32:00Z', healed_state: 'attempt+1 fresh thread' },
  },
};

describe('Workstream 6 — 最终验证 + 报告生成 + KR 回写 [BEHAVIOR]', () => {
  it('renderReport() 输出 markdown 含全部 6 段章节、3 段时间线（≥9 行 timeline 字段）、LiveMonitor URL', () => {
    const md: string = report.renderReport(FIXTURE);
    for (const sec of [
      '## Pre-flight 与派发',
      '## 14 节点事件表',
      '## 故障注入 A',
      '## 故障注入 B',
      '## 故障注入 C',
      '## 最终验证',
    ]) {
      expect(md).toContain(sec);
    }
    const tlMatches = md.match(/(?:注入时刻|反应时刻|自愈终态)/g) || [];
    expect(tlMatches.length).toBeGreaterThanOrEqual(9);
    expect(md).toMatch(/LiveMonitor.*localhost:5174\/monitor\?task_id=t-acc-1/);
  });

  it('verifyHealthEndpoint() body 缺 langgraph_version 时抛错', async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ last_attempt_at: new Date().toISOString() }), // 缺 langgraph_version
    }));
    await expect(
      report.verifyHealthEndpoint({ fetch: fakeFetch as any }),
    ).rejects.toThrow(/langgraph_version/i);
  });

  it('verifyHealthEndpoint() last_attempt_at 早于 90 分钟前抛错', async () => {
    const stale = new Date(Date.now() - 91 * 60 * 1000).toISOString();
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ langgraph_version: '0.1.0', last_attempt_at: stale }),
    }));
    await expect(
      report.verifyHealthEndpoint({ fetch: fakeFetch as any }),
    ).rejects.toThrow(/stale|too old|last_attempt_at/i);
  });

  it('verifyChildPrMerged() merged=false 时抛错（调用 GitHub API）', async () => {
    const fakeGh = vi.fn(async () => ({ merged: false }));
    await expect(
      report.verifyChildPrMerged('https://github.com/owner/repo/pull/123', { ghApi: fakeGh as any }),
    ).rejects.toThrow(/not merged|merged=false/i);
    expect(fakeGh).toHaveBeenCalled();
  });

  it('bumpKrProgress() 当现进度 ≥ 目标 delta 时 no-op（幂等），否则发起 PATCH', async () => {
    // 已经 ≥1% delta：no-op
    const fetchHigh = vi.fn(async (_u: string) => ({
      ok: true,
      json: async () => ({ progress_pct: 75, prev_progress_pct: 70 }),
    }));
    const r1 = await report.bumpKrProgress('kr-harness', 1, { fetch: fetchHigh as any });
    expect(r1.patched).toBe(false);

    // 不足 1%：触发 PATCH
    let patched = false;
    const fetchLow = vi.fn(async (_u: string, opts?: any) => {
      if (opts?.method === 'PATCH') { patched = true; return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => ({ progress_pct: 70, prev_progress_pct: 70 }) };
    });
    const r2 = await report.bumpKrProgress('kr-harness', 1, { fetch: fetchLow as any });
    expect(r2.patched).toBe(true);
    expect(patched).toBe(true);
  });
});
