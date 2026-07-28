#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import {
  buildEquivalenceReport,
  formatEquivalenceMarkdown,
  validateBehaviorEquivalence,
} from '../../packages/brain/src/lib/kernel-behavior-equivalence.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const contractPath = join(repositoryRoot, 'regression-contract.yaml');
const reportPath = join(
  repositoryRoot,
  'docs/reviews/2026-07-28-kernel-p0-p1-equivalence-report.md',
);

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

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function stripSqlComments(source) {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/--[^\n]*/g, '');
}

function findForbiddenLedgerTables() {
  const migrationRoots = [
    join(repositoryRoot, 'packages/brain/migrations'),
    join(repositoryRoot, 'packages/brain/src/migrations'),
  ];
  const createBehaviorLedger = /\bcreate\s+table(?:\s+if\s+not\s+exists)?\s+(?:(?:"?[a-z_][\w$]*"?\.)?)"?behavior_ledger"?\b/i;
  return migrationRoots
    .flatMap(walkFiles)
    .filter((path) => extname(path) === '.sql' && statSync(path).isFile())
    .filter((path) => createBehaviorLedger.test(stripSqlComments(readFileSync(path, 'utf8'))))
    .map((path) => path.slice(repositoryRoot.length + 1))
    .sort();
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const contract = load(readFileSync(contractPath, 'utf8'));
  const evaluatedAt = contract?.behavior_equivalence?.report_as_of;
  if (!evaluatedAt || !Number.isFinite(Date.parse(evaluatedAt))) {
    throw new Error('behavior_equivalence.report_as_of must be a valid deterministic timestamp');
  }

  const validation = validateBehaviorEquivalence(contract, {
    now: Date.parse(evaluatedAt),
  });
  const forbiddenTables = findForbiddenLedgerTables();
  const report = buildEquivalenceReport(validation, { evaluatedAt });
  const markdown = formatEquivalenceMarkdown(report);

  if (options.writeReport) {
    writeFileSync(reportPath, markdown, 'utf8');
  }

  let drift = false;
  if (options.checkReport) {
    drift = !existsSync(reportPath) || readFileSync(reportPath, 'utf8') !== markdown;
  }

  if (options.format === 'markdown') {
    process.stdout.write(markdown);
  } else {
    process.stdout.write(`${JSON.stringify({
      ...report,
      forbidden_behavior_ledger_tables: forbiddenTables,
      report_drift: drift,
    }, null, 2)}\n`);
  }

  if (!validation.valid) {
    process.stderr.write(
      `Behavior equivalence contract has ${validation.findings.length} validation finding(s).\n`,
    );
    process.exitCode = 1;
  }
  if (forbiddenTables.length > 0) {
    process.stderr.write(
      `Forbidden behavior_ledger table creation found in: ${forbiddenTables.join(', ')}\n`,
    );
    process.exitCode = 1;
  }
  if (drift) {
    process.stderr.write(
      `Behavior equivalence report is stale; run ${process.argv[1]} --write-report.\n`,
    );
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
