import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

const sprint = 'sprints/07272334-kernel-aeaf5c78';
const names = {
  B1: '[B1] real result sink',
  B2: '[B2] exact HarnessResult bounds',
  B3: '[B3] atomic callback',
  B4: '[B4] exact Round2 lineage',
  B5: '[B5] current-head approvals',
} as const;

describe('P0 Kernel Feedback Lineage Recovery 4 contract driver', () => {
  for (const [behavior, name] of Object.entries(names)) {
    it(name, () => {
      const result = spawnSync(
        'bash',
        [`${sprint}/tests/run-behavior.sh`, behavior, 'red'],
        { encoding: 'utf8', env: process.env },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output, `DRIVER_RED_INVALID:${behavior}:real edge did not produce a valid Red`)
        .toContain(`VALID_RED:${behavior}`);
      expect(result.status).toBe(0);
    });
  }
});
