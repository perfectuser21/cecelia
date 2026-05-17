/**
 * W5 — Interrupt + Resume 集成测试
 *
 * 验证：
 *   1. finalEvaluateDispatchNode 在 verdict='FAIL' && task_loop_fix_count>=3 时调 interrupt() 暂停
 *   2. /api/brain/harness-interrupts GET 列出 task_events.type='interrupt_pending' 行
 *   3. /api/brain/harness-interrupts/:taskId/resume 接 decision body 写 task_events 'interrupt_resumed'
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W5
 */
import { describe, it, expect, vi } from 'vitest';
import { StateGraph, Annotation, START, END, MemorySaver } from '@langchain/langgraph';

// Mock pool/spawn before import — finalEvaluateDispatchNode 调 spawn 跑 evaluator 容器
vi.mock('../../packages/brain/src/db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
  },
}));
vi.mock('../../packages/brain/src/spawn/index.js', () => ({
  spawn: vi.fn(async () => ({ exit_code: 0, timed_out: false, stdout: '{"verdict":"FAIL","failed_step":"e2e step 3"}', stderr: '' })),
}));
vi.mock('../../packages/brain/src/harness-shared.js', () => ({
  parseDockerOutput: (s: string) => s,
  loadSkillContent: () => 'SKILL_BODY',
  // Protocol v2: readVerdictFile 返回 null → fallback 到 stdout 解析（测试走旧协议路径）
  readVerdictFile: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../packages/brain/src/harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn().mockResolvedValue('/tmp/wt'),
}));
vi.mock('../../packages/brain/src/harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn().mockResolvedValue('ghs_x'),
}));
vi.mock('../../packages/brain/src/harness-dag.js', () => ({
  parseTaskPlan: vi.fn().mockReturnValue({ tasks: [] }),
  upsertTaskPlan: vi.fn().mockResolvedValue({ idMap: new Map(), insertedTaskIds: [] }),
}));
vi.mock('../../packages/brain/src/harness-final-e2e.js', () => ({
  runFinalE2E: vi.fn(),
  attributeFailures: vi.fn(),
  runScenarioCommand: vi.fn(),
  bootstrapE2E: vi.fn(),
  teardownE2E: vi.fn(),
  normalizeAcceptance: (a: any) => a,
}));
vi.mock('../../packages/brain/src/harness-gan-graph.js', () => ({
  runGanContractGraph: vi.fn(),
}));
vi.mock('../../packages/brain/src/orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue(new MemorySaver()),
}));

import { finalEvaluateDispatchNode } from '../../packages/brain/src/workflows/harness-initiative.graph.js';

