import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';


const migrationPath = fileURLToPath(new URL(
  '../../migrations/372_golden_path_contract_versions.sql',
  import.meta.url,
));

describe('migration 372 Golden Path contract versions', () => {
  it('creates the append-only contract and signature schema', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS golden_path_contract_versions',
    );
    expect(sql).toMatch(
      /status\s+text\s+NOT NULL[\s\S]*CHECK\s*\(\s*status\s+IN\s*\(\s*'pending_signature'\s*,\s*'signed'\s*,\s*'invalidated'\s*,\s*'superseded'\s*\)\s*\)/i,
    );
    expect(sql).toMatch(
      /golden_path_id\s+uuid\s+NOT NULL\s+REFERENCES\s+golden_paths\s*\(\s*id\s*\)/i,
    );
    expect(sql).toMatch(
      /signature_decision_id\s+uuid\s+(?:UNIQUE\s+)?REFERENCES\s+decisions\s*\(\s*id\s*\)/i,
    );
    expect(sql).toMatch(
      /signing_action_id\s+uuid\s+(?:UNIQUE\s+)?REFERENCES\s+pending_actions\s*\(\s*id\s*\)/i,
    );
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*golden_path_id\s*,\s*version\s*\)/i,
    );
    expect(sql).toContain('CREATE UNIQUE INDEX uq_gp_contract_one_signed');
    expect(sql).toMatch(/WHERE\s+status\s*=\s*'signed'/i);
    expect(sql).toContain("VALUES ('372'");
  });

  it('does not make content hashes globally or per-GP unique', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).not.toMatch(/UNIQUE\s*\([^)]*content_hash/i);
    expect(sql).not.toMatch(/UNIQUE\s+INDEX[^;]*content_hash/i);
  });
});
