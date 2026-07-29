#!/usr/bin/env node

import {
  readFileSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import {
  validateBehaviorEquivalence,
} from '../../packages/brain/src/lib/kernel-behavior-equivalence.js';
import {
  compileAtomicRequirementSummary,
  compileDrillPlan,
} from '../../packages/brain/src/lib/kernel-equivalence-drills.js';
import {
  createReadOnlyBundleReader,
} from '../../packages/brain/src/lib/kernel-equivalence-file-store.js';
import {
  compileReportDrillPlan,
} from '../../packages/brain/src/lib/kernel-equivalence-report-clock.js';
import {
  createBrainTrustedExecutionClient,
  probeBrainTrustedExecutionSocketReadiness,
} from '../../packages/brain/src/lib/kernel-equivalence-trusted-execution-client.js';
import {
  loadProductionTrustedExecutionReadinessConfiguration,
} from '../../packages/brain/src/lib/kernel-equivalence-readiness-configuration.js';

const repositoryRoot = resolve(
  new URL('../..', import.meta.url).pathname,
);
const contractPath = resolve(repositoryRoot, 'regression-contract.yaml');
const FORBIDDEN_PATH = /(?:^|[/_.:-])(?:main|master|production|prod|release)(?:$|[/_.:-])/i;

class UsageError extends Error {}

function usage(message) {
  throw new UsageError(message);
}

function parseArguments(argv) {
  if (argv.length === 0) usage('exactly one mode is required');
  const modeArguments = argv.filter((argument) => (
    ['--plan', '--check', '--gate', '--execute'].includes(argument)
  ));
  if (modeArguments.length !== 1) usage('exactly one mode is required');
  const mode = modeArguments[0].slice(2);

  if (mode === 'execute') {
    if (
      argv.length !== 5
      || argv[0] !== '--execute'
      || argv[1] !== '--cell'
      || argv[3] !== '--grant-ref'
    ) {
      usage('execute requires canonical --cell/--grant-ref order');
    }
    return {
      mode,
      cellId: argv[2],
      grantRef: argv[4],
      format: 'json',
    };
  }

  if (
    ['check', 'gate'].includes(mode)
    && argv[0] === `--${mode}`
  ) {
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
      usage(`${mode} accepts --bundle-dir <absolute-dir> and --format=json|markdown`);
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

export function atomicCutoverGateReady(report) {
  return (
    report?.contract_valid === true
    && report?.schema_valid === true
    && report?.proof_complete === true
    && report?.atomic_cutover_ready === true
    && report?.atomic_proven_family_cell_count === 99
    && report?.execution_wiring_ready === true
  );
}

export function kernelEquivalenceReportExitCode(report, mode) {
  if (
    report?.contract_valid !== true
    || report?.schema_valid !== true
  ) {
    return 1;
  }
  return mode === 'gate' && !atomicCutoverGateReady(report) ? 1 : 0;
}

function checkReport(contract, plan, {
  bundleDir = null,
  executionReadiness,
  mode = 'check',
  now,
} = {}) {
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
  const legacyVerifiedFamilyReceiptCount =
    validation.legacy_verified_family_receipt_count ?? 0;
  const legacyFamilyReceiptMatrixReady =
    plan.cells.length === 99
    && legacyVerifiedFamilyReceiptCount === plan.cells.length;
  const atomicRequirements = compileAtomicRequirementSummary(validation);
  const proofRequiredProbeCount = atomicRequirements.atom_count > 0
    ? validation.atomic_metrics?.proof_required_probe_definition_count ?? 0
    : 0;
  const atomicProvenFamilyCellCount = (
    Number.isInteger(validation.atomic_proven_family_cell_count)
    && validation.atomic_proven_family_cell_count >= 0
    && validation.atomic_proven_family_cell_count <= plan.cells.length
  )
    ? validation.atomic_proven_family_cell_count
    : 0;
  const executionWiringReady = executionReadiness.ready;
  const report = {
    schema_version: 'kernel-equivalence-drill-cli/v1',
    mode,
    contract_valid: validation.valid,
    schema_valid: validation.schema_valid === true,
    proof_complete: validation.proof_complete === true,
    atomic_cutover_ready: validation.atomic_cutover_ready === true,
    atom_count: atomicRequirements.atom_count,
    proof_required_atom_count: atomicRequirements.proof_required_atom_count,
    probe_count: atomicRequirements.probe_count,
    proof_required_probe_count: proofRequiredProbeCount,
    provider_probe_required:
      atomicRequirements.provider_probe_assertion_count,
    provider_probe_proven: 0,
    atomic_proven_family_cell_count: atomicProvenFamilyCellCount,
    execution_ready: false,
    execution_wiring_ready: executionWiringReady,
    execution_wiring_blockers: executionReadiness.ready
      ? []
      : [executionReadiness.code],
    behavior_count: validation.behaviors.length,
    behavior_gap_count: validation.behaviors.filter(
      (behavior) => behavior.effective_status === 'gap',
    ).length,
    cell_count: plan.cells.length,
    cell_blocker_count: blockerCount,
    configured_bundle_ref_count: configuredBundleRefs,
    trusted_bundle_count: legacyVerifiedFamilyReceiptCount,
    legacy_verified_family_receipt_count:
      legacyVerifiedFamilyReceiptCount,
    legacy_family_receipt_matrix_ready:
      legacyFamilyReceiptMatrixReady,
    trust_key_count:
      contract.behavior_equivalence?.drill_trust_registry?.keys?.length ?? 0,
    findings: validation.findings,
  };
  report.execution_ready = atomicCutoverGateReady(report);
  return report;
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

  if (['check', 'gate'].includes(options.mode)) {
    const { now, plan } = compileReportDrillPlan(contract);
    let executionReadiness;
    try {
      const readiness =
        loadProductionTrustedExecutionReadinessConfiguration();
      executionReadiness =
        await probeBrainTrustedExecutionSocketReadiness({
          socketPath: readiness.socket_path,
          expectedPlanDigest:
            readiness.expected_plan_digest,
          readinessTrustAnchor:
            readiness.readiness_trust_anchor,
        });
    } catch (error) {
      const code = (
        typeof error?.code === 'string'
        && error.code.startsWith('trusted_execution_')
      )
        ? error.code
        : 'trusted_execution_config_unavailable';
      executionReadiness = Object.freeze({
        ready: false,
        code,
        socket_path: null,
      });
    }
    const report = checkReport(contract, plan, {
      bundleDir: options.bundleDir,
      executionReadiness,
      mode: options.mode,
      now,
    });
    output(report, options.format);
    process.exitCode = kernelEquivalenceReportExitCode(
      report,
      options.mode,
    );
    return;
  }

  const plan = compileDrillPlan(contract, { now: Date.now() });

  if (options.mode === 'plan') {
    output(planReport(plan), options.format);
    return;
  }

  const cell = plan.cells.find((candidate) => candidate.cell_id === options.cellId);
  if (!cell) usage('cell is not in the canonical 99-cell plan');
  try {
    const client = createBrainTrustedExecutionClient();
    const result = await client.execute({
      cell_id: cell.cell_id,
      grant_ref: options.grantRef,
    });
    output({
      ...result,
      schema_version: 'kernel-equivalence-drill-cli/v1',
      mode: 'execute',
      cell_id: cell.cell_id,
      execution_ready: result.status === 'collected',
    }, 'json');
    if (result.status !== 'collected') process.exitCode = 1;
  } catch (error) {
    const code = typeof error?.code === 'string'
      && error.code.startsWith('trusted_execution_')
      ? error.code
      : 'trusted_execution_client_failed';
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
  }
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
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
}