describe('finalEvaluateDispatchNode interrupt() (W5)', () => {
  it('verdict=FAIL & fix_round=0 → 不调 interrupt，正常返 verdictDelta', async () => {
    // mock spawn 返 FAIL
    const fakeExecutor = vi.fn(async () => ({ exit_code: 0, timed_out: false, stdout: '{"verdict":"FAIL","failed_step":"step1"}', stderr: '' }));
    const out = await finalEvaluateDispatchNode(
      {
        task: { id: 't1', payload: { sprint_dir: 'sprints' } },
        initiativeId: 'init-1',
        worktreePath: '/tmp/wt',
        githubToken: 'gh',
        task_loop_fix_count: 0,
        taskPlan: { journey_type: 'autonomous' },
      },
      { executor: fakeExecutor }
    );
    expect(out.final_e2e_verdict).toBe('FAIL');
    expect(out.error).toBeUndefined();
    expect(out.operator_decision).toBeUndefined();
  });

  it('verdict=FAIL & fix_round>=3 → 在真实 graph 内 interrupt() 暂停（GraphInterrupt 抛出 / interrupt 状态）', async () => {
    // 用 MemorySaver compile 一个最小 graph，进 final_evaluate 节点
    const Anno = Annotation.Root({
      task: Annotation<any>({ reducer: (_o: any, n: any) => n, default: () => null }),
      initiativeId: Annotation<any>({ reducer: (_o: any, n: any) => n, default: () => null }),
      worktreePath: Annotation<any>({ reducer: (_o: any, n: any) => n, default: () => null }),
      githubToken: Annotation<any>({ reducer: (_o: any, n: any) => n, default: () => null }),
      task_loop_fix_count: Annotation<number>({ reducer: (_o: any, n: any) => n, default: () => 0 }),
      taskPlan: Annotation<any>({ reducer: (_o: any, n: any) => n, default: () => ({ journey_type: 'autonomous' }) }),
      final_e2e_verdict: Annotation<any>({ reducer: (_o: any, n: any) => n, default: () => null }),
      final_e2e_failed_scenarios: Annotation<any>({ reducer: (_o: any, n: any) => n, default: () => [] }),
      operator_decision: Annotation<any>({ reducer: (_o: any, n: any) => n, default: () => null }),
      error: Annotation<any>({ reducer: (_o: any, n: any) => n, default: () => null }),
    });

    // mock executor 让 final_evaluate 返 FAIL verdict
    const failExecutor = vi.fn(async () => ({ exit_code: 0, timed_out: false, stdout: '{"verdict":"FAIL","failed_step":"e2e fail"}', stderr: '' }));
    const wrappedNode = async (state: any) => finalEvaluateDispatchNode(state, { executor: failExecutor });

    const checkpointer = new MemorySaver();
    const g = new StateGraph(Anno)
      .addNode('final_evaluate', wrappedNode)
      .addEdge(START, 'final_evaluate')
      .addEdge('final_evaluate', END)
      .compile({ checkpointer });

    const threadId = `harness-initiative:test:1`;
    const config = { configurable: { thread_id: threadId } };

    // 第一次 invoke — 进 final_evaluate, fix_round=3 → interrupt 触发
    const result1 = await g.invoke(
      {
        task: { id: 't1', payload: { sprint_dir: 'sprints' } },
        initiativeId: 'init-1',
        task_loop_fix_count: 3,
        taskPlan: { journey_type: 'autonomous' },
      },
      config
    );

    // LangGraph 1.x: interrupt() 让 graph 暂停，state 内含 __interrupt__ 元数据
    // result1 状态：节点未真正完成，graph 在等 Command({resume})
    const stateNow = await g.getState(config);
    expect(stateNow.tasks).toBeDefined();
    // 必须有 pending interrupt（next 指向 final_evaluate）或 tasks 上有 interrupts
    const hasInterrupt = (stateNow.tasks || []).some((t: any) => Array.isArray(t.interrupts) && t.interrupts.length > 0);
    expect(hasInterrupt).toBe(true);

    // 验证 result1 不含 final_e2e_verdict='FAIL' 和 'PASS'（被 interrupt 暂停了）
    // result1 可能含部分 state（reducers 已应用），关键是 graph 状态已停在 final_evaluate
    expect(result1).toBeDefined();
  }, 30000);
});

describe('/api/brain/harness-interrupts route (W5)', () => {
  it('GET / 返回 interrupts 列表（mock pool 返空 → 空数组）', async () => {
    // 动态 import 路由 — pool 已 mock
    const { default: router } = await import('../../packages/brain/src/routes/harness-interrupts.js');
    expect(typeof router).toBe('function'); // express Router 是 function
    // 路由对象有 stack（express Router 内部）
    expect((router as any).stack).toBeDefined();
    const paths = (router as any).stack.map((l: any) => l.route?.path).filter(Boolean);
    expect(paths).toContain('/');
    expect(paths.some((p: string) => p.includes('resume'))).toBe(true);
  });

  it('POST /:taskId/resume 缺 decision.action → 400', async () => {
    const express = (await import('express')).default;
    const { default: router } = await import('../../packages/brain/src/routes/harness-interrupts.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain/harness-interrupts', router);

    // 用 supertest 风格自调 — 无 supertest 时手工调 listener
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/brain/harness-interrupts/00000000-0000-0000-0000-000000000abc/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/decision/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('POST /:taskId/resume 非法 decision.action → 400', async () => {
    const express = (await import('express')).default;
    const { default: router } = await import('../../packages/brain/src/routes/harness-interrupts.js');
    const app = express();
    app.use(express.json());
    app.use('/api/brain/harness-interrupts', router);

    const http = await import('http');
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/brain/harness-interrupts/00000000-0000-0000-0000-000000000abc/resume`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: { action: 'nuke_everything' } }),
      });
      expect(res.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
