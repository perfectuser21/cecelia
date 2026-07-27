import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  JOURNEY_ID,
  probeRequiredFamily,
} from '../kernel-harness-f1-baseline.js';

describe('kernel harness F1 baseline audit', () => {
  test('从当前仓库真实 wiring 验证八个批准行为族', () => {
    const repoRoot = path.resolve(process.cwd(), '../..');
    const results = Array.from({ length: 8 }, (_, index) => (
      probeRequiredFamily(
        `KH-F1-F${String(index + 1).padStart(2, '0')}`,
        { repoRoot },
      )
    ));

    expect(JOURNEY_ID).toBe('bb8cc561-b3ee-4fec-b74d-2255694bd963');
    expect(results).toHaveLength(8);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.every((result) => result.source_digest?.startsWith('sha256:'))).toBe(true);
  });
});
