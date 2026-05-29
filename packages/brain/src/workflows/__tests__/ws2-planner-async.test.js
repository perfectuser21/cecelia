/**
 * WS2 — Planner 节点异步化（spawnDockerDetached + interrupt）
 *
 * 把 runPlannerNode 从同步阻塞 reconnectOrSpawn 改为 Layer 3 spawn-and-interrupt：
 *   - spawnDockerDetached（docker run -d，立即 return，不阻塞 5-10 分钟）
 *   - 写 walking_skeleton_thread_lookup（containerId → thread_id, graph_name='harness-initiative'）
 *   - interrupt() yield，等 callback router Command(resume) 续跑
 *
 * 参考 harness-task.graph.js 的 spawnNode / awaitCallbackNode / evaluateContractNode。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver, Command, StateGraph, START, END } from '@langchain/langgraph';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mockSpawnDetached = vi.fn();
const mockResolveAccount = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock('../../db.js', () => ({ default: { query: (...a) => mockPoolQuery(...a), connect: vi.fn() } }));
vi.mock('../../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../../spawn/host-executor.js', () => ({ executeOnHost: vi.fn() }));
vi.mock('../../spawn/detached.js', () => ({ spawnDockerDetached: (...a) => mockSpawnDetached(...a) }));
vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: (...a) => mockResolveAccount(...a),
}));
vi.mock('../../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(async () => '/wt/test'),
  harnessSubTaskWorktreePath: (id, l) => `/wt/${id}-${l}`,
}));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn(async () => 'ghp_x') }));
vi.mock('../../harness-shared.js', async (orig) => {
  const actual = await orig();
  return { ...actual, loadSkillContent: () => 'SKILL', parseDockerOutput: (s) => s };
});
vi.mock('../../harness-dag.js', () => ({ parseTaskPlan: vi.fn(), upsertTaskPlan: vi.fn() }));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('../../harness-final-e2e.js', () => ({
  runFinalE2E: vi.fn(), attributeFailures: () => new Map(),
  runScenarioCommand: vi.fn(), bootstrapE2E: vi.fn(), teardownE2E: vi.fn(),
  normalizeAcceptance: (a) => a,
}));
vi.mock('../../harness-container-cleanup.js', () => ({ killInitiativeContainers: vi.fn() }));
vi.mock('../../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn(async () => new MemorySaver()),
}));

import { runPlannerNode, InitiativeState } from '../harness-initiative.graph.js';

const baseState = {
  task: { id: 't1', description: 'do something', payload: {} },
  initiativeId: 'init-1',
  worktreePath: '/wt/test',
  githubToken: 'gh',
};

describe('WS2 runPlannerNode — spawn-and-interrupt', () => {
  beforeEach(() => {
    mockSpawnDetached.mockReset().mockResolvedValue({ containerId: 'x' });
    mockResolveAccount.mockReset().mockResolvedValue(undefined);
    mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
  });

  it('spawn detached + 写 walking_skeleton_thread_lookup(harness-initiative) + interrupt yield', async () => {
    let thrown = null;
    try {
      await runPlannerNode(baseState, {
        spawnDetached: mockSpawnDetached,
        pool: { query: mockPoolQuery },
        configurable: { thread_id: 'harness-initiative:init-1:2' },
      });
    } catch (e) {
      thrown = e; // interrupt() 在 graph 上下文外抛出 — 预期
    }

    // spawnDockerDetached 被调用（非阻塞）
    expect(mockSpawnDetached).toHaveBeenCalledTimes(1);
    const arg = mockSpawnDetached.mock.calls[0][0];
    expect(arg.env.HARNESS_NODE).toBe('planner');
    expect(arg.env.CECELIA_TASK_TYPE).toBe('harness_planner');
    expect(arg.env.GITHUB_TOKEN).toBe('gh');
    expect(arg.containerId).toMatch(/^harness-planner-t1-/);
    // callback URL 指向本 containerId（容器跑完 POST 回来）
    expect(arg.env.HARNESS_CALLBACK_URL).toContain(arg.containerId);

    // thread_lookup INSERT：graph_name='harness-initiative'
    const insert = mockPoolQuery.mock.calls.find(
      (c) => /INSERT INTO walking_skeleton_thread_lookup/.test(c[0]) && /'harness-initiative'/.test(c[0])
    );
    expect(insert).toBeDefined();
    expect(insert[1][0]).toBe(arg.containerId);          // container_id
    expect(insert[1][1]).toBe('harness-initiative:init-1:2'); // thread_id 来自 config

    // interrupt() 在 graph 外抛出，证明节点确实 yield 等 callback
    expect(thrown).toBeTruthy();
  });

  it('idempotent: state.plannerOutput 已存在 → passthrough，不 spawn', async () => {
    const delta = await runPlannerNode(
      { ...baseState, plannerOutput: 'cached PRD' },
      { spawnDetached: mockSpawnDetached, pool: { query: mockPoolQuery } }
    );
    expect(delta.plannerOutput).toBe('cached PRD');
    expect(mockSpawnDetached).not.toHaveBeenCalled();
  });

  it('resume: interrupt 后 Command(resume={stdout,exit_code:0}) → 续跑产 plannerOutput', async () => {
    const compiled = new StateGraph(InitiativeState)
      .addNode('planner', runPlannerNode)
      .addEdge(START, 'planner')
      .addEdge('planner', END)
      .compile({ checkpointer: new MemorySaver() });

    const config = { configurable: { thread_id: 'harness-initiative:init-r:1' } };
    await compiled.invoke({ ...baseState, initiativeId: 'init-r' }, config);

    let st = await compiled.getState(config);
    expect(st.next).toContain('planner'); // 停在 planner interrupt

    await compiled.invoke(new Command({ resume: { stdout: 'PRD-FROM-CALLBACK', exit_code: 0 } }), config);
    st = await compiled.getState(config);
    expect(st.next.length).toBe(0); // 走到 END
    expect(st.values.plannerOutput).toBe('PRD-FROM-CALLBACK');
  });

  it('resume: callback exit_code!=0 → 写 error.node=planner', async () => {
    const compiled = new StateGraph(InitiativeState)
      .addNode('planner', runPlannerNode)
      .addEdge(START, 'planner')
      .addEdge('planner', END)
      .compile({ checkpointer: new MemorySaver() });

    const config = { configurable: { thread_id: 'harness-initiative:init-e:1' } };
    await compiled.invoke({ ...baseState, initiativeId: 'init-e' }, config);
    await compiled.invoke(new Command({ resume: { exit_code: 1, error: 'boom' } }), config);
    const st = await compiled.getState(config);
    expect(st.values.error?.node).toBe('planner');
    expect(st.values.error?.message).toContain('boom');
  });
});

describe('WS2 source-level invariants (DoD)', () => {
  const src = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'harness-initiative.graph.js'),
    'utf8'
  );
  const bodyMatch = src.match(/export async function runPlannerNode[\s\S]*?\n}\n/);

  it('[ARTIFACT] 文件 import spawnDockerDetached from spawn/detached.js', () => {
    expect(src).toMatch(/import\s*\{[^}]*spawnDockerDetached[^}]*\}\s*from\s*['"]\.\.\/spawn\/detached\.js['"]/);
  });

  it('[ARTIFACT] runPlannerNode 不含阻塞 reconnectOrSpawn', () => {
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch[0]).not.toMatch(/reconnectOrSpawn/);
  });

  it('[BEHAVIOR] runPlannerNode 含 spawnDockerDetached 调用', () => {
    expect(bodyMatch[0]).toMatch(/spawnDockerDetached/);
  });

  it('[BEHAVIOR] runPlannerNode 含 interrupt() 调用', () => {
    expect(bodyMatch[0]).toMatch(/interrupt\s*\(/);
  });

  it('[BEHAVIOR] runPlannerNode 写 walking_skeleton_thread_lookup(graph_name=harness-initiative)', () => {
    expect(bodyMatch[0]).toMatch(/INSERT INTO walking_skeleton_thread_lookup[\s\S]*'harness-initiative'/);
  });
});
