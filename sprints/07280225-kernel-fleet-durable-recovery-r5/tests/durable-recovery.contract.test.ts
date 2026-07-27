import { describe, it, expect } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCapabilityGate } from '../../../packages/brain/src/orchestrator/preflight/capability-gate.js';

const BASE = 'dd424a61926009ac85a915b31187124b85f0ca98';
const SOURCE_PATH = 'packages/engine/regression-contract.yaml';
const SOURCE_BLOB = '7bb49c69e1af07bdaf7d69cf9ec286688b5f75d3';
const FULL_ENTRY_DIGEST = 'bfcb7a7678d5a1e1e3076ca27e34f0b01978ca590780f33d7ddb551f9615914d';
const ADVISORY_DIGEST = 'a8e979f936ea1d5072d148cd3500c32231e9c3227f438d96bd4bd2258470e7b3';
const HISTORY_DIGEST = 'd74103b146f2261c47c20ed1880830f8bd98adcdfee4c53854a9b9c5d2006cfd';
const JOURNEY = 'bb8cc561-b3ee-4fec-b74d-2255694bd963';
const REVIEWER_ALIAS = 'e2bd9263-87ef-4461-a1d5-5ff07a38b8a8';
const FINAL_E2E_ALIAS = 'a6888ef3-2482-4655-8703-cf3b9f037cb9';
const PROPOSAL = '4dc3b69aaca97e16fd4c8e28c35c4a8b6fd08f13';
const SPRINT = 'sprints/07280225-kernel-fleet-durable-recovery-r5';
const PROVIDERS = ['claude', 'codex', 'grok'];
const VECTORS = Array.from({ length: 13 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`);
const DAFE = ['D', 'A', 'F', 'E'];
const DENY_REASONS = [
  'KH_G01_PROTECTED_BRANCH_WRITE', 'KH_G01_PRIMARY_REPO_CHECKOUT',
  'KH_G02_SECRET_LITERAL_INPUT', 'KH_G02_SECRET_OUTPUT_EGRESS',
  'KH_G03_PRECHECK_FAILED', 'KH_G03_REMOTE_REF_POLICY',
  'KH_G04_TDD_ORDER_INVALID', 'KH_G04_DEVGATE_FAILED',
  'KH_G05_ATTEMPT_STILL_LIVE', 'KH_G05_LIVENESS_UNKNOWN',
  'KH_G06_EVALUATOR_MISSING_OR_STALE', 'KH_G06_JUDGE_MISSING_OR_STALE',
  'KH_G06_HUMAN_REVIEW_REQUIRED', 'KH_G07_REQUIRED_CHECKS_UNSATISFIED',
  'KH_G07_MERGE_AUTHORITY_CONFLICT', 'KH_G08_STAGING_NOT_PASS',
  'KH_G08_SHA_DRIFT', 'KH_G08_PRODUCTION_RECEIPT_MISSING',
  'KH_G08_ROLLBACK_ANCHOR_MISSING',
];

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function run(script: string, args: string[] = [], env: Record<string, string> = {}) {
  return execFileSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function source(path: string) {
  return readFileSync(path, 'utf8');
}

function readJsonReceipts(dir: string) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
}

function expectExecutable(path: string) {
  expect(existsSync(path), `缺少产品验证入口 ${path}`).toBe(true);
}

function waitForExit(child: ChildProcess) {
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

describe('P0 durable recovery contract [BEHAVIOR]', () => {
  it('built image self-contained profiles', () => {
    const script = 'scripts/ci/verify-brain-image-self-contained.sh';
    expectExecutable(script);
    const out = run(script, ['--contract-red', '--network-none', '--read-only', '--no-mounts']);
    expect(out).toContain('profiles=3');
    expect(out).toContain('missing_config=denied');
  });

  it('immutable per-attempt profile snapshot across concurrent upgrade', () => {
    const script = 'scripts/kernel-fleet/verify-atomic-release.sh';
    expectExecutable(script);
    expect(run(script, ['--real-pg', '--concurrent-upgrade'])).toContain('snapshot_drift=0');
  });

  it('real Worker Runner seam before Agent execution', () => {
    const script = 'scripts/kernel-fleet/verify-worker-admission.sh';
    expectExecutable(script);
    const out = run(script, ['--exact-runner', '--mutate-stdout-unwritable', '--mutate-private-root']);
    expect(out).toMatch(/agent_start_count=0[\s\S]*diagnostic_bytes=([1-9]\d{0,2}|1\d{3}|20[0-3]\d|204[0-8])/);
  });

  it('GitHub auth on success timeout crash and cancel', () => {
    const script = 'scripts/kernel-fleet/verify-github-broker.sh';
    expectExecutable(script);
    expect(run(script, ['--real-runner', '--all-terminals'])).toContain('credential_residual=0');
  });

  it('fleet-worker transport with production upgrade rollback and source enum parity', () => {
    const script = 'scripts/kernel-fleet/verify-transport-migration.sh';
    expectExecutable(script);
    const out = run(script, ['--real-pg', '--migration-min', '368', '--upgrade-rollback']);
    expect(out).toContain('fleet-worker');
    expect(out).toContain('schema_source_parity=1');
  });

  it('ownership frame plus persisted heartbeat', () => {
    const script = 'scripts/kernel-fleet/verify-real-kernel-startup.sh';
    expectExecutable(script);
    const out = run(script, ['--entrypoint', 'packages/brain/src/orchestrator/run.js', '--real-pg']);
    expect(out).toContain('parent_resolved_after_persisted_heartbeat=1');
    for (const key of ['async_spawn_error', 'early_exit', 'handshake_timeout', 'lease_busy', 'spoof_ready_without_db'])
      expect(out).toContain(`${key}=denied`);
  });

  it('authenticated callback commit before Worker cleanup', () => {
    const script = 'scripts/kernel-fleet/verify-artifact-transfer.sh';
    expectExecutable(script);
    const out = run(script, ['--real-git', '--authenticated-callback']);
    expect(out).toContain('materialized_before_cleanup=1');
    expect(out).toContain('cross_run=denied');
  });

  it('reverse cleanup removes real Runner nested and ignored output', () => {
    const script = 'scripts/kernel-fleet/verify-reverse-cleanup.sh';
    expectExecutable(script);
    const out = run(script, ['--real-runner', '--deep-umask-077', '--concurrent-cancel-wait-reconcile']);
    expect(out).toContain('container_absent>normalize_descendants>workspace_admin>runtime_secret>state');
    expect(out).toContain('residual_total=0');
    expect(out).toContain('append_only_quarantine_duplicates=0');
  });

  it('ESRCH-only local liveness death', async () => {
    const liveness = await import('../../../packages/brain/src/lib/kernel-liveness.js');
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    const task = { id: 'real-child', payload: { harness_runtime: 'kernel-v1' } };
    const runRow = { id: 'real-run', orchestrator_pid: child.pid, orchestrator_host: 'same-host', orchestrator_heartbeat_at: null };
    await expect(liveness.assessKernelLiveness({ task, run: runRow, hostFn: () => 'same-host' }))
      .resolves.toMatchObject({ verdict: 'alive', reason: 'pid_alive' });
    child.kill('SIGKILL');
    await waitForExit(child);
    await expect(liveness.assessKernelLiveness({ task, run: runRow, hostFn: () => 'same-host' }))
      .resolves.toMatchObject({ verdict: 'dead', reason: 'pid_gone' });
    await expect(liveness.assessKernelLiveness({ task, run: runRow, hostFn: () => 'other-host' }))
      .resolves.toMatchObject({ verdict: 'unknown', reason: 'host_mismatch' });
  });

  it('CI-only authorization and stale exact-head owner approval', () => {
    const script = 'scripts/kernel-fleet/verify-p0-workflow-contract.sh';
    expectExecutable(script);
    const out = run(script, ['--github-api', '--mutate-all-merge-bypasses']);
    expect(out).toContain('pre_owner_mutation_count=0');
    expect(out).toContain('stale_head=denied');
  });

  it('semantic anchor resolves journey golden-path step ownership', () => {
    const script = 'scripts/kernel-fleet/verify-semantic-anchor.sh';
    expectExecutable(script);
    expect(run(script, ['--real-pg', '--task', process.env.TASK_ID ?? '', '--run', process.env.RUN_ID ?? '']))
      .toContain('ownership_consistent=1');
  });

  it('P0 workflows enforce owner merge staging production order', () => {
    const script = 'scripts/kernel-fleet/run-authoritative-final-e2e.sh';
    expectExecutable(script);
    expect(run(script, ['--contract-red', '--assert-order-only']))
      .toContain('draft>ci>evaluator>judge>owner>merge>staging>production>rollback>s12');
  });

  it('attempt scoped result channel', () => {
    const script = 'scripts/kernel-fleet/run-result-channel-proof.sh';
    expectExecutable(script);
    const out = run(script, ['--real-worker-runner', '--taskbundle-bindings', '--all-mutations']);
    expect(out).toContain('durable_receipt_before_ack=1');
    expect(out).toContain('workspace_result_authority=0');
    expect(out).toContain('pre_agent_failure_budget_delta=0');
  });

  it('authority inventory full entry fixture and advisory partition', () => {
    expect(execFileSync('git', ['rev-parse', `${BASE}:${SOURCE_PATH}`], { encoding: 'utf8' }).trim()).toBe(SOURCE_BLOB);
    const fixture = source('packages/quality/contracts/kernel-policy-source-inventory.json');
    expect(Buffer.byteLength(fixture)).toBe(56518);
    expect(sha256(fixture)).toBe(FULL_ENTRY_DIGEST);
    const advisory = JSON.parse(source('packages/quality/contracts/kernel-policy-classification-advisory.json'));
    expect(sha256(JSON.stringify(advisory.rows))).toBe(ADVISORY_DIGEST);
    expect(advisory.partition).toEqual({ machine_recommended: 76, needs_human_review: 53 });
    expect(advisory.f08_partition).toEqual({ machine_recommended_elsewhere: 66, unreviewed_or_out_of_taxonomy: 44 });
    expect(advisory.f08_semantic_staging_promote_rollback_hits).toBe(0);
    expect(advisory.provider_independent_candidates).toEqual({ ci: 32, doc: 2, export: 5, infrastructure: 1, regression: 3 });
  });

  it('classification decisions are append only and pre-authority creates zero obligations', () => {
    const decisions = JSON.parse(source('packages/quality/contracts/kernel-policy-classification-decisions.json'));
    expect(decisions.rows).toHaveLength(129);
    expect(decisions.rows.every((r: any) => r.approved_family === null && r.state !== 'owner_approved')).toBe(true);
    expect(new Set(decisions.rows.map((r: any) => r.legacy_id)).size).toBe(129);
    expect(JSON.parse(source('packages/quality/contracts/kernel-policy-equivalence-obligations.json')).rows).toHaveLength(0);
  });

  it('owner approval binds full proposal head manifest bytes and signature', () => {
    const script = 'scripts/kernel-fleet/verify-authority-owner-receipt.sh';
    expectExecutable(script);
    const out = run(script, ['--proposal', PROPOSAL, '--github-api', '--allowlisted-owner', '--verify-signature']);
    expect(out).toContain('manifest_bytes_bound=1');
    expect(out).toContain('behavior_pass_inferred=0');
  });

  it('lifecycle migration preserves exact production history fixture', () => {
    const fixture = JSON.parse(source('packages/quality/contracts/kernel-harness-production-history.json'));
    expect(fixture.journey_id).toBe(JOURNEY);
    expect(fixture.rows.map((r: any) => r.id)).toEqual(expect.arrayContaining([REVIEWER_ALIAS, FINAL_E2E_ALIAS]));
    expect(sha256(JSON.stringify(fixture.rows))).toBe(HISTORY_DIGEST);
    const script = 'scripts/kernel-fleet/verify-lifecycle-projection.sh';
    expectExecutable(script);
    const out = run(script, ['--real-pg', '--migration-min', '368', '--upgrade-failure-logical-rollback']);
    expect(out).toContain('historical_fingerprint_unchanged=1');
    expect(out).toContain('backbones=13 aliases=2 new_rows=9 cells=143');
  });

  it('origin kind uses direct authority queries not module booleans', () => {
    const script = 'scripts/kernel-fleet/verify-stage-origin-receipts.sh';
    expectExecutable(script);
    const out = run(script, ['--real-pg', '--github-api', '--deployment-store']);
    expect(out).toContain('S3=proposer+reviewer+approved');
    expect(out).toContain('S6_S7_distinct_attempt_session=1');
    expect(out).toContain('self_asserted_boolean_accepted=0');
  });

  it('canonical manifest contains law only and exact 143 requirement cells', () => {
    const manifest = JSON.parse(source('packages/quality/contracts/kernel-harness-authority-manifest.json'));
    expect(manifest.stages).toHaveLength(13);
    expect(manifest.elements).toHaveLength(11);
    expect(manifest.cells).toHaveLength(143);
    expect(manifest).not.toHaveProperty('current_colors');
    expect(manifest.cells.every((c: any) => c.requirement_digest && c.positive_oracle_id && c.violation_oracle_id && c.recovery_oracle_id)).toBe(true);
  });

  it('append only evidence schema derives expiry and independent NA review', () => {
    const migration = source('packages/brain/migrations/368_kernel_harness_authority.sql');
    for (const table of ['kernel_harness_manifest_versions', 'kernel_harness_origin_receipts', 'kernel_harness_cell_evidence', 'kernel_harness_terminal_accounting'])
      expect(migration).toContain(`CREATE TABLE ${table}`);
    expect(migration).toContain('valid_until');
    expect(migration).toContain('na_requested');
    expect(migration).toContain('na_approved');
  });

  it('journey projection writes cannot satisfy canonical cell gates', () => {
    const script = 'scripts/kernel-fleet/verify-authority-write-isolation.sh';
    expectExecutable(script);
    expect(run(script, ['--real-pg', '--patch-journey-green'])).toContain('canonical_satisfied_delta=0');
  });

  it('strict staging rejects empty skip and SHA drift', async () => {
    const staging = await import('../../../packages/brain/src/staging-e2e-runner.js');
    const fakeDb = (rows: any[]) => ({ query: async () => ({ rows }) });
    await expect(staging.checkInitiativeAggregate(fakeDb([]), 'i')).resolves.toMatchObject({ allPass: false });
    await expect(staging.checkInitiativeAggregate(fakeDb([{ verdict: 'SKIP', tested_sha: BASE }]), 'i'))
      .resolves.toMatchObject({ allPass: false });
    await expect(staging.checkInitiativeAggregate(fakeDb([{ verdict: 'PASS', tested_sha: 'wrong' }]), 'i', BASE))
      .resolves.toMatchObject({ allPass: false });
  });

  it('merge report cannot complete before staging production rollback and S12', () => {
    const handlers = source('packages/brain/src/orchestrator/kernel-handlers.js');
    expect(handlers).not.toContain("SET status='completed'");
    expect(handlers).not.toContain("detail: 'report chain completed'");
  });

  it('S12 serializable accountant consumes exact current evidence chain', () => {
    const script = 'scripts/kernel-fleet/verify-terminal-accounting.sh';
    expectExecutable(script);
    const out = run(script, ['--real-pg', '--serializable', '--all-counterfactuals']);
    expect(out).toContain('stage_chain=S0>S1>S2>S3>S4>S5>S6>S7>S8>S9>S10>S11>S12');
    for (const key of ['missing_cell', 'expired_without_scheduler', 'empty_staging', 'all_skip_staging', 'sha_drift', 'promoted_without_health', 'missing_rollback', 'missing_report_effect'])
      expect(out).toContain(`${key}=blocked`);
    expect(out).toContain('terminal_transaction_count=1');
  });

  it('guard manifest references approved source inventory without runtime state', () => {
    const manifest = JSON.parse(source('packages/quality/contracts/kernel-guard-manifest.json'));
    expect(manifest.source.commit).toBe(BASE);
    expect(manifest.source.path).toBe(SOURCE_PATH);
    expect(manifest.source.blob).toBe(SOURCE_BLOB);
    expect(manifest).not.toHaveProperty('passed');
    expect(manifest).not.toHaveProperty('coverage');
    expect(manifest.behaviors.every((b: any) =>
      b.source_entry_sha256 && b.classification_decision_id && b.production_seam?.path &&
      b.production_seam?.symbol && Array.isArray(b.vectors) && b.oracles?.D &&
      b.oracles?.A && b.oracles?.F && b.oracles?.E)).toBe(true);
  });

  it('clean home official installer activates provider neutral guard for three providers', () => {
    const script = 'scripts/kernel-fleet/run-clean-home-guard-proof.sh';
    expectExecutable(script);
    const evidenceDir = mkdtempSync(join(tmpdir(), 'kernel-guard-activation-'));
    run(script, [
      '--manifest', 'packages/quality/contracts/kernel-guard-manifest.json',
      '--providers', PROVIDERS.join(','), '--vectors', VECTORS.join(','),
      '--official-installer', 'packages/engine/install/install-kernel-policy-guards.sh',
      '--real-launcher', 'docker/cecelia-runner/entrypoint.sh',
      '--evidence-dir', evidenceDir,
    ]);
    const receipts = readJsonReceipts(evidenceDir);
    const activation = receipts.filter((r) => r.stage === 'A');
    expect(new Set(activation.map((r) => r.provider))).toEqual(new Set(PROVIDERS));
    for (const receipt of activation) {
      expect(receipt.official_installer_realpath).toMatch(/^\/.+/);
      expect(receipt.official_installer_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.launcher_digest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.effective_hop_chain.map((h: any) => h.kind)).toEqual([
        'settings_source', 'installer_source', 'installed_target', 'kernel_dispatcher',
        'provider_adapter', 'production_entrypoint',
      ]);
      expect(receipt.manual_settings_copy).toBe(false);
      expect(receipt.direct_hook_invocation).toBe(false);
    }
  });

  it('V01 through V13 produce append only D A F E receipts with independent effects', () => {
    const script = 'scripts/kernel-fleet/verify-guard-vectors.sh';
    expectExecutable(script);
    const evidenceDir = mkdtempSync(join(tmpdir(), 'kernel-guard-vectors-'));
    run(script, [
      '--providers', PROVIDERS.join(','), '--vectors', VECTORS.join(','),
      '--deny', '--near-allow', '--recovery', '--independent-effect',
      '--evidence-dir', evidenceDir,
    ], { DB_URL: process.env.DB_URL ?? '' });
    const receipts = readJsonReceipts(evidenceDir);
    const exactKeys = new Set(receipts.map((r) => `${r.provider}:${r.vector_id}:${r.polarity}:${r.stage}`));
    const required = new Set(PROVIDERS.flatMap((provider) =>
      VECTORS.flatMap((vector) =>
        ['deny', 'near_allow', 'recovery'].flatMap((polarity) =>
          DAFE.map((stage) => `${provider}:${vector}:${polarity}:${stage}`)))));
    expect(exactKeys).toEqual(required);
    expect(receipts.every((r) => r.observer_class !== r.subject_class || !['F', 'E'].includes(r.stage))).toBe(true);
    expect(receipts.filter((r) => r.stage === 'E').every((r) =>
      r.predecessor_receipt_id && r.raw_artifact_digest?.match(/^[a-f0-9]{64}$/))).toBe(true);
    expect(receipts.filter((r) => r.polarity === 'recovery' && r.stage === 'E')).toHaveLength(PROVIDERS.length * VECTORS.length);
    expect(new Set(receipts.filter((r) => r.polarity === 'deny' && r.stage === 'F').map((r) => r.reason_code)))
      .toEqual(new Set(DENY_REASONS));
    expect(new Set(receipts.filter((r) => r.polarity === 'near_allow' && r.stage === 'F').map((r) => r.reason_code)))
      .toEqual(new Set(['KH_ALLOW_POLICY_SATISFIED']));
    expect(new Set(receipts.filter((r) => r.polarity === 'recovery' && r.stage === 'F').map((r) => r.reason_code)))
      .toEqual(new Set(['KH_RECOVERY_PRECONDITION_SATISFIED']));
  });

  it('single merge staging production authority cannot be bypassed', () => {
    const script = 'scripts/kernel-fleet/verify-single-release-authority.sh';
    expectExecutable(script);
    const evidenceDir = mkdtempSync(join(tmpdir(), 'kernel-release-authority-'));
    run(script, [
      '--github-api', '--deployment-store', '--all-bypasses',
      '--task', process.env.TASK_ID ?? '', '--run', process.env.RUN_ID ?? '',
      '--head', process.env.PR_HEAD_SHA ?? '', '--evidence-dir', evidenceDir,
    ], { DB_URL: process.env.DB_URL ?? '' });
    const receipts = readJsonReceipts(evidenceDir);
    const bypasses = new Set(receipts.filter((r) => r.scenario === 'violation').map((r) => r.vector_id));
    expect(bypasses).toEqual(new Set(['V08', 'V09', 'V10', 'V11', 'V12', 'V13']));
    expect(receipts.filter((r) => r.scenario === 'violation').every((r) =>
      r.decision === 'deny' && r.effect?.merge_delta === 0 &&
      r.effect?.production_sha_delta === 0 && r.effect?.terminal_delta === 0)).toBe(true);
    const pass = receipts.find((r) => r.scenario === 'normal' && r.stage === 'S11');
    expect(pass.required_test_count).toBeGreaterThan(0);
    expect(pass.fail_count).toBe(0);
    expect(pass.required_skip_count).toBe(0);
    expect(pass.merge_sha).toBe(pass.deployed_sha);
    expect(pass.merge_sha).toBe(pass.tested_sha);
    expect(pass.production_health_sha).toBe(pass.merge_sha);
    expect(pass.rollback_receipt_id).toBeTruthy();
  });

  it('deterministic reviewer v2 approval rejects advisory outcomes and stale intent', () => {
    const script = 'scripts/kernel-fleet/verify-contract-approval-v2.sh';
    expectExecutable(script);
    const evidenceDir = mkdtempSync(join(tmpdir(), 'kernel-contract-approval-v2-'));
    run(script, [
      '--real-pg', '--real-result-channel', '--controller-gate', '--all-counterfactuals',
      '--task', process.env.TASK_ID ?? '', '--run', process.env.RUN_ID ?? '',
      '--head', process.env.PR_HEAD_SHA ?? '', '--evidence-dir', evidenceDir,
    ], { DB_URL: process.env.DB_URL ?? '' });
    const receipts = readJsonReceipts(evidenceDir);
    const denied = new Set(receipts.filter((r) => r.authorizing === false).map((r) => r.scenario));
    expect(denied).toEqual(new Set([
      'completed_with_concerns', 'score_6', 'missing_dimension', 'prose_only',
      'no_result_file', 'source_result', 'callback_before_ack', 'task_addendum',
      'contract_or_skill_drift', 'conflicting_hash', 'stale_lease',
    ]));
    const approved = receipts.filter((r) => r.authorizing === true);
    expect(approved).toHaveLength(1);
    expect(approved[0].scenario).toBe('clean_completed_all_seven_gte_7');
    expect(Object.keys(approved[0].scores).sort()).toEqual([
      'ci_workflow_alignment', 'dod_machineability', 'internal_consistency',
      'risk_registered', 'scope_match_prd', 'test_is_red',
      'verification_oracle_completeness',
    ]);
    expect(Object.values(approved[0].scores).every((score) =>
      Number.isInteger(score) && Number(score) >= 7 && Number(score) <= 10)).toBe(true);
    expect(approved[0].result_channel_receipt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(approved[0].task_intent_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(approved[0].gate_artifact_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(approved[0].red_inventory_digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reviewer mutation surface is denied before verified approval', () => {
    const script = 'scripts/kernel-fleet/verify-reviewer-effect-isolation.sh';
    expectExecutable(script);
    const evidenceDir = mkdtempSync(join(tmpdir(), 'kernel-reviewer-isolation-'));
    run(script, [
      '--real-runner', '--brain-api', '--github-api', '--deployment-api',
      '--controlled-posts', 'registry,decision,task,pr,merge,deploy,staging,production',
      '--task', process.env.TASK_ID ?? '', '--run', process.env.RUN_ID ?? '',
      '--head', process.env.PR_HEAD_SHA ?? '', '--evidence-dir', evidenceDir,
    ]);
    const receipts = readJsonReceipts(evidenceDir);
    const denied = receipts.filter((r) => r.kind === 'reviewer_mutation_denied');
    expect(new Set(denied.map((r) => r.surface))).toEqual(new Set([
      'registry', 'decision', 'task', 'pr', 'merge', 'deploy', 'staging', 'production',
    ]));
    expect(denied.every((r) => r.effect_delta === 0 && r.mutation_credential_count === 0)).toBe(true);
    expect(receipts.filter((r) => ['revision', 'stale'].includes(r.approval_state))
      .every((r) => r.outbox_write_count === 0)).toBe(true);
    const verified = receipts.find((r) => r.approval_state === 'verified');
    expect(verified.outbox_write_count).toBe(1);
    expect(verified.retry_outbox_write_count).toBe(1);
    expect(verified.secret_scan_hits).toBe(0);
  });

  it('execution target quarantine expires per logical cycle and writes complete selection receipts', async () => {
    const decisions: any[] = [];
    const probes: any[] = [];
    const gate = createCapabilityGate({
      now: () => Date.parse('2026-07-28T03:00:00Z'),
      getMachineHealth: async ({ machine, task_bundle }: any) => {
        probes.push({ kind: 'health', machine, cycle: task_bundle.logical_cycle_id });
        return { ok: true, signature: 'healthy', observed_at: '2026-07-28T03:00:00Z' };
      },
      getMachineCapacity: async ({ machine, task_bundle }: any) => {
        probes.push({ kind: 'capacity', machine, cycle: task_bundle.logical_cycle_id });
        return { ok: true, available: 1, observed_at: '2026-07-28T03:00:00Z' };
      },
      probeProviderAuth: async ({ account, task_bundle }: any) => {
        probes.push({ kind: 'provider_auth', account, cycle: task_bundle.logical_cycle_id });
        return { ok: account === 'team4', signature: account === 'team4' ? 'ok' : 'quota_unavailable' };
      },
      recordDecision: async (receipt: any) => decisions.push(receipt),
    });
    const team3 = { provider: 'codex', account: 'team3', machine: 'us-mac-m4' };
    const team4 = { provider: 'codex', account: 'team4', machine: 'us-mac-m4' };
    const team5 = { provider: 'codex', account: 'team5', machine: 'us-mac-m4' };
    const result = await gate.evaluate({
      preferred_target: team3,
      candidate_targets: [team3, team4, team5],
      failed_targets: [
        { ...team3, run_id: 'run-current', role: 'proposer', logical_cycle_id: 'cycle-1',
          failure_class: 'execution_transport_unavailable', source_attempt_id: 'attempt-team3',
          expires_at: '2026-07-28T02:59:00Z' },
        { ...team4, run_id: 'run-current', role: 'proposer', logical_cycle_id: 'cycle-1',
          failure_class: 'execution_transport_unavailable', source_attempt_id: 'attempt-team4',
          expires_at: '2026-07-28T02:59:00Z' },
      ],
      requirements: { provider_auth: true },
      task_bundle: { run_id: 'run-current', role: 'proposer', logical_cycle_id: 'cycle-2' },
    });
    expect(result.status).toBe('ok');
    expect(result.to_target).toEqual(team4);
    expect(probes.some((probe) => probe.account === 'team4' && probe.cycle === 'cycle-2')).toBe(true);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      run_id: 'run-current',
      role: 'proposer',
      logical_cycle_id: 'cycle-2',
      selected_target: team4,
    });
    expect(decisions[0].considered_targets).toHaveLength(3);
    expect(decisions[0].excluded_targets.every((entry: any) =>
      entry.failure_class && entry.source_attempt_id && (entry.expires_at || entry.reset_at))).toBe(true);
  });

  it('current controller remains serial single writer', () => {
    const plan = JSON.parse(source(`${SPRINT}/task-plan.json`));
    expect(plan.execution_mode).toBe('serial_single_writer');
    expect(plan.parallel_width).toBe(1);
    expect(plan.canonical_pr_writer).toBe('controller_integrator');
    for (const [index, task] of plan.tasks.entries()) {
      expect(task.depends_on).toHaveLength(index === 0 ? 0 : 1);
    }
    const script = 'scripts/kernel-fleet/verify-workstream-execution-mode.sh';
    expectExecutable(script);
    const evidenceDir = mkdtempSync(join(tmpdir(), 'kernel-workstream-mode-'));
    run(script, [
      '--real-controller', '--plan', `${SPRINT}/task-plan.json`, '--all-counterfactuals',
      '--evidence-dir', evidenceDir,
    ]);
    const receipts = readJsonReceipts(evidenceDir);
    expect(receipts.find((r) => r.scenario === 'four_ready_nodes').writer_allocated_count).toBe(1);
    for (const scenario of ['parallel_width_4', 'cycle', 'unknown_dep', 'overlap',
      'canonical_branch_writer', 'segment_global_pass']) {
      const receipt = receipts.find((r) => r.scenario === scenario);
      expect(receipt.decision).toBe('deny');
      expect(receipt.global_state_delta).toBe(0);
    }
    expect(receipts.find((r) => r.scenario === 'normal').draft_pr_count).toBe(1);
    expect(receipts.find((r) => r.scenario === 'normal').merge_receipt_count).toBeLessThanOrEqual(1);
  });
});
