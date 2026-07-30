import { describe, expect, it } from 'vitest';
import { classifyRunTrust } from '../run-trust-classifier.js';

const baseEvidence = Object.freeze({
  run: {
    id: '11111111-1111-4111-8111-111111111111',
    current_task_id: '22222222-2222-4222-8222-222222222222',
    record_trust_status: 'untrusted',
  },
  taskReferenceCount: 1,
  matchingAttemptCount: 0,
  batchCollisionCount: 1,
});

describe('classifyRunTrust', () => {
  it('preserves a canonical trusted marker', () => {
    expect(classifyRunTrust({
      ...baseEvidence,
      run: { ...baseEvidence.run, record_trust_status: 'trusted' },
    })).toEqual({
      status: 'trusted',
      reason: 'canonical_trusted_marker',
    });
  });

  it('reconstructs a unique direct task reference', () => {
    expect(classifyRunTrust(baseEvidence)).toEqual({
      status: 'reconstructed',
      reason: 'direct_task_reference',
    });
  });

  it('strengthens reconstruction when exactly one attempt references the run and task', () => {
    expect(classifyRunTrust({
      ...baseEvidence,
      matchingAttemptCount: 1,
    })).toEqual({
      status: 'reconstructed',
      reason: 'direct_task_and_attempt',
    });
  });

  it('does not infer a missing task identity', () => {
    expect(classifyRunTrust({
      ...baseEvidence,
      run: { ...baseEvidence.run, current_task_id: null },
    })).toEqual({
      status: 'untrusted',
      reason: 'missing_task_identity',
    });
  });

  it('rejects a dangling direct task identity', () => {
    expect(classifyRunTrust({
      ...baseEvidence,
      taskReferenceCount: 0,
    })).toEqual({
      status: 'untrusted',
      reason: 'dangling_task_identity',
    });
  });

  it('rejects exact-timestamp batch mutation evidence', () => {
    expect(classifyRunTrust({
      ...baseEvidence,
      batchCollisionCount: 16,
    })).toEqual({
      status: 'untrusted',
      reason: 'batch_mutation_suspected',
    });
  });

  it('rejects ambiguous task or attempt evidence', () => {
    expect(classifyRunTrust({
      ...baseEvidence,
      taskReferenceCount: 2,
      matchingAttemptCount: 2,
    })).toEqual({
      status: 'untrusted',
      reason: 'ambiguous_identity',
    });
  });
});
