import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL('../../migrations/367_harness_commander_phase1.sql', import.meta.url);
const migrationPath = fileURLToPath(migrationUrl);
const sql = existsSync(migrationPath) ? readFileSync(migrationUrl, 'utf8') : '';

describe('migration 367 Harness Commander Phase 1', () => {
  it('adds opt-in mode, isolated state, immutable events and actor delivery state', () => {
    expect(sql, 'migration 367 must exist').not.toBe('');
    expect(sql).toContain('commander_mode');
    for (const table of [
      'harness_commander_state',
      'harness_run_events',
      'harness_actor_messages',
      'harness_actor_deliveries',
      'harness_actor_cursors',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain('append_harness_run_event');
    expect(sql).toContain('harness_attempt_event_version');
    expect(sql).toContain('harness_initiative_run_event_version');
    expect(sql).toMatch(/VALUES\s*\(\s*'367'/);
  });

  it('projects only bounded lifecycle payloads and keeps event rows immutable', () => {
    expect(sql).toContain('harness_run_events_append_only');
    expect(sql).toContain('attempt.expired');
    expect(sql).toContain('attempt.heartbeat');
    expect(sql).toContain('run.phase_changed');
    expect(sql).not.toMatch(/jsonb_build_object\([^;]*(task_bundle|callback_secret_hash|provider_session_id|error_message)/is);
  });
});
