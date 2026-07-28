#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const STARTUP_TIMEOUT_MS = 180_000;
const POSTGRES_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const POSTGRES_IMAGE = 'pgvector/pgvector:pg15';

class ContractFailure extends Error {
  constructor(code, detail = '') {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function usage(message) {
  process.stderr.write(
    `brain_runtime_image_contract_usage: ${message}\n`,
  );
  process.exit(2);
}

function parse(argv) {
  const requireDocker = argv.includes('--require-docker');
  const allowSkip = argv.includes('--allow-skip');
  const imageIndex = argv.indexOf('--image');
  const shaIndex = argv.indexOf('--expected-git-sha');
  if (
    argv.length !== 5
    || imageIndex === -1
    || shaIndex === -1
    || requireDocker === allowSkip
    || imageIndex === argv.length - 1
    || shaIndex === argv.length - 1
  ) {
    usage(
      'use --image <tag> --expected-git-sha <40-hex> and exactly one of --require-docker/--allow-skip',
    );
  }
  const image = argv[imageIndex + 1];
  const expectedGitSha = argv[shaIndex + 1];
  if (
    !/^[a-z0-9][a-z0-9./_-]*:[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(image)
  ) {
    usage('image tag is invalid');
  }
  if (!/^[a-f0-9]{40}$/.test(expectedGitSha)) {
    usage('expected Git SHA is invalid');
  }
  const allowed = new Set([
    '--image',
    image,
    '--expected-git-sha',
    expectedGitSha,
    '--require-docker',
    '--allow-skip',
  ]);
  if (argv.some((argument) => !allowed.has(argument))) {
    usage('argument is invalid');
  }
  return {
    allowSkip,
    expectedGitSha,
    image,
  };
}

function run(command, args, {
  inherit = false,
  timeout = 600_000,
} = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    timeout,
  });
}

function outputFor(result) {
  return `${result?.stdout ?? ''}${result?.stderr ?? ''}`.trim();
}

function requireSuccess(result, code) {
  if (result?.error) {
    throw new ContractFailure(
      code,
      result.error.code ?? result.error.message,
    );
  }
  if (result?.status !== 0) {
    throw new ContractFailure(code, outputFor(result));
  }
  return result;
}

function docker(args, options) {
  return run('docker', args, options);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function waitFor({
  code,
  deadlineMs,
  probe,
}) {
  const deadline = Date.now() + deadlineMs;
  let last = '';
  while (Date.now() < deadline) {
    const result = await probe();
    if (result.ready) return result.value;
    last = result.detail ?? last;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new ContractFailure(code, last);
}

function inspectImage(image, expectedGitSha) {
  const id = requireSuccess(docker([
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    image,
  ]), 'image_inspect_failed').stdout.trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) {
    throw new ContractFailure('image_id_invalid', id);
  }

  const rawEnvironment = requireSuccess(docker([
    'image',
    'inspect',
    '--format',
    '{{json .Config.Env}}',
    image,
  ]), 'image_environment_unavailable').stdout.trim();
  let environment;
  try {
    environment = JSON.parse(rawEnvironment);
  } catch {
    throw new ContractFailure(
      'image_environment_invalid',
      rawEnvironment,
    );
  }
  const embedded = environment.find(
    (entry) => entry.startsWith('GIT_SHA='),
  );
  if (embedded !== `GIT_SHA=${expectedGitSha}`) {
    throw new ContractFailure(
      'image_git_sha_mismatch',
      embedded ?? 'GIT_SHA=missing',
    );
  }
  process.stdout.write(
    `PASS brain_runtime_image_contract image_id ${id}\n`,
  );
  process.stdout.write(
    `PASS brain_runtime_image_contract git_sha ${expectedGitSha}\n`,
  );
}

function verifyRuntimeGraph(image) {
  const probe = String.raw`
import {
  accessSync,
  constants,
  lstatSync,
  realpathSync,
} from 'node:fs';

const required = [
  '/app/scripts/cecelia-bridge.cjs',
  '/app/scripts/fleet-worker/github-mutation-broker.cjs',
  '/brain/src/lib/kernel-equivalence-receipts.js',
  '/engine/scripts/devgate/kernel-equivalence-devgate-sidecar.mjs',
  '/engine/scripts/devgate/check-tdd-commit-order.sh',
  '/engine/scripts/devgate/check-dod-purity.cjs',
];
for (const path of required) {
  accessSync(path, constants.R_OK);
}
if (!lstatSync('/brain').isSymbolicLink()) {
  throw new Error('brain_runtime_alias_not_symlink');
}
if (realpathSync('/brain') !== '/app') {
  throw new Error('brain_runtime_alias_wrong_target');
}
await import(
  'file:///app/src/lib/kernel-equivalence-production-seam-builders.js'
);
await import(
  'file:///engine/scripts/devgate/kernel-equivalence-devgate-sidecar.mjs'
);
process.stdout.write(
  'PASS brain_runtime_image_contract boot_graph\n',
);
`;
  const result = docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    'node',
    image,
    '--input-type=module',
    '--eval',
    probe,
  ], { timeout: 60_000 });
  requireSuccess(result, 'runtime_boot_graph_failed');
  process.stdout.write(result.stdout);
}

function resourceExists(kind, name) {
  return docker([kind, 'inspect', name]).status === 0;
}

