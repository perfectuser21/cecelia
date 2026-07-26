import { describe, expect, it } from 'vitest';

import { resolveCanonicalMachineId } from './canonical-machine-id.js';

describe('resolveCanonicalMachineId', () => {
  it('只接受受控 canonical id，忽略 Docker hostname', () => {
    expect(resolveCanonicalMachineId({
      envMachineId: 'us-mac-m4',
      hostname: 'docker-ephemeral',
    })).toBe('us-mac-m4');
    expect(() => resolveCanonicalMachineId({
      hostname: 'docker-ephemeral',
    })).toThrow(/missing canonical/i);
  });
});

