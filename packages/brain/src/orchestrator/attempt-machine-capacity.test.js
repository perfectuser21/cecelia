import { describe, expect, it } from 'vitest';

import {
  AUTONOMOUS_SINGLETON_CAPACITY_CONTENDED,
  prepareAttemptMachineCapacity,
  readAttemptCreationOutcome,
} from './attempt-machine-capacity.js';

describe('attempt machine capacity authority', () => {
  it('只接受同机、已验证的自主单例容量快照', () => {
    const result = prepareAttemptMachineCapacity({
      role: 'evaluator',
      machineId: 'fleet-a',
      bundle: { inputs: { requested: true } },
      capacitySnapshot: {
        verified: true,
        machine: 'fleet-a',
        capability_snapshot_id: 'snapshot-1',
        capacity: {
          ok: true,
          available: 1,
          physical_capacity: 1,
          autonomous_progress_floor: true,
        },
      },
    });

    expect(result.autonomousSingleton).toBe(true);
    expect(result.bundle.inputs._server_allocation).toEqual({
      autonomous_progress_floor: true,
      machine_id: 'fleet-a',
      capability_snapshot_id: 'snapshot-1',
    });
  });

  it('不受信快照会删除 caller 注入的 allocation marker', () => {
    const result = prepareAttemptMachineCapacity({
      role: 'evaluator',
      machineId: 'fleet-a',
      bundle: { inputs: { _server_allocation: { forged: true } } },
      capacitySnapshot: { verified: false },
    });

    expect(result.autonomousSingleton).toBe(false);
    expect(result.bundle.inputs).not.toHaveProperty('_server_allocation');
  });

  it('把持久化容量争用标记提升为专属错误', () => {
    expect(() => readAttemptCreationOutcome({
      rows: [{ machine_capacity_contended: true }],
    })).toThrow(AUTONOMOUS_SINGLETON_CAPACITY_CONTENDED);
  });
});
