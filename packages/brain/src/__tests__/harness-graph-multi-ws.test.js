/**
 * harness-graph-multi-ws.test.js
 *
 * 验证 Harness LangGraph 多 Workstream 改造：
 *   - parseWorkstreams 合同解析（有/无 Workstreams 区块、多种行格式）
 *   - Proposer 节点把 workstreams 写入 state
 *   - Generator 按 WS 循环产多 PR，state.pr_urls 长度 = WS 数量
 *   - Evaluator 按 PR 单独验收，state.ws_verdicts 逐项对齐
 *   - Fix 模式 Generator 只跑上轮 FAIL 的 WS，PASS 的 PR 保留
 *   - 单 WS 合同（无 ## Workstreams 区块）完全向后兼容，老字段仍填 pr_urls[0]
 */
import { describe, it, expect } from 'vitest';
import {
  parseWorkstreams,
  createDockerNodes,
  compileHarnessApp,
} from '../harness-graph.js';

// ─── parseWorkstreams ────────────────────────────────────────────────────────

describe('parseWorkstreams', () => {
  it('无 ## Workstreams 区块 → 默认单 WS', () => {
    const ws = parseWorkstreams('# Contract\n\nSome content, no workstreams section');
    expect(ws).toEqual([{ index: 1, name: 'default' }]);
  });

  it('空输入 → 默认单 WS', () => {
    expect(parseWorkstreams('')).toEqual([{ index: 1, name: 'default' }]);
    expect(parseWorkstreams(null)).toEqual([{ index: 1, name: 'default' }]);
  });

  it('标准格式：`- **WS-1**: name` + `- **WS-2**: name`', () => {
    const md = `# Contract

## Workstreams

- **WS-1**: docker_runtime_probe
- **WS-2**: circuit_breaker

## Other section
`;
    const ws = parseWorkstreams(md);
    expect(ws).toHaveLength(2);
    expect(ws[0]).toMatchObject({ index: 1, name: 'docker_runtime_probe' });
    expect(ws[1]).toMatchObject({ index: 2, name: 'circuit_breaker' });
  });

  it('兼容：`- WS1 — name`（无 **，用长破折号）', () => {
    const md = `## Workstreams

- WS1 — langgraph_state_upgrade
- WS2 — generator_loop
`;
    const ws = parseWorkstreams(md);
    expect(ws.map(w => w.index)).toEqual([1, 2]);
    expect(ws[0].name).toBe('langgraph_state_upgrade');
  });

  it('提取 dod_file 路径（括号里）', () => {
    const md = `## Workstreams

- **WS-1**: docker_probe (dod: sprints/contract-dod-ws1.md)
- **WS-2**: circuit_breaker (sprints/contract-dod-ws2.md)
`;
    const ws = parseWorkstreams(md);
    expect(ws[0].dod_file).toBe('sprints/contract-dod-ws1.md');
    expect(ws[1].dod_file).toBe('sprints/contract-dod-ws2.md');
  });

  it('只认第一个 ## Workstreams 区块到下一个 ## 之间的内容', () => {
    const md = `## Workstreams

- **WS-1**: a
- **WS-2**: b

## 验证命令

这里不应被解析：WS-99 fake
`;
    const ws = parseWorkstreams(md);
    expect(ws).toHaveLength(2);
    expect(ws.find(w => w.index === 99)).toBeUndefined();
  });

  it('重复 index 只保留首次出现', () => {
    const md = `## Workstreams

- **WS-1**: first
- **WS-1**: duplicate
- **WS-2**: second
`;
    const ws = parseWorkstreams(md);
    expect(ws).toHaveLength(2);
    expect(ws[0].name).toBe('first');
  });

  it('按 index 升序返回（即使合同乱序）', () => {
    const md = `## Workstreams

- **WS-3**: c
- **WS-1**: a
- **WS-2**: b
`;
    const ws = parseWorkstreams(md);
    expect(ws.map(w => w.index)).toEqual([1, 2, 3]);
  });
});

// ─── createDockerNodes — proposer parsed workstreams ────────────────────────

