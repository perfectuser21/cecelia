/**
 * Tests: migration 152 — learnings quality_score + source_type fields
 *
 * Validates the SQL migration file and selfcheck.js without requiring
 * a live PostgreSQL connection (CI-safe, grep-based checks).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = path.resolve(__dirname, '../../migrations/152_learnings_quality_score.sql');
const SELFCHECK_FILE = path.resolve(__dirname, '../selfcheck.js');

describe('Migration 152 — learnings quality_score + source_type', () => {
  let sql;

  it('migration file exists', () => {
    expect(fs.existsSync(MIGRATION_FILE)).toBe(true);
    sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
  });

  it('adds quality_score INTEGER column', () => {
    if (!sql) sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toMatch(/quality_score\s+INTEGER/i);
  });

  it('quality_score defaults to NULL', () => {
    if (!sql) sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toMatch(/quality_score\s+INTEGER\s+DEFAULT\s+NULL/i);
  });

  it('adds check constraint for quality_score range 0-100', () => {
    if (!sql) sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toMatch(/learnings_quality_score_check/);
    expect(sql).toMatch(/quality_score >= 0 AND quality_score <= 100/);
  });

  it('adds source_type VARCHAR(50) column', () => {
    if (!sql) sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toMatch(/source_type\s+VARCHAR\(50\)/i);
  });

  it('source_type check constraint includes all three values', () => {
    if (!sql) sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toMatch(/learnings_source_type_check/);
    expect(sql).toMatch(/'test_run'/);
    expect(sql).toMatch(/'real_insight'/);
    expect(sql).toMatch(/'unknown'/);
  });

  it('creates index on quality_score', () => {
    if (!sql) sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toMatch(/idx_learnings_quality_score/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_learnings_quality_score/i);
  });

  it('inserts schema_version 152', () => {
    if (!sql) sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
    expect(sql).toMatch(/'152'/);
    expect(sql).toMatch(/INSERT INTO schema_version/i);
  });
});

describe('selfcheck.js EXPECTED_SCHEMA_VERSION', () => {
  it('is updated to 152', () => {
    const content = fs.readFileSync(SELFCHECK_FILE, 'utf-8');
    expect(content).toMatch(/EXPECTED_SCHEMA_VERSION\s*=\s*'152'/);
  });
});
