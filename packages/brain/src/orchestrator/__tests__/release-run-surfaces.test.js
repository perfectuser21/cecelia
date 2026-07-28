import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../..');
const production = [
  'deploy.yml',
  'promote-all-prod.yml',
  'brain-ci-deploy.yml',
  'promote-dashboard-prod.yml',
];

function workflow(name) {
  return readFileSync(resolve(root, '.github/workflows', name), 'utf8');
}

describe('legacy release surfaces fail closed', () => {
  it.each(production)('%s requires exact ReleaseRun production authority', (name) => {
    const source = workflow(name);
    expect(source).toMatch(/release_run_id:/);
    expect(source).toMatch(/merge_sha:/);
    expect(source).toMatch(/release_authorization:/);
    expect(source).toMatch(/release_run_id[^\n]*(RELEASE_RUN_ID|inputs\.release_run_id)/);
    expect(source).toMatch(/merge_sha[^\n]*(MERGE_SHA|inputs\.merge_sha)/);
    expect(source).toMatch(/release_authorization[^\n]*(RELEASE_AUTHORIZATION|inputs\.release_authorization)/);
    expect(source).toMatch(/group:\s*kernel-release/);
    expect(source).not.toMatch(/schedule:/);
    expect(source).not.toMatch(/push:/);
    expect(source).not.toMatch(/视为成功|production 部署不受阻断|Fast Lane/);
  });

  it('staging deploy requires the same exact ReleaseRun axes', () => {
    const source = workflow('auto-staging-deploy.yml');
    expect(source).toMatch(/release_run_id:/);
    expect(source).toMatch(/merge_sha:/);
    expect(source).toMatch(/release_authorization:/);
    expect(source).toMatch(/\\?"staging\\?":true/);
    expect(source).toMatch(/group:\s*kernel-release/);
    expect(source).not.toMatch(/push:/);
    expect(source).not.toMatch(/skipped_|视为通过|status idle/);
  });

  it('drift sentinel observes and escalates but never deploys', () => {
    const source = readFileSync(
      resolve(root, 'packages/brain/src/cron/drift-sentinel.js'),
      'utf8',
    );
    expect(source).not.toContain('scripts/brain-deploy.sh');
    expect(source).not.toMatch(/\bexec\(['"]bash .*deploy/);
    expect(source).toContain('blocked_unowned_release');
  });

  it('direct production scripts share an executable fail-closed guard', () => {
    const guard = resolve(root, 'scripts/lib/release-run-guard.sh');
    const result = spawnSync('bash', [guard, 'production'], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/ReleaseRun authority required/);

    const directProductionScripts = [
      'brain-deploy.sh',
      'promote-dashboard.sh',
      'post-merge-deploy.sh',
      'deploy.sh',
    ];
    for (const file of directProductionScripts) {
      const source = readFileSync(resolve(root, 'scripts', file), 'utf8');
      expect(source).toContain('release-run-guard.sh');
      expect(source).toContain('production');

      const denied = spawnSync('bash', [resolve(root, 'scripts', file)], {
        env: { PATH: process.env.PATH },
        encoding: 'utf8',
      });
      expect(denied.status, `${file} must fail closed`).not.toBe(0);
      expect(`${denied.stdout}${denied.stderr}`).toMatch(/ReleaseRun authority required/);
    }
  });

  it('bootstrap is normally disabled and requires an explicit database and deploy root', () => {
    const script = resolve(root, 'scripts/release-run-bootstrap.sh');
    const result = spawnSync('bash', [script], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    const source = readFileSync(script, 'utf8');
    expect(source).toContain('KERNEL_RELEASE_BOOTSTRAP_DATABASE_URL');
    expect(source).toContain('KERNEL_RELEASE_BOOTSTRAP_DEPLOY_ROOT');
    expect(source).toMatch(/psql[^ \n]*[ \\\n]+"?\$[^"\n]*DATABASE_URL/i);
    expect(source).toMatch(/git -C "\$deploy_root"/);
  });

  it('bootstrap verifies the exact merged SHA before creating any authority', () => {
    const source = readFileSync(
      resolve(root, 'scripts/release-run-bootstrap.sh'),
      'utf8',
    );
    const fetchPosition = source.search(/git -C "\$deploy_root" fetch/);
    const exactCheckoutPosition = source.search(
      /git -C "\$deploy_root" (?:checkout --force --detach|switch --detach) "\$merge_sha"/,
    );
    const exactHeadPosition = source.search(
      /git -C "\$deploy_root" rev-parse HEAD/,
    );
    const firstAuthorityPosition = source.search(
      /(?:CREATE TABLE IF NOT EXISTS|INSERT INTO) kernel_release_bootstrap_/,
    );

    expect(fetchPosition).toBeGreaterThan(-1);
    expect(exactCheckoutPosition).toBeGreaterThan(fetchPosition);
    expect(exactHeadPosition).toBeGreaterThan(exactCheckoutPosition);
    expect(firstAuthorityPosition).toBeGreaterThan(exactHeadPosition);
    expect(source).toMatch(/source_head_sha/);
    expect(source).toMatch(
      /git -C "\$deploy_root" merge-base --is-ancestor "\$source_head_sha" "\$merge_sha"/,
    );
  });

  it('bootstrap owner approval binds repository, PR, source, merge, and actor', () => {
    const source = readFileSync(
      resolve(root, 'scripts/release-run-bootstrap.sh'),
      'utf8',
    );
    const hmacPosition = source.indexOf('openssl dgst -sha256 -hmac');
    expect(hmacPosition).toBeGreaterThan(-1);
    const approvalContext = source.slice(
      Math.max(0, source.lastIndexOf('expected_approval', hmacPosition) - 1_000),
      hmacPosition + 250,
    );
    for (const axis of [
      'repository',
      'pr_number',
      'source_head_sha',
      'merge_sha',
      'actor',
    ]) {
      expect(approvalContext).toContain(`\${${axis}}`);
    }
  });

  it('bootstrap executes staging before production and refuses a terminal replay', () => {
    const source = readFileSync(
      resolve(root, 'scripts/release-run-bootstrap.sh'),
      'utf8',
    );
    for (const state of [
      'approved',
      'staging_intent',
      'staging_passed',
      'production_intent',
      'production_verified',
    ]) {
      expect(source).toContain(state);
    }
    const stagingDeployPosition = source.indexOf('scripts/staging-deploy.sh');
    const productionDeployPosition = source.indexOf('scripts/brain-deploy.sh');
    expect(stagingDeployPosition).toBeGreaterThan(-1);
    expect(productionDeployPosition).toBeGreaterThan(stagingDeployPosition);
    expect(source).toMatch(
      /production_verified[\s\S]{0,500}(?:terminal|already|forbid|permanent)[\s\S]{0,200}exit 78/i,
    );
  });

  it('bootstrap guard claims a leased generation for the current stage', () => {
    const source = readFileSync(
      resolve(root, 'scripts/lib/release-run-guard.sh'),
      'utf8',
    );
    expect(source).toContain('KERNEL_RELEASE_BOOTSTRAP_RUN_ID');
    expect(source).toContain('KERNEL_RELEASE_BOOTSTRAP_DATABASE_URL');
    expect(source).toContain('kernel_release_bootstrap_effect_attempts');
    expect(source).toContain('generation');
    expect(source).toContain('lease_expires_at');
    expect(source).toMatch(/staging_intent/);
    expect(source).toMatch(/production_intent/);
    expect(source).not.toContain('kernel_release_bootstrap_consumptions');
  });

  it('bootstrap uses an append-only state ledger instead of a consumable receipt', () => {
    const source = readFileSync(
      resolve(root, 'scripts/release-run-bootstrap.sh'),
      'utf8',
    );
    expect(source).toContain('KERNEL_RELEASE_OWNER_APPROVED_SHA');
    expect(source).toContain('KERNEL_RELEASE_BOOTSTRAP_OWNER_SECRET');
    expect(source).toMatch(/openssl dgst -sha256 -hmac/);
    expect(source).toContain('kernel_release_bootstrap_runs');
    expect(source).toContain('kernel_release_bootstrap_transitions');
    expect(source).toContain('kernel_release_bootstrap_effect_attempts');
    expect(source).toContain('kernel_release_bootstrap_effect_receipts');
    expect(source).toMatch(/singleton BOOLEAN NOT NULL UNIQUE/);
    expect(source).toMatch(/BEFORE UPDATE OR DELETE/g);
    expect(source).not.toContain('KERNEL_RELEASE_BOOTSTRAP_RECEIPT');
  });

  it('staging builds from an isolated exact-SHA worktree', () => {
    const source = readFileSync(resolve(root, 'scripts/staging-deploy.sh'), 'utf8');
    expect(source).toMatch(/worktree add --detach "\$EXACT_ROOT" "\$EXACT_SHA"/);
    expect(source).toContain('CECELIA_STAGING_EXACT_ROOT');
    expect(source).toMatch(/worktree remove --force/);
    expect(source).not.toContain('release-run-checkout.sh" staging');
  });
});
