import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RUN_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const BROKER_SOCKET_PATH = '/broker/proxy.sock';
const BROKER_PROGRAM = '/app/src/lib/codex-review-egress-broker.js';
const REVIEW_RUNTIME_TTL_MS = 7 * 60 * 1000;

function defaultExecute(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function dockerOptions() {
  return {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    env: Object.freeze({
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: '/nonexistent',
      TMPDIR: '/tmp',
    }),
  };
}

export function buildCodexReviewEgressNames(runId) {
  if (!RUN_ID_PATTERN.test(runId ?? '')) {
    throw new Error('review_egress_run_id_invalid');
  }
  return Object.freeze({
    brokerContainerName: `cecelia-codex-review-broker-${runId}`,
    egressVolumeName: `cecelia-codex-review-egress-${runId}`,
  });
}

function isVerifiedMissing(error, resource) {
  const detail = `${error?.message ?? ''}\n${error?.stderr ?? ''}`;
  return resource === 'volume'
    ? /no such volume/i.test(detail)
    : /no such (?:object|container)/i.test(detail);
}

async function removeIfPresent(execute, dockerBin, args, resource) {
  try {
    await execute(dockerBin, args, dockerOptions());
  } catch (error) {
    if (!isVerifiedMissing(error, resource)) throw error;
  }
}

async function inspectOwnedResource({
  execute,
  dockerBin,
  type,
  name,
  expectedKind,
  runId,
  ownerNonce,
}) {
  let inspected;
  try {
    inspected = JSON.parse(String(await execute(dockerBin, [
      ...(type === 'volume' ? ['volume', 'inspect'] : ['inspect']),
      '--format', '{{json .}}',
      name,
    ], dockerOptions())));
  } catch (error) {
    if (isVerifiedMissing(error, type)) return false;
    throw new Error('review_egress_cleanup_identity_unknown', {
      cause: error,
    });
  }
  const labels = type === 'volume'
    ? inspected?.Labels
    : inspected?.Config?.Labels;
  if (
    labels?.['cecelia.kind'] !== expectedKind
    || labels?.['cecelia.run_id'] !== runId
    || labels?.['cecelia.owner_nonce'] !== ownerNonce
  ) {
    throw new Error('review_egress_cleanup_identity_mismatch');
  }
  return true;
}

async function removeCodexReviewEgress({
  dockerBin,
  reviewerContainerName = null,
  brokerContainerName,
  egressVolumeName,
  runId,
  ownerNonce,
  execute,
}) {
  const resources = [
    ...(reviewerContainerName
      ? [{
        type: 'container',
        name: reviewerContainerName,
        expectedKind: 'codex-reviewer',
      }]
      : []),
    {
      type: 'container',
      name: brokerContainerName,
      expectedKind: 'codex-review-broker',
    },
    {
      type: 'volume',
      name: egressVolumeName,
      expectedKind: 'codex-review-egress',
    },
  ];
  const existing = new Map();
  for (const resource of resources) {
    existing.set(resource.name, await inspectOwnedResource({
      execute,
      dockerBin,
      ...resource,
      runId,
      ownerNonce,
    }));
  }

  try {
    if (
      reviewerContainerName
      && existing.get(reviewerContainerName)
    ) {
      await removeIfPresent(
        execute,
        dockerBin,
        ['rm', '--force', reviewerContainerName],
        'container',
      );
    }
    if (existing.get(brokerContainerName)) {
      await removeIfPresent(
        execute,
        dockerBin,
        ['rm', '--force', brokerContainerName],
        'container',
      );
    }
    if (existing.get(egressVolumeName)) {
      await removeIfPresent(
        execute,
        dockerBin,
        ['volume', 'rm', '--force', egressVolumeName],
        'volume',
      );
    }
    const remainingContainers = String(await execute(dockerBin, [
      'ps', '-a',
      '--filter', `name=^/${reviewerContainerName ?? brokerContainerName}$`,
      '--filter', `name=^/${brokerContainerName}$`,
      '--format', '{{.Names}}',
    ], dockerOptions())).split('\n').filter(Boolean);
    const remainingVolumes = String(await execute(dockerBin, [
      'volume', 'ls',
      '--filter', `name=${egressVolumeName}`,
      '--format', '{{.Name}}',
    ], dockerOptions())).split('\n').filter((name) => name === egressVolumeName);
    if (remainingContainers.length > 0 || remainingVolumes.length > 0) {
      throw new Error('review_egress_cleanup_incomplete');
    }
  } catch (error) {
    throw new Error('review_egress_cleanup_failed', { cause: error });
  }
}

function extractRunId(name, prefix) {
  const match = new RegExp(
    `^${prefix}([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$`,
  ).exec(name ?? '');
  return match?.[1] ?? null;
}

export async function cleanupCodexReviewEgress({
  dockerBin,
  reviewerContainerName = null,
  brokerContainerName,
  egressVolumeName,
  ownerNonce,
  execute = defaultExecute,
} = {}) {
  if (
    typeof dockerBin !== 'string'
    || !dockerBin.startsWith('/')
    || !/^[a-f0-9]{32}$/.test(ownerNonce ?? '')
  ) {
    throw new Error('review_egress_cleanup_identity_invalid');
  }
  const brokerRunId = extractRunId(
    brokerContainerName,
    'cecelia-codex-review-broker-',
  );
  const volumeRunId = extractRunId(
    egressVolumeName,
    'cecelia-codex-review-egress-',
  );
  const reviewerRunId = reviewerContainerName === null
    ? brokerRunId
    : extractRunId(reviewerContainerName, 'cecelia-codex-review-');
  if (
    !brokerRunId
    || brokerRunId !== volumeRunId
    || brokerRunId !== reviewerRunId
  ) {
    throw new Error('review_egress_cleanup_identity_invalid');
  }
  await removeCodexReviewEgress({
    dockerBin,
    reviewerContainerName,
    brokerContainerName,
    egressVolumeName,
    runId: brokerRunId,
    ownerNonce,
    execute,
  });
}

export async function reapExpiredCodexReviewEgress({
  dockerBin,
  execute = defaultExecute,
  now = () => new Date(),
  force = false,
} = {}) {
  if (
    typeof dockerBin !== 'string'
    || !dockerBin.startsWith('/')
    || typeof execute !== 'function'
    || typeof now !== 'function'
    || typeof force !== 'boolean'
  ) {
    throw new Error('review_egress_reaper_invalid');
  }
  const currentTime = now().getTime();
  if (!Number.isFinite(currentTime)) {
    throw new Error('review_egress_reaper_invalid');
  }
  const [containerOutput, volumeOutput] = await Promise.all([
    execute(dockerBin, [
      'ps', '-a',
      '--filter', 'label=cecelia.expires_at',
      '--format', '{{.Names}}',
    ], dockerOptions()),
    execute(dockerBin, [
      'volume', 'ls',
      '--filter', 'label=cecelia.expires_at',
      '--format', '{{.Name}}',
    ], dockerOptions()),
  ]);
  const runIds = new Set();
  for (const name of `${containerOutput}\n${volumeOutput}`.split('\n')) {
    const runId = extractRunId(name, 'cecelia-codex-review-broker-')
      ?? extractRunId(name, 'cecelia-codex-review-egress-')
      ?? extractRunId(name, 'cecelia-codex-review-');
    if (runId) runIds.add(runId);
  }

  let reaped = 0;
  let pending = 0;
  for (const runId of runIds) {
    const names = buildCodexReviewEgressNames(runId);
    let labels = null;
    let inspectUnknown = false;
    for (const candidate of [
      {
        type: 'container',
        name: names.brokerContainerName,
        expectedKind: 'codex-review-broker',
      },
      {
        type: 'container',
        name: `cecelia-codex-review-${runId}`,
        expectedKind: 'codex-reviewer',
      },
      {
        type: 'volume',
        name: names.egressVolumeName,
        expectedKind: 'codex-review-egress',
      },
    ]) {
      try {
        const inspected = JSON.parse(String(await execute(dockerBin, [
          ...(candidate.type === 'volume' ? ['volume', 'inspect'] : ['inspect']),
          '--format', '{{json .}}',
          candidate.name,
        ], dockerOptions())));
        labels = candidate.type === 'volume'
          ? inspected?.Labels
          : inspected?.Config?.Labels;
        if (labels?.['cecelia.kind'] !== candidate.expectedKind) {
          inspectUnknown = true;
          labels = null;
        }
        break;
      } catch (error) {
        if (!isVerifiedMissing(error, candidate.type)) {
          inspectUnknown = true;
          break;
        }
      }
    }
    if (inspectUnknown || !labels) {
      pending++;
      continue;
    }
    const expiresAt = Date.parse(labels?.['cecelia.expires_at'] ?? '');
    const ownerNonce = labels?.['cecelia.owner_nonce'];
    if (
      labels?.['cecelia.run_id'] !== runId
      || !/^[a-f0-9]{32}$/.test(ownerNonce ?? '')
      || !Number.isFinite(expiresAt)
      || (!force && expiresAt > currentTime)
    ) {
      continue;
    }
    try {
      await cleanupCodexReviewEgress({
        dockerBin,
        reviewerContainerName: `cecelia-codex-review-${runId}`,
        ...names,
        ownerNonce,
        execute,
      });
      reaped++;
    } catch {
      pending++;
    }
  }
  return Object.freeze({
    scanned: runIds.size,
    reaped,
    pending,
  });
}

export function startCodexReviewEgressReaper({
  dockerBin,
  intervalMs = 60_000,
  reap = reapExpiredCodexReviewEgress,
  schedule = setInterval,
  cancel = clearInterval,
} = {}) {
  if (
    typeof dockerBin !== 'string'
    || !dockerBin.startsWith('/')
    || !Number.isInteger(intervalMs)
    || intervalMs < 10_000
    || typeof reap !== 'function'
    || typeof schedule !== 'function'
    || typeof cancel !== 'function'
  ) {
    throw new Error('review_egress_reaper_schedule_invalid');
  }
  let stopped = false;
  let running = null;
  const run = (force = false) => {
    if (stopped && !force) return Promise.resolve();
    if (running) return running;
    running = reap({ dockerBin, force })
      .catch((error) => {
        console.error(`[codex-review-egress] reaper failed: ${error.message}`);
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
  void run();
  const timer = schedule(() => {
    void run();
  }, intervalMs);
  timer?.unref?.();
  return Object.freeze({
    async stop({ cleanupActive = false } = {}) {
      if (stopped) return;
      stopped = true;
      cancel(timer);
      if (running) await running;
      if (cleanupActive) await run(true);
    },
  });
}

export async function startCodexReviewEgress({
  dockerBin,
  imageId,
  runId,
  execute = defaultExecute,
  wait = defaultWait,
  readinessAttempts = 40,
  now = () => new Date(),
  ownerNonce = randomBytes(16).toString('hex'),
} = {}) {
  if (
    typeof dockerBin !== 'string'
    || !dockerBin.startsWith('/')
    || !IMAGE_ID_PATTERN.test(imageId ?? '')
    || typeof execute !== 'function'
    || typeof wait !== 'function'
    || !Number.isInteger(readinessAttempts)
    || readinessAttempts < 1
    || readinessAttempts > 200
    || typeof now !== 'function'
    || !/^[a-f0-9]{32}$/.test(ownerNonce)
  ) {
    throw new Error('review_egress_runtime_invalid');
  }
  const names = buildCodexReviewEgressNames(runId);
  const createdAt = now();
  const expiresAt = new Date(
    createdAt.getTime() + REVIEW_RUNTIME_TTL_MS,
  ).toISOString();
  let cleanupPromise = null;
  const dispose = async () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = cleanupCodexReviewEgress({
      dockerBin,
      ...names,
      ownerNonce,
      execute,
    });
    try {
      await cleanupPromise;
    } catch (error) {
      cleanupPromise = null;
      throw error;
    }
  };
  const teardown = async (reviewerContainerName) => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = cleanupCodexReviewEgress({
      dockerBin,
      reviewerContainerName,
      ...names,
      ownerNonce,
      execute,
    });
    try {
      await cleanupPromise;
    } catch (error) {
      cleanupPromise = null;
      throw error;
    }
  };

  try {
    await execute(dockerBin, [
      'volume', 'create',
      '--label', 'cecelia.kind=codex-review-egress',
      '--label', `cecelia.run_id=${runId}`,
      '--label', `cecelia.owner_nonce=${ownerNonce}`,
      '--label', `cecelia.expires_at=${expiresAt}`,
      names.egressVolumeName,
    ], dockerOptions());

    const volume = JSON.parse(String(await execute(dockerBin, [
      'volume', 'inspect',
      '--format', '{{json .}}',
      names.egressVolumeName,
    ], dockerOptions())));
    if (
      volume?.Name !== names.egressVolumeName
      || volume?.Labels?.['cecelia.kind'] !== 'codex-review-egress'
      || volume?.Labels?.['cecelia.run_id'] !== runId
      || volume?.Labels?.['cecelia.owner_nonce'] !== ownerNonce
      || volume?.Labels?.['cecelia.expires_at'] !== expiresAt
    ) {
      throw new Error('review_egress_volume_identity_conflict');
    }

    await execute(dockerBin, [
      'run', '--rm',
      '--network', 'none',
      '--read-only',
      '--cap-drop=ALL',
      '--cap-add=CHOWN',
      '--security-opt=no-new-privileges',
      '--user', '0:0',
      '--mount', `type=volume,src=${names.egressVolumeName},dst=/broker`,
      '--entrypoint', '/bin/sh',
      imageId,
      '-ceu',
      'chown 1001:1001 /broker',
    ], dockerOptions());

    await execute(dockerBin, [
      'run', '--detach',
      '--name', names.brokerContainerName,
      '--label', 'cecelia.kind=codex-review-broker',
      '--label', `cecelia.run_id=${runId}`,
      '--label', `cecelia.owner_nonce=${ownerNonce}`,
      '--label', `cecelia.expires_at=${expiresAt}`,
      '--init',
      '--no-healthcheck',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--pids-limit', '64',
      '--ulimit', 'nofile=64:64',
      '--memory', '128m',
      '--cpus', '0.25',
      '--user', '1001:1001',
      '--network', 'bridge',
      '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777',
      '--mount', `type=volume,src=${names.egressVolumeName},dst=/broker`,
      '--entrypoint', '/usr/local/bin/node',
      imageId,
      BROKER_PROGRAM,
      BROKER_SOCKET_PATH,
    ], dockerOptions());

    let ready = false;
    const readinessDeadline = Date.now() + 5_000;
    for (let attempt = 0; attempt < readinessAttempts; attempt++) {
      if (Date.now() >= readinessDeadline) break;
      try {
        await execute(dockerBin, [
          'exec',
          names.brokerContainerName,
          '/usr/local/bin/node',
          '-e',
          [
            "const net=require('node:net')",
            `const s=net.createConnection('${BROKER_SOCKET_PATH}')`,
            "const t=setTimeout(()=>process.exit(2),500)",
            "s.on('connect',()=>s.write('GET /health HTTP/1.1\\r\\nHost: local\\r\\n\\r\\n'))",
            "s.on('data',d=>{clearTimeout(t);process.exit(String(d).includes('403 Forbidden')?0:3)})",
            "s.on('error',()=>process.exit(4))",
          ].join(';'),
        ], {
          ...dockerOptions(),
          timeout: Math.max(
            100,
            Math.min(1_000, readinessDeadline - Date.now()),
          ),
        });
        ready = true;
        break;
      } catch {
        await wait(50);
      }
    }
    if (!ready) throw new Error('review_egress_broker_not_ready');

    return Object.freeze({
      ...names,
      expiresAt,
      ownerNonce,
      dispose,
      teardown,
    });
  } catch (error) {
    try {
      await dispose();
    } catch {
      // Identity mismatch/unknown must fail closed: never delete a resource
      // merely because it has the deterministic name for this run.
    }
    if (error?.message === 'review_egress_broker_not_ready') throw error;
    throw new Error('review_egress_broker_start_failed', { cause: error });
  }
}
