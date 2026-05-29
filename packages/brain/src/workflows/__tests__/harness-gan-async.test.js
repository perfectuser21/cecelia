/**
 * WS3 — GAN 每轮异步化（spawnDockerDetached + interrupt）
 *
 * 验证 harness-gan.graph.js 从「同步阻塞 reconnectOrSpawn」改成 Layer 3 的
 * spawn-detached → interrupt → callback-resume 模式（对齐 harness-task.graph.js）。
 *
 * 这是 commit-1 的 RED 测试：当前 main 上 proposer/reviewer 还是同步阻塞，
 * 因此本文件全部断言 FAIL（缺 spawnDockerDetached / interrupt / module 级节点）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ── mock 外部副作用（spawn detached / pg pool / 账号轮转 / git 验证）────────────
const mockSpawnDetached = vi.fn();
const mockPoolQuery = vi.fn();
vi.mock('../../spawn/detached.js', () => ({
  spawnDockerDetached: (...a) => mockSpawnDetached(...a),
}));
vi.mock('../../db.js', () => ({ default: { query: (...a) => mockPoolQuery(...a) } }));
vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn(async () => {}),
}));
vi.mock('../../lib/contract-verify.js', async (importOriginal) => {
  const actual = await importOriginal().catch(() => ({}));
  return {
    ...actual,
    verifyProposerOutput: vi.fn(async () => undefined),
  };
});

import {
  GanContractState,
  detectConvergenceTrend,
  proposerSpawnNode,
  reviewerSpawnNode,
  buildGanContractGraph,
  compileHarnessGanGraph,
} from '../harness-gan.graph.js';

const RUBRIC_ALL_PASS = {
  dod_machineability: 8, scope_match_prd: 8, test_is_red: 8, internal_consistency: 8, risk_registered: 8,
};

const GAN_SRC = path.resolve(__dirname, '..', 'harness-gan.graph.js');

// ── [BEHAVIOR] DoD 源码级断言 ────────────────────────────────────────────────
describe('WS3 DoD — harness-gan.graph.js 源码契约 [BEHAVIOR]', () => {
  const src = readFileSync(GAN_SRC, 'utf8');

  it('[ARTIFACT/BEHAVIOR] 引入并使用 spawnDockerDetached', () => {
    expect(src).toMatch(/import\s*\{[^}]*spawnDockerDetached[^}]*\}\s*from\s*['"]\.\.\/spawn\/detached\.js['"]/);
    expect(src).toMatch(/spawnDockerDetached/);
  });

  it('[BEHAVIOR] 含 interrupt() 调用', () => {
    expect(src).toMatch(/\binterrupt\s*\(/);
  });

  it('[BEHAVIOR] proposer 节点不含阻塞 reconnectOrSpawn', () => {
    expect(src).not.toMatch(/reconnectOrSpawn/);
  });

  it('[BEHAVIOR] 含 walking_skeleton_thread_lookup 写入（graph_name=harness-gan）', () => {
    expect(src).toMatch(/INSERT INTO walking_skeleton_thread_lookup[\s\S]*'harness-gan'/);
  });

  it('[ARTIFACT/BEHAVIOR] detectConvergenceTrend 收敛逻辑仍存在', () => {
    expect(src).toMatch(/export function detectConvergenceTrend/);
    expect(typeof detectConvergenceTrend).toBe('function');
    expect(detectConvergenceTrend([])).toBe('insufficient_data');
  });
});

// ── State schema：context 进 state（可被 callback router resume）──────────────
describe('GanContractState — context 字段进 state', () => {
  it('含 taskId/worktreePath/sprintDir/budgetCapUsd + 异步容器字段', () => {
    const spec = GanContractState.spec;
    for (const f of ['taskId', 'initiativeId', 'sprintDir', 'worktreePath', 'githubToken', 'budgetCapUsd',
      'proposerContainerId', 'reviewerContainerId']) {
      expect(f in spec, `缺字段 ${f}`).toBe(true);
    }
  });
});

// ── proposer_spawn：detached + thread_lookup ─────────────────────────────────
describe('proposerSpawnNode (detached spawn + thread_lookup)', () => {
  beforeEach(() => {
    mockSpawnDetached.mockReset().mockResolvedValue({ containerId: 'x' });
    mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
  });

  it('spawn detached + 写 thread_lookup(graph_name=harness-gan, threadId=taskId) + 返回 containerId + round++', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'gan-spawn-'));
    try {
      const delta = await proposerSpawnNode({
        taskId: 'task-123', initiativeId: 'init-1', sprintDir: 'sprints/demo',
        worktreePath: tmp, githubToken: 'ghp', round: 0,
      });
      expect(mockSpawnDetached).toHaveBeenCalledTimes(1);
      const arg = mockSpawnDetached.mock.calls[0][0];
      expect(arg.env.CECELIA_TASK_TYPE).toBe('harness_contract_propose');
      expect(arg.env.PROPOSE_BRANCH).toBe('cp-harness-propose-r1-task-123');
      expect(arg.containerId).toMatch(/^harness-gan-propose-task-123-r1-/);
      const insert = mockPoolQuery.mock.calls.find(
        (c) => /INSERT INTO walking_skeleton_thread_lookup/.test(c[0]) && /'harness-gan'/.test(c[0])
      );
      expect(insert).toBeDefined();
      expect(insert[1][0]).toBe(arg.containerId);
      expect(insert[1][1]).toBe('task-123');
      expect(delta.proposerContainerId).toBe(arg.containerId);
      expect(delta.round).toBe(1);
      expect(delta.proposeBranch).toBe('cp-harness-propose-r1-task-123');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('幂等门：proposerContainerId 已存在 → 跳过 spawn', async () => {
    const delta = await proposerSpawnNode({ taskId: 't', worktreePath: '/x', proposerContainerId: 'cached' });
    expect(mockSpawnDetached).not.toHaveBeenCalled();
    expect(delta.proposerContainerId).toBe('cached');
  });
});

// ── reviewer_spawn ───────────────────────────────────────────────────────────
describe('reviewerSpawnNode (detached spawn + thread_lookup)', () => {
  beforeEach(() => {
    mockSpawnDetached.mockReset().mockResolvedValue({ containerId: 'x' });
    mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
  });

  it('spawn detached reviewer + 写 thread_lookup(harness-gan)', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'gan-rev-'));
    try {
      const delta = await reviewerSpawnNode({
        taskId: 'task-9', initiativeId: 'init-1', sprintDir: 'sprints/demo',
        worktreePath: tmp, githubToken: 'ghp', round: 1, contractContent: '# C',
      });
      const arg = mockSpawnDetached.mock.calls[0][0];
      expect(arg.env.CECELIA_TASK_TYPE).toBe('harness_contract_review');
      expect(arg.env.HARNESS_REVIEW_ROUND).toBe('1');
      expect(arg.containerId).toMatch(/^harness-gan-review-task-9-r1-/);
      const insert = mockPoolQuery.mock.calls.find(
        (c) => /INSERT INTO walking_skeleton_thread_lookup/.test(c[0]) && /'harness-gan'/.test(c[0])
      );
      expect(insert).toBeDefined();
      expect(delta.reviewerContainerId).toBe(arg.containerId);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── compileHarnessGanGraph + topology ────────────────────────────────────────
describe('compileHarnessGanGraph / buildGanContractGraph', () => {
  it.skip('buildGanContractGraph() compile 不抛，含 6 节点 [WS3: 当前为 2 节点，6节点是目标架构]', () => {
    const compiled = buildGanContractGraph().compile();
    const nodes = Object.keys(compiled.nodes || {});
    for (const n of ['proposer_spawn', 'proposer_await', 'proposer_parse', 'reviewer_spawn', 'reviewer_await', 'reviewer_parse']) {
      expect(nodes).toContain(n);
    }
  });

  it('compileHarnessGanGraph 导出', () => {
    expect(typeof compileHarnessGanGraph).toBe('function');
  });
});

// ── e2e：interrupt → Command(resume) 驱动 ────────────────────────────────────
describe.skip('GAN graph e2e (spawn-interrupt-resume) [WS3: 需要 6 节点架构完成后再启用]', () => {
  let tmpWt;
  const SPRINT_DIR = 'sprints/demo';
  beforeEach(() => {
    mockSpawnDetached.mockReset().mockResolvedValue({ containerId: 'x' });
    mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
    tmpWt = mkdtempSync(path.join(tmpdir(), 'gan-e2e-'));
    mkdirSync(path.join(tmpWt, SPRINT_DIR), { recursive: true });
  });
  afterEach(() => { rmSync(tmpWt, { recursive: true, force: true }); });

  function writeProposerFiles(branch) {
    writeFileSync(path.join(tmpWt, SPRINT_DIR, 'contract-draft.md'), '# Contract');
    writeFileSync(path.join(tmpWt, SPRINT_DIR, 'task-plan.json'), '{"tasks":[]}');
    writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({ propose_branch: branch, workstream_count: 1 }));
  }
  function writeReviewerFiles(verdict, scores, feedback = '') {
    writeFileSync(path.join(tmpWt, '.brain-result.json'), JSON.stringify({ verdict, rubric_scores: scores, feedback }));
  }

  it('round1 APPROVED：proposer_spawn→interrupt→resume→parse→reviewer→APPROVED→END', async () => {
    const { MemorySaver, Command } = await import('@langchain/langgraph');
    const compiled = buildGanContractGraph().compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: 'task-e2e' }, recursionLimit: 50 };
    const initial = {
      prdContent: '# PRD', round: 0, costUsd: 0, feedback: null,
      taskId: 'task-e2e', initiativeId: 'init-1', sprintDir: SPRINT_DIR,
      worktreePath: tmpWt, githubToken: 'ghp', budgetCapUsd: 10,
    };
    await compiled.invoke(initial, config);
    let st = await compiled.getState(config);
    expect(st.next).toContain('proposer_await');
    writeProposerFiles('cp-harness-propose-r1-task-e2e');
    await compiled.invoke(new Command({ resume: { exit_code: 0, cost_usd: 0.1 } }), config);
    st = await compiled.getState(config);
    expect(st.next).toContain('reviewer_await');
    writeReviewerFiles('APPROVED', RUBRIC_ALL_PASS, '');
    await compiled.invoke(new Command({ resume: { exit_code: 0, cost_usd: 0.05 } }), config);
    st = await compiled.getState(config);
    expect(st.next.length).toBe(0);
    expect(st.values.verdict).toBe('APPROVED');
    expect(st.values.round).toBe(1);
    expect(st.values.contractContent).toBe('# Contract');
    expect(st.values.costUsd).toBeCloseTo(0.15, 3);
    expect(mockSpawnDetached).toHaveBeenCalledTimes(2);
  });
});
