import { describe, expect, it } from 'vitest';

import {
  IMPLEMENTATION_BASELINE_INSTRUCTION,
  objectiveWithImplementationBaseline,
  resolveImplementationBaseline,
} from './implementation-baseline.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const PLANNER_ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';

function plannerAttempt(baseSha) {
  return {
    id: PLANNER_ATTEMPT_ID,
    hop: 1,
    created_at: '2026-08-13T00:00:00.000Z',
    task_bundle: {
      contract_version: '1.0',
      run_id: RUN_ID,
      attempt_id: PLANNER_ATTEMPT_ID,
      hop: 1,
      phase: 'planning',
      role: 'planner',
      objective: 'Plan the implementation contract.',
      skill: null,
      inputs: {
        task_id: TASK_ID,
        sprint_dir: 'sprints/stable-baseline',
        execution_surface: 'fleet-worker',
        workspace_spec: {
          repo: 'perfectuser21/cecelia',
          base_sha: baseSha,
          branch: 'cp-stable-baseline',
          expected_head_sha: null,
          mode: 'read-write',
          run_id: RUN_ID,
          attempt_id: PLANNER_ATTEMPT_ID,
          frozen_baseline: false,
        },
        artifacts: [],
      },
      constraints: {
        read_only: false,
        fresh_session: true,
        timeout_seconds: 600,
      },
      expected_output: 'harness-result/planner-v1',
    },
  };
}

describe('implementation baseline', () => {
  it('显式 task payload 基线优先并冻结', () => {
    const baseSha = 'a'.repeat(40);

    expect(resolveImplementationBaseline({
      taskPayload: {
        base_repo: 'https://github.com/perfectuser21/cecelia.git',
        base_sha: baseSha,
      },
      attemptRows: [plannerAttempt('b'.repeat(40))],
      runId: RUN_ID,
      taskId: TASK_ID,
    })).toEqual({
      repo: 'perfectuser21/cecelia',
      base_sha: baseSha,
      source: 'task_payload',
      frozen: true,
    });
  });

  it('只从最早合法 TaskBundle 恢复，不采用后续角色工作区 SHA', () => {
    const baseSha = 'b'.repeat(40);
    const laterAttempt = {
      ...plannerAttempt('c'.repeat(40)),
      id: '55555555-5555-4555-8555-555555555555',
      hop: 2,
      created_at: '2026-08-13T00:01:00.000Z',
    };

    expect(resolveImplementationBaseline({
      attemptRows: [laterAttempt, plannerAttempt(baseSha)],
      runId: RUN_ID,
      taskId: TASK_ID,
    })).toMatchObject({ base_sha: baseSha, source: 'initial_workspace' });
  });

  it('最早历史损坏时 fail-closed，不降级采用后续 SHA', () => {
    const corrupted = { ...plannerAttempt('d'.repeat(40)), task_bundle: { broken: true } };

    expect(() => resolveImplementationBaseline({
      attemptRows: [corrupted],
      runId: RUN_ID,
      taskId: TASK_ID,
    })).toThrow('implementation_baseline_unrecoverable');
  });

  it('只向 objective 注入一次权威基线说明', () => {
    const once = objectiveWithImplementationBaseline('Implement the task.', { base_sha: 'e'.repeat(40) });
    const twice = objectiveWithImplementationBaseline(once, { base_sha: 'e'.repeat(40) });

    expect(once).toContain(IMPLEMENTATION_BASELINE_INSTRUCTION);
    expect(twice).toBe(once);
  });
});
