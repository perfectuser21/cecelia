'use strict';

const { Buffer } = require('node:buffer');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { access, chmod, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const process = require('node:process');
const { clearTimeout, setTimeout } = require('node:timers');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const { AbortController } = globalThis;

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_CALLBACK_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BUFFER = 64 * 1024;
const DISPOSABLE_CONTAINER_TIMEOUT_MS = 15_000;
const DEFAULT_CALLBACK_URL = 'http://127.0.0.1:5221/api/brain/health';
const DEFAULT_DRAIN_MARKER = '/var/run/cecelia/fleet-worker.drain';
const DEFAULT_WORKER_VERSION = '1.272.16';
const DEFAULT_RUNNER_VERSION = 'cecelia-runner/v1';
const DEFAULT_POSTGRES_IMAGE = 'pgvector/pgvector:pg15@sha256:a20a57d7aa5217a6af0a391ccf69f4a8512406d6c14be08132f801468cc3cc62';
const MAX_CLOCK_OFFSET_SECONDS = 1;
const EMPTY_DIGEST = `sha256:${'0'.repeat(64)}`;

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : fallback;
}

function boundedString(value, fallback = 'unavailable') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1_024) : fallback;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function percentage(value, fallback = 100) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(100, number))
    : fallback;
}

function safeNow(now) {
  try {
    const value = typeof now === 'function' ? now() : Date.now();
    const timestamp = new Date(value);
    if (Number.isFinite(timestamp.getTime())) return timestamp.toISOString();
  } catch {
    // Fail closed with a valid, stale timestamp.
  }
  return '1970-01-01T00:00:00.000Z';
}

function normalizeCommandResult(result) {
  if (typeof result === 'string' || Buffer.isBuffer(result)) {
    return { stdout: String(result), stderr: '' };
  }
  return {
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? ''),
  };
}

function createCommandRunner({
  execFileFn,
  commandTimeoutMs,
  maxBuffer,
}) {
  return async function run(file, args, extraOptions = {}) {
    try {
      const result = await execFileFn(file, args, {
        shell: false,
        timeout: commandTimeoutMs,
        maxBuffer,
        encoding: 'utf8',
        ...extraOptions,
      });
      const normalized = normalizeCommandResult(result);
      return {
        ok: true,
        stdout: normalized.stdout.slice(0, maxBuffer),
        stderr: normalized.stderr.slice(0, maxBuffer),
      };
    } catch {
      return { ok: false, stdout: '', stderr: '' };
    }
  };
}

function parseVersion(output, prefixes = []) {
  const text = String(output ?? '').trim();
  if (!text) return 'unavailable';
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.version === 'string') return boundedString(parsed.version);
    if (typeof parsed?.Version === 'string') return boundedString(parsed.Version);
  } catch {
    // Version commands commonly return plain text.
  }
  let candidate = text;
  for (const prefix of prefixes) {
    candidate = candidate.replace(prefix, '');
  }
  const version = candidate.match(/\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?/);
  return boundedString(version?.[0] ?? candidate.split(/\s+/).at(-1));
}

function parseJson(output) {
  try {
    return JSON.parse(String(output ?? ''));
  } catch {
    return null;
  }
}

function parseInteger(output) {
  const match = String(output ?? '').match(/-?\d+/);
  return match ? Number.parseInt(match[0], 10) : Number.NaN;
}

