import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../migrations/382_kernel_equivalence_grant_authority.sql',
  import.meta.url,
);
const sql = existsSync(migrationUrl)
  ? readFileSync(migrationUrl, 'utf8')
  : '';

describe('migration 382 Kernel equivalence grant authority', () => {
  it('creates immutable grant anchors, events, and revocation tombstones', () => {
    expect(sql).not.toBe('');
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_equivalence_grant_authorities/i,
    );
    expect(sql).toMatch(
      /grant_digest TEXT NOT NULL CHECK \(\s*grant_digest ~ '\^\[a-f0-9\]\{64\}\$'/i,
    );
    expect(sql).toMatch(
      /case_id UUID NOT NULL\s+REFERENCES kernel_equivalence_production_case_bindings\(case_id\)\s+ON DELETE RESTRICT/i,
    );
    for (const column of [
      'cell_id TEXT NOT NULL',
      'run_id UUID NOT NULL',
      'attempt_id UUID NOT NULL',
      'resource_type TEXT NOT NULL',
      'resource_id TEXT NOT NULL',
      'resource_ref TEXT NOT NULL',
      'grant_payload JSONB NOT NULL',
      'expires_at TIMESTAMPTZ NOT NULL',
      'grant_issued_at TIMESTAMPTZ NOT NULL',
      'registered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp\\(\\)',
    ]) {
      expect(sql).toMatch(new RegExp(column, 'i'));
    }

    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_equivalence_grant_events/i,
    );
    expect(sql).toMatch(
      /state TEXT NOT NULL CHECK \(state IN \(\s*'published',\s*'execution_intent',\s*'effect_completed',\s*'aborted_before_effect',\s*'effect_unknown'\s*\)\)/is,
    );
    expect(sql).toMatch(/actor_instance_id UUID NOT NULL/i);
    expect(sql).toMatch(
      /actor_kind TEXT NOT NULL CHECK \(actor_kind IN \('controller', 'runtime'\)\)/i,
    );
    expect(sql).toMatch(/details JSONB NOT NULL/i);
    expect(sql).toMatch(/UNIQUE \(grant_id, generation\)/i);

    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS kernel_equivalence_grant_revocations/i,
    );
    expect(sql).toMatch(/grant_id UUID PRIMARY KEY/i);
    expect(sql).toMatch(
      /execution_disposition TEXT NOT NULL CHECK \(\s*execution_disposition IN \('safe_no_effect', 'effect_possible'\)\s*\)/is,
    );
    expect(sql).toMatch(
      /revoked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp\(\)/i,
    );

    for (const table of [
      'kernel_equivalence_grant_authorities',
      'kernel_equivalence_grant_events',
      'kernel_equivalence_grant_revocations',
    ]) {
      expect(sql).toMatch(new RegExp(
        `BEFORE INSERT ON ${table}`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(
        `BEFORE UPDATE OR DELETE ON ${table}`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(
        `BEFORE TRUNCATE ON ${table}`,
        'i',
      ));
      expect(sql).toMatch(new RegExp(
        `REVOKE ALL ON TABLE ${table} FROM PUBLIC`,
        'i',
      ));
    }
  });

  it('exposes only controlled security-definer APIs for grant mutation', () => {
    for (const functionName of [
      'kernel_equivalence_register_grant_authority',
      'kernel_equivalence_append_grant_event',
      'kernel_equivalence_resolve_active_grant',
      'kernel_equivalence_revoke_grant',
    ]) {
      expect(sql).toMatch(new RegExp(
        `CREATE OR REPLACE FUNCTION ${functionName}\\(`,
        'i',
      ));
      expect(sql).toContain(`'${functionName}(`);
    }
    expect(sql.match(/SECURITY DEFINER/gi)).toHaveLength(4);
    expect(sql.match(/SET search_path = public, pg_temp/gi)).toHaveLength(8);
    for (const guardFunction of [
      'kernel_equivalence_grant_append_only',
      'kernel_equivalence_grant_authority_insert_guard',
      'kernel_equivalence_grant_event_insert_guard',
      'kernel_equivalence_grant_revocation_insert_guard',
    ]) {
      expect(sql).toMatch(new RegExp(
        `FUNCTION ${guardFunction}\\(\\)[\\s\\S]*?LANGUAGE plpgsql\\s+SET search_path = public, pg_temp`,
        'i',
      ));
    }
    expect(sql).toMatch(
      /CREATE TEMP TABLE kernel_equivalence_grant_migration_context[\s\S]*current_user::name AS runtime_role/i,
    );
    expect(sql).toMatch(
      /format\(\s*'GRANT EXECUTE ON FUNCTION %s TO %I'/i,
    );
    expect(sql).not.toMatch(/GRANT EXECUTE[\s\S]*TO PUBLIC/i);
    expect(sql).toMatch(
      /aclexplode\([\s\S]*pg_get_userbyid\([\s\S]*REVOKE ALL ON FUNCTION %s FROM %I/i,
    );
    expect(sql).not.toMatch(
      /kernel_equivalence_revoke_grant\(\s*p_grant_id UUID,\s*p_grant_sha256 TEXT,\s*p_controller_instance_id UUID,\s*p_reason TEXT\s*\)[\s\S]*p_execution_disposition/i,
    );
    expect(sql).toMatch(
      /kernel_equivalence_register_grant_authority\(\s*p_case_id UUID,\s*p_grant JSONB,\s*p_grant_sha256 TEXT\s*\)/i,
    );
    expect(sql).toMatch(
      /kernel_equivalence_append_grant_event\(\s*p_grant_id UUID,\s*p_grant_sha256 TEXT,\s*p_state TEXT,\s*p_actor_instance_id UUID,\s*p_details JSONB\s*\)/i,
    );
    expect(sql).toMatch(
      /kernel_equivalence_resolve_active_grant\(\s*p_grant_id UUID,\s*p_grant_sha256 TEXT,\s*p_cell_id TEXT\s*\)/i,
    );
    expect(sql).toMatch(
      /kernel_equivalence_revoke_grant\(\s*p_grant_id UUID,\s*p_grant_sha256 TEXT,\s*p_controller_instance_id UUID,\s*p_reason TEXT\s*\)/i,
    );
  });

  it('uses database time and production case/lease authority at active boundaries', () => {
    expect(sql).toMatch(
      /JOIN kernel_equivalence_production_cases cases/i,
    );
    expect(sql).toMatch(
      /JOIN kernel_equivalence_production_case_leases leases/i,
    );
    expect(sql).toMatch(
      /leases\.owner_id\s*=\s*'brain\.kernel_equivalence\.production_cases'/i,
    );
    expect(sql).toMatch(/leases\.state = 'prepared'/i);
    expect(sql).toMatch(/cases\.expires_at > clock_timestamp\(\)/i);
    expect(sql).toMatch(/leases\.lease_expires_at > clock_timestamp\(\)/i);
    expect(sql).toMatch(
      /grant_expires_at <= clock_timestamp\(\)/i,
    );
    expect(sql).toMatch(
      /grant_expires_at\s+>\s+LEAST\(case_expires_at, lease_expires_at\)/i,
    );
    expect(sql).toMatch(
      /authorities\.expires_at > clock_timestamp\(\)/i,
    );
  });

  it('uses one documented cross-authority row-lock order', () => {
    expect(sql).toMatch(
      /production lease -> execution fence \(publication only\) -> grant authority/i,
    );
    const authorityInsertGuard = sql.match(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_grant_authority_insert_guard\(\)[\s\S]*?\$\$ LANGUAGE plpgsql/i,
    )?.[0] ?? '';
    const registerFunction = sql.match(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_register_grant_authority\([\s\S]*?\$\$ LANGUAGE plpgsql\s+SECURITY DEFINER/i,
    )?.[0] ?? '';
    const resolveFunction = sql.match(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_resolve_active_grant\([\s\S]*?\$\$ LANGUAGE plpgsql\s+SECURITY DEFINER/i,
    )?.[0] ?? '';
    const revocationInsertGuard = sql.match(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_grant_revocation_insert_guard\(\)[\s\S]*?\$\$ LANGUAGE plpgsql/i,
    )?.[0] ?? '';
    const revokeFunction = sql.match(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_revoke_grant\([\s\S]*?\$\$ LANGUAGE plpgsql\s+SECURITY DEFINER/i,
    )?.[0] ?? '';

    expect(authorityInsertGuard).toMatch(/FOR UPDATE OF leases/i);
    const registerLeaseLock = registerFunction.indexOf(
      'FOR UPDATE OF leases',
    );
    expect(registerLeaseLock).toBeGreaterThan(-1);
    expect(registerFunction.indexOf(
      'INSERT INTO kernel_equivalence_grant_authorities',
    )).toBeGreaterThan(registerLeaseLock);

    const resolveLeaseLock = resolveFunction.indexOf(
      'FOR SHARE OF leases',
    );
    const resolveAuthorityLock = resolveFunction.indexOf(
      'FOR SHARE OF authorities',
    );
    expect(resolveLeaseLock).toBeGreaterThan(-1);
    expect(resolveAuthorityLock).toBeGreaterThan(resolveLeaseLock);
    expect(resolveFunction).not.toMatch(
      /FOR SHARE OF authorities, bindings, cases, leases/i,
    );

    for (const authorityOnlyFunction of [
      revocationInsertGuard,
      revokeFunction,
    ]) {
      expect(authorityOnlyFunction).toMatch(
        /FROM kernel_equivalence_grant_authorities/i,
      );
      expect(authorityOnlyFunction).not.toMatch(
        /kernel_equivalence_production_case_leases/i,
      );
    }
  });

  it('enforces publication, intent, terminal, generation, and revoke ordering', () => {
    const appendFunction = sql.match(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_append_grant_event\([\s\S]*?\$\$ LANGUAGE plpgsql\s+SECURITY DEFINER/i,
    )?.[0] ?? '';
    const insertGuard = sql.match(
      /CREATE OR REPLACE FUNCTION kernel_equivalence_grant_event_insert_guard\(\)[\s\S]*?\$\$ LANGUAGE plpgsql/i,
    )?.[0] ?? '';
    expect(sql).toMatch(
      /next_generation <> previous_generation \+ 1/i,
    );
    expect(sql).toMatch(
      /p_state = 'execution_intent'[\s\S]*previous_state <> 'published'/i,
    );
    expect(sql).toMatch(
      /p_state IN \(\s*'effect_completed',\s*'aborted_before_effect',\s*'effect_unknown'\s*\)[\s\S]*previous_state <> 'execution_intent'/is,
    );
    expect(sql).toMatch(
      /p_details->>'intent_generation'[\s\S]*previous_generation/i,
    );
    expect(sql).toMatch(
      /p_state = 'execution_intent'[\s\S]*kernel_equivalence_grant_revocations/i,
    );
    expect(sql).toMatch(
      /WHEN NOT EXISTS \([\s\S]*intent\.state = 'execution_intent'[\s\S]*AND NOT EXISTS \([\s\S]*aborted\.state = 'aborted_before_effect'[\s\S]*aborted\.details->>'intent_generation'[\s\S]*intent\.generation[\s\S]*THEN 'safe_no_effect'/i,
    );
    expect(sql).toMatch(/ELSE 'effect_possible'/i);
    expect(sql).not.toMatch(
      /existing_revocation\.execution_disposition\s+IS DISTINCT FROM computed_disposition/i,
    );
    expect(sql).toMatch(
      /IF FOUND THEN[\s\S]*existing_revocation\.reason IS DISTINCT FROM p_reason[\s\S]*RETURN QUERY[\s\S]*END IF;[\s\S]*computed_disposition :=/i,
    );
    for (const definition of [appendFunction, insertGuard]) {
      const leaseLockIndex = definition.indexOf('FOR UPDATE OF leases');
      const fenceLockIndex = definition.indexOf(
        'FROM kernel_equivalence_production_execution_fences',
        leaseLockIndex,
      );
      const publicationValidationIndex = definition.indexOf(
        'publication execution fence is inactive',
        fenceLockIndex,
      );
      const authorityLockIndex = definition.indexOf(
        'SELECT authorities.grant_digest',
        fenceLockIndex,
      );
      expect(leaseLockIndex).toBeGreaterThan(-1);
      expect(fenceLockIndex).toBeGreaterThan(leaseLockIndex);
      expect(publicationValidationIndex).toBeGreaterThan(fenceLockIndex);
      expect(authorityLockIndex).toBeGreaterThan(fenceLockIndex);
      expect(definition).toMatch(
        /IF (?:p_state|NEW\.state) IN \('published', 'execution_intent'\) THEN[\s\S]*FOR UPDATE OF leases/i,
      );
    }
    expect(sql).toMatch(
      /VALUES \('382', 'kernel_equivalence_grant_authority'\)/i,
    );
  });
});
