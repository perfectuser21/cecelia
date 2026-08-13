import { describe, it, expect } from 'vitest';

// TDD 红证据 + generator 倒入 packages/brain/src/orchestrator/__tests__/dispatcher.test.js 的样板。
// 直接测真实 buildInputs（禁 mock 被改的边：dispatcher.buildInputs ↔ observed.decisionLog）。
import { __test__ } from '../../../packages/brain/src/orchestrator/dispatcher.js';
import { HARNESS_BUNDLE_MAX_BYTES } from '../../../packages/brain/src/orchestrator/constants.js';

const { buildInputs } = __test__;
const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_ID = '11111111-1111-4111-8111-111111111111';

function evaluatorInputs(decisionLog) {
  const observed = {
    task: { id: TASK_ID, title: 't', payload: { sprint_dir: 'sprints/x' } },
    decisionLog,
  };
  const ctx = { observed, taskId: TASK_ID, runId: RUN_ID, hop: 9 };
  return buildInputs(
    'spawn:evaluator',
    { role: 'evaluator' },
    ctx,
    { logicalCycleId: 'lc', attemptKind: 'initial', workstreamKey: 'ws1' },
  );
}

const judgeRow = (hop, detail) => ({ hop, action: 'verdict:judge', detail });

describe('dispatcher buildInputs judge_feedback 注入', () => {
  it('judge_feedback: 存在 judge FAIL verdict 时注入 summary/failure_class/round', () => {
    const inputs = evaluatorInputs([
      judgeRow(7, { verdict: 'FAIL', feedback: '缺失: e2e 截图 03-result.png', failure_class: 'evidence_insufficient' }),
    ]);
    expect(inputs.judge_feedback).toBeDefined();
    expect(inputs.judge_feedback.summary).toContain('缺失');
    expect(inputs.judge_feedback.failure_class).toBe('evidence_insufficient');
    expect(inputs.judge_feedback.round).toBe(7);
  });

  it('judge_feedback: evidence_insufficient failure_class 原样注入', () => {
    const inputs = evaluatorInputs([
      judgeRow(4, { verdict: 'FAIL', feedback: '点名缺失证据: DB 时间窗查询', failure_class: 'evidence_insufficient' }),
    ]);
    expect(inputs.judge_feedback.failure_class).toBe('evidence_insufficient');
  });

  it('judge_feedback: 无 judge verdict 时不注入该字段', () => {
    expect(Object.prototype.hasOwnProperty.call(evaluatorInputs([]), 'judge_feedback')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(evaluatorInputs(undefined), 'judge_feedback')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(
      evaluatorInputs([{ hop: 3, action: 'verdict:context_answer', detail: {} }]),
      'judge_feedback',
    )).toBe(false);
  });

  it('judge_feedback: 最近 judge verdict 为 PASS 时不注入', () => {
    const inputs = evaluatorInputs([
      judgeRow(5, { verdict: 'FAIL', feedback: '旧的失败', failure_class: 'evidence_insufficient' }),
      judgeRow(9, { verdict: 'PASS', feedback: 'ok' }),
    ]);
    expect(Object.prototype.hasOwnProperty.call(inputs, 'judge_feedback')).toBe(false);
  });

  it('judge_feedback: 多条 judge verdict 只取最近一次', () => {
    const inputs = evaluatorInputs([
      judgeRow(5, { verdict: 'FAIL', feedback: '旧-round5', failure_class: 'x' }),
      judgeRow(9, { verdict: 'FAIL', feedback: '新-round9', failure_class: 'evidence_insufficient' }),
    ]);
    expect(inputs.judge_feedback.summary).toContain('新-round9');
    expect(inputs.judge_feedback.summary).not.toContain('旧-round5');
    expect(inputs.judge_feedback.round).toBe(9);
  });

  it('judge_feedback: 超长 summary 截断后整包不超 256KB', () => {
    const inputs = evaluatorInputs([
      judgeRow(9, { verdict: 'FAIL', feedback: 'X'.repeat(200 * 1024), failure_class: 'evidence_insufficient' }),
    ]);
    expect(inputs.judge_feedback.summary.length).toBeLessThanOrEqual(2000);
    expect(Buffer.byteLength(JSON.stringify(inputs))).toBeLessThanOrEqual(HARNESS_BUNDLE_MAX_BYTES);
  });

  it('judge_feedback: summary 注入前脱敏', () => {
    const inputs = evaluatorInputs([
      judgeRow(9, { verdict: 'FAIL', feedback: 'Bearer secret-abc token=hunter2 缺证据', failure_class: 'evidence_insufficient' }),
    ]);
    expect(inputs.judge_feedback.summary).not.toContain('secret-abc');
    expect(inputs.judge_feedback.summary).not.toContain('hunter2');
  });
});
