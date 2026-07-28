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

  it('keeps independent PR quality contracts while removing push deploy authority', () => {
    const source = workflow('brain-ci-deploy.yml');
    expect(source).toMatch(/pull_request:/);
    expect(source).toMatch(/skill-contract-guard:/);
    expect(source).toMatch(/contract-exists\.mjs/);
    expect(source).toMatch(/skill-contract\.test\.mjs/);
    expect(source).toMatch(/island-gate:/);
    expect(source).toMatch(/island-gate\.mjs/);
    expect(source).toMatch(/sha-account-l1:/);
    expect(source).toMatch(/sha-account\.test\.sh/);
    expect(source).not.toMatch(/push:/);
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
      'brain-rollback.sh',
      'rollback-cecelia.sh',
      'rolling-update.sh',
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

  it('release guard is source-safe and continues only after server authorization', () => {
    const guard = resolve(root, 'scripts/lib/release-run-guard.sh');
    const fixture = `
      curl() {
        local out="" previous=""
        for arg in "$@"; do
          if [[ "$previous" == "--output" ]]; then out="$arg"; fi
          previous="$arg"
        done
        printf '{"authorized":true}' > "$out"
        printf 200
      }
      export -f curl
      source "$1"
      require_release_run_authority production
      printf authorized-ok
    `;
    const authorized = spawnSync('bash', ['-c', fixture, '--', guard], {
      env: {
        PATH: process.env.PATH,
        KERNEL_RELEASE_RUN_ID: '44444444-4444-4444-8444-444444444444',
        KERNEL_RELEASE_MERGE_SHA: 'b'.repeat(40),
        KERNEL_RELEASE_AUTHORIZATION: '55555555-5555-4555-8555-555555555555',
        DEPLOY_TOKEN: 'fixture-token',
      },
      encoding: 'utf8',
    });
    expect(authorized.status).toBe(0);
    expect(authorized.stdout).toBe('authorized-ok');

    const unauthorized = spawnSync(
      'bash',
      ['-c', 'source "$1"; require_release_run_authority production', '--', guard],
      { env: { PATH: process.env.PATH }, encoding: 'utf8' },
    );
    expect(unauthorized.status).toBe(78);
    expect(unauthorized.stderr).toMatch(/ReleaseRun authority required/);
  });

  it('does not expose the legacy token-only rollback endpoint', () => {
    const source = readFileSync(resolve(root, 'packages/brain/src/routes/ops.js'), 'utf8');
    const rollbackRoute = source.slice(
      source.indexOf("router.post('/deploy/rollback'"),
      source.indexOf("router.post('/deploy/rollback'") + 900,
    );
    expect(rollbackRoute).toContain('release_rollback_authority_required');
    expect(rollbackRoute).not.toMatch(/git (?:fetch|checkout)/);
    expect(rollbackRoute).not.toMatch(/pm2 restart/);
  });

  it('legacy staging callers cannot mutate staging outside ReleaseRun authority', () => {
    const relay = readFileSync(resolve(root, 'packages/brain/scripts/cecelia-run.sh'), 'utf8');
    const runner = readFileSync(resolve(root, 'packages/brain/src/staging-e2e-runner.js'), 'utf8');
    expect(relay).not.toMatch(/deploy-local\.sh/);
    expect(runner).not.toMatch(/deploy-local\.sh/);
  });

  it('ReleaseRun E2E never imports or invokes the arbitrary shell scenario runner', () => {
    const adapter = readFileSync(
      resolve(root, 'packages/brain/src/orchestrator/release-run-adapters.js'),
      'utf8',
    );
    const executor = readFileSync(
      resolve(root, 'packages/brain/src/orchestrator/release-run-e2e.js'),
      'utf8',
    );
    const bootstrap = readFileSync(
      resolve(root, 'scripts/lib/release-run-bootstrap-e2e.mjs'),
      'utf8',
    );
    for (const source of [adapter, executor, bootstrap]) {
      expect(source).not.toMatch(/staging-e2e-runner/);
      expect(source).not.toMatch(/\brunScenarios\b/);
    }
    const registry = readFileSync(
      resolve(root, 'packages/brain/src/orchestrator/release-run-e2e-registry.js'),
      'utf8',
    );
    expect(registry).not.toMatch(/node:child_process/);
    expect(registry).not.toMatch(/exec(?:File|Sync)?\(/);
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
    expect(source).toMatch(/PGDATABASE="\$database_url" psql/);
    expect(source).not.toMatch(/psql "\$database_url"/);
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
    expect(source).toContain('gh api --method GET');
    expect(source).toContain('validate-bootstrap-pr.mjs');
    expect(source).toMatch(/"\$\{source_head_sha\}:\$\{source_ref\}"/);
    expect(source).toMatch(/"\$\{merge_sha\}:\$\{merge_ref\}"/);
    expect(source).toMatch(/"refs\/heads\/main:\$\{main_ref\}"/);
    expect(source).toMatch(
      /git -C "\$deploy_root" merge-base --is-ancestor "\$merge_sha" "\$main_ref"/,
    );
    expect(source).not.toMatch(
      /merge-base --is-ancestor "\$source_head_sha" "\$merge_sha"/,
    );
    expect(source).not.toContain('refs/pull/${pr_number}/merge');
  });

  it('bootstrap owner approval uses an immutable trust root and binds every release axis', () => {
    const source = readFileSync(
      resolve(root, 'scripts/release-run-bootstrap.sh'),
      'utf8',
    );
    const verifyPosition = source.indexOf('verify-bootstrap-approval.mjs');
    expect(verifyPosition).toBeGreaterThan(-1);
    expect(source).toContain('/etc/cecelia/kernel-release-bootstrap-owner-v1.pub');
    expect(source).toMatch(/trust_mode.*0:444/);
    expect(source).toMatch(/root-owned, non-writable, mode 0444/);
    expect(source).toMatch(/caller-supplied owner secrets are forbidden/);
    const approvalContext = source.slice(
      verifyPosition,
      verifyPosition + 350,
    );
    for (const axis of [
      'repository',
      'pr_number',
      'source_head_sha',
      'merge_sha',
      'actor',
    ]) {
      expect(approvalContext).toContain(`$${axis}`);
    }

    const attacker = spawnSync('bash', [
      resolve(root, 'scripts/release-run-bootstrap.sh'),
    ], {
      env: {
        PATH: process.env.PATH,
        KERNEL_RELEASE_BOOTSTRAP: '1',
        KERNEL_RELEASE_BOOTSTRAP_OWNER_SECRET: 'attacker-owned-secret',
      },
      encoding: 'utf8',
    });
    expect(attacker.status).not.toBe(0);
    expect(`${attacker.stdout}${attacker.stderr}`).toMatch(/caller-supplied owner secrets/i);
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
    expect(source).toMatch(/state" != "production_verified"/);
    expect(source).toMatch(/one-time bootstrap is terminal and permanently closed/);
    expect(source).toMatch(/canonical migration 369-375 sequence failed/);
    expect(source).toMatch(/release-run-bootstrap-e2e\.mjs" materialize/);
    expect(source.match(/execute_manifest (?:staging|production)/g)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(source).toContain('KERNEL_RELEASE_ARTIFACT_VERSIONS');
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
    expect(source).toContain('KERNEL_RELEASE_BOOTSTRAP_ATTEMPT_FILE');
    expect(source).toMatch(
      /latest_attempt AS \([\s\S]*?effective_lease_expires_at[\s\S]*?ORDER BY a\.generation DESC/i,
    );
    expect(source).toMatch(
      /SELECT effective_lease_expires_at <= clock_timestamp\(\) FROM latest_attempt/i,
    );
    expect(source).toContain('verify-bootstrap-approval.mjs');
    expect(source).toContain('approval_digest');
    expect(source).toMatch(/PGDATABASE="\$bootstrap_database_url" psql/);
    expect(source).not.toMatch(/psql "\$bootstrap_database_url"/);
    expect(source).toContain('kernel_release_bootstrap_e2e_manifests');
    expect(source).toMatch(/staging_intent/);
    expect(source).toMatch(/production_intent/);
    expect(source).not.toContain('kernel_release_bootstrap_consumptions');
  });

  it('bootstrap uses an append-only state ledger instead of a consumable receipt', () => {
    const source = readFileSync(
      resolve(root, 'scripts/release-run-bootstrap.sh'),
      'utf8',
    );
    expect(source).toContain('KERNEL_RELEASE_BOOTSTRAP_OWNER_SECRET');
    expect(source).toContain('kernel_release_bootstrap_runs');
    expect(source).toContain('kernel_release_bootstrap_transitions');
    expect(source).toContain('kernel_release_bootstrap_effect_attempts');
    expect(source).toContain('kernel_release_bootstrap_effect_receipts');
    expect(source).toContain('run_bootstrap_effect');
    expect(source).toContain('start_attempt_renewal');
    expect(source).toContain('stop_attempt_renewal');
    expect(source).toContain('prepare-rollback');
    expect(source).toContain('artifact_rollback_intent_ids');
    expect(source).toContain('artifact_rollback_receipt_ids');
    expect(source).toContain('KERNEL_RELEASE_BOOTSTRAP_ATTEMPT_FILE');
    expect(source).not.toContain('KERNEL_RELEASE_BOOTSTRAP_RECEIPT');

    const bootstrapE2E = readFileSync(
      resolve(root, 'scripts/lib/release-run-bootstrap-e2e.mjs'),
      'utf8',
    );
    expect(bootstrapE2E).toContain(
      'kernel_release_bootstrap_rollback_artifact_intents',
    );
    expect(bootstrapE2E).toContain(
      'kernel_release_bootstrap_rollback_artifact_receipts',
    );

    const migration = readFileSync(
      resolve(root, 'packages/brain/migrations/374_kernel_release_runs.sql'),
      'utf8',
    );
    expect(migration).toMatch(/singleton BOOLEAN NOT NULL UNIQUE/);
    expect(migration.match(/BEFORE UPDATE OR DELETE/g)?.length).toBeGreaterThanOrEqual(10);
    expect(migration).toMatch(/staging_passed requires confirmed staging effect receipt/);
    expect(migration).toMatch(/production_verified requires confirmed production effect receipt/);
    expect(migration).toMatch(/uq_kernel_release_bootstrap_attempt_confirmed/);
  });

  it('staging builds from an isolated exact-SHA worktree', () => {
    const source = readFileSync(resolve(root, 'scripts/staging-deploy.sh'), 'utf8');
    expect(source).toMatch(/worktree add --detach "\$EXACT_ROOT" "\$EXACT_SHA"/);
    expect(source).toContain('CECELIA_STAGING_EXACT_ROOT');
    expect(source).toMatch(/worktree remove --force/);
    expect(source).not.toContain('release-run-checkout.sh" staging');
    expect(source).toMatch(
      /KERNEL_RELEASE_MERGE_SHA[\s\S]+?bash "\$SCRIPT_DIR\/brain-build\.sh"/,
    );

    const build = readFileSync(resolve(root, 'scripts/brain-build.sh'), 'utf8');
    expect(build).toContain('RELEASE_SHA="${KERNEL_RELEASE_MERGE_SHA:-}"');
    expect(build).toMatch(/BUILD_REF="\$RELEASE_SHA"/);
    expect(build).toMatch(/archive --format=tar "\$BUILD_REF"/);
    expect(build).toMatch(/BUILD_SHA=.*rev-parse "\$BUILD_REF"/);
  });

  it('routes from immutable exact-SHA artifacts without mutating the live checkout', () => {
    const worker = readFileSync(
      resolve(root, 'scripts/lib/release-run-effect-worker.mjs'),
      'utf8',
    );
    expect(worker).not.toContain('release-run-checkout.sh');
    expect(worker).not.toMatch(/git['"], \[['"]checkout/);
    expect(worker).toContain('prepareReleaseArtifactSnapshot');
    expect(worker).toContain('KERNEL_RELEASE_ARTIFACT_ROOT');
    expect(worker).toContain('runLeasedReleaseRoutes');
    expect(worker).toContain('KERNEL_RELEASE_PRIVATE_CONFIG_FILE');
    expect(worker).not.toContain('...process.env');

    const ops = readFileSync(
      resolve(root, 'packages/brain/src/routes/ops.js'),
      'utf8',
    );
    const productionSpawn = ops.slice(
      ops.indexOf('const child = spawn(args[0]'),
      ops.indexOf('child.unref()'),
    );
    expect(productionSpawn).toContain('buildReleaseWorkerEnvironment');
    expect(productionSpawn).toContain('KERNEL_RELEASE_PRIVATE_CONFIG_FILE');
    expect(productionSpawn).not.toContain('...process.env');
    expect(productionSpawn).not.toContain('appendDispatchOutcome');

    const deployLocal = readFileSync(resolve(root, 'scripts/deploy-local.sh'), 'utf8');
    expect(deployLocal).not.toContain('release-run-checkout.sh');

    const workflow = readFileSync(
      resolve(root, 'packages/workflows/scripts/deploy-workflow-skills.sh'),
      'utf8',
    );
    expect(workflow).toContain('KERNEL_RELEASE_ARTIFACT_ROOT');
    expect(workflow).not.toContain('source_dir="$workflow_root/packages/workflows/skills"');
    expect(workflow).toMatch(/ln -s "\$skill_dir" "\$temporary_link"/);
  });

  it('publishes typed per-run dashboard rollback metadata', () => {
    const promote = readFileSync(resolve(root, 'scripts/promote-dashboard.sh'), 'utf8');
    expect(promote).toContain('logs/release-rollbacks/dashboard');
    expect(promote).toContain('KERNEL_RELEASE_RUN_ID');
    expect(promote).toContain('OLD_TAG');
    const receipt = readFileSync(
      resolve(root, 'scripts/lib/release-run-dashboard-receipt.mjs'),
      'utf8',
    );
    expect(receipt).toContain('old_tag');
    expect(receipt).toContain('new_tag');
    expect(receipt).toContain('previous_digest');

    const worker = readFileSync(
      resolve(root, 'scripts/lib/release-run-effect-worker.mjs'),
      'utf8',
    );
    expect(worker).toContain('dashboard_rollback_metadata');
  });

  it('leaves ReleaseRun contract E2E evidence to the server-owned manifest executor', () => {
    const deploy = readFileSync(resolve(root, 'scripts/brain-deploy.sh'), 'utf8');
    expect(deploy).not.toMatch(/run_post_deploy_smoke\s*\|\|\s*true/);
    expect(deploy).toMatch(
      /KERNEL_RELEASE_RUN_ID[\s\S]+?server-owned contract E2E manifest executor/,
    );
    expect(deploy).not.toContain('e2e_receipt');
    expect(deploy).toContain('deployed_artifact_versions');
    expect(deploy).toMatch(/logs\/cecelia-deploy-status\.json/);

    const ops = readFileSync(resolve(root, 'packages/brain/src/routes/ops.js'), 'utf8');
    expect(ops).not.toContain("const DEPLOY_STATUS_FILE = '/tmp/cecelia-deploy-status.json'");
    expect(ops).not.toMatch(/stagingDeployState\.e2e_receipt\s*=/);
    expect(ops).toContain('deployed_artifact_versions');
  });
});
