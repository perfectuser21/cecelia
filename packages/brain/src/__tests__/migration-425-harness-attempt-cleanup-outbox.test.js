import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = new URL(
  '../../migrations/425_harness_attempt_cleanup_outbox.sql',
  import.meta.url,
);
const rollback = new URL(
  '../../migrations/rollback/425_harness_attempt_cleanup_outbox.down.sql',
  import.meta.url,
);

describe('migration 425: durable Harness attempt cleanup outbox', () => {
  it('creates an append-oriented outbox with frozen execution identity', () => {
    const sql = readFileSync(migration, 'utf8');

    expect(sql).toMatch(/CREATE TABLE(?: IF NOT EXISTS)?\s+harness_attempt_cleanup_outbox/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*attempt_id\s*,\s*lease_generation\s*\)/i);
    for (const column of [
      'run_id',
      'attempt_id',
      'target_machine_id',
      'execution_transport',
      'remote_job_id',
      'lease_owner',
      'lease_generation',
      'cleanup_cause',
      'cleanup_cause_message',
      'claim_owner',
      'claim_generation',
      'claim_expires_at',
      'delivery_attempts',
      'available_at',
      'receipt',
      'last_error_code',
      'last_error_message',
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`, 'i'));
    }
    expect(sql).toMatch(/run_id[\s\S]*REFERENCES\s+initiative_runs\s*\(\s*id\s*\)[\s\S]*ON DELETE RESTRICT/i);
    expect(sql).toMatch(/attempt_id[\s\S]*REFERENCES\s+harness_attempts\s*\(\s*id\s*\)[\s\S]*ON DELETE RESTRICT/i);
    expect(sql).toMatch(/delivery_attempts[\s\S]*NOT NULL[\s\S]*DEFAULT\s+0/i);
    expect(sql).toMatch(/available_at[\s\S]*DEFAULT\s+NOW\s*\(\s*\)/i);
    expect(sql).toMatch(/status[\s\S]*pending[\s\S]*leased[\s\S]*confirmed[\s\S]*blocked/i);
    expect(sql).toMatch(
      /ALTER TABLE harness_attempts[\s\S]*ADD COLUMN(?: IF NOT EXISTS)?\s+parent_run_terminal\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+FALSE/i,
    );
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*['"]425['"]/i);
  });

  it('enqueues OLD attempt authority and terminalizes v2 attempts at deferred commit', () => {
    const sql = readFileSync(migration, 'utf8');

    expect(sql).toMatch(/AFTER UPDATE OF status\s+ON harness_attempts/i);
    expect(sql).toMatch(/OLD\.status[\s\S]*queued[\s\S]*starting[\s\S]*running/i);
    expect(sql).toMatch(/NEW\.status\s*=\s*'cancelled'/i);
    expect(sql).toMatch(/NEW\.error_code\s*=\s*'parent_run_terminal'/i);
    expect(sql).toMatch(/OLD\.lease_owner/i);
    expect(sql).toMatch(/OLD\.lease_generation/i);
    expect(sql).toMatch(/NEW\.error_message/i);
    expect(sql).toMatch(/ON CONFLICT\s*\(\s*attempt_id\s*,\s*lease_generation\s*\)\s+DO NOTHING/i);
    expect(sql).toMatch(/CREATE CONSTRAINT TRIGGER[\s\S]*DEFERRABLE INITIALLY DEFERRED/i);
    expect(sql).toMatch(/NEW\.orchestrator_version\s*=\s*'v2'/i);
    expect(sql).toMatch(/NEW\.phase\s+IN\s*\(\s*'done'\s*,\s*'failed'\s*\)/i);
    expect(sql).toMatch(/ORDER BY\s+id[\s\S]*FOR UPDATE/i);
    expect(sql).toMatch(/SET[\s\S]*parent_run_terminal\s*=\s*TRUE[\s\S]*status\s*=\s*CASE/i);
    expect(sql).toMatch(/BEFORE INSERT\s+ON harness_attempts/i);
    expect(sql).toMatch(/BEFORE UPDATE OF status\s*,\s*run_id\s*,\s*parent_run_terminal\s+ON harness_attempts/i);
    expect(sql).toMatch(/OLD\.run_id\s+IS DISTINCT FROM\s+NEW\.run_id[\s\S]*attempt_run_id_immutable/i);
    expect(sql).toMatch(/OLD\.parent_run_terminal[\s\S]*NOT NEW\.parent_run_terminal[\s\S]*parent_run_terminal_immutable/i);
    expect(sql).toMatch(/NEW\.status\s+IN\s*\(\s*'queued'\s*,\s*'starting'\s*,\s*'running'\s*\)[\s\S]*parent_run_terminal/i);
    expect(sql).toMatch(
      /FUNCTION guard_harness_attempt_insert_parent_run[\s\S]*SELECT[\s\S]*INTO parent_run[\s\S]*FOR KEY SHARE[\s\S]*BEFORE INSERT\s+ON harness_attempts/i,
    );
    expect(sql).toMatch(/parent_run\.phase\s+IN\s*\(\s*'done'\s*,\s*'failed'\s*\)/i);
    expect(sql).toMatch(/AFTER UPDATE OF phase\s*,\s*orchestrator_version\s+ON initiative_runs/i);
    expect(sql).toMatch(/OLD\.orchestrator_version\s+IS DISTINCT FROM\s+NEW\.orchestrator_version/i);
  });

  it('freezes outbox identity and rejects deletion throughout its lifecycle', () => {
    const sql = readFileSync(migration, 'utf8');

    expect(sql).toMatch(
      /BEFORE INSERT OR UPDATE OR DELETE\s+ON harness_attempt_cleanup_outbox/i,
    );
    for (const identity of [
      'id',
      'run_id',
      'attempt_id',
      'target_machine_id',
      'execution_transport',
      'remote_job_id',
      'lease_owner',
      'lease_generation',
      'cleanup_cause',
      'cleanup_cause_message',
      'created_at',
    ]) {
      expect(sql).toMatch(new RegExp(`OLD\\.${identity}[\\s\\S]*NEW\\.${identity}`, 'i'));
    }
    expect(sql).toMatch(/TG_OP\s*=\s*'DELETE'[\s\S]*cleanup_outbox_delete_forbidden/i);
    expect(sql).toMatch(/NEW\.claim_owner\s+IS NULL/i);
    expect(sql).toMatch(/NEW\.claim_generation\s*(?:<>|!=)\s*OLD\.claim_generation\s*\+\s*1/i);
    expect(sql).toMatch(/NEW\.claim_expires_at\s*<=\s*NOW\s*\(\s*\)/i);
    expect(sql).toMatch(/NEW\.receipt\s+IS NULL/i);
    expect(sql).toMatch(/NEW\.confirmed_at\s+IS NULL/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
  });

  it('enforces canonical inserts, object receipts, and due-work indexes', () => {
    const sql = readFileSync(migration, 'utf8');

    expect(sql).toMatch(
      /BEFORE INSERT OR UPDATE OR DELETE\s+ON harness_attempt_cleanup_outbox/i,
    );
    expect(sql).toMatch(/TG_OP\s*=\s*'INSERT'[\s\S]*cleanup_outbox_invalid_initial_state/i);
    expect(sql).toMatch(/NEW\.status\s*(?:<>|!=)\s*'pending'/i);
    expect(sql).toMatch(/NEW\.claim_generation\s*(?:<>|!=)\s*0/i);
    expect(sql).toMatch(/jsonb_typeof\s*\(\s*NEW\.receipt\s*\)[\s\S]*'object'/i);
    expect(sql).toMatch(
      /NEW\.status\s*(?:<>|!=)\s*'confirmed'[\s\S]*NEW\.receipt\s+IS NOT NULL[\s\S]*NEW\.confirmed_at\s+IS NOT NULL/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS\s+idx_harness_attempt_cleanup_outbox_pending_due[\s\S]*available_at[\s\S]*WHERE status\s*=\s*'pending'/i,
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS\s+idx_harness_attempt_cleanup_outbox_lease_expiry[\s\S]*claim_expires_at\s*,\s*created_at\s*,\s*id[\s\S]*WHERE status\s*=\s*'leased'/i,
    );
    expect(sql).toMatch(/NEW\.delivery_attempts\s*(?:<>|!=)\s*0/i);
    for (const errorField of ['last_error_code', 'last_error_message', 'last_error_at']) {
      expect(sql).toMatch(new RegExp(`NEW\\.${errorField}\\s+IS NOT NULL`, 'i'));
    }
  });

  it('backfills terminal v2 active attempts after installing its triggers', () => {
    const sql = readFileSync(migration, 'utf8');
    const triggerIndex = sql.indexOf('CREATE CONSTRAINT TRIGGER terminalize_v2_run_active_attempts');
    const backfillIndex = sql.indexOf('FOR terminal_run IN');

    expect(triggerIndex).toBeGreaterThan(-1);
    expect(backfillIndex).toBeGreaterThan(triggerIndex);
    expect(sql.slice(backfillIndex)).toMatch(
      /SELECT id[\s\S]*FROM initiative_runs[\s\S]*orchestrator_version\s*=\s*'v2'[\s\S]*phase IN\s*\(\s*'done'\s*,\s*'failed'\s*\)[\s\S]*ORDER BY id[\s\S]*FOR UPDATE/i,
    );
    expect(sql.slice(backfillIndex)).toMatch(
      /SELECT id[\s\S]*FROM harness_attempts[\s\S]*run_id\s*=\s*terminal_run\.id[\s\S]*ORDER BY id[\s\S]*FOR UPDATE/i,
    );
    expect(sql.slice(backfillIndex)).toMatch(/parent_run_terminal\s*=\s*TRUE/i);
  });

  it('rolls back triggers and functions before dropping the outbox marker', () => {
    const sql = readFileSync(rollback, 'utf8');

    expect(sql).toMatch(/to_regclass\s*\(\s*'harness_attempt_cleanup_outbox'\s*\)/i);
    expect(sql).toMatch(/cleanup_outbox_rollback_nonempty/i);
    expect(sql).toMatch(/DROP TRIGGER[\s\S]*initiative_runs/i);
    expect(sql).toMatch(/DROP TRIGGER[\s\S]*harness_attempts/i);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS parent_run_terminal/i);
    expect(sql).toMatch(/DROP TABLE(?: IF EXISTS)?\s+harness_attempt_cleanup_outbox/i);
    expect(sql).toMatch(/DELETE FROM schema_version\s+WHERE version\s*=\s*'425'/i);
    expect(sql.indexOf('DROP TABLE')).toBeLessThan(sql.indexOf('DELETE FROM schema_version'));
  });
});
