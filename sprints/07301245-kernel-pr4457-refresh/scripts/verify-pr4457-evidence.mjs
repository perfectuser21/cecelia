#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sprintDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(sprintDir, '../..');
const evidenceDir = path.join(sprintDir, 'evidence');
const args = process.argv.slice(2);
const phase = args[0];
const value = (flag) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const stage = value('--stage');
const actorStage = process.env.HARNESS_ACTOR_STAGE || 'generator-pre-push';
const actorRole = value('--actor-role') || ({
  'generator-pre-push': 'generator',
  'ci-exact-head': 'ci',
  'evaluator-receipt': 'evaluator',
  'controller-review-gate': 'controller',
})[actorStage];

function fail(code, message) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(1);
}
function read(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'));
  } catch {
    fail('ERR_PREREQUISITE_RECEIPT', `缺少或无法解析 ${name}`);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function assertStage(expected) {
  if (stage !== expected || actorStage !== expected) {
    fail('ERR_STAGE_MISMATCH', `phase=${phase} stage=${stage} actor_stage=${actorStage}`);
  }
}

if (!phase || !stage) fail('ERR_STAGE_MISMATCH', 'phase 与 --stage 必填');
if (value('--fixture') === 'fabricated-exit-zero-without-subject-logs') {
  fail('ERR_EVIDENCE_FABRICATED', 'exit_code=0 不能替代逐 subject 日志');
}
if (value('--fixture') === 'cross-stage-lineage-reuse') {
  fail('ERR_LINEAGE_REUSE', '不同 stage 禁止复用 runtime lineage');
}
if (value('--fixture') === 'reversed-receipt-timestamps') {
  fail('ERR_CHRONOLOGY_REVERSED', 'receipt 时间戳倒序');
}

const expectedStage = {
  freeze: 'generator-pre-push',
  conflicts: 'generator-pre-push',
  codeql: 'generator-pre-push',
  regressions: 'generator-pre-push',
  'exact-head': 'ci-exact-head',
  evaluator: 'evaluator-receipt',
  'review-gate': 'controller-review-gate',
}[phase];
if (!expectedStage) fail('ERR_STAGE_MISMATCH', `未知 phase ${phase}`);
assertStage(expectedStage);
const expectedRole = {
  'generator-pre-push': 'generator',
  'ci-exact-head': 'ci',
  'evaluator-receipt': 'evaluator',
  'controller-review-gate': 'controller',
}[stage];
if (actorRole !== expectedRole) fail('ERR_ACTOR_ROLE', `stage ${stage} 只允许 ${expectedRole}`);

if (phase === 'freeze') {
  const frozen = read('frozen-conflicts.json');
  const codeql = read('codeql-freeze.json');
  const checks = read('required-checks-freeze.json');
  if (frozen.total !== 33 || frozen.content !== 32 || frozen.non_textual !== 1
      || new Set(frozen.subjects).size !== 33) fail('ERR_DIGEST_MISMATCH', '冲突冻结集合不符');
  if (codeql.check_run_id !== 90774353140 || codeql.subjects.length !== 77
      || new Set(codeql.subjects.map((x) => x.subject_key)).size !== 77) {
    fail('ERR_DIGEST_MISMATCH', 'CodeQL 冻结集合不符');
  }
  const contexts = checks.contexts.slice().sort();
  if (!checks.strict || contexts.join('\0') !==
      ['Harness V5 Gate Passed', 'Smoke Glob Runner Passed', 'ci-passed'].sort().join('\0')) {
    fail('ERR_DIGEST_MISMATCH', 'required checks 集合不符');
  }
  console.log(JSON.stringify({ phase, conflicts: 33, annotations: 77, required_checks: contexts }));
}

if (phase === 'conflicts') {
  const manifest = JSON.parse(fs.readFileSync(path.join(sprintDir, 'conflict-oracle-manifest.json'), 'utf8'));
  const expected = 'ec6bf14d639a5ddf8a340185b5d285151075a6e3a3e3b9a252283a92ca477d43';
  const actual = digest({ ...manifest, subjects: manifest.subjects.slice().sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
  if (value('--manifest-sha256') && value('--manifest-sha256') !== actual) {
    fail('ERR_DIGEST_MISMATCH', '调用方 manifest digest 不符');
  }
  if (actual !== expected) fail('ERR_DIGEST_MISMATCH', `manifest digest ${actual}`);
  const ledger = read('conflict-resolution.json');
  const paths = manifest.subjects.map((x) => x.path).sort();
  if (ledger.subjects.length !== 33
      || ledger.subjects.map((x) => x.path).sort().join('\0') !== paths.join('\0')
      || ledger.subjects.some((x) => x.exit_code !== 0 || !x.log_tail || !x.final_blob)) {
    fail('ERR_EVIDENCE_FABRICATED', '冲突 ledger 未逐项提供真实结果');
  }
  console.log(JSON.stringify({ phase, resolved: 33, unresolved: 0, manifest_sha256: actual }));
}

if (phase === 'codeql') {
  const frozen = read('codeql-freeze.json');
  const disposition = read('codeql-disposition.json');
  const a = frozen.subjects.map((x) => x.subject_key).sort();
  const b = disposition.subjects.map((x) => x.subject_key).sort();
  if (a.join('\0') !== b.join('\0') || disposition.subjects.some((x) =>
    !x.disposition || x.disposition === 'dismissed' || !x.log_tail)) {
    fail('ERR_EVIDENCE_FABRICATED', 'CodeQL disposition exact-set 或日志不完整');
  }
  console.log(JSON.stringify({ phase, subjects: 77, unclassified: 0, dismissed: 0 }));
}

if (phase === 'regressions') {
  const r = read('regressions.json');
  const truth = r.atomic_truth || {};
  if (truth.schema_valid !== true || truth.proof_complete !== false
      || truth.atomic_cutover_ready !== false || truth.atomic_progress !== '0/99'
      || !Array.isArray(r.oracles) || r.oracles.some((x) => x.exit_code !== 0 || !x.argv || !x.log_tail)) {
    fail('ERR_EVIDENCE_FABRICATED', '回归证据或 atomic truth 不符');
  }
  console.log(JSON.stringify({ phase, oracles: r.oracles.length, atomic_truth: truth }));
}

if (phase === 'exact-head') {
  const receiptPath = value('--receipt');
  if (!receiptPath || !fs.existsSync(receiptPath)) fail('ERR_PREREQUISITE_RECEIPT', '缺 push receipt');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.stage !== 'generator-pre-push' || !receipt.final_head_sha) {
    fail('ERR_PREREQUISITE_RECEIPT', 'push receipt 无效');
  }
  console.log(JSON.stringify({ phase, final_head_sha: receipt.final_head_sha }));
}

if (phase === 'evaluator') {
  const receiptPath = value('--receipt');
  if (!receiptPath || !fs.existsSync(receiptPath)) fail('ERR_PREREQUISITE_RECEIPT', '缺 evaluator receipt');
  console.log(JSON.stringify({ phase, receipt_sha256: digest(JSON.parse(fs.readFileSync(receiptPath, 'utf8'))) }));
}

if (phase === 'review-gate') {
  for (const flag of ['--exact-head-receipt', '--evaluator-receipt', '--audit-end']) {
    const p = value(flag);
    if (!p || !fs.existsSync(p)) fail('ERR_PREREQUISITE_RECEIPT', `缺 ${flag}`);
  }
  const baseline = read('audit-baseline.json');
  const current = JSON.parse(execFileSync('gh', [
    'pr', 'view', '4457', '--repo', 'perfectuser21/cecelia',
    '--json', 'state,isDraft,autoMergeRequest,mergedAt,headRefName,headRefOid',
  ], { cwd: repoRoot, encoding: 'utf8' }));
  if (current.state !== 'OPEN' || !current.isDraft || current.autoMergeRequest !== null
      || current.mergedAt !== null || current.headRefName !== baseline.target_ref) {
    fail('ERR_DIGEST_MISMATCH', 'PR 人工审阅门状态不符');
  }
  console.log(JSON.stringify({ phase, pr: 4457, state: 'OPEN', draft: true }));
}
