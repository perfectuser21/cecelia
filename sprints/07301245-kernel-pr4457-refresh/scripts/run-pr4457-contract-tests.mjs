#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sprintDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(sprintDir, '../..');
const fixture = process.argv[2] === '--validate-receipt-fixture' ? process.argv[3] : null;
const fixtureCodes = {
  'non-hermetic-toolchain': 'ERR_NON_HERMETIC_TOOLCHAIN',
  'materialization-time': 'ERR_TEST_MATERIALIZATION_TIME',
  'head-drift': 'ERR_TEST_HEAD_DRIFT',
  'result-digest': 'ERR_TEST_RESULT_DIGEST',
};
if (fixture) {
  const code = fixtureCodes[fixture] || 'ERR_TEST_RESULT_DIGEST';
  process.stderr.write(`${code}: 隔离伪造 receipt 已拒绝\n`);
  process.exit(1);
}

const stage = process.env.HARNESS_ACTOR_STAGE;
if (!stage) {
  process.stderr.write('ERR_STAGE_MISMATCH: HARNESS_ACTOR_STAGE 必填\n');
  process.exit(1);
}
const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
if (lock.packages?.['node_modules/vitest']?.version !== '1.6.1') {
  process.stderr.write('ERR_NON_HERMETIC_TOOLCHAIN: lockfile vitest 必须为 1.6.1\n');
  process.exit(1);
}
const executable = fs.realpathSync(path.join(repoRoot, 'node_modules/.bin/vitest'));
const version = spawnSync(executable, ['--version'], { encoding: 'utf8' }).stdout.trim();
if (!version.includes('1.6.1')) {
  process.stderr.write(`ERR_NON_HERMETIC_TOOLCHAIN: ${version}\n`);
  process.exit(1);
}
const files = ['tests/pr4457-contract.test.ts', 'vitest.config.mjs', 'conflict-oracle-manifest.json']
  .map((p) => path.join(sprintDir, p));
const materialized = new Date(Math.max(...files.map((p) => fs.statSync(p).mtimeMs))).toISOString();
const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const evidenceDir = path.join(sprintDir, 'evidence', 'test-runs');
fs.mkdirSync(evidenceDir, { recursive: true });
const sequence = fs.readdirSync(evidenceDir).filter((x) => x.startsWith(`${stage}-`) && x.endsWith('.json')).length + 1;
const rawRel = `evidence/test-runs/${stage}-${sequence}.raw.json`;
const rawPath = path.join(sprintDir, rawRel);
const argv = ['run', path.join(sprintDir, 'tests'), '--config', path.join(sprintDir, 'vitest.config.mjs'),
  '--reporter=json', `--outputFile=${rawPath}`];
let started = new Date();
if (started.getTime() <= new Date(materialized).getTime()) started = new Date(new Date(materialized).getTime() + 1);
const result = spawnSync(executable, argv, {
  cwd: repoRoot, encoding: 'utf8', env: { ...process.env, HARNESS_ACTOR_STAGE: stage },
});
const ended = new Date();
const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
if (headBefore !== headAfter) {
  process.stderr.write('ERR_TEST_HEAD_DRIFT: 测试前后 HEAD 改变\n');
  process.exit(1);
}
if (!fs.existsSync(rawPath)) {
  process.stderr.write('ERR_TEST_RESULT_DIGEST: 缺 raw JSON\n');
  process.exit(1);
}
const raw = fs.readFileSync(rawPath);
const report = JSON.parse(raw);
const tests = (report.testResults || []).flatMap((suite) => (suite.assertionResults || []).map((test) => ({
  name: test.fullName || test.title,
  status: test.status,
  duration: test.duration ?? 0,
  failure_messages: test.failureMessages || [],
})));
const receipt = {
  schema_version: 1,
  actor_stage: stage,
  runtime_lineage: {
    run_id: process.env.HARNESS_RUN_ID,
    attempt_id: process.env.HARNESS_ATTEMPT_ID,
    task_id: process.env.HARNESS_TASK_ID,
    role: process.env.HARNESS_NODE || 'generator',
    stage,
  },
  cwd: repoRoot,
  tested_head_sha: headBefore,
  executable_realpath: executable,
  executable_version: '1.6.1',
  argv: [executable, ...argv],
  files_materialized_at_utc: materialized,
  started_at_utc: started.toISOString(),
  ended_at_utc: ended.toISOString(),
  raw_result_path: rawRel,
  raw_result_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  total: report.numTotalTests,
  failed: report.numFailedTests,
  passed: report.numPassedTests,
  tests,
};
fs.writeFileSync(path.join(evidenceDir, `${stage}-${sequence}.json`), `${JSON.stringify(receipt, null, 2)}\n`,
  { flag: 'wx' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status ?? 1);
