import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL('../../migrations/370_gp_governance_decisions.sql', import.meta.url);
const migrationPath = fileURLToPath(migrationUrl);
const sql = existsSync(migrationPath) ? readFileSync(migrationUrl, 'utf8') : '';

describe('migration 370 — finalized Golden Path governance decisions', () => {
  it('exists as the next migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('seeds every finalized policy with stable machine keys', () => {
    const policyKeys = [
      'gp.sealing.element-criterion',
      'gp.sealing.contract-criterion',
      'gp.sealing.rejection-template',
      'gp.ownership-transfer.b',
      'gp.high-risk.global-invariant',
      'gp.classification-and-yield-defaults',
    ];

    expect(sql).toContain('policy_version');
    for (const key of policyKeys) {
      expect(sql).toContain(key);
      expect(sql).toContain(`harness-gp-governance-prd:${key}:v1`);
    }
  });

  it('adds a real global invariant level and the four immutable risk domains', () => {
    expect(sql).toMatch(/decisions_level_chk[\s\S]+?'global'[\s\S]+?'area'/);
    expect(sql).toContain("'category', 'invariant'");
    expect(sql).toContain("'level', 'global'");
    expect(sql).toContain("'permission'");
    expect(sql).toContain("'money'");
    expect(sql).toContain("'external_publish'");
    expect(sql).toContain("'production_data'");
    expect(sql).toContain("'require_human_confirmation'");
  });

  it('records the sealed wording, ownership B condition, and default yield order', () => {
    expect(sql).toContain('每步单独回答、逐步不同、且未被四区收留');
    expect(sql).toContain('每 GP 单独回答、且必须人签字');
    expect(sql).toContain('11 要素封版，不再增补');
    expect(sql).toContain('红方接线');
    expect(sql).toContain('断言盖章');
    expect(sql).toContain('权和闸同步交接，不裸奔');
    expect(sql).toContain('安全/资金正确性');
    expect(sql).toContain('数据一致性');
    expect(sql).toContain('功能完整');
    expect(sql).toContain('性能');
    expect(sql).toContain('体验顺滑');
  });

  it('is Owner-attributed and idempotent only within the governance namespace', () => {
    expect(sql).toContain("'owner'");
    expect(sql).toContain("'user'");
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]+source_ref[\s\S]+harness-gp-governance-prd:/);
    expect(sql).toMatch(/ON CONFLICT\s*\(source_ref\)[\s\S]+harness-gp-governance-prd:/);
    expect(sql).toContain("VALUES ('370'");
  });
});
