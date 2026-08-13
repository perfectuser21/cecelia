#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
export POSTGRES_IMAGE='pgvector/pgvector:pg15@sha256:a20a57d7aa5217a6af0a391ccf69f4a8512406d6c14be08132f801468cc3cc62'

cd "$ROOT_DIR"
node <<'NODE'
'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createAttemptResourceManager } = require(
  './packages/brain/scripts/fleet-worker/attempt-resources.cjs'
);

const execFileAsync = promisify(execFile);
const attemptId = '99999999-9999-4999-8999-999999999999';
const postgresName = `cecelia-pg-${attemptId}`;
const networkName = `cecelia-attempt-${attemptId}`;
const runnerName = `cecelia-runtime-smoke-runner-${attemptId}`;
const runCommand = async (command, args) => {
  const { stdout = '' } = await execFileAsync(command, args, { encoding: 'utf8' });
  return { stdout: stdout.trim() };
};
const ignore = (promise) => promise.catch(() => undefined);

(async () => {
  await ignore(runCommand('docker', ['rm', '-f', '--', runnerName]));
  await ignore(runCommand('docker', ['rm', '-f', '--', postgresName]));
  await ignore(runCommand('docker', ['network', 'rm', '--', networkName]));
  const manager = createAttemptResourceManager({
    runCommand,
    postgresImageDigest: process.env.POSTGRES_IMAGE,
    healthAttempts: 60,
    healthIntervalMs: 200,
  });
  let runtime;
  try {
    const provisioned = await manager.provision({
      attemptId,
      requirements: { postgres: true },
    });
    runtime = provisioned.runtime;
    const portBindings = await runCommand('docker', [
      'inspect', '--format', '{{json .HostConfig.PortBindings}}', postgresName,
    ]);
    if (!['null', '{}'].includes(portBindings.stdout)) {
      throw new Error('postgres_host_port_published');
    }

    // Simulate the callback-sending Runner as an active endpoint. Pre-commit
    // release must remove PostgreSQL but retain both Runner and network.
    await runCommand('docker', [
      'run', '--detach', '--name', runnerName, '--network', networkName,
      '--entrypoint', 'sleep', process.env.POSTGRES_IMAGE, '300',
    ]);
    await manager.releaseService({ attemptId, runtime });
    await runCommand('docker', ['inspect', runnerName]);
    await runCommand('docker', ['network', 'inspect', networkName]);
    try {
      await runCommand('docker', ['inspect', postgresName]);
      throw new Error('postgres_service_not_released');
    } catch (error) {
      if (error.message === 'postgres_service_not_released') throw error;
    }

    await runCommand('docker', ['rm', '-f', '--', runnerName]);
    await manager.release({ attemptId, runtime });
    try {
      await runCommand('docker', ['network', 'inspect', networkName]);
      throw new Error('attempt_network_not_released');
    } catch (error) {
      if (error.message === 'attempt_network_not_released') throw error;
    }
  } finally {
    await ignore(runCommand('docker', ['rm', '-f', '--', runnerName]));
    await ignore(runCommand('docker', ['rm', '-f', '--', postgresName]));
    await ignore(runCommand('docker', ['network', 'rm', '--', networkName]));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE

# Guard the retry-critical control contract: resource release cannot kill the
# callback Runner, and Brain validates artifacts before requesting cleanup.
bash "$ROOT_DIR/docker/cecelia-runner/__tests__/entrypoint-callback-retry.test.sh"
cd "$ROOT_DIR/packages/brain"
npx vitest run \
  scripts/fleet-worker/attempt-resources.test.cjs \
  scripts/fleet-worker/attempt-runner.test.cjs \
  src/routes/__tests__/harness-attempt-callback.test.js

echo 'kernel runtime resource smoke: PASS'