describe('createDockerNodes > proposer', () => {
  it('Docker 返回的合同含 ## Workstreams → state.workstreams 填充', async () => {
    const contractOutput = `
# Contract

## Workstreams

- **WS-1**: state_upgrade
- **WS-2**: generator_loop

## ACCEPTANCE_CRITERIA:
Given X When Y Then Z
`;
    const executor = async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ type: 'result', result: contractOutput }),
      stderr: '',
    });
    const nodes = createDockerNodes(executor, { id: 'task-proposer' });
    const out = await nodes.proposer({
      sprint_dir: 'sprints',
      prd_content: 'test',
      review_round: 0,
    });
    expect(out.workstreams).toHaveLength(2);
    expect(out.workstreams[0]).toMatchObject({ index: 1, name: 'state_upgrade' });
    expect(out.workstreams[1]).toMatchObject({ index: 2, name: 'generator_loop' });
    expect(out.trace).toContain('ws=2');
  });

  it('合同无 ## Workstreams → state.workstreams 默认 [{1, default}]', async () => {
    const executor = async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ type: 'result', result: 'Just plain contract' }),
      stderr: '',
    });
    const nodes = createDockerNodes(executor, { id: 'task-proposer-2' });
    const out = await nodes.proposer({ sprint_dir: 'sprints', prd_content: 'x' });
    expect(out.workstreams).toEqual([{ index: 1, name: 'default' }]);
  });
});

// ─── createDockerNodes — generator 多 PR 循环 ───────────────────────────────

describe('createDockerNodes > generator', () => {
  it('多 WS 首轮：executor 每次返回不同 pr_url → state.pr_urls 长度 = WS 数', async () => {
    let callCount = 0;
    const calledWsIndexes = [];
    const executor = async ({ prompt }) => {
      callCount += 1;
      // 从 prompt 里提取 workstream_index 验证 generator 有按 WS 派发
      const m = prompt.match(/\*\*workstream_index\*\*:\s*(\d+)/);
      if (m) calledWsIndexes.push(parseInt(m[1], 10));
      return {
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({
          type: 'result',
          result: `pr_url: https://github.com/x/pull/${100 + callCount}\npr_branch: cp-ws${callCount}`,
        }),
        stderr: '',
      };
    };
    const nodes = createDockerNodes(executor, { id: 'task-gen' });
    const out = await nodes.generator({
      sprint_dir: 'sprints',
      contract_content: 'contract body',
      acceptance_criteria: 'ac',
      workstreams: [
        { index: 1, name: 'ws-one' },
        { index: 2, name: 'ws-two' },
      ],
      eval_round: 0,
    });
    expect(callCount).toBe(2);
    expect(calledWsIndexes).toEqual([1, 2]);
    expect(out.pr_urls).toHaveLength(2);
    expect(out.pr_urls[0]).toMatch(/pull\/101/);
    expect(out.pr_urls[1]).toMatch(/pull\/102/);
    // 向后兼容：pr_url = pr_urls[0]
    expect(out.pr_url).toBe(out.pr_urls[0]);
    expect(out.pr_branches).toHaveLength(2);
    expect(out.pr_branch).toBe(out.pr_branches[0]);
  });

  it('Fix 模式：上轮 WS1 PASS / WS2 FAIL → 只重跑 WS2，PASS 的 PR 保留', async () => {
    let callCount = 0;
    const calledWsIndexes = [];
    const executor = async ({ prompt }) => {
      callCount += 1;
      const m = prompt.match(/\*\*workstream_index\*\*:\s*(\d+)/);
      if (m) calledWsIndexes.push(parseInt(m[1], 10));
      return {
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({
          type: 'result',
          result: `pr_url: https://github.com/x/pull/999\npr_branch: cp-ws2-fix`,
        }),
        stderr: '',
      };
    };
    const nodes = createDockerNodes(executor, { id: 'task-fix' });
    const out = await nodes.generator({
      sprint_dir: 'sprints',
      contract_content: 'contract',
      workstreams: [
        { index: 1, name: 'ws1' },
        { index: 2, name: 'ws2' },
      ],
      pr_urls: ['https://github.com/x/pull/101', 'https://github.com/x/pull/102'],
      pr_branches: ['cp-ws1', 'cp-ws2'],
      ws_verdicts: ['PASS', 'FAIL'],
      ws_feedbacks: [null, 'Evaluator says WS2 failed'],
      eval_round: 1,  // Fix 模式
    });
    // 只跑了 WS-2
    expect(callCount).toBe(1);
    expect(calledWsIndexes).toEqual([2]);
    // PR array 保留 PASS 的 WS1，更新 WS2
    expect(out.pr_urls[0]).toBe('https://github.com/x/pull/101');  // 保留
    expect(out.pr_urls[1]).toBe('https://github.com/x/pull/999');  // 更新
  });

  it('单 WS 向后兼容：合同没 Workstreams → state.workstreams 为空 → generator 仍跑 1 次', async () => {
    let callCount = 0;
    const executor = async () => {
      callCount += 1;
      return {
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({
          type: 'result',
          result: 'pr_url: https://github.com/x/pull/1\npr_branch: cp-single',
        }),
        stderr: '',
      };
    };
    const nodes = createDockerNodes(executor, { id: 'task-single' });
    const out = await nodes.generator({ sprint_dir: 'sprints', contract_content: 'c' });
    expect(callCount).toBe(1);
    expect(out.pr_urls).toHaveLength(1);
    expect(out.pr_url).toBe('https://github.com/x/pull/1');
    expect(out.pr_branch).toBe('cp-single');
  });
});

