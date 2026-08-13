import { describe, expect, it } from 'vitest';
import {
  assertMapRecoveryContract,
  assertMapRecoveryPaths,
} from '../preflight/map-impact-contract.js';

describe('map recovery contract', () => {
  it('is narrow, unexpired, bugfix-only and single-attempt', () => {
    const valid = {
      receipt_id: 'receipt-1', task_id: 'task-1', repo: 'cecelia',
      branch: 'cp-map-fix', base_sha: 'a'.repeat(40), change_kind: 'bugfix',
      reason_code: 'map_unavailable', expires_at: new Date(Date.now()+60000).toISOString(),
      consumed_attempt_id: null,
      authorization_evidence: { authorized_by: 'brain-map-preflight', observed_reason_code: 'map_unavailable' },
    };
    const context = {
      receipt_id: 'receipt-1', task_id: 'task-1', repo: 'cecelia',
      branch: 'cp-map-fix', base_sha: 'a'.repeat(40), reason_code: 'map_unavailable',
    };
    expect(assertMapRecoveryContract(valid, context)).toBe(true);
    expect(() => assertMapRecoveryContract({ ...valid, change_kind: 'new_capability' })).toThrow('map_recovery_forbidden');
    expect(() => assertMapRecoveryContract({ ...valid, consumed_attempt_id: 'used' }, context)).toThrow('map_recovery_consumed');
    expect(() => assertMapRecoveryContract({ ...valid, repo: 'other' }, context)).toThrow('map_recovery_identity_mismatch');
    expect(() => assertMapRecoveryContract({ ...valid, reason_code: 'scanner_unavailable' }, context)).toThrow('map_recovery_identity_mismatch');
  });

  it('allows only frozen Map, scanner and projection implementation paths', () => {
    expect(assertMapRecoveryPaths([
      'packages/brain/src/lib/map-read-service.js',
      'packages/brain/src/scanners/api-scanner.js',
      'packages/brain/scripts/run-all-scans.sh',
    ])).toBe(true);
    expect(() => assertMapRecoveryPaths(['packages/brain/src/orchestrator/dispatcher.js']))
      .toThrow('map_recovery_diff_forbidden');
    expect(() => assertMapRecoveryPaths([])).toThrow('map_recovery_diff_missing');
  });
});