function parseLoadAverage(output) {
  const match = String(output ?? '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : Number.NaN;
}

function parseMemoryPressure(output) {
  const match = String(output ?? '').match(
    /System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/i,
  );
  if (!match) return 100;
  return percentage(100 - Number.parseFloat(match[1]));
}

function parseDisk(output) {
  const lines = String(output ?? '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) {
    return { disk_free_bytes: 0, disk_used_percent: 100 };
  }
  const fields = lines.at(-1).trim().split(/\s+/);
  const availableBlocks = Number.parseInt(fields[3], 10);
  const usedPercent = Number.parseFloat(String(fields[4] ?? '').replace('%', ''));
  return {
    disk_free_bytes: Number.isFinite(availableBlocks) && availableBlocks >= 0
      ? availableBlocks * 1_024
      : 0,
    disk_used_percent: percentage(usedPercent),
  };
}

function parsePower(output) {
  const text = String(output ?? '');
  return {
    sleep_disabled: /(?:^|\s)sleep\s+0(?:\s|$)/m.test(text),
    auto_power_on: /(?:^|\s)autorestart\s+1(?:\s|$)/m.test(text),
  };
}

function parseTimeSynchronization(output) {
  const text = String(output ?? '');
  const explicitOffset = text.match(
    /offset\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)/i,
  );
  const genericOffset = text.match(
    /(?:^|\s)([+-]\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)?(?:\s|$)/im,
  );
  const value = Number.parseFloat(explicitOffset?.[1] ?? genericOffset?.[1]);
  return Number.isFinite(value) && Math.abs(value) <= MAX_CLOCK_OFFSET_SECONDS;
}

function tailscaleConnected(result) {
  if (!result.ok) return false;
  const status = parseJson(result.stdout);
  return status?.BackendState === 'Running';
}

function isTailscaleIpv4(address) {
  const octets = String(address ?? '').split('.').map(Number);
  return octets.length === 4
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && octets[0] === 100
    && octets[1] >= 64
    && octets[1] <= 127;
}

function tailscaleInterfaceConnected(result, expectedAddress) {
  if (!result.ok || !isTailscaleIpv4(expectedAddress)) return false;
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .some((line) => {
      const fields = line.trim().split(/\s+/);
      return fields[0] === 'inet' && fields[1] === expectedAddress;
    });
}

