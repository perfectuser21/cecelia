import { describe, it, expect } from 'vitest';

// deriveCommanderRisks 尚未导出 —— 本轮新增：把闸的真实结论提炼进 bundle.activeRisks。
import {
  deriveCommanderRisks,
  buildCommanderBundle,
} from '../../../packages/brain/src/orchestrator/commander-bundle.js';

const OBSERVED = {
  impact_gate: {
    reason: 'impact_contract_unclaimed_files',
    retryable: false,
    detail: {
      unclaimed_files: ['packages/brain/src/orchestrator/loop.js'],
      missing_capabilities: ['wechat-capable'],
    },
  },
  admission: {
    signature: 'proposer@us-mac-m4#slot0',
    admission_reasons: ['single_slot_contended', 'autonomous_progress_floor'],
  },
  latest_attempt: {
    error_code: 'http_503',
    failure_class: 'infrastructure_blocked',
  },
};

describe('deriveCommanderRisks [BEHAVIOR]', () => {
  it('surfaces impact_gate reason and retryable', () => {
    const risks = deriveCommanderRisks(OBSERVED);
    expect(Array.isArray(risks)).toBe(true);
    expect(risks.some((r) => r.reason === 'impact_contract_unclaimed_files'
      && r.retryable === false)).toBe(true);
  });

  it('surfaces admission_reasons and attempt error_code', () => {
    const risks = deriveCommanderRisks(OBSERVED);
    const flat = JSON.stringify(risks);
    expect(flat).toContain('single_slot_contended');
    expect(risks.some((r) => r.error_code === 'http_503')).toBe(true);
  });

  it('returns no risks when observed has no gate conclusions', () => {
    expect(deriveCommanderRisks({})).toEqual([]);
  });
});

describe('commander bundle run isolation [BEHAVIOR]', () => {
  const RUN_A = '22222222-2222-4222-8222-222222222222';
  const RUN_B = '33333333-3333-4333-8333-333333333333';

  it('rejects events from a different run (FR-1 隔离)', () => {
    expect(() => buildCommanderBundle({
      runId: RUN_A,
      commanderAttemptId: '44444444-4444-4444-8444-444444444444',
      state: { run_id: RUN_A, event_cursor: 0 },
      runProfile: {},
      objective: {},
      observed: {},
      historySummary: {},
      newEvents: [{
        run_id: RUN_B,
        cursor: 1,
        event_type: 'run.created',
        source_type: 'initiative_run',
        source_id: 'run',
        source_version: 0,
        payload: {},
      }],
      actorMessages: [],
      activeRisks: [],
      budgets: {},
      allowedActions: [],
    })).toThrow(/commander_bundle_run_mismatch/);
  });
});
