import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const NETWORK_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const NONCE_RE = /^[0-9a-f]{64}$/;

function deny(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function overlapsImmutableRuntime(path) {
  if (!isAbsolute(path ?? '')) return true;
  const candidate = resolve(path);
  return candidate === '/'
    || ['/repo', '/app'].some((immutableRoot) => (
      candidate === immutableRoot
      || candidate.startsWith(`${immutableRoot}/`)
      || immutableRoot.startsWith(`${candidate}/`)
    ));
}

function isCanonicalAbsolutePath(path) {
  return isAbsolute(path ?? '') && resolve(path) === path;
}

function hasExactControllerTmpfs(tmpfs) {
  if (
    tmpfs == null
    || typeof tmpfs !== 'object'
    || Array.isArray(tmpfs)
    || JSON.stringify(Object.keys(tmpfs).sort()) !== JSON.stringify(['/tmp'])
  ) {
    return false;
  }
  const option = tmpfs['/tmp'];
  if (typeof option !== 'string' || option.includes(',')) return false;
  const match = option.match(
    /^size=([1-9][0-9]*)([kmgt]?)(?:i?b)?$/i,
  );
  if (!match) return false;
  const powers = { '': 0n, k: 1n, m: 2n, g: 3n, t: 4n };
  const exponent = powers[match[2].toLowerCase()];
  const bytes = BigInt(match[1]) * (1024n ** exponent);
  return bytes === 100n * 1024n * 1024n;
}

export function resolveRollbackControllerRuntime({
  exec = execFileSync,
} = {}) {
  const image = String(exec(
    'docker',
    ['inspect', 'cecelia-node-brain', '--format', '{{.Image}}'],
    { encoding: 'utf8' },
  )).trim();
  const networks = String(exec(
    'docker',
    [
      'inspect',
      'cecelia-node-brain',
      '--format',
      '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}',
    ],
    { encoding: 'utf8' },
  )).trim().split(/\s+/).filter(Boolean);
  if (!DIGEST_RE.test(image) || networks.length !== 1 || !NETWORK_RE.test(networks[0])) {
    deny('release_rollback_controller_runtime_invalid');
  }
  return { image, network: networks[0] };
}

function buildReleaseControllerArgs({
  kind,
  image,
  network,
  repoRoot,
  privateConfigFile,
  logFile,
  claimId,
  generation,
  ownerNonce = randomBytes(32).toString('hex'),
  workerEnvironment,
}) {
  const normalizedGeneration = Number(generation);
  if (
    !DIGEST_RE.test(image ?? '')
    || !NETWORK_RE.test(network ?? '')
    || !isCanonicalAbsolutePath(repoRoot)
    || overlapsImmutableRuntime(repoRoot)
    || !isCanonicalAbsolutePath(privateConfigFile)
    || !privateConfigFile.includes('/cecelia-release-worker-')
    || overlapsImmutableRuntime(privateConfigFile)
    || !isCanonicalAbsolutePath(logFile)
    || !logFile.startsWith(`${repoRoot}/logs/`)
    || !Number.isSafeInteger(Number(claimId))
    || !Number.isSafeInteger(normalizedGeneration)
    || normalizedGeneration < 1
    || (kind === 'rollback' && normalizedGeneration !== 1)
    || !NONCE_RE.test(ownerNonce)
    || !UUID_RE.test(workerEnvironment?.KERNEL_RELEASE_RUN_ID ?? '')
  ) {
    deny('release_rollback_controller_request_invalid');
  }
  if (!['production', 'rollback'].includes(kind)) {
    deny('release_controller_kind_invalid');
  }
  const name = `cecelia-release-${kind}-${Number(claimId)}-${normalizedGeneration}`;
  const binds = [
    '/var/run/docker.sock:/var/run/docker.sock',
    `${repoRoot}:${repoRoot}:rw`,
    `${dirname(privateConfigFile)}:${dirname(privateConfigFile)}:rw`,
  ];
  const args = [
    'run', '-d',
    '--name', name,
    '--restart', 'on-failure:3',
    '--network', network,
    '--read-only',
    '--tmpfs', '/tmp:size=100M',
    '--no-healthcheck',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--pids-limit', '128',
    '--memory', '512m',
    '--cpus', '1',
    '--label', `cecelia.release.kind=${kind}`,
    '--label', `cecelia.release.claim-id=${Number(claimId)}`,
    '--label', `cecelia.release.generation=${normalizedGeneration}`,
    '--label', `cecelia.release.owner-nonce=${ownerNonce}`,
    '-v', binds[0],
    '-v', binds[1],
    '-v', binds[2],
    '-w', repoRoot,
  ];
  for (const deployRoot of String(
    workerEnvironment.CECELIA_SKILLS_DEPLOY_ROOTS ?? '',
  ).split(':').filter(Boolean)) {
    if (
      !isCanonicalAbsolutePath(deployRoot)
      || overlapsImmutableRuntime(deployRoot)
    ) {
      deny('release_rollback_controller_request_invalid');
    }
    const bind = `${deployRoot}:${deployRoot}:rw`;
    binds.push(bind);
    args.push('-v', bind);
  }
  const safeEnvironment = {
    ...workerEnvironment,
    BRAIN_URL: 'http://node-brain:5221',
    KERNEL_RELEASE_EXTERNAL_CONTROLLER: '1',
    KERNEL_RELEASE_CONTROLLER_LOG_FILE: logFile,
  };
  for (const [key, value] of Object.entries(safeEnvironment).sort(([a], [b]) => (
    a.localeCompare(b)
  ))) {
    if (value != null) args.push('-e', `${key}=${String(value)}`);
  }
  const command = [
    'sh',
    '-c',
    'exec node "$1" >> "$KERNEL_RELEASE_CONTROLLER_LOG_FILE" 2>&1',
    'release-controller',
    kind === 'rollback'
      ? '/repo/scripts/lib/release-run-rollback-worker.mjs'
      : '/repo/scripts/lib/release-run-effect-worker.mjs',
  ];
  args.push(image, ...command);
  const expectedEnvironmentEntries = Object.entries(safeEnvironment)
    .filter(([, value]) => value != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`);
  const expectedLabels = {
    'cecelia.release.kind': kind,
    'cecelia.release.claim-id': String(Number(claimId)),
    'cecelia.release.generation': String(normalizedGeneration),
    'cecelia.release.owner-nonce': ownerNonce,
  };
  return {
    name,
    args,
    privateConfigDirectory: dirname(privateConfigFile),
    kind,
    image,
    claimId: Number(claimId),
    generation: normalizedGeneration,
    ownerNonce,
    network,
    repoRoot,
    binds,
    command,
    expectedEnvironmentEntries,
    expectedLabels,
  };
}

export function buildRollbackControllerArgs(options) {
  return buildReleaseControllerArgs({ ...options, kind: 'rollback' });
}

export function buildProductionControllerArgs(options) {
  return buildReleaseControllerArgs({ ...options, kind: 'production' });
}

function reconcileController(planned, {
  execFn = execFileSync,
} = {}) {
  let ids;
  try {
    ids = String(execFn(
      'docker',
      [
        'ps',
        '-aq',
        '--no-trunc',
        '--filter',
        `name=^/${planned.name}$`,
      ],
      { encoding: 'utf8' },
    )).trim().split(/\s+/).filter(Boolean);
  } catch (error) {
    throw Object.assign(
      new Error('release_controller_launch_outcome_unknown', { cause: error }),
      { code: 'release_controller_launch_outcome_unknown' },
    );
  }
  if (ids.length === 0) return false;
  if (ids.length !== 1) deny('release_controller_identity_collision');
  let observed;
  let imageConfig;
  try {
    observed = JSON.parse(String(execFn(
      'docker',
      ['inspect', planned.name, '--format', '{{json .}}'],
      { encoding: 'utf8' },
    )));
    imageConfig = JSON.parse(String(execFn(
      'docker',
      ['image', 'inspect', planned.image, '--format', '{{json .Config}}'],
      { encoding: 'utf8' },
    )));
  } catch (error) {
    throw Object.assign(
      new Error('release_controller_launch_outcome_unknown', { cause: error }),
      { code: 'release_controller_launch_outcome_unknown' },
    );
  }
  const toEnvironmentMap = (entries) => {
    if (!Array.isArray(entries)) return null;
    const result = {};
    for (const entry of entries) {
      const separator = typeof entry === 'string' ? entry.indexOf('=') : -1;
      if (separator <= 0) return null;
      const key = entry.slice(0, separator);
      if (Object.hasOwn(result, key)) return null;
      result[key] = entry.slice(separator + 1);
    }
    return result;
  };
  const imageEnvironment = toEnvironmentMap(imageConfig?.Env ?? []);
  const plannedEnvironment = toEnvironmentMap(planned.expectedEnvironmentEntries);
  const observedEnvironment = toEnvironmentMap(observed?.Config?.Env);
  const expectedEnvironment = imageEnvironment && plannedEnvironment
    ? { ...imageEnvironment, ...plannedEnvironment }
    : null;
  const expectedLabels = {
    ...(imageConfig?.Labels ?? {}),
    ...planned.expectedLabels,
  };
  const sameRecord = (left, right) => (
    left != null
    && right != null
    && JSON.stringify(Object.entries(left).sort(([a], [b]) => a.localeCompare(b)))
      === JSON.stringify(Object.entries(right).sort(([a], [b]) => a.localeCompare(b)))
  );
  const observedSecurity = (observed?.HostConfig?.SecurityOpt ?? [])
    .map((value) => value === 'no-new-privileges:true'
      ? 'no-new-privileges'
      : value);
  if (
    observed?.Name !== `/${planned.name}`
    || observed?.Image !== planned.image
    || observed?.State?.Running !== true
    || observed?.Config?.Image !== planned.image
    || !sameRecord(observed?.Config?.Labels ?? {}, expectedLabels)
    || expectedEnvironment == null
    || !sameRecord(observedEnvironment, expectedEnvironment)
    || observed?.HostConfig?.RestartPolicy?.Name !== 'on-failure'
    || Number(observed?.HostConfig?.RestartPolicy?.MaximumRetryCount) !== 3
    || observed?.HostConfig?.NetworkMode !== planned.network
    || observed?.HostConfig?.ReadonlyRootfs !== true
    || JSON.stringify(observed?.HostConfig?.CapDrop) !== JSON.stringify(['ALL'])
    || JSON.stringify(observedSecurity)
      !== JSON.stringify(['no-new-privileges'])
    || !hasExactControllerTmpfs(observed?.HostConfig?.Tmpfs)
    || JSON.stringify(observed?.Config?.Healthcheck?.Test)
      !== JSON.stringify(['NONE'])
    || Number(observed?.HostConfig?.PidsLimit) !== 128
    || Number(observed?.HostConfig?.Memory) !== 512 * 1024 * 1024
    || Number(observed?.HostConfig?.NanoCpus) !== 1_000_000_000
    || observed?.Config?.WorkingDir !== planned.repoRoot
    || JSON.stringify([...(observed?.HostConfig?.Binds ?? [])].sort())
      !== JSON.stringify([...planned.binds].sort())
    || JSON.stringify(observed?.Config?.Cmd) !== JSON.stringify(planned.command)
  ) {
    deny('release_controller_identity_collision');
  }
  return true;
}

async function launchController(planned, options, {
  spawnFn = spawn,
  execFn = execFileSync,
} = {}) {
  const reconciled = await new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      callback(value);
    };
    const reconcileAfterResult = (cliSucceeded) => {
      try {
        if (reconcileController(planned, { execFn })) {
          finish(resolve, cliSucceeded !== true);
        } else {
          const code = cliSucceeded === true
            ? 'release_controller_launch_outcome_unknown'
            : 'release_rollback_controller_spawn_failed';
          finish(reject, Object.assign(new Error(code), { code }));
        }
      } catch (error) {
        finish(reject, error);
      }
    };
    const child = spawnFn('docker', planned.args, {
      cwd: options.repoRoot,
      stdio: 'ignore',
    });
    child.once?.('error', () => reconcileAfterResult(false));
    child.once?.('close', (code) => {
      reconcileAfterResult(code === 0);
    });
    if (!child.once && child.on) {
      child.on('error', () => reconcileAfterResult(false));
      child.on('close', (code) => {
        reconcileAfterResult(code === 0);
      });
    }
  });
  return reconciled
    ? { name: planned.name, reconciled: true }
    : { name: planned.name };
}

export async function launchRollbackController(options, dependencies) {
  return launchController(buildRollbackControllerArgs(options), options, dependencies);
}

export async function launchProductionController(options, dependencies) {
  return launchController(buildProductionControllerArgs(options), options, dependencies);
}

export const __test__ = {
  DIGEST_RE,
  NETWORK_RE,
  UUID_RE,
  NONCE_RE,
  overlapsImmutableRuntime,
  isCanonicalAbsolutePath,
  reconcileController,
};
