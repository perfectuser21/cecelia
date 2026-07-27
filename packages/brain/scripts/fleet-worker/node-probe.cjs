'use strict';

const { Buffer } = require('node:buffer');
const { execFile } = require('node:child_process');
const { access, mkdtemp, rm } = require('node:fs/promises');
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
const DEFAULT_CALLBACK_URL = 'http://127.0.0.1:5221/api/brain/health';
const DEFAULT_DRAIN_MARKER = '/var/run/cecelia/fleet-worker.drain';
const DEFAULT_WORKER_VERSION = '1.267.90';
const DEFAULT_RUNNER_VERSION = 'cecelia-runner/v1';
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

async function probeDisposableResources({
  run,
  repoRoot,
  runnerImageDigest,
  makeTempDirFn,
  removeTempDirFn,
}) {
  let tempRoot = null;
  let worktreePath = null;
  let worktreeAdded = false;
  let containerId = null;
  let containerCreated = false;
  let worktreeCleanupSucceeded = true;
  let containerCleanupSucceeded = true;
  let tempCleanupSucceeded = true;

  try {
    tempRoot = await makeTempDirFn();
    worktreePath = path.join(tempRoot, 'worktree');
    const addResult = await run(
      'git',
      ['worktree', 'add', '--detach', worktreePath, 'HEAD'],
      { cwd: repoRoot },
    );
    worktreeAdded = addResult.ok;

    if (worktreeAdded) {
      const createResult = await run('docker', [
        'create',
        '--mount',
        `type=bind,src=${worktreePath},dst=/workspace,readonly`,
        runnerImageDigest,
        'true',
      ]);
      containerId = boundedString(createResult.stdout, '');
      containerCreated = createResult.ok && containerId.length > 0;
    }
  } catch {
    worktreeAdded = false;
    containerCreated = false;
  } finally {
    if (containerId) {
      const removeContainer = await run('docker', ['rm', '-f', '--', containerId]);
      containerCleanupSucceeded = removeContainer.ok;
    }
    if (worktreeAdded && worktreePath) {
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
      && containerCleanupSucceeded
      && tempCleanupSucceeded,
  };
}

function failClosedReport({
  machineId,
  runnerImageDigest,
  observedAt,
  workerVersion,
  runnerVersion,
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
  const report = failClosedReport({
    machineId,
    runnerImageDigest,
    observedAt,
    workerVersion,
    runnerVersion,
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
    const drainMarkerPath = boundedString(
      options.drainMarkerPath ?? env.CECELIA_DRAIN_MARKER,
      DEFAULT_DRAIN_MARKER,
    );
    const makeTempDirFn = options.makeTempDirFn
      ?? (() => mkdtemp(path.join(tmpdir(), 'fleet-node-probe-')));
    const removeTempDirFn = options.removeTempDirFn
      ?? ((target) => rm(target, { recursive: true, force: true }));
    const statFn = options.statFn ?? access;
    const fetchFn = options.fetchFn ?? globalThis.fetch;

    const [
      osResult,
      orbResult,
      dockerInfoResult,
      dockerImageResult,
      gitResult,
      nodeResult,
      codexResult,
      tailscaleResult,
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
      run('orb', ['--version']),
      run('docker', ['info', '--format', '{{json .}}']),
      run('docker', ['image', 'inspect', '--format', '{{json .RepoDigests}}', commandDigest]),
      run('git', ['--version']),
      run('node', ['--version']),
      run('codex', ['--version']),
      run('tailscale', ['status', '--json']),
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
    report.tailscale.connected = tailscaleConnected(tailscaleResult);
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
