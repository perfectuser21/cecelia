import { describe, expect, it } from 'vitest';

import { resolveValidationClock } from '../validation-clock.js';

const startedAt = '2026-08-03T19:02:13.199Z';
const deadlineAt = '2026-08-03T21:02:13.199Z';

describe('resolveValidationClock', () => {
  it('starts one shared window at the first Generator intent', () => {
    expect(resolveValidationClock({
      action: 'spawn:generator',
      decisionLog: [],
      intentAt: startedAt,
      timeoutSeconds: 7200,
    })).toEqual({
      pipeline_started_at: startedAt,
      deadline_at: deadlineAt,
    });
  });

  it.each([
    'spawn:generator-fix',
    'spawn:evaluator',
    'spawn:evaluator-evidence-repair',
    'spawn:judge',
  ])(
    'reuses the persisted clock for %s',
    (action) => {
      expect(resolveValidationClock({
        action,
        decisionLog: [{
          hop: 70,
          action: 'spawn:generator',
          created_at: startedAt,
          detail: {
            pipeline_started_at: startedAt,
            deadline_at: deadlineAt,
          },
        }],
        intentAt: '2026-08-03T19:30:00.000Z',
        timeoutSeconds: 7200,
      })).toEqual({
        pipeline_started_at: startedAt,
        deadline_at: deadlineAt,
      });
    },
  );

  it('recovers a pre-fix in-flight run from the first Generator intent created_at', () => {
    expect(resolveValidationClock({
      action: 'spawn:generator-fix',
      decisionLog: [{
        hop: 70,
        action: 'spawn:generator',
        created_at: startedAt,
        detail: { reason: 'contract_approved' },
      }],
      intentAt: '2026-08-03T19:30:00.000Z',
      timeoutSeconds: 7200,
    })).toEqual({
      pipeline_started_at: startedAt,
      deadline_at: deadlineAt,
    });
  });

  it('fails closed when a downstream role has no Generator clock', () => {
    expect(() => resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [],
      intentAt: startedAt,
      timeoutSeconds: 7200,
    })).toThrow('validation_clock_required');
  });

  it('starts one shared window at a verified existing-PR Evaluator intent', () => {
    expect(resolveValidationClock({
      action: 'spawn:evaluator',
      decisionLog: [],
      intentAt: startedAt,
      timeoutSeconds: 7200,
      allowEvaluatorOrigin: true,
    })).toEqual({
      pipeline_started_at: startedAt,
      deadline_at: deadlineAt,
    });
  });

  it('reuses the persisted verified existing-PR Evaluator clock for Judge', () => {
    expect(resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [{
        hop: 70,
        action: 'spawn:evaluator',
        created_at: startedAt,
        detail: {
          validation_origin: 'verified_existing_pr',
          pipeline_started_at: startedAt,
          deadline_at: deadlineAt,
        },
      }],
      intentAt: '2026-08-03T19:30:00.000Z',
      timeoutSeconds: 7200,
    })).toEqual({
      pipeline_started_at: startedAt,
      deadline_at: deadlineAt,
    });
  });

  it('fails closed when the persisted clock is malformed', () => {
    expect(() => resolveValidationClock({
      action: 'spawn:judge',
      decisionLog: [{
        hop: 70,
        action: 'spawn:generator',
        created_at: startedAt,
        detail: {
          pipeline_started_at: startedAt,
          deadline_at: 'not-a-time',
        },
      }],
      intentAt: '2026-08-03T19:30:00.000Z',
      timeoutSeconds: 7200,
    })).toThrow('validation_clock_invalid');
  });

  it('does not create a validation clock for authoring roles', () => {
    expect(resolveValidationClock({
      action: 'spawn:reviewer',
      decisionLog: [],
      intentAt: startedAt,
      timeoutSeconds: 7200,
    })).toBeNull();
  });
});
