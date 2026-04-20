/**
 * Harness v2 M4 — harness-graph.js 节点覆盖率补充测试
 *
 * 目的：补齐 planner / proposer / reviewer / report 四个 Docker 节点的单元覆盖，
 * 以及 generator/evaluator 的错误路径与边界（timeout, exit_code!=0, throw, 各种 output 解析）。
 *
 * 所有测试通过 createDockerNodes 注入 mock dockerExecutor，不依赖真实 Docker。
 */

import { describe, it, expect, vi } from 'vitest';
import { createDockerNodes } from '../harness-graph.js';

// ─── Planner 节点 ───────────────────────────────────────────────────────────

describe('planner 节点', () => {
  it('正常 Docker 成功 → prd_content 取自 output，trace=planner', async () => {
    const dockerMock = vi.fn(async ({ task, prompt, env }) => {
      expect(task.task_type).toBe('harness_planner');
      expect(env.HARNESS_NODE).toBe('planner');
      expect(env.CECELIA_TASK_TYPE).toBe('harness_planner');
      expect(prompt).toContain('harness-planner');
      return {
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({ type: 'result', result: 'PRD 正文内容' }),
      };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't-planner' });
    const out = await nodes.planner({ task_description: '做一个功能' });
    expect(out.prd_content).toBe('PRD 正文内容');
    expect(out.error).toBeNull();
    expect(out.trace).toBe('planner');
  });

  it('sprint_dir 默认 sprints，注入进 env.HARNESS_SPRINT_DIR', async () => {
    let capturedEnv = null;
    const dockerMock = vi.fn(async ({ env }) => {
      capturedEnv = env;
      return { exit_code: 0, timed_out: false, stdout: 'prd text' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    await nodes.planner({ task_description: 'x' });
    expect(capturedEnv.HARNESS_SPRINT_DIR).toBe('sprints');
  });

  it('state.sprint_dir 非默认 → 注入 env', async () => {
    let capturedEnv = null;
    const dockerMock = vi.fn(async ({ env }) => {
      capturedEnv = env;
      return { exit_code: 0, timed_out: false, stdout: 'x' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    await nodes.planner({ sprint_dir: 'sprints-alt', task_description: 'x' });
    expect(capturedEnv.HARNESS_SPRINT_DIR).toBe('sprints-alt');
  });

  it('Docker timed_out=true → trace 含 ERROR，error 有 "Docker timeout"', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: true,
      stdout: '',
      stderr: '',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.planner({ task_description: 'x' });
    expect(out.error).toMatch(/Docker timeout/);
    expect(out.trace).toBe('planner(ERROR)');
    expect(out.prd_content).toBeNull();
  });

  it('Docker exit_code != 0 → trace 含 ERROR，error 含 stderr 后 500 字符', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 137,
      timed_out: false,
      stdout: '',
      stderr: 'OOM: container killed',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.planner({ task_description: 'x' });
    expect(out.error).toMatch(/Docker exit code 137/);
    expect(out.error).toContain('OOM: container killed');
    expect(out.trace).toBe('planner(ERROR)');
  });

  it('dockerExecutor 抛异常 → error=err.message，success=false', async () => {
    const dockerMock = vi.fn(async () => {
      throw new Error('docker daemon down');
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.planner({ task_description: 'x' });
    expect(out.error).toBe('docker daemon down');
    expect(out.trace).toBe('planner(ERROR)');
  });

  it('opts.env 透传到 dockerExecutor', async () => {
    let capturedEnv = null;
    const dockerMock = vi.fn(async ({ env }) => {
      capturedEnv = env;
      return { exit_code: 0, timed_out: false, stdout: 'x' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' }, { env: { FOO: 'bar' } });
    await nodes.planner({ task_description: 'x' });
    expect(capturedEnv.FOO).toBe('bar');
    expect(capturedEnv.HARNESS_NODE).toBe('planner');
  });
});

// ─── Proposer 节点 ──────────────────────────────────────────────────────────

describe('proposer 节点', () => {
  it('首次调用 review_round=1，输出 contract_content + acceptance_criteria', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: '合同正文\nACCEPTANCE_CRITERIA:\nGiven X When Y Then Z',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.proposer({ prd_content: 'PRD' });
    expect(out.review_round).toBe(1);
    expect(out.contract_content).toContain('合同正文');
    expect(out.acceptance_criteria).toBe('Given X When Y Then Z');
    expect(out.tasks).toEqual([]); // 无 ## Tasks
  });

  it('review_round 累加（REVISION 回环时）', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'x',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.proposer({ prd_content: 'P', review_round: 2 });
    expect(out.review_round).toBe(3);
  });

  it('review_feedback 存在时注入 prompt', async () => {
    let capturedPrompt = null;
    const dockerMock = vi.fn(async ({ prompt }) => {
      capturedPrompt = prompt;
      return { exit_code: 0, timed_out: false, stdout: 'x' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    await nodes.proposer({ review_feedback: 'reviewer 说这不够严格', review_round: 1 });
    expect(capturedPrompt).toContain('reviewer 说这不够严格');
    expect(capturedPrompt).toMatch(/Reviewer 反馈.*Round 1/);
  });

  it('无 ACCEPTANCE_CRITERIA 标记 → 整个 output 作为 acceptance_criteria', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: '只有合同没有标记',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.proposer({ prd_content: 'P' });
    expect(out.acceptance_criteria).toBe('只有合同没有标记');
  });

  it('合同含 ## Tasks → tasks 字段非空，trace 含 tasks=N', async () => {
    const contract = `
合同正文

## Tasks

### Task: T1
**title**: 做 A
**scope**: A 模块
**depends_on**: []
**files**: [a.js]

#### DoD
- [ARTIFACT] a.js 存在

#### Unit Test Plan
- 覆盖点 1

#### Integration Test Plan
- 场景 1

### Task: T2
**title**: 做 B
**scope**: B 模块
**depends_on**: [T1]
**files**: [b.js]

#### DoD
- [ARTIFACT] b.js 存在

#### Unit Test Plan
- 覆盖点 1

#### Integration Test Plan
- 场景 1
`;
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: contract,
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.proposer({ prd_content: 'P' });
    expect(out.tasks.length).toBe(2);
    expect(out.tasks[0].task_id).toBe('T1');
    expect(out.trace).toMatch(/tasks=2/);
  });

  it('合同无 Tasks 但有 Workstreams → legacy fallback，trace 含 ws=N', async () => {
    const contract = `
## Workstreams

- **WS-1** name: core_probe
- **WS-2** name: ui_hookup
`;
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: contract,
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.proposer({ prd_content: 'P' });
    expect(out.tasks.length).toBe(0);
    expect(out.trace).toMatch(/ws=2/);
  });

  it('Docker 失败（timed_out）→ trace=proposer(...)(ERROR)', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: true,
      stdout: '',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.proposer({});
    expect(out.trace).toMatch(/\(ERROR\)/);
    expect(out.error).toMatch(/timeout/);
  });
});

// ─── Reviewer 节点 ──────────────────────────────────────────────────────────

describe('reviewer 节点', () => {
  it('output 含 VERDICT: APPROVED → review_verdict=APPROVED，feedback=null', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: '审查通过\nVERDICT: APPROVED',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.reviewer({
      prd_content: 'P',
      contract_content: 'C',
      acceptance_criteria: 'A',
    });
    expect(out.review_verdict).toBe('APPROVED');
    expect(out.review_feedback).toBeNull();
    expect(out.trace).toMatch(/reviewer.*APPROVED/);
  });

  it('output 含 VERDICT: REVISION → review_feedback=整个 output', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: '风险 1\n风险 2\nVERDICT: REVISION',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.reviewer({
      prd_content: 'P',
      contract_content: 'C',
    });
    expect(out.review_verdict).toBe('REVISION');
    expect(out.review_feedback).toContain('风险');
    expect(out.trace).toMatch(/REVISION/);
  });

  it('Docker 失败 → 默认 REVISION（不因 docker 挂掉而误 APPROVED）', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 1,
      timed_out: false,
      stdout: '',
      stderr: 'whatever',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.reviewer({});
    expect(out.review_verdict).toBe('REVISION');
    expect(out.error).toMatch(/Docker exit code 1/);
  });

  it('output 无显式 verdict → 扫全文关键词（APPROVED fallback）', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: '这个看起来 APPROVED 了',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.reviewer({});
    expect(out.review_verdict).toBe('APPROVED');
  });

  it('review_round 透传（不是 proposer 的递增字段）', async () => {
    let capturedPrompt = null;
    const dockerMock = vi.fn(async ({ prompt }) => {
      capturedPrompt = prompt;
      return { exit_code: 0, timed_out: false, stdout: 'VERDICT: APPROVED' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    await nodes.reviewer({ review_round: 3 });
    expect(capturedPrompt).toMatch(/review_round.*3/);
  });
});

// ─── Generator 节点（错误路径补充）────────────────────────────────────────

describe('generator 节点错误路径', () => {
  it('新建模式 output 不含 pr_url → pr_url=null', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'no pr info here',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({ eval_round: 0 });
    expect(out.pr_url).toBeNull();
    expect(out.pr_branch).toBeNull();
    expect(out.commit_shas).toEqual([]);
  });

  it('新建模式 pr_url="FAILED" → 视为 null（INVALID_LITERAL）', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'pr_url: FAILED\npr_branch: FAILED',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({ eval_round: 0 });
    expect(out.pr_url).toBeNull();
  });

  it('Docker 失败（exit_code != 0）→ 保留已有 state，trace 含 ERROR', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 1,
      timed_out: false,
      stdout: '',
      stderr: 'boom',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({
      eval_round: 1,
      pr_url: 'https://github.com/o/r/pull/5',
      pr_branch: 'cp-existing',
      commit_shas: ['prev'],
    });
    // Fix 模式 Docker 失败 → pr_url 仍保留已有值（isFixMode ? existingPrUrl : parsed）
    expect(out.pr_url).toBe('https://github.com/o/r/pull/5');
    expect(out.pr_branch).toBe('cp-existing');
    // commit_shas 不追加
    expect(out.commit_shas).toEqual(['prev']);
    expect(out.trace).toMatch(/\(ERROR\)/);
  });

  it('Fix 模式 LLM 输出不同 pr_url → 仍保留已有（硬约束绝不换 PR）', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'pr_url: https://github.com/o/r/pull/999\npr_branch: cp-new\ncommit_sha: abc',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({
      eval_round: 2,
      pr_url: 'https://github.com/o/r/pull/5',
      pr_branch: 'cp-existing',
    });
    expect(out.pr_url).toBe('https://github.com/o/r/pull/5');
    expect(out.pr_branch).toBe('cp-existing');
    expect(out.commit_shas).toContain('abc');
  });

  it('Fix 模式 existingPrUrl 空 + parsed pr_url → 取 parsed', async () => {
    // 这是 edge case：Fix 模式本应有 existingPrUrl，但若为空，退回 parsed
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'pr_url: https://github.com/o/r/pull/7\ncommit_sha: abc',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({
      eval_round: 1,
      // pr_url 缺失
    });
    expect(out.pr_url).toBe('https://github.com/o/r/pull/7');
  });

  it('commit_shas 非数组 → reducer 兼容（当前实现直接 .commit_shas || []）', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'commit_sha: newsha',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({
      eval_round: 1,
      pr_url: 'https://github.com/o/r/pull/1',
      pr_branch: 'cp-x',
      commit_shas: 'garbage', // 非数组
    });
    // 实现：Array.isArray(state.commit_shas) ? state.commit_shas : [] → 从 [] 开始
    expect(Array.isArray(out.commit_shas)).toBe(true);
    expect(out.commit_shas).toEqual(['newsha']);
  });
});

// ─── Evaluator 节点（错误路径补充）───────────────────────────────────────

describe('evaluator 节点错误路径', () => {
  it('Docker 失败 → verdict=FAIL，feedback 含 error 文案', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 1,
      timed_out: false,
      stdout: '',
      stderr: 'eval crashed',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.evaluator({
      pr_url: 'https://github.com/o/r/pull/1',
      eval_round: 0,
    });
    expect(out.evaluator_verdict).toBe('FAIL');
    expect(out.eval_feedback).toMatch(/eval crashed/);
    expect(out.error).toMatch(/Docker exit code 1/);
  });

  it('output 无显式 VERDICT，也无关键词 → 默认 FAIL', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: '没有 verdict 关键词的文本',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.evaluator({
      pr_url: 'https://github.com/o/r/pull/1',
      eval_round: 2,
    });
    expect(out.evaluator_verdict).toBe('FAIL');
    expect(out.eval_round).toBe(3);
  });

  it('VERDICT: PASS + eval_round 累加', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'VERDICT: PASS',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.evaluator({
      pr_url: 'https://github.com/o/r/pull/1',
      eval_round: 5,
    });
    expect(out.evaluator_verdict).toBe('PASS');
    expect(out.eval_round).toBe(6);
    expect(out.eval_feedback).toBeNull();
  });
});

