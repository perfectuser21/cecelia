import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { runInNewContext } from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const worker = 'packages/brain/scripts/fleet-worker/';
const suites = ['resource-canaries'];
const workflow = name => yaml.load(readFileSync(join(root, '.github/workflows', name), 'utf8'));
for (const id of suites) {
  const name=id+'.yml';
  const job = workflow('ci.yml').jobs[id];
  test(`${name}: 统一质量job不再受paths过滤`, () => {
    assert.ok(job); assert.equal(workflow('ci.yml').on.pull_request.paths, undefined);
    assert.equal(job.if, "github.event_name != 'schedule' && github.event.action != 'closed'");
  });
  for (const step of job.steps.filter(s => s.run?.includes('| tee '))) {
    for (const exitCode of [0, 19]) test(`${name}: ${step.name} 真shell保留子进程退出${exitCode}`, () => {
      const temp = mkdtempSync(join(tmpdir(), 'resource-canary-shell-'));
      try {
        const node = join(temp, 'node');
        writeFileSync(node, `#!/bin/sh\nprintf '%s\\n' "$*" > "$MARKER"\nprintf 'canary-output\\n'\nexit ${exitCode}\n`);
        chmodSync(node, 0o755);
        const result = spawnSync('bash', ['-e', '-c', step.run], { cwd: temp, encoding: 'utf8',
          env: { PATH: `${temp}:${process.env.PATH}`, MARKER: join(temp, 'invoked') }, timeout: 10000 });
        assert.equal(result.status, exitCode, result.stdout + result.stderr);
        assert.match(readFileSync(join(temp, 'invoked'), 'utf8'), /packages\/brain\/scripts\/fleet-worker\/.+-canary\.cjs/);
        const log = step.run.match(/tee\s+([^\s]+)/)[1];
        assert.equal(readFileSync(join(temp, log), 'utf8'), 'canary-output\n');
      } finally { rmSync(temp, { recursive: true, force: true }); }
    });
  }
}

test('四个真实canary共享准备但失败不吞后续，镜像和证据保持独立', () => {
  const jobs = workflow('ci.yml').jobs, job = jobs['resource-canaries'];
  assert.ok(job);
  for (const old of ['app-server-canary','linux-resource-canary','attempt-runtime-limits']) assert.equal(jobs[old], undefined);
  assert.equal(job.steps.filter(step => step.uses === 'actions/checkout@v4').length, 1);
  assert.deepEqual(job.steps.filter(step => step.uses === 'actions/setup-node@v4').map(step => step.with['node-version']), ['24']);
  const canaries = job.steps.filter(step => step.run?.includes('| tee '));
  assert.equal(canaries.length, 4);
  for (const step of canaries) {
    assert.equal(step.if, '!cancelled()');
    assert.equal(step['continue-on-error'], undefined);
    assert.match(step.run, /set -o pipefail/);
  }
  const preparation = job.steps.filter(step => step.run && !step.run.includes('| tee ')).map(step => step.run).join('\n');
  for (const variable of ['APP_SERVER_CANARY_IMAGE','HARNESS_LIMITS_CANARY_IMAGE','HARNESS_LIMITS_CANARY_POSTGRES_IMAGE','LINUX_RESOURCE_CANARY_IMAGE']) {
    assert.match(preparation, new RegExp(variable + '=\\$\\(docker image inspect'));
  }
  assert.match(preparation, /FROM mirror\.gcr\.io\/library\/node:22-bookworm-slim/);
  assert.equal(job.steps.some(step => step.uses === './.github/actions/dockerhub-mirror'), false, '共享runner不能热加载Docker导致host-gateway失效');
  assert.match(preparation, /@openai\/codex@0\.158\.0/);
  assert.match(preparation, /node:24-bookworm-slim/);
  assert.match(preparation, /pgvector\/pgvector:pg15/);
  const artifacts = job.steps.filter(step => step.uses === 'actions/upload-artifact@v4');
  assert.deepEqual(artifacts.map(step => step.with.name).sort(), ['app-server-canary-evidence','attempt-runtime-limits-evidence','linux-resource-observation'].sort());
  for (const artifact of artifacts) assert.equal(artifact.if, 'always()');
});