// ─── createDockerNodes — evaluator 按 PR 分别验收 ───────────────────────────

describe('createDockerNodes > evaluator', () => {
  it('多 PR → 每个 PR 单独跑 harness_evaluate，verdicts 对齐', async () => {
    let callCount = 0;
    const verdictsToReturn = ['PASS', 'FAIL'];
    const executor = async () => {
      const v = verdictsToReturn[callCount];
      callCount += 1;
      return {
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({
          type: 'result',
          result: `VERDICT: ${v}\n${v === 'FAIL' ? 'something broke' : 'all green'}`,
        }),
        stderr: '',
      };
    };
    const nodes = createDockerNodes(executor, { id: 'task-eval' });
    const out = await nodes.evaluator({
      sprint_dir: 'sprints',
      workstreams: [
        { index: 1, name: 'a' },
        { index: 2, name: 'b' },
      ],
      pr_urls: ['https://github.com/x/pull/1', 'https://github.com/x/pull/2'],
      eval_round: 0,
    });
    expect(callCount).toBe(2);
    expect(out.ws_verdicts).toEqual(['PASS', 'FAIL']);
    expect(out.ws_feedbacks[0]).toBeNull();
    expect(out.ws_feedbacks[1]).toBeTruthy();
    // 向后兼容：任一 FAIL → 整体 FAIL
    expect(out.evaluator_verdict).toBe('FAIL');
    expect(out.eval_feedback).toContain('WS-2');
    expect(out.eval_round).toBe(1);
  });

  it('已 PASS 的 WS 不重验，直接跳过', async () => {
    let callCount = 0;
    const executor = async () => {
      callCount += 1;
      return {
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({ type: 'result', result: 'VERDICT: PASS' }),
        stderr: '',
      };
    };
    const nodes = createDockerNodes(executor, { id: 'task-eval-2' });
    const out = await nodes.evaluator({
      sprint_dir: 'sprints',
      workstreams: [
        { index: 1, name: 'a' },
        { index: 2, name: 'b' },
      ],
      pr_urls: ['https://github.com/x/pull/1', 'https://github.com/x/pull/2'],
      ws_verdicts: ['PASS', 'FAIL'],  // 上轮结果
      ws_feedbacks: [null, 'was broken'],
      eval_round: 1,
    });
    // 只重验 WS-2（上轮 FAIL）
    expect(callCount).toBe(1);
    expect(out.ws_verdicts).toEqual(['PASS', 'PASS']);
    expect(out.evaluator_verdict).toBe('PASS');
  });

  it('PR 缺失（Generator 失败）→ 该 WS 直接 FAIL，不调 docker', async () => {
    let callCount = 0;
    const executor = async () => {
      callCount += 1;
      return {
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({ type: 'result', result: 'VERDICT: PASS' }),
        stderr: '',
      };
    };
    const nodes = createDockerNodes(executor, { id: 'task-eval-3' });
    const out = await nodes.evaluator({
      sprint_dir: 'sprints',
      workstreams: [
        { index: 1, name: 'a' },
        { index: 2, name: 'b' },
      ],
      pr_urls: ['https://github.com/x/pull/1', null],  // WS-2 没 PR
      eval_round: 0,
    });
    // 只调了 WS-1 的 evaluator
    expect(callCount).toBe(1);
    expect(out.ws_verdicts).toEqual(['PASS', 'FAIL']);
    expect(out.ws_feedbacks[1]).toMatch(/WS-2/);
    expect(out.evaluator_verdict).toBe('FAIL');
  });

  it('单 WS 向后兼容：evaluator 读 pr_url（非数组）也能跑', async () => {
    const executor = async () => ({
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ type: 'result', result: 'VERDICT: PASS' }),
      stderr: '',
    });
    const nodes = createDockerNodes(executor, { id: 'task-eval-4' });
    const out = await nodes.evaluator({
      sprint_dir: 'sprints',
      pr_url: 'https://github.com/x/pull/42',
    });
    expect(out.ws_verdicts).toEqual(['PASS']);
    expect(out.evaluator_verdict).toBe('PASS');
  });
});

// ─── 图级 E2E：多 WS 跑通 + Fix 循环 ────────────────────────────────────────

