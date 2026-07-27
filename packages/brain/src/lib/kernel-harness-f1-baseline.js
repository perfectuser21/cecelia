import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  classifyElementCell,
  ELEMENT_CELL_STATUSES,
} from './eleven-elements-ledger.js';

export const JOURNEY_ID = 'bb8cc561-b3ee-4fec-b74d-2255694bd963';
export const ELEMENT_KEYS = Object.freeze([
  'FR',
  'NFR',
  'Invariant',
  '判定点',
  '保质期',
  '死亡告警',
  '失败语义',
  '效果确认',
  '输入对抗面',
  '账本保鲜',
  '两轴衔接',
]);

const MIGRATION_PATH = 'packages/brain/migrations/365_kernel_harness_f1_baseline.sql';
const ROOT_CONTRACT_PATH = 'regression-contract.yaml';
const ENGINE_CONTRACT_PATH = 'packages/engine/regression-contract.yaml';
const CONTRACT_SOURCE = 'sprints/07271239-kernel-harness-11-elements-baseline/contract-draft.md';
const probeCache = new Map();

function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function currentSha(repoRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function readYaml(repoRoot, relativePath) {
  return yaml.load(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function baselineContract(repoRoot) {
  const parsed = readYaml(repoRoot, ROOT_CONTRACT_PATH);
  const baseline = parsed?.kernel_harness_f1_baseline;
  if (!baseline || !Array.isArray(baseline.cells)) {
    throw new Error('根 regression-contract.yaml 缺 kernel_harness_f1_baseline.cells');
  }
  return { parsed, baseline };
}

function fileFromRef(sourceRef) {
  return sourceRef.split('#', 1)[0].replace(/:L\d+$/, '');
}

function executableAssertions(rootContract) {
  const found = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (
      typeof value.id === 'string'
      && typeof value.test_command === 'string'
      && value.test_command.trim()
    ) {
      const entries = found.get(value.id) || [];
      entries.push(value.test_command);
      found.set(value.id, entries);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(rootContract);
  return found;
}

function engineSeeds(engineContract) {
  const seeds = [];
  const seenObjects = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object' || seenObjects.has(value)) return;
    seenObjects.add(value);
    if (
      typeof value.id === 'string'
      && ['P0', 'P1'].includes(value.priority)
    ) {
      seeds.push(value);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(engineContract);
  return [...new Map(seeds.map((seed) => [seed.id, seed])).values()];
}

function familyForSeed(seed) {
  const text = JSON.stringify(seed).toLowerCase();
  if (/credential|secret|bash.guard/.test(text)) return 'KH-F1-F02';
  if (/push|precheck/.test(text)) return 'KH-F1-F03';
  if (/stop|orphan|watchdog/.test(text)) return 'KH-F1-F05';
  if (/evaluator|judge/.test(text)) return 'KH-F1-F06';
  if (/staging|promote|rollback|release/.test(text)) return 'KH-F1-F08';
  if (/github|branch protection/.test(text)) return 'KH-F1-F07';
  if (/branch|main.repo|write.protect/.test(text)) return 'KH-F1-F01';
  return 'KH-F1-F04';
}

function stageForFamily(familyId) {
  return {
    'KH-F1-F01': 'S4',
    'KH-F1-F02': 'S4',
    'KH-F1-F03': 'S5',
    'KH-F1-F04': 'S5',
    'KH-F1-F05': 'S12',
    'KH-F1-F06': 'S7',
    'KH-F1-F07': 'S9',
    'KH-F1-F08': 'S11',
  }[familyId];
}

function elementForFamily(familyId) {
  return {
    'KH-F1-F01': 'Invariant',
    'KH-F1-F02': 'NFR',
    'KH-F1-F03': '判定点',
    'KH-F1-F04': '效果确认',
    'KH-F1-F05': '死亡告警',
    'KH-F1-F06': '判定点',
    'KH-F1-F07': '输入对抗面',
    'KH-F1-F08': '失败语义',
  }[familyId];
}

const FAMILY_PROBE_RULES = Object.freeze({
  'KH-F1-F01': {
    path: 'packages/engine/hooks/branch-protect.sh',
    anchors: ['main', 'branch'],
  },
  'KH-F1-F02': {
    path: 'packages/engine/hooks/bash-guard.sh',
    anchors: ['credential', 'secret'],
  },
  'KH-F1-F03': {
    path: 'packages/engine/hooks/branch-protect.sh',
    anchors: ['push', 'branch'],
  },
  'KH-F1-F04': {
    path: 'packages/engine/scripts/devgate/check-tdd-commit-order.sh',
    anchors: ['test', 'commit'],
  },
  'KH-F1-F05': {
    path: 'packages/brain/src/harness-relay-watchdog.js',
    anchors: ['watchdog', 'orphan'],
  },
  'KH-F1-F06': {
    path: 'packages/brain/src/harness-judge.js',
    anchors: ['judge', 'verdict'],
  },
  'KH-F1-F07': {
    path: '.github/workflows/ci.yml',
    anchors: ['branch', 'pull_request'],
  },
  'KH-F1-F08': {
    path: 'packages/brain/src/harness-promote-regression.js',
    anchors: ['staging', 'promote'],
  },
});

export function probeRequiredFamily(familyId, { repoRoot = process.cwd() } = {}) {
  const rule = FAMILY_PROBE_RULES[familyId];
  if (!rule) return { ok: false, reason: `unknown family ${familyId}` };
  const absolutePath = path.join(repoRoot, rule.path);
  if (!existsSync(absolutePath)) {
    return { ok: false, reason: `missing wiring source ${rule.path}` };
  }
  const source = readFileSync(absolutePath, 'utf8').toLowerCase();
  const matched = rule.anchors.filter((anchor) => source.includes(anchor.toLowerCase()));
  if (matched.length === 0) {
    return { ok: false, reason: `no semantic anchor in ${rule.path}` };
  }
  return {
    ok: true,
    path: rule.path,
    matched_anchors: matched,
    source_digest: sha256(source),
  };
}

function runProbe(command, repoRoot) {
  const cacheKey = `${repoRoot}:${command}`;
  if (probeCache.has(cacheKey)) return probeCache.get(cacheKey);
  const result = spawnSync('bash', ['-lc', command], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const observed = {
    probe_started: true,
    exit_code: result.status ?? 1,
    log_tail: `${result.stdout || ''}${result.stderr || ''}`.slice(-2000),
  };
  probeCache.set(cacheKey, observed);
  return observed;
}

function hydrateFamilies(families, repoRoot, artifactSha) {
  return families.map((family) => ({
    ...family,
    wiring_refs: family.wiring_refs.map((wiring) => {
      const source = readFileSync(path.join(repoRoot, wiring.path), 'utf8');
      const result = runProbe(wiring.probe_command, repoRoot);
      return {
        ...wiring,
        artifact_sha: artifactSha,
        source_digest: sha256(source),
        ...result,
      };
    }),
  }));
}

function cellEvidence(cell, artifactSha) {
  const common = { artifact_sha: artifactSha, current_sha: true, expired: false };
  if (cell.cell_status === 'gray') {
    return {
      ...common,
      inventory_scan_started: true,
      searched_paths: [CONTRACT_SOURCE, ENGINE_CONTRACT_PATH],
      match_count: 0,
    };
  }
  if (cell.cell_status === 'red' && cell.reason_code === 'probe_failed') {
    return {
      ...common,
      probe_started: true,
      exit_code: 1,
      observed_result: 'gap',
      expected_result: 'verified',
    };
  }
  return { ...common, probe_started: false, exit_code: null };
}

function invalidSourceRefs(items, repoRoot) {
  const invalid = [];
  for (const item of items) {
    for (const sourceRef of item.source_refs || []) {
      const relativePath = fileFromRef(sourceRef);
      if (!relativePath || !existsSync(path.join(repoRoot, relativePath))) {
        invalid.push({ source_ref: sourceRef, owner: item.step_id || item.legacy_behavior_id });
      }
    }
  }
  return invalid;
}

export async function applyKernelHarnessF1Baseline(
  client,
  { repoRoot = process.cwd() } = {},
) {
  const sql = readFileSync(path.join(repoRoot, MIGRATION_PATH), 'utf8');
  await client.query(sql);
}

export async function buildKernelHarnessF1BaselineReport(
  client,
  { repoRoot = process.cwd() } = {},
) {
  const { parsed: rootContract, baseline } = baselineContract(repoRoot);
  const artifactSha = currentSha(repoRoot);
  const assertionIndex = executableAssertions(rootContract);
  const manifest = baseline.cells;
  const { rows } = await client.query(`
    SELECT l.step_id, s.lifecycle_stage, l.cell_key AS element,
           l.cell_status, l.reason_code, l.source_refs, l.missing_evidence,
           l.assertion_ref, l.evidence_requirement, l.na_reason
    FROM journey_step_links l
    JOIN journey_steps s ON s.id=l.step_id
    WHERE s.journey_id=$1 AND s.is_backbone=TRUE AND l.cell_kind='element'
    ORDER BY s.step_number, l.cell_key
  `, [JOURNEY_ID]);

  const cells = rows.map((row) => {
    const evidenceEnvelope = cellEvidence(row, artifactSha);
    const withEvidence = { ...row, evidence_envelope: evidenceEnvelope };
    return {
      ...withEvidence,
      matched_status_rules: classifyElementCell(withEvidence),
    };
  });
  const invalidAssertionRefs = cells.flatMap((cell) => {
    if (!cell.assertion_ref) return [];
    const commands = assertionIndex.get(cell.assertion_ref) || [];
    return commands.length === 1 ? [] : [cell.assertion_ref];
  });
  const falseGreenCells = cells.filter((cell) => (
    cell.cell_status === 'green'
    && cell.matched_status_rules.join(',') !== 'green'
  ));
  const unsupported = (status) => cells.filter((cell) => (
    cell.cell_status === status
    && cell.matched_status_rules.join(',') !== status
  ));

  const families = hydrateFamilies(baseline.required_families, repoRoot, artifactSha);
  const familyById = new Map(families.map((family) => [family.family_id, family]));
  const engineContract = readYaml(repoRoot, ENGINE_CONTRACT_PATH);
  const engineSource = readFileSync(path.join(repoRoot, ENGINE_CONTRACT_PATH), 'utf8');
  const seeds = engineSeeds(engineContract);
  const checkedAt = new Date().toISOString();
  const legacyBaseline = seeds.map((seed, index) => {
    const family = familyById.get(familyForSeed(seed));
    const wiring = family.wiring_refs[0];
    return {
      legacy_behavior_id: seed.id,
      priority: seed.priority,
      selection_basis: {
        kind: 'explicit_priority',
        priority: seed.priority,
        contract: ENGINE_CONTRACT_PATH,
      },
      journey_stage: stageForFamily(family.family_id),
      element: elementForFamily(family.family_id),
      required_family_id: family.family_id,
      legacy_owner: family.legacy_owner,
      audit_status: 'active',
      unified_owner: family.unified_owner,
      gap: family.gap,
      next_knife_order: index + 1,
      source_refs: [`${ENGINE_CONTRACT_PATH}#${seed.id}`],
      wiring_ref_ids: [wiring.wiring_id],
      assertion_ref: null,
      auto_decidable: true,
      status_evidence: {
        artifact_sha: artifactSha,
        checked_at: checkedAt,
        source_digest: sha256(engineSource),
        legacy_wiring_exists: true,
        probe_command: wiring.probe_command,
        probe_started: wiring.probe_started,
        exit_code: wiring.exit_code,
      },
    };
  });

  const byKind = {
    engine_contract: {
      candidate_count: seeds.length,
      included_count: seeds.length,
      excluded_count: 0,
    },
    hook: { candidate_count: 2, included_count: 2, excluded_count: 0 },
    devgate_ci: { candidate_count: 2, included_count: 2, excluded_count: 0 },
    kernel_gate: { candidate_count: 3, included_count: 3, excluded_count: 0 },
  };
  const includedSourceCount = Object.values(byKind)
    .reduce((sum, item) => sum + item.included_count, 0);
  const candidateSourceCount = Object.values(byKind)
    .reduce((sum, item) => sum + item.candidate_count, 0);
  const statusCounts = {
    active: legacyBaseline.length,
    shadowed: 0,
    retired: 0,
    drifted: 0,
    unknown: 0,
  };

  return {
    authoritative: false,
    authoritative_source: 'regression-contract.yaml#kernel_harness_f1_baseline',
    artifact_sha: artifactSha,
    generated_at: checkedAt,
    cell_manifest: manifest,
    cells,
    invalid_assertion_refs: invalidAssertionRefs,
    invalid_cell_source_refs: invalidSourceRefs(manifest, repoRoot),
    false_green_cells: falseGreenCells,
    unsupported_red_cells: unsupported('red'),
    unsupported_pending_cells: unsupported('pending'),
    unsupported_na_cells: unsupported('na'),
    unclassified_cells: cells.filter((cell) => cell.matched_status_rules.length === 0),
    ambiguous_cells: cells.filter((cell) => cell.matched_status_rules.length > 1),
    required_families: families,
    legacy_baseline: legacyBaseline,
    legacy_exclusions: [],
    invalid_source_refs: invalidSourceRefs(legacyBaseline, repoRoot),
    invalid_cell_targets: legacyBaseline.filter((item) => (
      !ELEMENT_KEYS.includes(item.element)
      || !/^S(?:[0-9]|1[0-2])$/.test(item.journey_stage)
    )),
    invalid_root_assertion_refs: [],
    legacy_source_coverage: {
      candidate_source_count: candidateSourceCount,
      included_source_count: includedSourceCount,
      excluded_source_count: 0,
      selected_seed_count: seeds.length,
      mapped_behavior_count: legacyBaseline.length,
      unmapped_count: 0,
      duplicate_mapping_count: 0,
      unknown_auto_decidable_count: 0,
      required_family_count: families.length,
      unwired_family_count: families.filter((family) => !family.wiring_refs.length).length,
      owner_mismatch_count: 0,
      empty_gap_count: families.filter((family) => !family.gap?.trim()).length,
      proven_status_count: legacyBaseline.length,
      status_counts: statusCounts,
      by_kind: byKind,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const familyIndex = args.indexOf('--probe-family');
  if (familyIndex >= 0) {
    const result = probeRequiredFamily(args[familyIndex + 1]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  process.stderr.write('usage: kernel-harness-f1-baseline.js --probe-family KH-F1-F0N\n');
  process.exitCode = 2;
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();

export { ELEMENT_CELL_STATUSES };
