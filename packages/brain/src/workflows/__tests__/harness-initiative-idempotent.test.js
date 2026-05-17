import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('B13 harness-initiative dbUpsert 幂等', () => {
  const graphSource = readFileSync(
    resolve(__dirname, '../harness-initiative.graph.js'),
    'utf8'
  );

  it('两处 INSERT initiative_contracts 都含 ON CONFLICT (initiative_id, version) DO UPDATE', () => {
    const matches = graphSource.match(
      /ON CONFLICT \(initiative_id, version\) DO UPDATE/g
    );
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('两处 INSERT 都覆盖 contract_content 列（用 EXCLUDED.contract_content）', () => {
    const matches = graphSource.match(/contract_content = EXCLUDED\.contract_content/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('两处 ON CONFLICT 块都用 approved_at = NOW() 重置时间戳', () => {
    const onConflictBlocks = graphSource.split('ON CONFLICT (initiative_id, version) DO UPDATE');
    expect(onConflictBlocks.length).toBeGreaterThanOrEqual(3);
    onConflictBlocks.slice(1).forEach((block) => {
      const upToNextSemi = block.split(';')[0];
      expect(upToNextSemi).toMatch(/approved_at\s*=\s*NOW\(\)/);
    });
  });
});
