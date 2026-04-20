/**
 * harness-graph.test.js
 *
 * 验证 LangGraph 骨架 harness pipeline：
 *   - 6 个节点定义齐全
 *   - happy path: planner → proposer → reviewer(APPROVED) → generator → evaluator(PASS) → report
 *   - reviewer REVISION → 回到 proposer
 *   - evaluator FAIL    → 回到 generator
 *   - runner 读取 HARNESS_LANGGRAPH_ENABLED 开关
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HARNESS_NODE_NAMES,
  buildHarnessGraph,
  compileHarnessApp,
  placeholderNode,
} from '../harness-graph.js';
import { runHarnessPipeline, isLangGraphEnabled } from '../harness-graph-runner.js';

describe('HARNESS_NODE_NAMES', () => {
  it('exposes the 7 expected node names in order (v2 M4: ci_gate 插在 generator 和 evaluator 之间)', () => {
    expect(HARNESS_NODE_NAMES).toEqual([
      'planner',
      'proposer',
      'reviewer',
      'generator',
      'ci_gate',
      'evaluator',
      'report',
    ]);
  });
});

describe('buildHarnessGraph + compileHarnessApp', () => {
  it('graph compiles with 7 nodes (skeleton, v2 M4 含 ci_gate)', async () => {
    const app = compileHarnessApp();
    expect(app).toBeDefined();
    expect(typeof app.invoke).toBe('function');
    expect(typeof app.stream).toBe('function');
  });

  it('happy path: APPROVED + ci_gate PASS + evaluator PASS reaches report and stops', async () => {
    const app = compileHarnessApp();
    const finalState = await app.invoke(
      { task_description: 'demo' },
      { configurable: { thread_id: 't-happy' } },
    );
    // trace 累计了 7 节点路径（v2 M4: 含 ci_gate）
    expect(finalState.trace).toEqual([
      'planner', 'proposer', 'reviewer', 'generator', 'ci_gate', 'evaluator', 'report',
    ]);
    expect(finalState.review_verdict).toBe('APPROVED');
    expect(finalState.evaluator_verdict).toBe('PASS');
    expect(finalState.ci_status).toBe('pass');
  });

  it('reviewer REVISION sends control back to proposer (one rebound)', async () => {
    // reviewer 第一次返回 REVISION，第二次返回 APPROVED
    let reviewerCalls = 0;
    const app = compileHarnessApp({
      overrides: {
        reviewer: async () => {
          reviewerCalls += 1;
          return { trace: 'reviewer', review_verdict: reviewerCalls === 1 ? 'REVISION' : 'APPROVED' };
        },
      },
    });
    const finalState = await app.invoke(
      { task_description: 'rebound' },
      { configurable: { thread_id: 't-revision' } },
    );
    // proposer 出现 2 次（首次 + REVISION 回路）
    const proposerCount = finalState.trace.filter((t) => t === 'proposer').length;
    expect(proposerCount).toBe(2);
    expect(reviewerCalls).toBe(2);
    // 最后到达 report
    expect(finalState.trace[finalState.trace.length - 1]).toBe('report');
  });

  it('evaluator FAIL sends control back to generator (one rebound)', async () => {
    let evalCalls = 0;
    const app = compileHarnessApp({
      overrides: {
        evaluator: async () => {
          evalCalls += 1;
          return { trace: 'evaluator', evaluator_verdict: evalCalls === 1 ? 'FAIL' : 'PASS' };
        },
      },
    });
    const finalState = await app.invoke(
      { task_description: 'fix-loop' },
      { configurable: { thread_id: 't-fail' } },
    );
    const generatorCount = finalState.trace.filter((t) => t === 'generator').length;
    expect(generatorCount).toBe(2);
    expect(evalCalls).toBe(2);
    expect(finalState.trace[finalState.trace.length - 1]).toBe('report');
  });
});

describe('placeholderNode', () => {
  it('appends label to trace and merges optional state update', async () => {
    const node = placeholderNode('planner', () => ({ prd_content: 'hello' }));
    const out = await node({});
    expect(out.trace).toBe('planner');
    expect(out.prd_content).toBe('hello');
  });
});

describe('runHarnessPipeline', () => {
  const ORIGINAL_ENV = process.env.HARNESS_LANGGRAPH_ENABLED;

  beforeEach(() => {
    delete process.env.HARNESS_LANGGRAPH_ENABLED;
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.HARNESS_LANGGRAPH_ENABLED;
    else process.env.HARNESS_LANGGRAPH_ENABLED = ORIGINAL_ENV;
  });

  it('returns { skipped: true } when HARNESS_LANGGRAPH_ENABLED is not set', async () => {
    const r = await runHarnessPipeline({ id: 'task-1', description: 'demo' });
    expect(r.skipped).toBe(true);
  });

  it('runs the pipeline when HARNESS_LANGGRAPH_ENABLED=true', async () => {
    process.env.HARNESS_LANGGRAPH_ENABLED = 'true';
    const seen = [];
    // Override nodes to avoid Docker dependency in CI
    // reviewer→APPROVED breaks GAN loop, evaluator→PASS breaks fix loop
    const overrides = {
      planner: async (state) => ({ ...state, trace: 'planner', prd_content: 'test prd' }),
      proposer: async (state) => ({ ...state, trace: 'proposer', acceptance_criteria: 'test criteria' }),
      reviewer: async (state) => ({ ...state, trace: 'reviewer', review_verdict: 'APPROVED' }),
      generator: async (state) => ({ ...state, trace: 'generator', pr_url: 'https://github.com/test/1', pr_branch: 'cp-test' }),
      // v2 M4: ci_gate 必须 override（默认 dockerNodes.ci_gate 会调真 gh CLI）
      ci_gate: async (state) => ({ ...state, trace: 'ci_gate', ci_status: 'pass' }),
      evaluator: async (state) => ({ ...state, trace: 'evaluator', evaluator_verdict: 'PASS' }),
      report: async (state) => ({ ...state, trace: 'report', report: 'done' }),
    };
    const r = await runHarnessPipeline(
      { id: 'task-2', description: 'demo' },
      { overrides, onStep: (e) => { seen.push(e.step_index); } },
    );
    expect(r.skipped).toBe(false);
    expect(r.steps).toBeGreaterThan(0);
    expect(seen.length).toBe(r.steps);
  });

  it('throws when task.id missing', async () => {
    process.env.HARNESS_LANGGRAPH_ENABLED = 'true';
    await expect(runHarnessPipeline({ description: 'no id' })).rejects.toThrow(/task\.id/);
  });

  it('isLangGraphEnabled handles common falsy values', () => {
    delete process.env.HARNESS_LANGGRAPH_ENABLED;
    expect(isLangGraphEnabled()).toBe(false);
    process.env.HARNESS_LANGGRAPH_ENABLED = '0';
    expect(isLangGraphEnabled()).toBe(false);
    process.env.HARNESS_LANGGRAPH_ENABLED = 'false';
    expect(isLangGraphEnabled()).toBe(false);
    process.env.HARNESS_LANGGRAPH_ENABLED = 'true';
    expect(isLangGraphEnabled()).toBe(true);
    process.env.HARNESS_LANGGRAPH_ENABLED = '1';
    expect(isLangGraphEnabled()).toBe(true);
  });
});
