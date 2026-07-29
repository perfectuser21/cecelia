import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { test, expect } from 'vitest';

const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const repositoryRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);
const contractPath = join(repositoryRoot, 'regression-contract.yaml');
const cutoverWorkflowPath = join(
  repositoryRoot,
  '.github/workflows/kernel-equivalence-cutover.yml',
);
const checkScriptPath = join(
  repositoryRoot,
  'scripts/ci/check-kernel-behavior-equivalence.mjs',
);
const equivalenceReportPath = join(
  repositoryRoot,
  'docs/reviews/2026-07-28-kernel-p0-p1-equivalence-report.md',
);

test('core-regression 无 workspace 路径门', () => {
  const m = ci.match(/\n {2}core-regression:[\s\S]*?(?=\n {2}\w)/);
  expect(m).not.toBeNull();
  expect(m[0]).not.toMatch(/needs\.changes\.outputs\.workspace/);
  expect(m[0]).toMatch(/refs\/heads\/main/);
});

test('假绿灯 regression-smoke 已删', () => {
  expect(ci).not.toMatch(/golden-smoke\.test\.ts/);
});

test('普通 core regression 只检查等价合同和报告，不执行 cutover gate', () => {
  const contract = load(readFileSync(contractPath, 'utf8'));
  const invariant = contract.golden_paths.find(
    ({ id }) => id === 'KERNEL-BEHAVIOR-EQUIVALENCE-01',
  );

  expect(invariant).toBeDefined();
  expect(invariant.test_command).toMatch(
    /^node scripts\/ci\/check-kernel-behavior-equivalence\.mjs --check-report(?: --format=json)? && node scripts\/ci\/run-kernel-equivalence-drill\.mjs --check --format=json$/,
  );
  expect(invariant.test_command).not.toContain('--gate');
});

test('cutover workflow 只能人工触发，并按 check-report → gate 的顺序只读执行', () => {
  const workflow = readFileSync(cutoverWorkflowPath, 'utf8');
  const checkIndex = workflow.indexOf(
    'node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report',
  );
  const gateIndex = workflow.indexOf(
    'node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json',
  );
  const runCommands = [...workflow.matchAll(
    /^\s*-\s+run:\s*(.+)$/gm,
  )].map((match) => match[1]);

  expect(workflow).toMatch(/^on:\s*\n\s+workflow_dispatch:\s*(?:\{\})?\s*$/m);
  expect(workflow).not.toMatch(/^\s+(?:push|pull_request|pull_request_target):/m);
  expect(workflow).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
  expect(workflow).not.toMatch(
    /^\s+(?:actions|checks|deployments|issues|packages|pull-requests|statuses|id-token):\s*write\s*$/m,
  );
  expect(workflow).toMatch(/^\s+environment:\s*kernel-equivalence-cutover\s*$/m);
  expect(checkIndex).toBeGreaterThan(-1);
  expect(gateIndex).toBeGreaterThan(checkIndex);
  expect(runCommands).toEqual([
    'npm ci',
    'node scripts/ci/check-kernel-behavior-equivalence.mjs --check-report --format=json',
    'node scripts/ci/run-kernel-equivalence-drill.mjs --gate --format=json',
  ]);
  expect(runCommands.join('\n')).not.toMatch(
    /\b(?:deploy|push|promote|merge|release|publish)\b/i,
  );
});

test('checked-in Kernel 等价报告与真实合同完全一致且保持 0/99 fail-closed', () => {
  const result = spawnSync(process.execPath, [
    checkScriptPath,
    '--check-report',
    '--format=json',
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });

  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({
    schema_valid: true,
    proof_complete: false,
    atomic_cutover_ready: false,
    atomic_summary: {
      classified: 43,
      proof_required: 42,
      probe_definitions: 446,
      proof_required_probe_definitions: 442,
      proven: 0,
      provider_probe_proven: 0,
    },
    report_drift: false,
  });
  expect(report.atomic_details).toHaveLength(43);
  expect(report.atomic_details.filter(
    ({ effective_status: status }) => status === 'gap',
  )).toHaveLength(42);
  expect(report.cell_atomic_coverage).toHaveLength(99);
  expect(report.cell_atomic_coverage.every((cell) => (
    cell.configured_invariant_ids.length === 0
    && cell.live_proven_invariant_ids.length === 0
    && cell.configured_probe_ids.length === 0
    && cell.live_proven_probe_ids.length === 0
    && cell.missing_invariant_ids.length > 0
    && cell.missing_probe_ids.length > 0
  ))).toBe(true);
  expect(readFileSync(equivalenceReportPath, 'utf8')).toContain(
    'Atomic gate：schema_valid=true / proof_complete=false / atomic_cutover_ready=false / status=FAIL-CLOSED',
  );
});
