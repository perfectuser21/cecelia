import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDockerOutput,
  extractField,
  extractVerdict,
  placeholderNode,
  createDockerNodes,
  buildHarnessGraph,
  compileHarnessApp,
  HarnessState,
  HARNESS_NODE_NAMES,
} from '../src/harness-graph.js';

// ─── parseDockerOutput ───────────────────────────────────────────────────────

describe('parseDockerOutput', () => {
  it('空输入返回空字符串', () => {
    expect(parseDockerOutput('')).toBe('');
    expect(parseDockerOutput(null)).toBe('');
    expect(parseDockerOutput(undefined)).toBe('');
  });

  it('解析 claude JSON result', () => {
    const stdout = '{"type":"system","text":"starting"}\n{"type":"result","result":"PRD content here"}';
    expect(parseDockerOutput(stdout)).toBe('PRD content here');
  });

  it('解析 content 字段', () => {
    const stdout = '{"type":"assistant","content":"contract draft"}';
    expect(parseDockerOutput(stdout)).toBe('contract draft');
  });

  it('非 JSON 返回原文末尾', () => {
    const stdout = 'some plain text output\nfrom docker';
    expect(parseDockerOutput(stdout)).toBe('some plain text output\nfrom docker');
  });

  it('多行 JSON 取最后一个有 result 的', () => {
    const stdout = [
      '{"type":"chunk","text":"..."}',
      '{"type":"chunk","text":"..."}',
      '{"type":"result","result":"final output"}',
    ].join('\n');
    expect(parseDockerOutput(stdout)).toBe('final output');
  });
});

// ─── extractField ────────────────────────────────────────────────────────────

describe('extractField', () => {
  it('提取 key: value 格式', () => {
    const text = 'pr_url: https://github.com/foo/bar/pull/123\npr_branch: cp-test';
    expect(extractField(text, 'pr_url')).toBe('https://github.com/foo/bar/pull/123');
    expect(extractField(text, 'pr_branch')).toBe('cp-test');
  });

  it('提取 **key**: value 格式', () => {
    const text = '**pr_url**: https://github.com/foo/bar/pull/456';
    expect(extractField(text, 'pr_url')).toBe('https://github.com/foo/bar/pull/456');
  });

  it('字段不存在返回 null', () => {
    expect(extractField('no match here', 'pr_url')).toBeNull();
    expect(extractField(null, 'pr_url')).toBeNull();
  });
});

// ─── extractVerdict ──────────────────────────────────────────────────────────

describe('extractVerdict', () => {
  it('提取显式 VERDICT: 字段', () => {
    const text = '审查完成。\n\nVERDICT: APPROVED\n\n理由...';
    expect(extractVerdict(text, ['APPROVED', 'REVISION'])).toBe('APPROVED');
  });

  it('提取中文 裁决: 字段', () => {
    const text = '裁决: REVISION\n修改建议: ...';
    expect(extractVerdict(text, ['APPROVED', 'REVISION'])).toBe('REVISION');
  });

  it('全文匹配最后出现的关键词', () => {
    const text = '初步看 APPROVED，但发现问题，最终 REVISION';
    expect(extractVerdict(text, ['APPROVED', 'REVISION'])).toBe('REVISION');
  });

  it('PASS/FAIL 识别', () => {
    expect(extractVerdict('VERDICT: PASS', ['PASS', 'FAIL'])).toBe('PASS');
    expect(extractVerdict('测试 FAIL 了', ['PASS', 'FAIL'])).toBe('FAIL');
  });

  it('空输入返回 null', () => {
    expect(extractVerdict(null, ['PASS', 'FAIL'])).toBeNull();
    expect(extractVerdict('', ['PASS', 'FAIL'])).toBeNull();
  });
});

// ─── placeholderNode ─────────────────────────────────────────────────────────

describe('placeholderNode', () => {
  it('写入 trace 标签', async () => {
    const node = placeholderNode('test');
    const result = await node({});
    expect(result.trace).toBe('test');
  });

  it('执行 stateUpdate 回调', async () => {
    const node = placeholderNode('reviewer', () => ({ review_verdict: 'APPROVED' }));
    const result = await node({});
    expect(result.review_verdict).toBe('APPROVED');
    expect(result.trace).toBe('reviewer');
  });
});

// ─── createDockerNodes ───────────────────────────────────────────────────────

