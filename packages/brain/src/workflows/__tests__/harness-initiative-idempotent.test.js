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

  it('INSERT initiative_contracts 含 ON CONFLICT (initiative_id, version) DO UPDATE', () => {
    const matches = graphSource.match(
      /ON CONFLICT \(initiative_id, version\) DO UPDATE/g
    );
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('INSERT 覆盖 contract_content 列（用 EXCLUDED.contract_content）', () => {
    const matches = graphSource.match(/contract_content = EXCLUDED\.contract_content/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('ON CONFLICT 块用 approved_at = NOW() 重置时间戳', () => {
    const onConflictBlocks = graphSource.split('ON CONFLICT (initiative_id, version) DO UPDATE');
    expect(onConflictBlocks.length).toBeGreaterThanOrEqual(2);
    onConflictBlocks.slice(1).forEach((block) => {
      const upToNextSemi = block.split(';')[0];
      expect(upToNextSemi).toMatch(/approved_at\s*=\s*NOW\(\)/);
    });
  });
});
