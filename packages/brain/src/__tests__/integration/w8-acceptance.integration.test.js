/**
 * W8 Acceptance — full graph 17 节点 + sub_task spawn credentials 注入参数 + checkpoint resume
 *
 * 目标（DoD）：
 *   - 用 MemorySaver 编译一份镜像 full graph（拓扑对齐 compileHarnessFullGraph()）
 *   - mock spawn / docker / pool / resolveAccount / parseTaskPlan / runGanContractGraph
 *   - 第一次 invoke 让 sub-graph 在 await_callback interrupt 停下
 *   - 第二次用 Command(resume) 唤回，断言：
 *       (1) 节点字典里 17 个必走节点（顶层 12 + sub-graph 5）spy 各 ≥ 1 次
 *       (2) sub_task spawn mock args.env 含 CECELIA_CREDENTIALS（仅参数）
 *       (3) resume 前后 spawn 总调用次数 = sub_task 数（无重 spawn 幂等门）
 *       (4) 最终 state.report_path 非空
 *
 * 范围：只验"逻辑流转 + credentials 注入参数"。实跑实证由 WS3 acceptance-report.md (DRY_RUN=0) 补充。
 *
 * 输入：sprints/w8-langgraph-v8/acceptance-fixture.json (WS1 产物，缺失时走内置 fallback)
 *
 * 镜像 graph 而不是直接驱动 compileHarnessFullGraph()：因为 buildHarnessFullGraph 在源文件内
 * 用本地绑定捕获 node 函数引用，vi.mock 重写 export 也不会改 wiring（ESM module 同文件 binding 限制）。
 * 镜像方案保留拓扑对齐 + spy 可控 + 测试确定性。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MemorySaver,
  Command,
  StateGraph,
  Annotation,
  START,
  END,
  interrupt,
} from '@langchain/langgraph';
import fs from 'node:fs';
import path from 'node:path';

// ── 对齐 DoD：账号轮转模块路径声明 (../../spawn/middleware/account-rotation.js) ──
// mock 把 resolveAccount 改成在 opts.env 上注入 CECELIA_CREDENTIALS — 验注入参数路径走通
const mockResolveAccount = vi.fn(async (opts) => {
  opts.env = opts.env || {};
  opts.env.CECELIA_CREDENTIALS = '/host-claude-config/.credentials.json';
  opts.env.CECELIA_MODEL = 'claude-sonnet-4-6';
});
vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: (...a) => mockResolveAccount(...a),
}));

// PG checkpointer 默认装载会拉 db.js → 测试里走 MemorySaver 回应 getPgCheckpointer
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn(async () => new MemorySaver()),
}));

// 防御 mocks — compileHarnessFullGraph 顶层 import 链会拉 db / spawn / docker / shepherd
vi.mock('../../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../../shepherd.js', () => ({
  checkPrStatus: vi.fn(),
  executeMerge: vi.fn(),
  classifyFailedChecks: vi.fn(),
}));
vi.mock('../../harness-final-e2e.js', () => ({
  runScenarioCommand: vi.fn(),
  bootstrapE2E: vi.fn(),
  teardownE2E: vi.fn(),
  normalizeAcceptance: (a) => a,
  attributeFailures: () => new Map(),
  runFinalE2E: vi.fn(),
}));
// parseTaskPlan / runGanContractGraph 走 mock — DoD 列出的 mock 对象
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: vi.fn(() => ({ initiative_id: 'i', tasks: [] })),
  upsertTaskPlan: vi.fn(),
}));
vi.mock('../../harness-gan-graph.js', () => ({
  runGanContractGraph: vi.fn(async () => ({ contract_content: 'C', rounds: 1, propose_branch: 'b' })),
}));

// 必须在 mock 之后 import — 验 compileHarnessFullGraph 是从生产 graph 文件可导入的（DoD ARTIFACT）
import { compileHarnessFullGraph } from '../../workflows/harness-initiative.graph.js';
import { resolveAccount } from '../../spawn/middleware/account-rotation.js';

// ── 加载 acceptance fixture（WS1 产物）；缺失时走内置 fallback 让 ws2 PR 独立可跑 ──
const FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'sprints',
  'w8-langgraph-v8',
  'acceptance-fixture.json'
);

function loadFixture() {
  try {
    return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  } catch {
    return {
      task_type: 'harness_initiative',
      payload: {
        fixture_marker: true,
        prd_content:
          'Inline fallback PRD for ws2 acceptance integration test (used when WS1 fixture not yet merged on this branch). 占位长度满足 ganLoop 入参校验阈值 200 字符；padding padding padding padding padding padding padding padding padding padding.',
        task_plan: [
          {
            id: 'ws-fixture-1',
            title: 'minimal sub_task placeholder for acceptance fixture',
            dod: [
              {
                type: 'ARTIFACT',
                desc: 'acceptance fixture sub_task placeholder',
              },
            ],
          },
        ],
      },
    };
  }
}

const FIXTURE = loadFixture();
const FIXTURE_TASK_PLAN = FIXTURE.payload?.task_plan || [];

// ── 17 个 spy 节点：顶层 12 + sub-graph 5（DoD 覆盖范围） ──
const top12Spies = {
  prep: vi.fn(async () => ({ prd_content: FIXTURE.payload.prd_content })),
  planner: vi.fn(async () => ({ planner_output: 'PLANNER_OK' })),
  parsePrd: vi.fn(async () => ({ taskPlan: { tasks: [] } })),
  ganLoop: vi.fn(async () => ({
    ganResult: { contract_content: 'C', propose_branch: 'b', rounds: 1 },
  })),
  inferTaskPlan: vi.fn(async () => ({
    taskPlan: {
      tasks: FIXTURE_TASK_PLAN.map((t) => ({ id: t.id, title: t.title })),
    },
  })),
  dbUpsert: vi.fn(async () => ({ task_loop_index: 0 })),
  pick_sub_task: vi.fn(async (state) => {
    const idx = state.task_loop_index || 0;
    const tasks = state.taskPlan?.tasks || [];
    if (idx >= tasks.length) return { sub_task: null };
    return { sub_task: tasks[idx] };
  }),
  run_sub_task: vi.fn(),
  evaluate: vi.fn(async () => ({ evaluate_verdict: 'PASS' })),
  advance: vi.fn(async (state) => ({ task_loop_index: (state.task_loop_index || 0) + 1 })),
  final_evaluate: vi.fn(async () => ({ final_e2e_verdict: 'PASS' })),
  report: vi.fn(async () => ({ report_path: '/tmp/w8-acceptance-report.md' })),
};

const spawnArgsLog = [];

const sub5Spies = {
  spawn: vi.fn(async (state) => {
    if (state.containerId) return { containerId: state.containerId };
    const opts = { task: state.task, env: {} };
    await resolveAccount(opts, { taskId: state.task.id });
    const accountEnv = opts.env;
    const containerId = `harness-task-${state.task.id}-r0-acc12345`;
    spawnArgsLog.push({
      task: state.task,
      containerId,
      env: {
        ...accountEnv,
        HARNESS_NODE: 'generator',
        HARNESS_TASK_ID: state.task.id,
        HARNESS_INITIATIVE_ID: state.initiativeId,
      },
    });
    return { containerId };
  }),
  await_callback: vi.fn(async (state) => {
    if (state.generator_output) return { generator_output: state.generator_output };
    const cb = interrupt({
      type: 'wait_harness_task_callback',
      containerId: state.containerId,
    });
    const exitCode = cb?.exit_code ?? 0;
    if (exitCode !== 0) {
      return { error: { node: 'await_callback', message: cb?.error || 'fail' } };
    }
    return {
      generator_output: cb?.stdout || '',
      cost_usd: cb?.cost_usd || 0,
    };
  }),
  parse_callback: vi.fn(async (state) => {
    if (state.pr_url) return { pr_url: state.pr_url };
    return { pr_url: 'https://gh/p/X', pr_branch: 'cp-test-branch' };
  }),
  poll_ci: vi.fn(async () => ({ ci_status: 'pass' })),
  merge_pr: vi.fn(async () => ({ status: 'merged', ci_status: 'merged' })),
};

// ── sub-graph state schema（对齐生产 TaskState 的关键字段） ──
const SubTaskState = Annotation.Root({
  task: Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId: Annotation({ reducer: (_o, n) => n, default: () => null }),
  containerId: Annotation({ reducer: (_o, n) => n, default: () => null }),
  generator_output: Annotation({ reducer: (_o, n) => n, default: () => null }),
  pr_url: Annotation({ reducer: (_o, n) => n, default: () => null }),
  pr_branch: Annotation({ reducer: (_o, n) => n, default: () => null }),
  ci_status: Annotation({ reducer: (_o, n) => n, default: () => 'pending' }),
  status: Annotation({ reducer: (_o, n) => n, default: () => 'queued' }),
  cost_usd: Annotation({ reducer: (c, n) => (c || 0) + (n || 0), default: () => 0 }),
  error: Annotation({ reducer: (_o, n) => n, default: () => null }),
});

function buildSubGraph() {
  return new StateGraph(SubTaskState)
    .addNode('spawn', sub5Spies.spawn)
    .addNode('await_callback', sub5Spies.await_callback)
    .addNode('parse_callback', sub5Spies.parse_callback)
    .addNode('poll_ci', sub5Spies.poll_ci)
    .addNode('merge_pr', sub5Spies.merge_pr)
    .addEdge(START, 'spawn')
    .addEdge('spawn', 'await_callback')
    .addEdge('await_callback', 'parse_callback')
    .addEdge('parse_callback', 'poll_ci')
    .addEdge('poll_ci', 'merge_pr')
    .addEdge('merge_pr', END);
}

// ── 顶层 state schema（关键字段，对齐 FullInitiativeState 顶层字段） ──
const FullInitiativeStateMirror = Annotation.Root({
  task: Annotation({ reducer: (_o, n) => n, default: () => null }),
  initiativeId: Annotation({ reducer: (_o, n) => n, default: () => null }),
  prd_content: Annotation({ reducer: (_o, n) => n, default: () => null }),
  planner_output: Annotation({ reducer: (_o, n) => n, default: () => null }),
  taskPlan: Annotation({ reducer: (_o, n) => n, default: () => null }),
  ganResult: Annotation({ reducer: (_o, n) => n, default: () => null }),
  task_loop_index: Annotation({ reducer: (_o, n) => n, default: () => 0 }),
  sub_task: Annotation({ reducer: (_o, n) => n, default: () => null }),
  sub_tasks: Annotation({
    reducer: (o, n) => [...(o || []), ...(n || [])],
    default: () => [],
  }),
  evaluate_verdict: Annotation({ reducer: (_o, n) => n, default: () => null }),
  final_e2e_verdict: Annotation({ reducer: (_o, n) => n, default: () => null }),
  report_path: Annotation({ reducer: (_o, n) => n, default: () => null }),
});

function routeFromPickSubTask(state) {
  const idx = state.task_loop_index || 0;
  const total = state.taskPlan?.tasks?.length || 0;
  return idx < total ? 'run_sub_task' : 'final_evaluate';
}

function routeAfterEvaluate(state) {
  return state.evaluate_verdict === 'PASS' ? 'advance' : 'final_evaluate';
}

function buildFullTestGraph(subCompiled) {
  // run_sub_task 调 sub-graph：first invoke 撞 await_callback interrupt → Command(resume) 唤回 → 拿 final state
  // thread_id 命名：harness-task:${initiativeId}:${subTaskId}（生产约定）
  top12Spies.run_sub_task.mockImplementation(async (state) => {
    const config = {
      configurable: {
        thread_id: `harness-task:${state.initiativeId}:${state.sub_task.id}`,
      },
      recursionLimit: 50,
    };

    let final = await subCompiled.invoke(
      { task: state.sub_task, initiativeId: state.initiativeId },
      config
    );

    const snap = await subCompiled.getState(config);
    if (snap.next && snap.next.length > 0) {
      // sub-graph 停在 interrupt — 用 Command(resume) 推到 END
      final = await subCompiled.invoke(
        new Command({
          resume: {
            stdout: 'pr_url: https://gh/p/X\npr_branch: cp-test-branch',
            exit_code: 0,
            cost_usd: 0.1,
          },
        }),
        config
      );
    }

    return {
      sub_tasks: [
        {
          id: state.sub_task.id,
          status: final?.status || 'merged',
          pr_url: final?.pr_url || null,
          cost_usd: final?.cost_usd || 0,
        },
      ],
    };
  });

  return new StateGraph(FullInitiativeStateMirror)
    .addNode('prep', top12Spies.prep)
    .addNode('planner', top12Spies.planner)
    .addNode('parsePrd', top12Spies.parsePrd)
    .addNode('ganLoop', top12Spies.ganLoop)
    .addNode('inferTaskPlan', top12Spies.inferTaskPlan)
    .addNode('dbUpsert', top12Spies.dbUpsert)
    .addNode('pick_sub_task', top12Spies.pick_sub_task)
    .addNode('run_sub_task', top12Spies.run_sub_task)
    .addNode('evaluate', top12Spies.evaluate)
    .addNode('advance', top12Spies.advance)
    .addNode('final_evaluate', top12Spies.final_evaluate)
    .addNode('report', top12Spies.report)
    .addEdge(START, 'prep')
    .addEdge('prep', 'planner')
    .addEdge('planner', 'parsePrd')
    .addEdge('parsePrd', 'ganLoop')
    .addEdge('ganLoop', 'inferTaskPlan')
    .addEdge('inferTaskPlan', 'dbUpsert')
    .addEdge('dbUpsert', 'pick_sub_task')
    .addConditionalEdges('pick_sub_task', routeFromPickSubTask, {
      run_sub_task: 'run_sub_task',
      final_evaluate: 'final_evaluate',
    })
    .addEdge('run_sub_task', 'evaluate')
    .addConditionalEdges('evaluate', routeAfterEvaluate, {
      advance: 'advance',
      final_evaluate: 'final_evaluate',
    })
    .addEdge('advance', 'pick_sub_task')
    .addEdge('final_evaluate', 'report')
    .addEdge('report', END);
}

// ──────────────────────────────────────────────────────────────────────────

describe('w8 acceptance — compileHarnessFullGraph 17 节点 + credentials 注入 + checkpoint resume', () => {
  beforeEach(() => {
    spawnArgsLog.length = 0;
    Object.values(top12Spies).forEach((s) => s.mockClear());
    Object.values(sub5Spies).forEach((s) => s.mockClear());
    mockResolveAccount.mockClear();
  });

  it('compileHarnessFullGraph 是可导入的（生产 graph 入口符号校验）', () => {
    expect(typeof compileHarnessFullGraph).toBe('function');
  });

  it('full graph happy path: 顶层 12 节点 spy 各 ≥ 1 次 + state.report_path 非空', async () => {
    const subCompiled = buildSubGraph().compile({ checkpointer: new MemorySaver() });
    const fullCompiled = buildFullTestGraph(subCompiled).compile({
      checkpointer: new MemorySaver(),
    });

    const final = await fullCompiled.invoke(
      { task: { id: 'init-1' }, initiativeId: 'init-1' },
      { configurable: { thread_id: 'harness-init:init-1:1' }, recursionLimit: 100 }
    );

    for (const [name, spy] of Object.entries(top12Spies)) {
      expect(spy.mock.calls.length, `top-level node ${name} should be called ≥ 1 time`).toBeGreaterThanOrEqual(1);
    }
    expect(final.report_path).toBeTruthy();
    expect(final.final_e2e_verdict).toBe('PASS');
  });

  it('sub-graph 5 节点 spy 各 ≥ 1 次（驱动一次完整 spawn → interrupt → resume → END）', async () => {
    const subCompiled = buildSubGraph().compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: 'harness-task:init-sub:s1' } };

    // 1st invoke：sub-graph 在 await_callback interrupt 停下
    await subCompiled.invoke(
      { task: { id: 's1' }, initiativeId: 'init-sub' },
      config
    );
    let snap = await subCompiled.getState(config);
    expect(snap.next).toEqual(['await_callback']);

    // Command(resume) 唤回 — 推到 END
    const final = await subCompiled.invoke(
      new Command({
        resume: { stdout: 'pr_url: https://gh/p/X', exit_code: 0, cost_usd: 0.1 },
      }),
      config
    );

    snap = await subCompiled.getState(config);
    expect(snap.next).toEqual([]);
    expect(final.status).toBe('merged');

    for (const [name, spy] of Object.entries(sub5Spies)) {
      expect(spy.mock.calls.length, `sub-graph node ${name} should be called ≥ 1 time`).toBeGreaterThanOrEqual(1);
    }
  });

  it('sub_task spawn mock args.env 含 CECELIA_CREDENTIALS（仅注入参数验证，非容器内真实 env）', async () => {
    const subCompiled = buildSubGraph().compile({ checkpointer: new MemorySaver() });
    await subCompiled.invoke(
      { task: { id: 's1' }, initiativeId: 'init-cred' },
      { configurable: { thread_id: 'harness-task:init-cred:s1' } }
    );

    expect(mockResolveAccount).toHaveBeenCalledTimes(1);
    expect(spawnArgsLog.length).toBe(1);
    expect(spawnArgsLog[0].env.CECELIA_CREDENTIALS).toBeTruthy();
    expect(spawnArgsLog[0].env.CECELIA_CREDENTIALS).toMatch(/\.credentials\.json/);
    expect(spawnArgsLog[0].env.CECELIA_MODEL).toBe('claude-sonnet-4-6');
    expect(spawnArgsLog[0].env.HARNESS_TASK_ID).toBe('s1');
    expect(spawnArgsLog[0].env.HARNESS_INITIATIVE_ID).toBe('init-cred');
  });

  it('Command(resume) 唤回前后 spawn 总调用次数 = sub_task 数（无重 spawn — 幂等门生效）', async () => {
    const subCompiled = buildSubGraph().compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: 'harness-task:init-idem:s1' } };

    await subCompiled.invoke({ task: { id: 's1' }, initiativeId: 'init-idem' }, config);
    const spawnBeforeResume = spawnArgsLog.length;
    expect(spawnBeforeResume).toBe(1);
    expect(sub5Spies.spawn.mock.calls.length).toBe(1);

    await subCompiled.invoke(
      new Command({
        resume: { stdout: 'pr_url: https://gh/p/X', exit_code: 0, cost_usd: 0.1 },
      }),
      config
    );

    // 1 sub_task = 1 spawn（resume 不重 spawn）
    expect(spawnArgsLog.length).toBe(spawnBeforeResume);
    expect(spawnArgsLog.length).toBe(1);
    expect(sub5Spies.spawn.mock.calls.length).toBe(1);
  });

  it('full graph 端到端：17 节点 spy 各 ≥ 1 次（顶层 12 + sub-graph 5 合计）', async () => {
    const subCompiled = buildSubGraph().compile({ checkpointer: new MemorySaver() });
    const fullCompiled = buildFullTestGraph(subCompiled).compile({
      checkpointer: new MemorySaver(),
    });

    const final = await fullCompiled.invoke(
      { task: { id: 'init-e2e' }, initiativeId: 'init-e2e' },
      { configurable: { thread_id: 'harness-init:init-e2e:1' }, recursionLimit: 100 }
    );

    const allNodes = { ...top12Spies, ...sub5Spies };
    for (const [name, spy] of Object.entries(allNodes)) {
      expect(spy.mock.calls.length, `node ${name} should be called ≥ 1 time (17 总数)`).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(allNodes).length).toBe(17);
    expect(final.report_path).toBeTruthy();
    expect(spawnArgsLog.length).toBe(1);
    expect(spawnArgsLog[0].env.CECELIA_CREDENTIALS).toBeTruthy();
  });

  it('thread_id 命名遵循 harness-task:${initiativeId}:${subTaskId} 约定', async () => {
    const subCompiled = buildSubGraph().compile({ checkpointer: new MemorySaver() });
    const initiativeId = 'init-naming';
    const subTaskId = 's-thread';
    const expectedThreadId = `harness-task:${initiativeId}:${subTaskId}`;
    const config = { configurable: { thread_id: expectedThreadId } };

    await subCompiled.invoke({ task: { id: subTaskId }, initiativeId }, config);
    const snap = await subCompiled.getState(config);
    expect(snap.config.configurable.thread_id).toBe(expectedThreadId);
  });
});
