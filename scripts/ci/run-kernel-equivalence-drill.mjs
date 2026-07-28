#!/usr/bin/env node

import {
  readFileSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { load } from 'js-yaml';
import {
  validateBehaviorEquivalence,
} from '../../packages/brain/src/lib/kernel-behavior-equivalence.js';
import {
  compileDrillPlan,
} from '../../packages/brain/src/lib/kernel-equivalence-drills.js';
import {
  createReadOnlyBundleReader,
} from '../../packages/brain/src/lib/kernel-equivalence-file-store.js';
import {
  compileReportDrillPlan,
} from '../../packages/brain/src/lib/kernel-equivalence-report-clock.js';
import {
  loadTrustedEquivalenceRuntime,
  validateTrustedRuntimeEnvironment,
} from '../../packages/brain/src/lib/kernel-equivalence-runtime-loader.js';

const repositoryRoot = resolve(
  new URL('../..', import.meta.url).pathname,
);
const contractPath = resolve(repositoryRoot, 'regression-contract.yaml');
const FORBIDDEN_PATH = /(?:^|[/_.:-])(?:main|master|production|prod|release)(?:$|[/_.:-])/i;
const EXECUTION_WIRING_BLOCKERS = Object.freeze([
  'trusted_nonce_consumer_unavailable',
  'trusted_adapter_registry_unavailable',
  'trusted_collector_unavailable',
  'trusted_bundle_chain_store_unavailable',
  'trusted_cleanup_verifier_unavailable',
]);

class UsageError extends Error {}

function usage(message) {
  throw new UsageError(message);
}

function parseArguments(argv) {
  if (argv.length === 0) usage('exactly one mode is required');
  const modeArguments = argv.filter((argument) => (
    ['--plan', '--check', '--execute'].includes(argument)
  ));
  if (modeArguments.length !== 1) usage('exactly one mode is required');
  const mode = modeArguments[0].slice(2);

  if (mode === 'execute') {
    const trustedRuntime = argv.at(-1) === '--trusted-runtime';
    if (
      argv.length !== (trustedRuntime ? 10 : 9)
      || argv[0] !== '--execute'
      || argv[1] !== '--cell'
      || argv[3] !== '--grant'
      || argv[5] !== '--state-dir'
      || argv[7] !== '--receipt-dir'
      || (trustedRuntime && argv[9] !== '--trusted-runtime')
    ) {
      usage('execute requires canonical --cell/--grant/--state-dir/--receipt-dir order');
    }
    return {
      mode,
      cellId: argv[2],
      grantPath: safeAbsolutePath(argv[4], 'grant'),
      stateDir: safeAbsolutePath(argv[6], 'state-dir'),
      receiptDir: safeAbsolutePath(argv[8], 'receipt-dir'),
      trustedRuntime,
      format: 'json',
    };
  }

  if (mode === 'check' && argv[0] === '--check') {
    const bundleDirIndex = argv.indexOf('--bundle-dir');
    const formatArgument = argv.find((argument) => argument.startsWith('--format='));
    const allowedLength =
      1 + (bundleDirIndex === -1 ? 0 : 2) + (formatArgument ? 1 : 0);
    if (
      argv.length !== allowedLength
      || (bundleDirIndex !== -1 && bundleDirIndex !== 1)
      || (
        formatArgument
        && !['--format=json', '--format=markdown'].includes(formatArgument)
      )
      || argv.some((argument, index) => (
        index !== 0
        && index !== bundleDirIndex
        && index !== bundleDirIndex + 1
        && argument !== formatArgument
      ))
    ) {
      usage('check accepts --bundle-dir <absolute-dir> and --format=json|markdown');
    }
    return {
      mode,
      bundleDir: bundleDirIndex === -1
        ? null
        : safeAbsolutePath(argv[bundleDirIndex + 1], 'bundle-dir'),
      format: formatArgument?.slice('--format='.length) ?? 'json',
    };
  }

  if (
    argv.length > 2
    || argv[0] !== `--${mode}`
    || (
      argv.length === 2
      && !['--format=json', '--format=markdown'].includes(argv[1])
    )
  ) {
    usage(`${mode} accepts only an optional --format=json|markdown`);
  }
  return {
    mode,
    format: argv[1]?.slice('--format='.length) ?? 'json',
  };
}

function safeAbsolutePath(value, label) {
  if (
    typeof value !== 'string'
    || !isAbsolute(value)
    || value === '/'
    || FORBIDDEN_PATH.test(value)
  ) {
    usage(`${label} must be an absolute non-protected path`);
  }
  return value;
}

function loadContract() {
  return load(readFileSync(contractPath, 'utf8'));
}

function signerHandoffs(plan) {
  const byBehavior = new Map();
  for (const cell of plan.cells) {
    if (!byBehavior.has(cell.behavior_id)) {
      byBehavior.set(cell.behavior_id, {
        behavior_id: cell.behavior_id,
        seam_id: cell.seam_id,
        seam_ref: cell.seam_ref,
        adapter_id: cell.adapter_id,
        blocker: cell.blocked_by,
        cell_count: 0,
      });
    }
    byBehavior.get(cell.behavior_id).cell_count += 1;
  }
  return [...byBehavior.values()].sort((left, right) => (
    left.behavior_id.localeCompare(right.behavior_id)
  ));
}

function planReport(plan) {
  const handoffs = signerHandoffs(plan);
  return {
    schema_version: 'kernel-equivalence-drill-cli/v1',
    mode: 'plan',
    contract_version: plan.contract_version,
    behavior_count: plan.behavior_count,
    cell_count: plan.cells.length,
    blocker_count: plan.cells.filter((cell) => cell.blocked_by != null).length,
    signer_handoff_count: handoffs.length,
    signer_handoffs: handoffs,
    cells: plan.cells.map((cell) => ({
      cell_id: cell.cell_id,
      behavior_id: cell.behavior_id,
      provider: cell.provider,
      scenario: cell.scenario,
      seam_id: cell.seam_id,
      adapter_id: cell.adapter_id,
      expected_outcome: cell.expected.expected_outcome,
      effect_code: cell.expected.effect_code,
      blocker: cell.blocked_by,
    })),
  };
}

function configuredBundleReferenceCount(contract) {
  return (contract.behavior_equivalence?.behaviors ?? []).reduce(
    (count, behavior) => count + ['claude', 'codex', 'grok'].reduce(
      (providerCount, provider) => providerCount
        + ['normal', 'violation', 'recovery'].filter(
          (scenario) => typeof behavior.proof_matrix?.[provider]?.[scenario]
            ?.receipt_bundle_ref === 'string',
        ).length,
      0,
    ),
    0,
  );
}

function checkReport(contract, plan, { bundleDir = null, now } = {}) {
  const configuredBundleRefs = configuredBundleReferenceCount(contract);
  if (configuredBundleRefs > 0 && bundleDir == null) {
    throw new Error('trusted_bundle_store_required');
  }
  const readBundle = bundleDir == null
    ? null
    : createReadOnlyBundleReader({ directory: bundleDir });
  const validation = validateBehaviorEquivalence(contract, {
    now,
    readBundle,
  });
  const blockerCount = plan.cells.filter((cell) => cell.blocked_by != null).length;
  const verifiedCellCount = validation.verified_proof_cell_count ?? 0;
  const proofMatrixReady =
    plan.cells.length === 99
    && verifiedCellCount === plan.cells.length;
  const executionWiringReady = false;
  return {
    schema_version: 'kernel-equivalence-drill-cli/v1',
    mode: 'check',
    contract_valid: validation.valid,
    execution_ready:
      validation.valid
      && blockerCount === 0
      && proofMatrixReady
      && executionWiringReady,
    execution_wiring_ready: executionWiringReady,
    execution_wiring_blockers: EXECUTION_WIRING_BLOCKERS,
    behavior_count: validation.behaviors.length,
    behavior_gap_count: validation.behaviors.filter(
      (behavior) => behavior.effective_status === 'gap',
    ).length,
    cell_count: plan.cells.length,
    cell_blocker_count: blockerCount,
    configured_bundle_ref_count: configuredBundleRefs,
    trusted_bundle_count: verifiedCellCount,
    verified_cell_count: verifiedCellCount,
    proof_matrix_ready: proofMatrixReady,
    trust_key_count:
      contract.behavior_equivalence?.drill_trust_registry?.keys?.length ?? 0,
    findings: validation.findings,
  };
}

function markdown(report) {
  const rows = Object.entries(report)
    .filter(([, value]) => (
      value == null
      || ['string', 'number', 'boolean'].includes(typeof value)
    ))
    .map(([key, value]) => `| ${key} | ${String(value)} |`);
  return [
    '# Kernel Equivalence Drill',
    '',
    '| Field | Value |',
    '|---|---|',
    ...rows,
    '',
  ].join('\n');
}

function output(report, format) {
  process.stdout.write(
    format === 'markdown'
      ? markdown(report)
      : `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const contract = loadContract();

  if (options.mode === 'check') {
    const { now, plan } = compileReportDrillPlan(contract);
    const report = checkReport(contract, plan, {
      bundleDir: options.bundleDir,
      now,
    });
    output(report, options.format);
    if (!report.contract_valid) process.exitCode = 1;
    return;
  }

  const plan = compileDrillPlan(contract, { now: Date.now() });

  if (options.mode === 'plan') {
    output(planReport(plan), options.format);
    return;
  }

  const cell = plan.cells.find((candidate) => candidate.cell_id === options.cellId);
  if (!cell) usage('cell is not in the canonical 99-cell plan');
  if (options.trustedRuntime) {
    try {
      validateTrustedRuntimeEnvironment(process.env);
      const originalLog = console.log;
      let pool;
      try {
        console.log = () => {};
        pool = (await import('../../packages/brain/src/db.js')).default;
      } finally {
        console.log = originalLog;
      }
      const runtime = await loadTrustedEquivalenceRuntime({
        env: process.env,
        trustRegistry:
          contract.behavior_equivalence?.drill_trust_registry,
        pool,
      });
      const result = await runtime.executeCell({
        cell,
        grantPath: options.grantPath,
      });
      output({
        schema_version: 'kernel-equivalence-drill-cli/v1',
        mode: 'execute',
        cell_id: cell.cell_id,
        execution_ready: result.status === 'collected',
        ...result,
      }, 'json');
      if (result.status !== 'collected') process.exitCode = 1;
      return;
    } catch (error) {
      const code = typeof error?.code === 'string'
        && error.code.startsWith('trusted_runtime_')
        ? error.code
        : 'trusted_runtime_wiring_failed';
      output({
        schema_version: 'kernel-equivalence-drill-cli/v1',
        mode: 'execute',
        cell_id: cell.cell_id,
        status: 'blocked',
        code,
        execution_ready: false,
        audit: null,
      }, 'json');
      process.exitCode = 1;
      return;
    }
  }
  output({
    schema_version: 'kernel-equivalence-drill-cli/v1',
    mode: 'execute',
    cell_id: cell.cell_id,
    status: 'blocked',
    code: 'trusted_execution_wiring_unavailable',
    execution_ready: false,
    missing_wiring: EXECUTION_WIRING_BLOCKERS,
    audit: null,
  }, 'json');
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`kernel_equivalence_cli_usage: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    const code = error?.code ?? error?.message ?? 'kernel_equivalence_cli_failed';
    process.stderr.write(`kernel_equivalence_cli_failed: ${code}\n`);
    process.exitCode = 1;
  }
}
