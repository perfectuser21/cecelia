import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

describe('Workstream 1 — DB Migration: initiative_run_events [BEHAVIOR]', () => {
  it('migration 文件存在于 packages/brain/migrations/', () => {
    const files = readdirSync('packages/brain/migrations').filter(f =>
      f.includes('initiative_run_events')
    );
    expect(files.length).toBeGreaterThan(0);
  });

  it('migration SQL 含 CREATE TABLE initiative_run_events', () => {
    const files = readdirSync('packages/brain/migrations').filter(f =>
      f.includes('initiative_run_events')
    );
    expect(files.length).toBeGreaterThan(0);
    const content = readFileSync(`packages/brain/migrations/${files[0]}`, 'utf8');
    expect(content).toContain('CREATE TABLE');
    expect(content).toContain('initiative_run_events');
  });

  it('migration SQL 含 node/status/attempt/verdict 列，ts 为 BIGINT，无 label 列', () => {
    const files = readdirSync('packages/brain/migrations').filter(f =>
      f.includes('initiative_run_events')
    );
    const content = readFileSync(`packages/brain/migrations/${files[0]}`, 'utf8');
    expect(content).toContain('node');
    expect(content).not.toContain('label');
    expect(content).toContain('attempt');
    expect(content).toContain('status');
    expect(content).toContain('verdict');
    expect(content).toMatch(/ts\s+BIGINT/i);
  });

  it('migration SQL 含 (initiative_id, ts) 复合索引', () => {
    const files = readdirSync('packages/brain/migrations').filter(f =>
      f.includes('initiative_run_events')
    );
    const content = readFileSync(`packages/brain/migrations/${files[0]}`, 'utf8');
    expect(content).toContain('CREATE INDEX');
    expect(content).toContain('initiative_id');
  });
});
