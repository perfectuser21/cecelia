import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runEvaluatorWriterAndBridge } from './evaluator-evidence-bridge.fixture.js';

const TASK_ID = '22222222-2222-4222-8222-222222222222';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';

describe('固定 evaluator writer 与真实 Runner bridge 的合同', () => {
  it('真实 writer 的结构化 checks 与探索证据原样进入 normalized result', () => {
    const evaluatorSkill = readFileSync(new URL(
      '../../../../../packages/workflows/skills/harness-evaluator/SKILL.md',
      import.meta.url,
    ), 'utf8');
    const writer = evaluatorSkill.match(/# evaluator-result-writer:start[\s\S]*?# evaluator-result-writer:end/)?.[0];
    expect(writer, 'Skill 必须保留可执行 writer 边界').toBeTruthy();
    const bridgedResult = runEvaluatorWriterAndBridge({
      contract_version: '1.0',
      attempt_id: ATTEMPT_ID,
      status: 'completed',
      summary: 'evaluator verified behavior',
      artifacts: [],
      checks: ['provider summary only'],
      decision: { outcome: 'PASS', reason: 'verified' },
      error: null,
      findings: [],
      screenshots: [],
      exploration_notes: ['exercised the evaluator callback and Judge evidence bridge'],
      provider_metadata: { provider: 'codex', session_id: 'thread-evaluator' },
    }, {
      taskId: TASK_ID,
      attemptId: ATTEMPT_ID,
      command: 'npm test',
      logTail: '12 tests passed',
      writer,
    });
    expect(bridgedResult.checks).toEqual([
      { command: 'npm test', exit_code: 0, log_tail: '12 tests passed' },
    ]);
    expect(bridgedResult.exploration_notes).toEqual([
      'exercised the evaluator callback and Judge evidence bridge',
    ]);
  });
});