// ─── Report 节点 ────────────────────────────────────────────────────────────

describe('report 节点', () => {
  it('正常生成报告，report_path 从 output 提取', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'report complete\nreport_path: sprints/harness-report-final.md',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.report({
      pr_url: 'https://github.com/o/r/pull/1',
      trace: ['planner', 'proposer'],
      prd_content: 'P',
      review_round: 2,
      review_verdict: 'APPROVED',
      eval_round: 1,
      evaluator_verdict: 'PASS',
    });
    expect(out.report_path).toBe('sprints/harness-report-final.md');
    expect(out.trace).toBe('report');
    expect(out.error).toBeNull();
  });

  it('output 不含 report_path → 默认 sprints/harness-report.md', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: '报告正文没有路径字段',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.report({});
    expect(out.report_path).toBe('sprints/harness-report.md');
  });

  it('非默认 sprint_dir → 默认 report_path 对应', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'no path',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.report({ sprint_dir: 'sprints-alt' });
    expect(out.report_path).toBe('sprints-alt/harness-report.md');
  });

  it('Docker 失败 → trace 含 ERROR，report_path 仍给默认值', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 2,
      timed_out: false,
      stdout: '',
      stderr: 'report failed',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.report({});
    expect(out.trace).toBe('report(ERROR)');
    expect(out.report_path).toBe('sprints/harness-report.md');
    expect(out.error).toMatch(/Docker exit code 2/);
  });

  it('prompt 注入 trace 数组 join', async () => {
    let capturedPrompt = null;
    const dockerMock = vi.fn(async ({ prompt }) => {
      capturedPrompt = prompt;
      return { exit_code: 0, timed_out: false, stdout: 'done' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    await nodes.report({ trace: ['a', 'b', 'c'], prd_content: 'PRD' });
    expect(capturedPrompt).toContain('a → b → c');
    expect(capturedPrompt).toContain('PRD');
  });

  it('trace 为非数组 → 不崩（用 || []）', async () => {
    const dockerMock = vi.fn(async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: 'x',
    }));
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.report({ trace: null });
    expect(out.report_path).toBeDefined();
  });
});
