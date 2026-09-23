import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { stripReanchorEvidence } from '../work-routing-store.js';

describe('work-routing-store × 接班收据', () => {
  it('幂等回读按 created_at DESC, anchor_generation DESC 取最新一代', async () => {
    const source = await readFile(new URL('../work-routing-store.js', import.meta.url), 'utf8');
    expect(source).toMatch(/WHERE r\.source=\$1 AND r\.source_id=\$2 AND r\.router_version=\$3\s+ORDER BY r\.created_at DESC, r\.anchor_generation DESC\s+LIMIT 1/);
  });

  it('sameRoute 比对 evidence 时剔除 base_sha / prev_base_sha / resigned_at / reanchor_reason', () => {
    expect(stripReanchorEvidence({ branch: 'cp-x', base_sha: 'a'.repeat(40), prev_base_sha: 'b'.repeat(40), resigned_at: 't', reanchor_reason: 'map_revision_advanced' }))
      .toEqual({ branch: 'cp-x' });
    expect(stripReanchorEvidence(null)).toEqual({});
  });
});