async function cleanup(resources) {
  const failures = [];
  for (const name of [resources.brain, resources.postgres]) {
    if (!name) continue;
    docker(['rm', '--force', name], { timeout: 30_000 });
    if (resourceExists('container', name)) {
      failures.push(`container:${name}`);
    }
  }
  if (resources.network) {
    docker(['network', 'rm', resources.network], {
      timeout: 30_000,
    });
    if (resourceExists('network', resources.network)) {
      failures.push(`network:${resources.network}`);
    }
  }
  if (failures.length > 0) {
    throw new ContractFailure(
      'cleanup_residue_detected',
      failures.join(','),
    );
  }
  process.stdout.write(
    'PASS brain_runtime_image_contract cleanup_zero_residue\n',
  );
}

async function verifyServerStartup(image) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const resources = {
    brain: `brain-runtime-contract-brain-${suffix}`,
    network: `brain-runtime-contract-net-${suffix}`,
    postgres: `brain-runtime-contract-pg-${suffix}`,
  };
  let primaryFailure = null;
  try {
    requireSuccess(docker([
      'network',
      'create',
      resources.network,
    ]), 'contract_network_create_failed');

    requireSuccess(docker([
      'run',
      '--detach',
      '--name',
      resources.postgres,
      '--network',
      resources.network,
      '--env',
      'POSTGRES_USER=cecelia',
      '--env',
      'POSTGRES_PASSWORD=kernel-runtime-contract',
      '--env',
      'POSTGRES_DB=cecelia_test',
      '--health-cmd',
      'pg_isready -U cecelia -d cecelia_test',
      '--health-interval',
      '1s',
      '--health-timeout',
      '3s',
      '--health-retries',
      '30',
      POSTGRES_IMAGE,
    ], { timeout: 120_000 }), 'postgres_start_failed');

    await waitFor({
      code: 'postgres_health_timeout',
      deadlineMs: POSTGRES_TIMEOUT_MS,
      probe: async () => {
        const result = docker([
          'inspect',
          '--format',
          '{{.State.Health.Status}}',
          resources.postgres,
        ]);
        return {
          ready: result.status === 0
            && result.stdout.trim() === 'healthy',
          detail: outputFor(result),
        };
      },
    });

    requireSuccess(docker([
      'run',
      '--detach',
      '--name',
      resources.brain,
      '--network',
      resources.network,
      '--env',
      `DB_HOST=${resources.postgres}`,
      '--env',
      'DB_PORT=5432',
      '--env',
      'DB_NAME=cecelia_test',
      '--env',
      'DB_USER=cecelia',
      '--env',
      'DB_PASSWORD=kernel-runtime-contract',
      '--env',
      'BRAIN_PORT=5221',
      '--env',
      'BRAIN_EVALUATOR_MODE=true',
      '--env',
      'CECELIA_TICK_ENABLED=false',
      '--env',
      'CONSCIOUSNESS_ENABLED=false',
      image,
    ], { timeout: 60_000 }), 'brain_start_failed');

    const health = await waitFor({
      code: 'brain_health_timeout',
      deadlineMs: STARTUP_TIMEOUT_MS,
      probe: async () => {
        const state = docker([
          'inspect',
          '--format',
          '{{.State.Running}} {{.State.ExitCode}}',
          resources.brain,
        ]);
        if (
          state.status !== 0
          || !state.stdout.trim().startsWith('true ')
        ) {
          return {
            ready: false,
            detail: outputFor(state),
          };
        }
        const result = docker([
          'exec',
          resources.brain,
          'curl',
          '--fail',
          '--silent',
          '--show-error',
          'http://127.0.0.1:5221/api/brain/tick/status',
        ], { timeout: 5_000 });
        return {
          ready: result.status === 0,
          value: result.stdout.trim(),
          detail: outputFor(result),
        };
      },
    });
    process.stdout.write(
      `PASS brain_runtime_image_contract server_health ${health}\n`,
    );
  } catch (error) {
    const logs = resources.brain && resourceExists(
      'container',
      resources.brain,
    )
      ? outputFor(docker([
        'logs',
        '--tail',
        '200',
        resources.brain,
      ]))
      : '';
    primaryFailure = error instanceof ContractFailure
      ? new ContractFailure(
        error.code,
        [error.detail, logs].filter(Boolean).join('\n'),
      )
      : new ContractFailure(
        'brain_runtime_contract_unexpected',
        error?.stack ?? String(error),
      );
  }

  let cleanupFailure = null;
  try {
    await cleanup(resources);
  } catch (error) {
    cleanupFailure = error;
  }
  if (cleanupFailure) throw cleanupFailure;
  if (primaryFailure) throw primaryFailure;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const dockerInfo = docker(['info'], { timeout: 30_000 });
  if (dockerInfo.status !== 0 || dockerInfo.error) {
    if (options.allowSkip) {
      process.stdout.write(
        'SKIP brain_runtime_image_contract docker_unavailable_explicit\n',
      );
      return;
    }
    throw new ContractFailure(
      'docker_required_but_unavailable',
      outputFor(dockerInfo),
    );
  }

  inspectImage(options.image, options.expectedGitSha);
  verifyRuntimeGraph(options.image);
  await verifyServerStartup(options.image);
}

main().catch((error) => {
  const code = error instanceof ContractFailure
    ? error.code
    : 'brain_runtime_contract_unexpected';
  const detail = error instanceof ContractFailure
    ? error.detail
    : error?.stack ?? String(error);
  process.stderr.write(
    `brain_runtime_image_contract_failed: ${code}\n`,
  );
  if (detail) process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
});
