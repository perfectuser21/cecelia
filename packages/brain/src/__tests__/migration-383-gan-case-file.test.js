import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL('../../migrations/383_gan_case_file.sql', import.meta.url),
  'utf8',
);

describe('migration 383 gan_case_file', () => {
  it('creates the append-only case-file table with the designed shape', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS gan_case_file/);
    expect(sql).toMatch(/run_id UUID NOT NULL REFERENCES initiative_runs\(id\)/);
    expect(sql).toMatch(/round INTEGER NOT NULL/);
    expect(sql).toMatch(
      /author_role TEXT NOT NULL CHECK \(author_role IN \('proposer','reviewer'\)\)/,
    );
    expect(sql).toMatch(/attempt_id UUID NOT NULL/);
    expect(sql).toMatch(/contract_sha TEXT/);
    expect(sql).toMatch(/rubric_scores JSONB/);
    expect(sql).toMatch(/blockers JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    expect(sql).toMatch(/feedback_md TEXT/);
    expect(sql).toMatch(/UNIQUE\s*\(run_id,\s*round,\s*author_role\)/);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_gan_case_file_run\s*\n\s*ON gan_case_file \(run_id, round\)/,
    );
  });
});
