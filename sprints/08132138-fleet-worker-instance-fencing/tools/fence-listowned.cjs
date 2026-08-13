#!/usr/bin/env node
'use strict';

// 独立真实 Docker fence oracle（evaluator [BEHAVIOR] B-01 与 ## E2E 验收 Part 3b 复用）。
// 证明修复后：本实例 namespace=nsB 的 reconcile 只认领自己 namespace 的容器，
//   - RED-1：不认领另一实例(nsA)容器；
//   - RED-2：不认领旧无 namespace 容器（fail-closed）；
//   - INV-1[不互杀]：两容器全程存活，未被 docker rm。
// 用真实 createDockerAdapter + 真实 Docker daemon，禁 mock（见 contract-draft.md 禁 mock 边清单）。
//
// 前置：docker daemon 可达（不可用=环境未就绪=退出非 0，禁止当 PASS 兜过）。
// 退出码：0=通过；非 0=失败/环境未就绪。

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ATTEMPT_RUNNER =
  process.env.ATTEMPT_RUNNER_PATH
  || path.resolve(__dirname, '../../../packages/brain/scripts/fleet-worker/attempt-runner.cjs');
const { createDockerAdapter } = require(ATTEMPT_RUNNER);

const WORKER = 'us-mac-m4';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const SUFFIX = `${process.pid}`;
const FOREIGN = `cecelia-fleet-e2e-foreign-${SUFFIX}`;
const LEGACY = `cecelia-fleet-e2e-legacy-${SUFFIX}`;

function docker(args) {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function cleanup() {
  for (const name of [FOREIGN, LEGACY]) {
    try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); } catch { /* best-effort */ }
  }
}

(async () => {
  try {
    docker(['version', '--format', '{{.Server.Version}}']);
  } catch {
    fail('docker daemon 不可达（环境未就绪，不得当 PASS）');
  }

  // Worker-A 的 nsA 容器（同 machine_id，另一实例 namespace）
  docker([
    'run', '-d', '--name', FOREIGN,
    '--label', `cecelia.fleet.worker_id=${WORKER}`,
    '--label', 'cecelia.fleet.attempt_id=0ca01d4b-0ca0-41d4-8ca0-1d4b0ca01d4b',
    '--label', `cecelia.fleet.run_id=${RUN_ID}`,
    '--label', 'cecelia.fleet.instance_namespace=nsA',
    'busybox', 'sleep', '300',
  ]);
  // 旧无 namespace 容器
  docker([
    'run', '-d', '--name', LEGACY,
    '--label', `cecelia.fleet.worker_id=${WORKER}`,
    '--label', 'cecelia.fleet.attempt_id=99999999-9999-4999-8999-999999999999',
    '--label', `cecelia.fleet.run_id=${RUN_ID}`,
    'busybox', 'sleep', '300',
  ]);

  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fence-rt-'));
  const adapter = createDockerAdapter({ runtimeRoot });

  // 本实例 namespace=nsB：listOwned 只能回本 namespace 容器
  const owned = await adapter.listOwned({ workerId: WORKER, instanceNamespace: 'nsB' });
  const ownedNs = owned.map((c) => (c.labels || {})['cecelia.fleet.instance_namespace']);
  const leaked = owned.filter((c) => (c.labels || {})['cecelia.fleet.instance_namespace'] !== 'nsB');
  if (leaked.length) {
    fail(`listOwned(nsB) 泄漏他实例/旧容器: ${leaked.map((c) => c.containerId).join(',')} (namespaces=${ownedNs.join(',')})`);
  }

  // INV-1：两容器全程存活（未被误杀）
  for (const name of [FOREIGN, LEGACY]) {
    const running = docker(['inspect', '-f', '{{.State.Running}}', name]);
    if (running !== 'true') fail(`容器 ${name} 被误杀/停止 (Running=${running})`);
  }

  cleanup();
  console.log('OK: fence 生效 —— nsB 只认领本 namespace 容器；nsA 与旧无 namespace 容器全程存活');
})().catch((error) => {
  console.error('FAIL:', error && error.message);
  cleanup();
  process.exit(1);
});
