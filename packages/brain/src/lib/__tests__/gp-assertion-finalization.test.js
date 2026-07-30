import { describe, expect, it, vi } from 'vitest';
import {
  inFinalTransaction,
  normalizeContractState,
  sameContractState,
} from '../gp-assertion-finalization.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function signedState(hash = HASH_A) {
  return {
    hasHistory: true,
    signed: { id: 'contract-1', content_hash: hash },
  };
}

function poolHarness() {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return {
    client,
    pool: { connect: vi.fn().mockResolvedValue(client) },
  };
}

describe('GP assertion finalization policy', () => {
  it('normalizes a journey with no contract history', () => {
    expect(normalizeContractState({
      hasHistory: false,
      signed: null,
    })).toEqual({
      hasHistory: false,
      id: null,
      hash: null,
    });
  });

  it('requires an Owner signature when contract history exists', () => {
    expect(() => normalizeContractState({
      hasHistory: true,
      signed: null,
    })).toThrow(expect.objectContaining({
      code: 'GP_CONTRACT_SIGNATURE_REQUIRED',
    }));
  });

  it('accepts only a complete signed contract hash snapshot', () => {
    expect(normalizeContractState(signedState())).toEqual({
      hasHistory: true,
      id: 'contract-1',
      hash: HASH_A,
    });
    expect(() => normalizeContractState(
      signedState('not-a-sha256'),
    )).toThrow(expect.objectContaining({ code: 'INVALID_GP_CONTRACT' }));
  });

  it('fails closed when the current contract state drifts', () => {
    const frozen = normalizeContractState(signedState());

    expect(sameContractState(frozen, signedState())).toBe(true);
    expect(sameContractState(frozen, signedState(HASH_B))).toBe(false);
    expect(sameContractState(frozen, {
      hasHistory: true,
      signed: { id: 'contract-2', content_hash: HASH_A },
    })).toBe(false);
    expect(sameContractState(frozen, {
      hasHistory: true,
      signed: null,
    })).toBe(false);
  });

  it('runs the final transaction at SERIALIZABLE isolation', async () => {
    const { client, pool } = poolHarness();

    await expect(inFinalTransaction(
      pool,
      vi.fn().mockResolvedValue('receipt'),
    )).resolves.toBe('receipt');

    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL SERIALIZABLE',
      'COMMIT',
    ]);
  });

  it('retries serialization failures and succeeds on attempt three', async () => {
    const { client, pool } = poolHarness();
    const serializationFailure = Object.assign(
      new Error('serialization failure'),
      { code: '40001' },
    );
    const work = vi.fn()
      .mockRejectedValueOnce(serializationFailure)
      .mockRejectedValueOnce(serializationFailure)
      .mockResolvedValue('receipt');

    await expect(inFinalTransaction(pool, work)).resolves.toBe('receipt');

    expect(work).toHaveBeenCalledTimes(3);
    expect(client.query).toHaveBeenCalledTimes(6);
    expect(client.release).toHaveBeenCalledTimes(3);
  });

  it('stops after three serialization failures', async () => {
    const { pool } = poolHarness();
    const serializationFailure = Object.assign(
      new Error('serialization failure'),
      { code: '40001' },
    );
    const work = vi.fn().mockRejectedValue(serializationFailure);

    await expect(inFinalTransaction(pool, work)).rejects.toBe(
      serializationFailure,
    );
    expect(work).toHaveBeenCalledTimes(3);
  });
});
