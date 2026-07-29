#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import {
  buildEquivalenceReport,
  formatEquivalenceMarkdown,
  validateBehaviorEquivalence,
} from '../../packages/brain/src/lib/kernel-behavior-equivalence.js';
import {
  compileDrillPlan,
} from '../../packages/brain/src/lib/kernel-equivalence-drills.js';
import {
  evaluateRepositoryPolicy,
} from '../../packages/brain/src/lib/kernel-equivalence-repository-policy.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = resolve(scriptDirectory, '../..');
const defaultDependencies = Object.freeze({
  buildEquivalenceReport,
  compileDrillPlan,
  evaluateRepositoryPolicy,
  formatEquivalenceMarkdown,
  validateBehaviorEquivalence,
});
const defaultFileSystem = Object.freeze({
  existsSync,
  readFileSync,
  writeFileSync,
});

function parseArguments(argv) {
  const options = {
    format: 'json',
    writeReport: false,
    checkReport: false,
  };
  for (const argument of argv) {
    if (argument.startsWith('--format=')) {
      options.format = argument.slice('--format='.length);
    } else if (argument === '--write-report') {
      options.writeReport = true;
    } else if (argument === '--check-report') {
      options.checkReport = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!['json', 'markdown'].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }
  return options;
}

function invalidClockValidation(contract) {
  return {
    valid: false,
    schema_valid: false,
    proof_complete: false,
    atomic_cutover_ready: false,
    atomic_metrics: {
      classified_atom_count: 0,
      proof_required_atom_count: 0,
      probe_definition_count: 0,
      proof_required_probe_definition_count: 0,
      provider_probe_required: 0,
      provider_probe_proven: 0,
    },
    legacy_verified_family_receipt_count: 0,
    atomic_proven_family_cell_count: 0,
    verified_proof_cell_count: 0,
    schema_version: contract?.behavior_equivalence?.schema_version ?? null,
    contract_version:
      contract?.behavior_equivalence?.contract_version ?? null,
    journey: null,
    dimensions: [],
    findings: [{
      behavior_id: null,
      code: 'report_as_of_invalid',
      path: 'behavior_equivalence.report_as_of',
      message: 'report_as_of must be a valid deterministic timestamp',
    }],
    behaviors: [],
  };
}

function fallbackDrillPlan() {
  return {
    behavior_count: 0,
    cells: [],
  };
}

export function runCheck({
  argv = [],
  repositoryRoot = defaultRepositoryRoot,
  reportPath = join(
    repositoryRoot,
    'docs/reviews/2026-07-28-kernel-p0-p1-equivalence-report.md',
  ),
  dependencies: dependencyOverrides = {},
  fileSystem: fileSystemOverrides = {},
} = {}) {
  const options = parseArguments(argv);
  const dependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
  };
  const fileSystem = {
    ...defaultFileSystem,
    ...fileSystemOverrides,
  };
  const contractPath = join(repositoryRoot, 'regression-contract.yaml');
  const contract = load(fileSystem.readFileSync(contractPath, 'utf8'));
  const repositoryPolicy = dependencies.evaluateRepositoryPolicy(
    repositoryRoot,
  );

  const reportAsOf = contract?.behavior_equivalence?.report_as_of;
  const now = typeof reportAsOf === 'string'
    ? Date.parse(reportAsOf)
    : Number.NaN;
  const clockValid = Number.isFinite(now);
  const evaluatedAt = clockValid
    ? new Date(now).toISOString()
    : null;

  let validation = clockValid
    ? dependencies.validateBehaviorEquivalence(contract, { now })
    : invalidClockValidation(contract);
  let drillPlan = fallbackDrillPlan();
  let drillError = null;
  if (clockValid) {
    try {
      drillPlan = dependencies.compileDrillPlan(contract, { now });
    } catch (error) {
      drillError = error instanceof Error ? error.message : String(error);
      validation = {
        ...validation,
        valid: false,
        schema_valid: false,
        findings: [
          ...(Array.isArray(validation.findings) ? validation.findings : []),
          {
            behavior_id: null,
            code: 'drill_manifest_invalid',
            path: 'behavior_equivalence.behaviors',
            message: `canonical drill manifest invalid: ${drillError}`,
          },
        ],
      };
    }
  }

  const drillBlockers = drillPlan.cells.filter(
    (cell) => cell.blocked_by != null,
  ).length;
  const report = dependencies.buildEquivalenceReport(
    validation,
    { evaluatedAt },
  );
  const markdown = dependencies.formatEquivalenceMarkdown(report);

  if (options.writeReport) {
    fileSystem.writeFileSync(reportPath, markdown, 'utf8');
  }

  let drift = false;
  if (options.checkReport) {
    drift = (
      !fileSystem.existsSync(reportPath)
      || fileSystem.readFileSync(reportPath, 'utf8') !== markdown
    );
  }

  const result = {
    ...report,
    valid: validation.valid === true,
    schema_valid: validation.schema_valid === true,
    proof_complete: validation.proof_complete === true,
    atomic_cutover_ready: validation.atomic_cutover_ready === true,
    drill_behavior_count: drillPlan.behavior_count,
    drill_cell_count: drillPlan.cells.length,
    drill_blocker_count: drillBlockers,
    drill_execution_ready: (
      drillPlan.cells.length > 0
      && drillBlockers === 0
    ),
    repository_policy_valid: (
      repositoryPolicy.repository_policy_valid === true
    ),
    duplicate_behavior_equivalence_contracts:
      repositoryPolicy.duplicate_behavior_equivalence_contracts,
    forbidden_behavior_ledger_tables:
      repositoryPolicy.forbidden_behavior_ledger_tables,
    report_drift: drift,
  };
  const stderr = [];
  if (!clockValid) {
    stderr.push(
      'behavior_equivalence.report_as_of must be a valid deterministic timestamp\n',
    );
  }
  if (drillError !== null) {
    stderr.push(`Kernel equivalence drill plan is invalid: ${drillError}\n`);
  }
  if (validation.schema_valid !== true) {
    stderr.push(
      `Behavior equivalence contract has ${validation.findings.length} validation finding(s).\n`,
    );
  }
  if (repositoryPolicy.repository_policy_valid !== true) {
    stderr.push(
      'Repository equivalence policy failed'
      + `; duplicate contracts: ${repositoryPolicy.duplicate_behavior_equivalence_contracts.join(', ') || 'none'}`
      + `; forbidden behavior_ledger DDL: ${repositoryPolicy.forbidden_behavior_ledger_tables.join(', ') || 'none'}.\n`,
    );
  }
  if (drift) {
    stderr.push(
      'Behavior equivalence report is stale; run '
      + 'scripts/ci/check-kernel-behavior-equivalence.mjs --write-report.\n',
    );
  }
  const exitCode = (
    validation.schema_valid === true
    && repositoryPolicy.repository_policy_valid === true
    && !drift
  ) ? 0 : 1;
  const stdout = options.format === 'markdown'
    ? markdown
    : `${JSON.stringify(result, null, 2)}\n`;

  return {
    exitCode,
    stdout,
    stderr: stderr.join(''),
    result,
    report,
    markdown,
  };
}

export function main({
  argv = process.argv.slice(2),
  repositoryRoot = defaultRepositoryRoot,
  stdout = process.stdout,
  stderr = process.stderr,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  try {
    const check = runCheck({ argv, repositoryRoot });
    stdout.write(check.stdout);
    stderr.write(check.stderr);
    setExitCode(check.exitCode);
    return check;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    setExitCode(1);
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${message}\n`,
      result: null,
      report: null,
      markdown: '',
    };
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
