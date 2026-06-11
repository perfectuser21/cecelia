/**
 * contract-gate-wiring.test.js — evaluateContractNode 在 spawn LLM evaluator 之前接同一 gate。
 *
 * 合同 Step 8：
 *  - 注入 gate-FAIL（ok:false）→ 返回 evaluate_verdict==='FAIL'，spawn 桩 0 次调用，feedback 含结构化命中清单
 *  - 注入 gate-PASS（ok:true）→ 照常 spawn（spawn 桩被调用）
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../account-usage.js', () => ({
  isSpendingCapped: () => false,
  isAuthFailed: () => false,
  selectBestAccount: vi.fn().mockResolvedValue(null),
}));

const { evaluateContractNode } = await import('../harness-task.graph.js');

const baseState = (overrides = {}) => ({
  task: { id: 'cg-wiring-task', task_type: 'harness_evaluate', payload: { sprint_dir: 'sprints/x' } },
  initiativeId: 'cg-init',
  pr_url: 'https://github.com/x/y/pull/123',
  pr_branch: 'cp-test-pr-branch',
  worktreePath: '/tmp/cg-wiring',
  githubToken: 'fake-token',
  fix_round: 0,
  ...overrides,
});

const baseOpts = () => ({
  resolveToken: vi.fn().mockResolvedValue('fake-token'),
  poolOverride: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  checkPrMerged: vi.fn().mockResolvedValue(false),
  // ARTIFACT 门不干扰本测（聚焦 Contract Gate 接线）
  verifyArtifacts: vi.fn().mockResolvedValue({ ran: false }),
});

describe('evaluateContractNode — Contract Gate 接线（spawn 前确定性拦截）', () => {
  it('gate-FAIL（ok:false）→ verdict=FAIL 且不 spawn 容器，feedback 含命中清单', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fake' });
    const runContractGate = vi.fn().mockResolvedValue({
      ok: false,
      hits: [
        {
          ruleId: 'cheat/mock-env',
          line: 12,
          excerpt: 'MOCK_WECHAT_VERSION=4.2.0.0',
          feedback: '第 12 行注入 MOCK_*——删除',
          exempted: false,
        },
      ],
      exemptions: [],
      envMissing: [],
    });

    const res = await evaluateContractNode(
      baseState(),
      { ...baseOpts(), spawnDetached, runContractGate }
    );

    expect(res.evaluate_verdict).toBe('FAIL');
    expect(runContractGate).toHaveBeenCalledOnce();
    // 关键：命中即拦截，不浪费 evaluator 容器
    expect(spawnDetached).not.toHaveBeenCalled();
    // feedback 必须是结构化命中清单（含 ruleId，供 generator/proposer 消费）
    expect(res.evaluate_error).toMatch(/cheat\/mock-env/);
  });

  it('gate-PASS（ok:true）→ 照常 spawn（语义判断仍归 LLM evaluator）', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fake' });
    const runContractGate = vi.fn().mockResolvedValue({
      ok: true,
      hits: [],
      exemptions: [],
      envMissing: [],
    });

    await evaluateContractNode(
      baseState(),
      { ...baseOpts(), spawnDetached, runContractGate }
    ).catch(() => {
      /* interrupt() 在图外抛错 OK —— spawn 已在 interrupt 前被调过 */
    });

    expect(runContractGate).toHaveBeenCalledOnce();
    expect(spawnDetached).toHaveBeenCalledOnce();
  });

  it('gate 执行异常 → fail-open（转 LLM evaluator，不误杀；不像 gate 命中那样直接 FAIL）', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fake' });
    const runContractGate = vi.fn().mockRejectedValue(new Error('boom'));

    await evaluateContractNode(
      baseState(),
      { ...baseOpts(), spawnDetached, runContractGate }
    ).catch(() => {});

    expect(runContractGate).toHaveBeenCalledOnce();
    // 异常 fail-open：继续走到 spawn（保留既有 ARTIFACT 门同样的容错语义）
    expect(spawnDetached).toHaveBeenCalledOnce();
  });
});
