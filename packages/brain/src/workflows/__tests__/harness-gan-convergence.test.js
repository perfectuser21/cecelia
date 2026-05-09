/**
 * harness-gan-convergence.test.js — GAN 收敛检测单元 + reviewer node 集成测试
 *
 * 验证 detectConvergenceTrend 纯函数 4 个返回值，以及 reviewer node 在
 * diverging / oscillating 时 force APPROVED + forcedApproval=true + emit P1 alert。
 *
 * 替代旧的 MAX_ROUNDS 硬 cap 测试（用户原话：无轮数上限，但发散时自动收敛）。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  detectConvergenceTrend,
  createGanContractNodes,
} from '../harness-gan.graph.js';

// ── detectConvergenceTrend 纯函数单元 ─────────────────────────────────────

describe('detectConvergenceTrend [BEHAVIOR]', () => {
  it('rubricHistory 长度 < 3 → insufficient_data（继续 GAN）', () => {
    expect(detectConvergenceTrend([])).toBe('insufficient_data');
    expect(detectConvergenceTrend([
      { round: 1, scores: { dod_machineability: 5, scope_match_prd: 5, test_is_red: 5, internal_consistency: 5, risk_registered: 5 } },
    ])).toBe('insufficient_data');
    expect(detectConvergenceTrend([
      { round: 1, scores: { dod_machineability: 5, scope_match_prd: 5, test_is_red: 5, internal_consistency: 5, risk_registered: 5 } },
      { round: 2, scores: { dod_machineability: 6, scope_match_prd: 6, test_is_red: 6, internal_consistency: 6, risk_registered: 6 } },
    ])).toBe('insufficient_data');
  });

  it('最近 2 轮 5 维度全部 ≥ 上一轮 → converging', () => {
    const hist = [
      { round: 1, scores: { dod_machineability: 5, scope_match_prd: 5, test_is_red: 5, internal_consistency: 5, risk_registered: 5 } },
      { round: 2, scores: { dod_machineability: 6, scope_match_prd: 6, test_is_red: 5, internal_consistency: 6, risk_registered: 6 } },
      { round: 3, scores: { dod_machineability: 7, scope_match_prd: 7, test_is_red: 6, internal_consistency: 7, risk_registered: 7 } },
    ];
    expect(detectConvergenceTrend(hist)).toBe('converging');
  });

  it('5 维度全部持平 → 仍算 converging（持平不是发散）', () => {
    const hist = [
      { round: 1, scores: { dod_machineability: 7, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 2, scores: { dod_machineability: 7, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 3, scores: { dod_machineability: 7, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
    ];
    expect(detectConvergenceTrend(hist)).toBe('converging');
  });

  it('任一维度连续 2 轮走低 → diverging', () => {
    const hist = [
      { round: 1, scores: { dod_machineability: 8, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 2, scores: { dod_machineability: 7, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 3, scores: { dod_machineability: 6, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
    ];
    expect(detectConvergenceTrend(hist)).toBe('diverging');
  });

  it('最近 3 轮某维度高低高震荡 → oscillating', () => {
    const hist = [
      { round: 1, scores: { dod_machineability: 8, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 2, scores: { dod_machineability: 6, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 3, scores: { dod_machineability: 8, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
    ];
    expect(detectConvergenceTrend(hist)).toBe('oscillating');
  });

  it('最近 3 轮某维度低高低震荡 → oscillating', () => {
    const hist = [
      { round: 1, scores: { dod_machineability: 6, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 2, scores: { dod_machineability: 8, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 3, scores: { dod_machineability: 6, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
    ];
    expect(detectConvergenceTrend(hist)).toBe('oscillating');
  });

  it('鲁棒：rubricHistory entry 缺失 scores 字段不抛错，按 insufficient_data 兜底', () => {
    expect(() => detectConvergenceTrend([
      { round: 1 }, { round: 2 }, { round: 3 },
    ])).not.toThrow();
  });
});

// ── reviewer node 集成测试（mock executor） ──────────────────────────────

function makeCtx(overrides = {}) {
  return {
    taskId: 'task-conv',
    initiativeId: 'init-conv',
    sprintDir: 'sprints/demo',
    worktreePath: '/tmp/wt/conv',
    githubToken: 'ghs_test',
    readContractFile: vi.fn(async () => '# Contract content'),
    // H10: reviewer 节点不调 fetchOriginFile，但 ctx DI 后默认会真跑 git，加 mock 防御。
    fetchOriginFile: vi.fn(async () => '{"tasks":[]}'),
    ...overrides,
  };
}

function rubricStdout(scores, verdictText = 'REVISION') {
  const json = JSON.stringify(scores);
  return [
    '## RUBRIC SCORES',
    '```json',
    json,
    '```',
    '',
    `VERDICT: ${verdictText}`,
  ].join('\n');
}

describe('reviewer node 收敛检测集成 [BEHAVIOR]', () => {
  it('5 轮以上但全部 converging → 不 force（GAN 不再被轮数硬 cap）', async () => {
    // round 6 进 reviewer，rubricHistory 已有 5 个上升记录
    // round 6 阈值是 6，故意 4 个 6 + 1 个 5（risk_registered）让 rubric 判 REVISION 继续 GAN
    const stdout = rubricStdout({ dod_machineability: 6, scope_match_prd: 6, test_is_red: 6, internal_consistency: 6, risk_registered: 5 }, 'REVISION');
    const executor = vi.fn(async () => ({ exit_code: 0, stdout, stderr: '', cost_usd: 0.05 }));
    const nodes = createGanContractNodes(executor, makeCtx());
    const rubricHistory = [
      { round: 1, scores: { dod_machineability: 1, scope_match_prd: 1, test_is_red: 1, internal_consistency: 1, risk_registered: 1 } },
      { round: 2, scores: { dod_machineability: 2, scope_match_prd: 2, test_is_red: 2, internal_consistency: 2, risk_registered: 2 } },
      { round: 3, scores: { dod_machineability: 3, scope_match_prd: 3, test_is_red: 3, internal_consistency: 3, risk_registered: 3 } },
      { round: 4, scores: { dod_machineability: 4, scope_match_prd: 4, test_is_red: 4, internal_consistency: 4, risk_registered: 4 } },
      { round: 5, scores: { dod_machineability: 5, scope_match_prd: 5, test_is_red: 5, internal_consistency: 5, risk_registered: 5 } },
    ];
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 6, costUsd: 0, rubricHistory,
    });
    // 没全 ≥ 7 → REVISION（继续），没 force（converging — 5→6 全升）
    expect(newState.verdict).toBe('REVISION');
    expect(newState.forcedApproval).toBe(false);
  });

  it('diverging（dod_machineability 连续走低）→ force APPROVED + forcedApproval=true + P1 alert', async () => {
    const stdout = rubricStdout({ dod_machineability: 4, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 }, 'REVISION');
    const executor = vi.fn(async () => ({ exit_code: 0, stdout, stderr: '', cost_usd: 0.05 }));
    const nodes = createGanContractNodes(executor, makeCtx());
    const rubricHistory = [
      { round: 1, scores: { dod_machineability: 8, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 2, scores: { dod_machineability: 6, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
    ];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 3, costUsd: 0, rubricHistory,
    });
    expect(newState.verdict).toBe('APPROVED');
    expect(newState.forcedApproval).toBe(true);
    const warnMsg = warnSpy.mock.calls.flat().join(' ');
    expect(warnMsg).toMatch(/\[harness-gan\]\[P1\]/);
    expect(warnMsg).toMatch(/diverging/i);
    warnSpy.mockRestore();
  });

  it('oscillating（dod_machineability 在 8/6/8 震荡）→ force APPROVED + P1 alert', async () => {
    // 当前轮 round=3 scores: dod_machineability=8（震荡回升），scope_match_prd=4 让 rubric 判 REVISION
    // 然后 history [r1=8, r2=6, r3=8] → high-low-high → oscillating
    const stdout = rubricStdout({ dod_machineability: 8, scope_match_prd: 4, test_is_red: 7, internal_consistency: 7, risk_registered: 7 }, 'REVISION');
    const executor = vi.fn(async () => ({ exit_code: 0, stdout, stderr: '', cost_usd: 0.05 }));
    const nodes = createGanContractNodes(executor, makeCtx());
    const rubricHistory = [
      { round: 1, scores: { dod_machineability: 8, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
      { round: 2, scores: { dod_machineability: 6, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 } },
    ];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 3, costUsd: 0, rubricHistory,
    });
    expect(newState.verdict).toBe('APPROVED');
    expect(newState.forcedApproval).toBe(true);
    const warnMsg = warnSpy.mock.calls.flat().join(' ');
    expect(warnMsg).toMatch(/\[harness-gan\]\[P1\]/);
    expect(warnMsg).toMatch(/oscillating/i);
    warnSpy.mockRestore();
  });

  it('reviewer 把当前轮 rubric_scores 累积进 rubricHistory state patch', async () => {
    const scores = { dod_machineability: 7, scope_match_prd: 7, test_is_red: 7, internal_consistency: 7, risk_registered: 7 };
    const stdout = rubricStdout(scores, 'APPROVED');
    const executor = vi.fn(async () => ({ exit_code: 0, stdout, stderr: '', cost_usd: 0.05 }));
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0, rubricHistory: [],
    });
    expect(newState.rubricHistory).toBeDefined();
    expect(newState.rubricHistory).toHaveLength(1);
    expect(newState.rubricHistory[0]).toMatchObject({ round: 1, scores });
  });

  it('insufficient_data（< 3 轮）即使 rubric 不达标也不 force APPROVED', async () => {
    const stdout = rubricStdout({ dod_machineability: 4, scope_match_prd: 4, test_is_red: 4, internal_consistency: 4, risk_registered: 4 }, 'REVISION');
    const executor = vi.fn(async () => ({ exit_code: 0, stdout, stderr: '', cost_usd: 0.05 }));
    const nodes = createGanContractNodes(executor, makeCtx());
    const newState = await nodes.reviewer({
      prdContent: '# PRD', contractContent: '# C', round: 1, costUsd: 0, rubricHistory: [],
    });
    expect(newState.verdict).toBe('REVISION');
    expect(newState.forcedApproval).toBe(false);
  });
});

describe('MAX_ROUNDS 常量已删除 [ARTIFACT]', () => {
  it('harness-gan.graph.js 不再 export MAX_ROUNDS', async () => {
    const mod = await import('../harness-gan.graph.js');
    expect(mod.MAX_ROUNDS).toBeUndefined();
  });
});