async function probeCallback(fetchFn, callbackUrl, timeoutMs) {
  if (typeof fetchFn !== 'function') return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(callbackUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    return Boolean(response?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probeDrainMarker(statFn, markerPath) {
  try {
    await statFn(markerPath);
    return true;
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
}

function disposableContainerName(tempRoot) {
  const suffix = createHash('sha256')
    .update(tempRoot)
    .digest('hex')
    .slice(0, 16);
  return `fleet-node-probe-${suffix}`;
}

async function probeDisposableResources({
  run,
  repoRoot,
  runnerImageDigest,
  makeTempDirFn,
  chmodTempDirFn,
  removeTempDirFn,
}) {
  let tempRoot = null;
  let worktreePath = null;
  let worktreeAddAttempted = false;
  let worktreeAdded = false;
  let containerName = null;
  let containerCreateAttempted = false;
  let containerCreated = false;
  let containerStarted = false;
  let worktreeCleanupSucceeded = true;
  let containerCleanupSucceeded = true;
  let tempCleanupSucceeded = true;

  try {
    tempRoot = await makeTempDirFn();
    await chmodTempDirFn(tempRoot, 0o755);
    worktreePath = path.join(tempRoot, 'worktree');
    containerName = disposableContainerName(tempRoot);
    worktreeAddAttempted = true;
    const addResult = await run(
      'git',
      ['worktree', 'add', '--detach', worktreePath, 'HEAD'],
      { cwd: repoRoot },
    );
    worktreeAdded = addResult.ok;

    if (worktreeAdded) {
      containerCreateAttempted = true;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          await run('docker', ['rm', '-f', '--', containerName]);
        }
        const createResult = await run('docker', [
          'create',
          '--name',
          containerName,
          '--mount',
          `type=bind,src=${worktreePath},dst=/workspace,readonly`,
          '--entrypoint',
          '/usr/bin/test',
          runnerImageDigest,
          '-e',
          '/workspace/.git',
        ], { timeout: DISPOSABLE_CONTAINER_TIMEOUT_MS });
        containerCreated = createResult.ok;
        containerStarted = false;
        if (containerCreated) {
          const startResult = await run(
            'docker',
            ['start', '--attach', containerName],
            { timeout: DISPOSABLE_CONTAINER_TIMEOUT_MS },
          );
          containerStarted = startResult.ok;
        }
        if (containerCreated && containerStarted) break;
      }
    }
  } catch {
    worktreeAdded = false;
    containerCreated = false;
    containerStarted = false;
  } finally {
    if (containerCreateAttempted && containerName) {
      const removeContainer = await run(
        'docker',
        ['rm', '-f', '--', containerName],
      );
      containerCleanupSucceeded = removeContainer.ok;
    }
    if (worktreeAddAttempted && worktreePath) {
      const removeWorktree = await run(
        'git',
        ['worktree', 'remove', '--force', worktreePath],
        { cwd: repoRoot },
      );
      worktreeCleanupSucceeded = removeWorktree.ok;
    }
    if (tempRoot) {
      try {
        await removeTempDirFn(tempRoot);
      } catch {
        tempCleanupSucceeded = false;
      }
    }
  }

  return {
    worktreeReady: worktreeAdded
      && worktreeCleanupSucceeded
      && tempCleanupSucceeded,
    containerSucceeded: containerCreated
      && containerStarted
      && containerCleanupSucceeded
      && tempCleanupSucceeded,
  };
}

async function probePostgresRuntime({ run, imageDigest, machineId }) {
  const safeMachine = String(machineId ?? 'unconfigured')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .slice(0, 48);
  const containerName = `cecelia-pg-admission-${safeMachine}`;
  let result = { ok: false, stdout: '', stderr: '' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // A previous timeout may have left the deterministic probe name. Cleanup is
    // exact around every bounded retry; three failures still remain fail-closed.
    await run('docker', ['rm', '-f', '--', containerName]);
    try {
      result = await run('docker', [
        'run',
        '--rm',
        '--name',
        containerName,
        '--label',
        'cecelia.fleet.resource=postgres-admission-probe',
        '--network',
        'none',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,noexec,nosuid,nodev',
        '--env',
        'POSTGRES_PASSWORD=probe-only',
        '--entrypoint',
        'sh',
        imageDigest,
        '-ec',
        [
          'docker-entrypoint.sh postgres >/tmp/postgres-probe.log 2>&1 &',
          'pid=$!',
          'trap \'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true\' EXIT',
          'i=0',
          'while [ "$i" -lt 20 ]; do',
          '  pg_isready -U postgres -d postgres >/dev/null 2>&1 && exit 0',
          '  i=$((i+1))',
          '  sleep 0.1',
          'done',
          'exit 1',
        ].join('\n'),
      ]);
      if (result.ok) return result;
    } finally {
      await run('docker', ['rm', '-f', '--', containerName]);
    }
  }
  return result;
}

function failClosedReport({
  machineId,
  runnerImageDigest,
  observedAt,
  workerVersion,
  runnerVersion,
  postgresImageDigest,
  drainActive = true,
}) {
  return {
    schema_version: 'fleet-node-health/v1',
    machine_id: machineId,
    observed_at: observedAt,
    worker: {
      protocol_version: 'kernel-harness/v1',
      contract_version: 'fleet-node-health/v1',
      version: workerVersion,
    },
    runner: {
      version: runnerVersion,
      image_digest: runnerImageDigest,
    },
    os: { version: 'unavailable' },
    orbstack: { version: 'unavailable' },
    docker: { available: false, observed_at: observedAt },
    resources: {
      cpu_cores: 0,
      memory_bytes: 0,
      disk_free_bytes: 0,
      disk_used_percent: 100,
      cpu_pressure_percent: 100,
      memory_pressure_percent: 100,
    },
    git: { available: false, version: 'unavailable' },
    node: { available: false, version: 'unavailable' },
    codex: { available: false, version: 'unavailable' },
    tailscale: { connected: false },
    callback: { reachable: false },
    time_sync: { synchronized: false },
    power: { sleep_disabled: false, auto_power_on: false },
    launchd: { loaded: false, domain: 'system', kind: 'LaunchDaemon' },
    worktree: { root_ready: false },
    container: { probe_succeeded: false },
    runtime_resources: {
      postgres: { available: false, image_digest: postgresImageDigest },
    },
    drain: { active: drainActive },
  };
}

async function probeFleetWorkerHealth(options = {}) {
  const env = options.env && typeof options.env === 'object'
    ? options.env
    : process.env;
  const machineId = boundedString(
    options.machineId ?? env.CECELIA_MACHINE_ID,
    'unconfigured',
  );
  const configuredDigest = boundedString(
    options.runnerImageDigest ?? env.CECELIA_RUNNER_DIGEST,
    'unconfigured',
  );
  const runnerImageDigest = /^sha256:[a-f0-9]{64}$/.test(configuredDigest)
    ? configuredDigest
    : configuredDigest;
  const commandDigest = /^sha256:[a-f0-9]{64}$/.test(runnerImageDigest)
    ? runnerImageDigest
    : EMPTY_DIGEST;
  const observedAt = safeNow(options.now);
  const workerVersion = boundedString(
    options.workerVersion ?? env.CECELIA_FLEET_WORKER_VERSION,
    DEFAULT_WORKER_VERSION,
  );
  const runnerVersion = boundedString(
    options.runnerVersion ?? env.CECELIA_RUNNER_VERSION,
    DEFAULT_RUNNER_VERSION,
  );
  const postgresImageDigest = boundedString(
    options.postgresImageDigest ?? env.CECELIA_POSTGRES_IMAGE,
    DEFAULT_POSTGRES_IMAGE,
  );
  const report = failClosedReport({
    machineId,
    runnerImageDigest,
    observedAt,
    workerVersion,
    runnerVersion,
    postgresImageDigest,
  });

  try {
    const run = createCommandRunner({
      execFileFn: options.execFileFn ?? execFileAsync,
      commandTimeoutMs: boundedInteger(
        options.commandTimeoutMs,
        DEFAULT_COMMAND_TIMEOUT_MS,
        100,
        30_000,
      ),
      maxBuffer: boundedInteger(
        options.maxBuffer,
        DEFAULT_MAX_BUFFER,
        1_024,
        256 * 1_024,
      ),
    });
    const repoRoot = path.resolve(
      boundedString(options.repoRoot ?? env.CECELIA_REPO_ROOT, process.cwd()),
    );
    const callbackUrl = boundedString(
      options.callbackUrl ?? env.CECELIA_CALLBACK_URL,
      DEFAULT_CALLBACK_URL,
    );
    const workerBindHost = boundedString(
      options.workerBindHost ?? env.CECELIA_FLEET_WORKER_HOST,
      '',
    );
    const orbstackHome = boundedString(
      options.orbstackHome ?? env.CECELIA_ORBSTACK_HOME,
      '/var/empty',
    );
    const drainMarkerPath = boundedString(
      options.drainMarkerPath ?? env.CECELIA_DRAIN_MARKER,
      DEFAULT_DRAIN_MARKER,
    );
    const makeTempDirFn = options.makeTempDirFn
      ?? (() => mkdtemp(path.join(tmpdir(), 'fleet-node-probe-')));
    const chmodTempDirFn = options.chmodTempDirFn ?? chmod;
    const removeTempDirFn = options.removeTempDirFn
      ?? ((target) => rm(target, { recursive: true, force: true }));
    const statFn = options.statFn ?? access;
    const fetchFn = options.fetchFn ?? globalThis.fetch;

    const [
      osResult,
      orbResult,
      dockerInfoResult,
      dockerImageResult,
      postgresImageResult,
      postgresRuntimeResult,
      gitResult,
      nodeResult,
      codexResult,
      tailscaleResult,
      ifconfigResult,
      powerResult,
      cpuResult,
      memoryResult,
      loadResult,
      memoryPressureResult,
      diskResult,
      launchdResult,
      timeResult,
      callbackReachable,
      drainActive,
      disposable,
    ] = await Promise.all([
      run('sw_vers', ['-productVersion']),
      run('orbctl', ['version'], {
        env: { ...env, HOME: orbstackHome },
      }),
      run('docker', ['info', '--format', '{{json .}}']),
      run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', commandDigest]),
      run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', postgresImageDigest]),
      probePostgresRuntime({
        run,
        imageDigest: postgresImageDigest,
        machineId,
      }),
      run('git', ['--version']),
      run('node', ['--version']),
      run('codex', ['--version']),
      run('tailscale', ['status', '--json']),
      run('ifconfig', []),
      run('pmset', ['-g']),
      run('sysctl', ['-n', 'hw.ncpu']),
      run('sysctl', ['-n', 'hw.memsize']),
      run('sysctl', ['-n', 'vm.loadavg']),
      run('memory_pressure', ['-Q']),
      run('df', ['-k', '/']),
      run('launchctl', ['print', 'system/com.perfect21.fleet-worker']),
      run('sntp', ['-d', 'time.apple.com']),
      probeCallback(
        fetchFn,
        callbackUrl,
        boundedInteger(
          options.callbackTimeoutMs,
          DEFAULT_CALLBACK_TIMEOUT_MS,
          100,
          30_000,
        ),
      ),
      probeDrainMarker(statFn, drainMarkerPath),
      probeDisposableResources({
        run,
        repoRoot,
        runnerImageDigest: commandDigest,
        makeTempDirFn,
        chmodTempDirFn,
        removeTempDirFn,
      }),
    ]);

    const cpuCores = finiteNumber(parseInteger(cpuResult.stdout));
    const memoryBytes = finiteNumber(parseInteger(memoryResult.stdout));
    const loadAverage = parseLoadAverage(loadResult.stdout);
    const disk = parseDisk(diskResult.stdout);
    const power = parsePower(powerResult.stdout);
    const timeOutput = `${timeResult.stdout}\n${timeResult.stderr}`;

    report.os.version = osResult.ok
      ? parseVersion(osResult.stdout)
      : 'unavailable';
    report.orbstack.version = orbResult.ok
      ? parseVersion(orbResult.stdout, [/^OrbStack\s*/i])
      : 'unavailable';
    report.docker.available = dockerInfoResult.ok && dockerImageResult.ok;
    report.runtime_resources.postgres = {
      available: dockerInfoResult.ok
        && postgresImageResult.ok
        && postgresRuntimeResult.ok,
      image_digest: postgresImageDigest,
    };
    report.resources = {
      cpu_cores: cpuCores,
      memory_bytes: memoryBytes,
      disk_free_bytes: disk.disk_free_bytes,
      disk_used_percent: disk.disk_used_percent,
      cpu_pressure_percent: cpuCores > 0
        ? percentage((finiteNumber(loadAverage, cpuCores) / cpuCores) * 100)
        : 100,
      memory_pressure_percent: memoryPressureResult.ok
        ? parseMemoryPressure(memoryPressureResult.stdout)
        : 100,
    };
    report.git = {
      available: gitResult.ok,
      version: gitResult.ok
        ? parseVersion(gitResult.stdout, [/^git version\s*/i])
        : 'unavailable',
    };
    report.node = {
      available: nodeResult.ok,
      version: nodeResult.ok
        ? parseVersion(nodeResult.stdout, [/^v/i])
        : 'unavailable',
    };
    report.codex = {
      available: codexResult.ok,
      version: codexResult.ok
        ? parseVersion(codexResult.stdout, [/^codex(?:-cli)?\s*/i])
        : 'unavailable',
    };
    report.tailscale.connected = tailscaleConnected(tailscaleResult)
      || (
        callbackReachable
        && tailscaleInterfaceConnected(ifconfigResult, workerBindHost)
      );
    report.callback.reachable = callbackReachable;
    report.time_sync.synchronized = timeResult.ok
      && parseTimeSynchronization(timeOutput);
    report.power = {
      sleep_disabled: powerResult.ok && power.sleep_disabled,
      auto_power_on: powerResult.ok && power.auto_power_on,
    };
    report.launchd.loaded = launchdResult.ok
      && /system\/com\.perfect21\.fleet-worker|state\s*=\s*running/i
        .test(launchdResult.stdout);
    report.worktree.root_ready = disposable.worktreeReady;
    report.container.probe_succeeded = disposable.containerSucceeded;
    report.drain.active = drainActive;
  } catch {
    // The complete fail-closed report above remains safe for admission.
  }

  return report;
}

module.exports = {
  probeFleetWorkerHealth,
};