describe('compileHarnessApp > 多 WS 图级 E2E', () => {
  it('多 WS 合同 → 首轮 Generator 产 2 PR，Evaluator WS1 PASS / WS2 FAIL → Fix 只跑 WS2', async () => {
    let generatorCalls = [];
    let evaluatorCallCount = 0;
    // 用 overrides 精确控制每步行为
    const overrides = {
      planner: async () => ({ prd_content: 'prd' }),
      proposer: async () => ({
        contract_content: `## Workstreams

- **WS-1**: one
- **WS-2**: two
`,
        acceptance_criteria: 'ac',
        workstreams: [
          { index: 1, name: 'one' },
          { index: 2, name: 'two' },
        ],
        review_round: 1,
      }),
      reviewer: async () => ({ review_verdict: 'APPROVED' }),
      generator: async (state) => {
        generatorCalls.push({
          eval_round: state.eval_round || 0,
          ws_verdicts: state.ws_verdicts ? [...state.ws_verdicts] : null,
        });
        // 首轮：两个 PR
        if (!state.eval_round) {
          return {
            pr_urls: ['https://github.com/x/pull/1', 'https://github.com/x/pull/2'],
            pr_branches: ['cp-ws1', 'cp-ws2'],
            pr_url: 'https://github.com/x/pull/1',
            pr_branch: 'cp-ws1',
          };
        }
        // Fix 轮：只更新 WS2
        const existing = state.pr_urls || [];
        const updated = [...existing];
        updated[1] = 'https://github.com/x/pull/22';
        return {
          pr_urls: updated,
          pr_branches: ['cp-ws1', 'cp-ws2-fix'],
          pr_url: updated[0],
          pr_branch: 'cp-ws1',
        };
      },
      evaluator: async () => {
        evaluatorCallCount += 1;
        if (evaluatorCallCount === 1) {
          return {
            ws_verdicts: ['PASS', 'FAIL'],
            ws_feedbacks: [null, 'WS-2 API 500'],
            evaluator_verdict: 'FAIL',
            eval_feedback: 'WS-2 API 500',
            eval_round: 1,
          };
        }
        // 第二轮：全通过
        return {
          ws_verdicts: ['PASS', 'PASS'],
          ws_feedbacks: [null, null],
          evaluator_verdict: 'PASS',
          eval_feedback: null,
          eval_round: 2,
        };
      },
      report: async () => ({ report_path: 'sprints/harness-report.md' }),
    };

    const app = compileHarnessApp({ overrides });
    const final = await app.invoke(
      { task_description: 'multi-ws e2e' },
      { configurable: { thread_id: 't-multi-ws' }, recursionLimit: 50 },
    );

    // Generator 跑了 2 次（首轮 + 1 次 Fix）
    expect(generatorCalls).toHaveLength(2);
    expect(generatorCalls[0].eval_round).toBe(0);
    expect(generatorCalls[1].eval_round).toBe(1);
    expect(generatorCalls[1].ws_verdicts).toEqual(['PASS', 'FAIL']);

    // Evaluator 跑了 2 次
    expect(evaluatorCallCount).toBe(2);

    // 最终 state：WS2 的 PR 被更新，WS1 PR 保留
    expect(final.pr_urls[0]).toBe('https://github.com/x/pull/1');  // WS1 保留
    expect(final.pr_urls[1]).toBe('https://github.com/x/pull/22');  // WS2 更新
    expect(final.ws_verdicts).toEqual(['PASS', 'PASS']);
    expect(final.evaluator_verdict).toBe('PASS');
  });

  it('单 WS 合同（无 Workstreams 区块）向后兼容：产 1 PR、走原路径', async () => {
    const overrides = {
      planner: async () => ({ prd_content: 'prd' }),
      proposer: async () => ({
        contract_content: 'Plain contract, no workstreams header',
        acceptance_criteria: 'ac',
        workstreams: [{ index: 1, name: 'default' }],
        review_round: 1,
      }),
      reviewer: async () => ({ review_verdict: 'APPROVED' }),
      generator: async () => ({
        pr_urls: ['https://github.com/x/pull/99'],
        pr_branches: ['cp-solo'],
        pr_url: 'https://github.com/x/pull/99',
        pr_branch: 'cp-solo',
      }),
      evaluator: async () => ({
        ws_verdicts: ['PASS'],
        ws_feedbacks: [null],
        evaluator_verdict: 'PASS',
        eval_round: 1,
      }),
      report: async () => ({ report_path: 'sprints/harness-report.md' }),
    };

    const app = compileHarnessApp({ overrides });
    const final = await app.invoke(
      { task_description: 'single-ws' },
      { configurable: { thread_id: 't-single-ws' }, recursionLimit: 30 },
    );
    expect(final.pr_urls).toEqual(['https://github.com/x/pull/99']);
    expect(final.pr_url).toBe('https://github.com/x/pull/99');
    expect(final.ws_verdicts).toEqual(['PASS']);
    expect(final.evaluator_verdict).toBe('PASS');
  });
});