describe('createDockerNodes', () => {
  let mockExecutor;
  let executorCalls;

  beforeEach(() => {
    executorCalls = [];
    mockExecutor = async (opts) => {
      executorCalls.push(opts);
      // 默认返回成功 + JSON result
      return {
        exit_code: 0,
        timed_out: false,
        stdout: '{"type":"result","result":"mock output VERDICT: APPROVED pr_url: https://gh.com/pr/1 pr_branch: cp-test ACCEPTANCE_CRITERIA: AC1"}',
        stderr: '',
        duration_ms: 1000,
        container: 'test-container',
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
      };
    };
  });

  it('创建全部 6 个节点', () => {
    const nodes = createDockerNodes(mockExecutor, { id: 'test-1', task_type: 'harness_planner' });
    expect(Object.keys(nodes)).toEqual(HARNESS_NODE_NAMES);
    for (const name of HARNESS_NODE_NAMES) {
      expect(typeof nodes[name]).toBe('function');
    }
  });

  it('planner 节点调用 Docker 并返回 prd_content', async () => {
    const nodes = createDockerNodes(mockExecutor, { id: 'test-1', task_type: 'harness_planner' });
    const result = await nodes.planner({ task_description: 'test task', sprint_dir: 'sprints/test' });
    expect(result.prd_content).toBeTruthy();
    expect(result.trace).toContain('planner');
    expect(executorCalls.length).toBe(1);
    expect(executorCalls[0].task.task_type).toBe('harness_planner');
  });

  it('reviewer 节点提取 APPROVED 裁决', async () => {
    const nodes = createDockerNodes(mockExecutor, { id: 'test-1', task_type: 'harness_planner' });
    const result = await nodes.reviewer({
      prd_content: 'PRD...',
      contract_content: 'Contract...',
      acceptance_criteria: 'AC...',
      sprint_dir: 'sprints/test',
      review_round: 1,
    });
    expect(result.review_verdict).toBe('APPROVED');
    expect(result.trace).toContain('reviewer');
  });

  it('reviewer 节点 Docker 失败时返回 REVISION', async () => {
    const failExecutor = async () => ({
      exit_code: 1,
      timed_out: false,
      stdout: '',
      stderr: 'some error',
      duration_ms: 500,
      container: 'test-container',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    });
    const nodes = createDockerNodes(failExecutor, { id: 'test-1', task_type: 'harness_planner' });
    const result = await nodes.reviewer({ sprint_dir: 'sprints/test', review_round: 1 });
    expect(result.review_verdict).toBe('REVISION');
    expect(result.error).toBeTruthy();
  });

  it('evaluator 节点 Docker 失败时返回 FAIL', async () => {
    const failExecutor = async () => ({
      exit_code: 137,
      timed_out: true,
      stdout: '',
      stderr: '',
      duration_ms: 900000,
      container: 'test-container',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    });
    const nodes = createDockerNodes(failExecutor, { id: 'test-1', task_type: 'harness_planner' });
    const result = await nodes.evaluator({ sprint_dir: 'sprints/test', eval_round: 0 });
    expect(result.evaluator_verdict).toBe('FAIL');
    expect(result.eval_round).toBe(1);
    expect(result.error).toContain('timeout');
  });

  it('generator 节点提取 pr_url 和 pr_branch', async () => {
    const nodes = createDockerNodes(mockExecutor, { id: 'test-1', task_type: 'harness_planner' });
    const result = await nodes.generator({
      prd_content: 'PRD',
      contract_content: 'Contract',
      acceptance_criteria: 'AC',
      sprint_dir: 'sprints/test',
      eval_round: 0,
    });
    expect(result.pr_url).toBe('https://gh.com/pr/1');
    expect(result.pr_branch).toBe('cp-test');
    expect(result.trace).toContain('generator');
  });
});

// ─── buildHarnessGraph + compileHarnessApp ───────────────────────────────────

describe('buildHarnessGraph 条件边', () => {
  it('reviewer APPROVED → generator → evaluator PASS → report（happy path）', async () => {
    const app = compileHarnessApp();
    const initialState = {
      task_id: 'test-happy',
      task_description: 'test',
      sprint_dir: 'sprints/test',
    };

    let steps = 0;
    for await (const _event of await app.stream(initialState, { configurable: { thread_id: 'test-happy' } })) {
      steps += 1;
    }
    // planner → proposer → reviewer → generator → evaluator → report = 6 steps
    expect(steps).toBe(6);
  });

  it('reviewer REVISION → proposer 循环（GAN 循环）', async () => {
    let reviewCount = 0;
    const overrides = {
      reviewer: async (state) => {
        reviewCount += 1;
        const verdict = reviewCount >= 2 ? 'APPROVED' : 'REVISION';
        return { review_verdict: verdict, review_round: reviewCount, trace: `reviewer(R${reviewCount}:${verdict})` };
      },
    };
    const app = compileHarnessApp({ overrides });
    const initialState = {
      task_id: 'test-gan',
      task_description: 'test gan loop',
      sprint_dir: 'sprints/test',
    };

    let steps = 0;
    for await (const _event of await app.stream(initialState, { configurable: { thread_id: 'test-gan' } })) {
      steps += 1;
    }
    // planner → proposer → reviewer(REVISION) → proposer → reviewer(APPROVED) → generator → evaluator → report = 8
    expect(steps).toBe(8);
    expect(reviewCount).toBe(2);
  });

  it('evaluator FAIL → generator 循环（Fix 循环）', async () => {
    let evalCount = 0;
    const overrides = {
      evaluator: async (state) => {
        evalCount += 1;
        const verdict = evalCount >= 2 ? 'PASS' : 'FAIL';
        return { evaluator_verdict: verdict, eval_round: evalCount, trace: `evaluator(R${evalCount}:${verdict})` };
      },
    };
    const app = compileHarnessApp({ overrides });
    const initialState = {
      task_id: 'test-fix',
      task_description: 'test fix loop',
      sprint_dir: 'sprints/test',
    };

    let steps = 0;
    for await (const _event of await app.stream(initialState, { configurable: { thread_id: 'test-fix' } })) {
      steps += 1;
    }
    // planner → proposer → reviewer → generator → evaluator(FAIL) → generator → evaluator(PASS) → report = 8
    expect(steps).toBe(8);
    expect(evalCount).toBe(2);
  });
});

// ─── HARNESS_NODE_NAMES ─────────────────────────────────────────────────────

describe('HARNESS_NODE_NAMES', () => {
  it('包含全部 6 个节点', () => {
    expect(HARNESS_NODE_NAMES).toEqual(['planner', 'proposer', 'reviewer', 'generator', 'evaluator', 'report']);
  });
});