// 执行真实 canary 发给容器的采样程序；变异数据必须触发同一组断言。
const linuxSource = readFileSync(join(root, worker, 'linux-resource-canary.cjs'), 'utf8');
const linuxProgram = linuxSource.match(/const program = `([\s\S]*?)`;/)[1];
const observed = { status: 'observed', cpu_cores: 0.5, memory_limit_bytes: 134217728,
  memory_available_bytes: 67108864, execution: false, pool_verified: false, ancestry_visible: false };
for (const [field, value] of [[null, null], ['status', 'unknown'], ['cpu_cores', 1],
  ['memory_limit_bytes', 268435456], ['memory_available_bytes', -1],
  ['memory_available_bytes', 134217729], ['execution', true], ['pool_verified', true], ['ancestry_visible', true]]) {
  test(`Linux真实采样断言拒绝变异 ${field ?? '正常基线'}=${value}`, async () => {
    const report = { ...observed, ...(field ? { [field]: value } : {}) }, childProcess = { exitCode: 0 };
    await runInNewContext(linuxProgram, { process: childProcess, console: { log() {}, error() {} },
      require: name => name === 'node:assert/strict' ? assert : { sampleLinuxResources: async () => report } });
    assert.equal(childProcess.exitCode, field ? 1 : 0);
  });
}

const attemptSource = readFileSync(join(root, worker, 'attempt-limits-canary.cjs'), 'utf8');
const limitFunction = attemptSource.match(/function checkLimits\(container, limits\) \{([\s\S]*?)\n\}/)[1];
const checkLimits = runInNewContext(`(container, limits) => {${limitFunction}}`, { assert });
const limits = { cpus: 0.25, memoryBytes: 805306368, pidsLimit: 96 };
const config = { NanoCpus: 250000000, Memory: 805306368, MemorySwap: 805306368, PidsLimit: 96 };
for (const field of [null, 'NanoCpus', 'Memory', 'MemorySwap', 'PidsLimit']) {
  test(`Attempt真实Docker限额断言拒绝变异 ${field ?? '正常基线'}`, () => {
    const container = { HostConfig: { ...config, ...(field ? { [field]: 1 } : {}) } };
    if (field) assert.throws(() => checkLimits(container, limits), { code: 'ERR_ASSERTION' });
    else checkLimits(container, limits);
  });
}
const appSource = readFileSync(join(root, worker, 'app-server-canary.cjs'), 'utf8');
const appChecks = appSource.slice(appSource.indexOf('    assert.equal(inspected.HostConfig.Memory,'),
  appSource.indexOf('    const connection = await initialize(identity);'));
const profile = { memoryBytes: 536870912 };
const inspectedBase = { HostConfig: { Memory: 536870912, MemorySwap: 536870912, NanoCpus: 1e9,
  PidsLimit: 64, LogConfig: { Type: 'none' }, ReadonlyRootfs: true, NetworkMode: 'none', CapDrop: ['ALL'] },
  Config: { Tty: false, User: '1000:1000' }, Mounts: [{ Type: 'volume', Name: 'canary-volume' }] };
for (const field of [null, 'Memory', 'MemorySwap', 'NanoCpus', 'PidsLimit', 'NetworkMode', 'ReadonlyRootfs']) {
  test(`App-server真实Docker隔离断言拒绝变异 ${field ?? '正常基线'}`, () => {
    const inspected = structuredClone(inspectedBase);
    if (field) inspected.HostConfig[field] = 'wrong';
    const evaluate = () => runInNewContext('const inspected = JSON.parse(serialized);\n' + appChecks,
      { assert, serialized: JSON.stringify(inspected), profile, volumes: ['canary-volume'] });
    if (field) assert.throws(evaluate, { code: 'ERR_ASSERTION' });
    else evaluate();
  });
}
