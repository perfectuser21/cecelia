#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, hostname as osHostname, platform as osPlatform } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSegment, withDirLock } from './codex-slot-store.mjs';

const DEFAULT_ALLOWED_PROJECTS = ['infrastructure', 'cecelia', 'Aivideogeneration'];
const DEFAULT_MIN_FREE_GIB = 45;
const DEFAULT_MAX_USED_PERCENT = 80;
const DEFAULT_DISK_SAMPLE_MAX_AGE_MS = 30_000;
const DEFAULT_TMUX_TIMEOUT_MS = 10_000;
const DEFAULT_TAILSCALE_TIMEOUT_MS = 5_000;
const DEFAULT_EXIT_NODE = 'mmv';
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_EXIT_NODE = /^[a-z0-9](?:[a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*)?$/;
const TRUSTED_EXIT_NODE_IDENTITIES = Object.freeze({
  mmv: Object.freeze([
    Object.freeze({ hostName: 'mmv', dnsLabel: 'mmv' }),
    Object.freeze({ hostName: 'perfect21', dnsLabel: 'mac-mini-m4-us' }),
  ]),
});

const nodeFs = {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
};

function parseFlags(argv) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const name = arg.slice(2);
    if (!name) {
      throw new Error('invalid empty option');
    }
    if (Object.hasOwn(flags, name)) {
      throw new Error(`duplicate --${name}`);
    }

    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }

  return { flags, positionals };
}

function rejectPositionals(positionals) {
  if (positionals.length > 0) {
    throw new Error(`unexpected argument: ${positionals[0]}`);
  }
}

function rejectUnknownFlags(flags, allowed) {
  for (const name of Object.keys(flags)) {
    if (!allowed.has(name)) {
      throw new Error(`unknown option --${name}`);
    }
  }
}

function requireStringFlag(flags, name) {
  const value = flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing --${name}`);
  }
  return value;
}

function validateSafeSegment(value, label) {
  try {
    validateSegment(value, label);
  } catch (error) {
    throw new Error(`unsafe ${label}: ${error.message}`);
  }

  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`unsafe ${label}: must contain only letters, numbers, dot, underscore or dash`);
  }
  return value;
}

function numberConfig(deps, depKey, envKey, fallback) {
  const raw = deps[depKey] ?? process.env[envKey];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${envKey} must be a non-negative number`);
  }
  return parsed;
}

function minFreeGiB(deps) {
  return numberConfig(deps, 'minFreeGiB', 'CODEX_SLOT_MIN_FREE_GIB', DEFAULT_MIN_FREE_GIB);
}

function maxUsedPercent(deps) {
  return numberConfig(
    deps,
    'maxUsedPercent',
    'CODEX_SLOT_MAX_USED_PERCENT',
    DEFAULT_MAX_USED_PERCENT
  );
}

function diskSampleMaxAgeMs(deps) {
  return numberConfig(
    deps,
    'diskSampleMaxAgeMs',
    'CODEX_SLOT_DISK_SAMPLE_MAX_AGE_MS',
    DEFAULT_DISK_SAMPLE_MAX_AGE_MS
  );
}

function tmuxTimeoutMs(deps) {
  return numberConfig(deps, 'tmuxTimeoutMs', 'CODEX_SLOT_TMUX_TIMEOUT_MS', DEFAULT_TMUX_TIMEOUT_MS);
}

function tailscaleTimeoutMs(deps) {
  const value = deps.tailscaleTimeoutMs ?? DEFAULT_TAILSCALE_TIMEOUT_MS;
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new Error('tailscaleTimeoutMs must be a positive number');
  }
  return Number(value);
}

function expectedExitNode(deps) {
  const value = normalizeExitNodeName(
    deps.exitNode ?? process.env.CODEX_SLOT_EXIT_NODE ?? DEFAULT_EXIT_NODE
  );
  if (value === null || value === '') {
    throw new Error('CODEX_SLOT_EXIT_NODE must be a safe host or DNS name');
  }
  return value;
}

function resolveHome(deps) {
  const value = deps.home ?? homedir();
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('home must be a non-empty path');
  }
  return value;
}

function resolveFs(deps) {
  return deps.fs ?? nodeFs;
}

function resolveNow(deps) {
  const value = typeof deps.now === 'function' ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('now must be a valid date');
  }
  return date;
}

function resolveHostname(deps) {
  const value = typeof deps.hostname === 'function'
    ? deps.hostname()
    : deps.hostname ?? process.env.CODEX_SLOT_HOST ?? osHostname();
  return validateSafeSegment(value, 'hostname');
}

function resolveAllowedProjects(deps) {
  const configured = deps.allowedProjects ?? process.env.CODEX_SLOT_ALLOWED_PROJECTS;
  const values = Array.isArray(configured)
    ? configured
    : typeof configured === 'string' && configured.length > 0
      ? configured.split(',').map((value) => value.trim()).filter(Boolean)
      : DEFAULT_ALLOWED_PROJECTS;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('allowedProjects must be a non-empty array');
  }

  return new Set(values.map((project) => validateSafeSegment(project, 'project')));
}

function resolveDiskPath(deps) {
  const configured = deps.diskPath;
  if (configured !== undefined) {
    if (typeof configured !== 'string' || configured.length === 0) {
      throw new Error('diskPath must be a non-empty path');
    }
    return configured;
  }
  return (deps.platform ?? osPlatform()) === 'darwin'
    ? '/System/Volumes/Data'
    : resolveHome(deps);
}

function parsePrepare(argv) {
  const { flags, positionals } = parseFlags(argv);
  rejectPositionals(positionals);
  rejectUnknownFlags(flags, new Set(['session', 'actor', 'project', 'name']));

  return {
    sessionId: validateSafeSegment(requireStringFlag(flags, 'session'), 'session'),
    actor: validateSafeSegment(requireStringFlag(flags, 'actor'), 'actor'),
    project: validateSafeSegment(requireStringFlag(flags, 'project'), 'project'),
    name: validateSafeSegment(requireStringFlag(flags, 'name'), 'name'),
  };
}

function parseSessionOnly(argv) {
  const { flags, positionals } = parseFlags(argv);
  rejectPositionals(positionals);
  rejectUnknownFlags(flags, new Set(['session']));
  return validateSafeSegment(requireStringFlag(flags, 'session'), 'session');
}

function basePaths(deps) {
  const home = resolveHome(deps);
  return {
    home,
    slotRoot: deps.slotRoot ?? join(home, '.codex-slots'),
    repoRoot: deps.repoRoot ?? join(home, 'repos'),
    worktreeRoot: deps.worktreeRoot ?? join(home, 'worktrees'),
  };
}

function sessionPaths(deps, { actor, sessionId, project }) {
  const base = basePaths(deps);
  const slotDir = join(base.slotRoot, actor, sessionId);
  return {
    ...base,
    actorDir: join(base.slotRoot, actor),
    slotDir,
    codexHome: join(slotDir, 'codex-home'),
    launcherPath: join(slotDir, 'launcher.sh'),
    metadataPath: join(slotDir, 'metadata.json'),
    logsDir: join(slotDir, 'logs'),
    repoPath: join(base.repoRoot, project),
    worktreePath: join(base.worktreeRoot, project, sessionId),
  };
}

function tmuxSessionName(sessionId) {
  return `codex-slot-${validateSafeSegment(sessionId, 'session')}`;
}

function exactTmuxTarget(sessionName) {
  return `=${sessionName}`;
}

async function defaultRunProcess(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let forceTimer = null;
    const timeout = options.timeoutMs;
    const timer = Number.isFinite(timeout) && timeout > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        forceTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      }, timeout)
      : null;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (forceTimer) {
        clearTimeout(forceTimer);
      }
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (forceTimer) {
        clearTimeout(forceTimer);
      }
      if (timedOut) {
        reject(new Error(`process timed out: ${cmd}`));
        return;
      }
      resolve({ exitCode: exitCode ?? 0, signal, stdout, stderr });
    });
  });
}

function resolveRunProcess(deps) {
  return deps.runProcess ?? defaultRunProcess;
}

async function runProcess(deps, cmd, args, options = {}) {
  return resolveRunProcess(deps)(cmd, args, options);
}

async function lstatOrNull(fs, path) {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function pathIsWithin(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function assertNoSymlink(fs, path, label, expectedType = null) {
  const info = await lstatOrNull(fs, path);
  if (!info) {
    throw new Error(`${label} missing: ${path}`);
  }
  if (info.isSymbolicLink()) {
    throw new Error(`${label} symlink rejected: ${path}`);
  }
  if (expectedType === 'directory' && !info.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }
  if (expectedType === 'file' && !info.isFile()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
  return info;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function captureDirectoryIdentity(fs, path, label) {
  const info = await assertNoSymlink(fs, path, label, 'directory');
  return { path, label, dev: info.dev, ino: info.ino };
}

async function assertDirectoryIdentity(fs, expected) {
  const current = await assertNoSymlink(fs, expected.path, expected.label, 'directory');
  if (!sameIdentity(current, expected)) {
    throw new Error(`${expected.label} identity changed: ${expected.path}`);
  }
  return current;
}

async function assertRealPathWithin(fs, root, target, label) {
  const [realRoot, realTarget] = await Promise.all([
    fs.realpath(root),
    fs.realpath(target),
  ]);
  if (!pathIsWithin(realRoot, realTarget)) {
    throw new Error(`${label} escapes trusted root`);
  }
}

async function readJson(fs, path) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function ensurePrivateDir(fs, path) {
  const existing = await lstatOrNull(fs, path);
  if (existing?.isSymbolicLink()) {
    throw new Error(`directory symlink rejected: ${path}`);
  }
  if (existing && !existing.isDirectory()) {
    throw new Error(`path is not a directory: ${path}`);
  }
  await fs.mkdir(path, { recursive: true, mode: 0o700 });
  await fs.chmod(path, 0o700);
}

async function ensurePrivateChildDir(fs, path, label) {
  const existing = await lstatOrNull(fs, path);
  if (existing) {
    if (existing.isSymbolicLink()) {
      throw new Error(`${label} symlink rejected: ${path}`);
    }
    if (!existing.isDirectory()) {
      throw new Error(`${label} must be a directory: ${path}`);
    }
    await fs.chmod(path, 0o700);
    return captureDirectoryIdentity(fs, path, label);
  }

  try {
    await fs.mkdir(path, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`${label} appeared during creation: ${path}`);
    }
    throw error;
  }
  await fs.chmod(path, 0o700);
  return captureDirectoryIdentity(fs, path, label);
}

async function createOwnedDir(fs, path, label) {
  const existing = await lstatOrNull(fs, path);
  if (existing) {
    throw new Error(existing.isSymbolicLink()
      ? `${label} symlink rejected: ${path}`
      : `${label} ownership conflict: ${path}`);
  }
  try {
    await fs.mkdir(path, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`${label} ownership conflict: ${path}`);
    }
    throw error;
  }
  await fs.chmod(path, 0o700);
}

async function unlinkIfPresent(fs, path) {
  const info = await lstatOrNull(fs, path);
  if (!info) {
    return;
  }
  if (info.isDirectory() && !info.isSymbolicLink()) {
    throw new Error(`refusing to unlink directory: ${path}`);
  }
  await fs.unlink(path);
}

async function removeFinalEntry(fs, path) {
  const info = await lstatOrNull(fs, path);
  if (!info) {
    return;
  }
  if (info.isDirectory() && !info.isSymbolicLink()) {
    await fs.rmdir(path);
    return;
  }
  await fs.unlink(path);
}

async function atomicWriteFile(fs, path, data, mode) {
  await assertNoSymlink(fs, dirname(path), 'atomic write parent', 'directory');
  const tmpPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmpPath, data, { mode });
    await fs.chmod(tmpPath, mode);
    await fs.rename(tmpPath, path);
    await fs.chmod(path, mode);
  } catch (error) {
    await unlinkIfPresent(fs, tmpPath).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(fs, path, value) {
  await atomicWriteFile(fs, path, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

async function defaultSampleDisk(deps, diskPath) {
  const output = await runProcess(deps, 'df', ['-Pk', diskPath], { timeoutMs: 5000 });
  if (output.exitCode !== 0) {
    throw new Error(output.stderr.trim() || 'df failed');
  }

  const lines = output.stdout.trim().split(/\r?\n/);
  const values = lines.at(-1)?.trim().split(/\s+/);
  if (!values || values.length < 5) {
    throw new Error('df output missing capacity fields');
  }

  const capacityKiB = Number(values[1]);
  const availableKiB = Number(values[3]);
  const usedPercent = Number(values[4].replace(/%$/, ''));
  if (!Number.isFinite(capacityKiB) || !Number.isFinite(availableKiB) || !Number.isFinite(usedPercent)) {
    throw new Error('df output contains invalid numbers');
  }

  return {
    freeGiB: availableKiB / 1024 / 1024,
    usedPercent,
    capacity: `${(capacityKiB / 1024 / 1024).toFixed(1)}GiB`,
    sampledAt: resolveNow(deps).toISOString(),
  };
}

async function sampleDisk(deps) {
  const home = resolveHome(deps);
  const diskPath = resolveDiskPath(deps);
  if (typeof deps.sampleDisk === 'function') {
    return deps.sampleDisk({ home, diskPath, now: resolveNow(deps) });
  }
  return defaultSampleDisk(deps, diskPath);
}

function normalizeDiskSample(sample) {
  if (!sample || typeof sample !== 'object') {
    throw new Error('disk sample must be an object');
  }

  const freeGiB = Number(sample.freeGiB);
  const usedPercent = Number(sample.usedPercent);
  if (!Number.isFinite(freeGiB) || !Number.isFinite(usedPercent)) {
    throw new Error('disk sample missing freeGiB or usedPercent');
  }

  return {
    freeGiB,
    usedPercent,
    capacity: sample.capacity ?? null,
    sampledAt: sample.sampledAt ?? sample.timestamp ?? null,
    sampledAtMs: sample.sampledAtMs,
  };
}

function assertFreshDiskSample(sample, deps) {
  const now = resolveNow(deps);
  const maxAge = diskSampleMaxAgeMs(deps);
  let sampledAtMs = null;

  if (Number.isFinite(sample.sampledAtMs)) {
    sampledAtMs = sample.sampledAtMs;
  } else if (sample.sampledAt !== null && sample.sampledAt !== undefined) {
    sampledAtMs = new Date(sample.sampledAt).getTime();
  }

  if (sampledAtMs !== null) {
    if (!Number.isFinite(sampledAtMs)) {
      throw new Error('磁盘采样陈旧: invalid sampledAt');
    }
    if (now.getTime() - sampledAtMs > maxAge) {
      throw new Error('磁盘采样陈旧');
    }
  }
}

function diskEnabled(sample, deps) {
  return sample.freeGiB >= minFreeGiB(deps) && sample.usedPercent < maxUsedPercent(deps);
}

async function guardedDiskSample(deps) {
  let sample;
  try {
    sample = normalizeDiskSample(await sampleDisk(deps));
    assertFreshDiskSample(sample, deps);
  } catch (error) {
    if (/磁盘采样陈旧/.test(error.message)) {
      throw error;
    }
    throw new Error(`磁盘采样失败: ${error.message}`);
  }

  if (!diskEnabled(sample, deps)) {
    throw new Error(`磁盘容量不足: freeGiB=${sample.freeGiB}, usedPercent=${sample.usedPercent}`);
  }
  return sample;
}

function normalizeExitNodeName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase().replace(/\.+$/, '');
  if (normalized.length === 0) {
    return '';
  }
  return SAFE_EXIT_NODE.test(normalized) ? normalized : null;
}

function normalizeTailscaleStatus(raw) {
  let status = raw;
  if (Buffer.isBuffer(status)) {
    status = status.toString('utf8');
  }
  if (typeof status === 'string') {
    status = JSON.parse(status);
  }
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    throw new Error('tailscale status must be a JSON object');
  }
  return status;
}

function normalizeTailscaleIp(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  const slash = normalized.lastIndexOf('/');
  const address = slash === -1 ? normalized : normalized.slice(0, slash);
  const prefix = slash === -1 ? null : normalized.slice(slash + 1);

  if (address.includes(':')) {
    if (!/^[0-9a-f:.]+$/.test(address) || (prefix !== null && prefix !== '128')) {
      return null;
    }
    return address;
  }

  const octets = address.split('.');
  if (
    octets.length !== 4
    || octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)
    || (prefix !== null && prefix !== '32')
  ) {
    return null;
  }
  return octets.map((octet) => String(Number(octet))).join('.');
}

function normalizeTailscaleIpSet(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const normalized = values.map(normalizeTailscaleIp);
  if (normalized.some((value) => value === null)) {
    return null;
  }
  return new Set(normalized);
}

function sameNonEmptyIpSet(left, right) {
  const leftSet = normalizeTailscaleIpSet(left);
  const rightSet = normalizeTailscaleIpSet(right);
  return Boolean(
    leftSet
    && rightSet
    && leftSet.size === rightSet.size
    && Array.from(leftSet).every((ip) => rightSet.has(ip))
  );
}

function exitNodeIdentity(peer, expected) {
  const hostName = normalizeExitNodeName(peer.HostName);
  const dnsName = normalizeExitNodeName(peer.DNSName);
  if (hostName === null || dnsName === null || !dnsName) {
    return { exitNode: null, expectedMatches: false };
  }

  const dnsLabel = dnsName.split('.')[0];
  const trusted = TRUSTED_EXIT_NODE_IDENTITIES[expected];
  if (trusted?.some((identity) =>
    identity.hostName === hostName && identity.dnsLabel === dnsLabel
  )) {
    return { exitNode: expected, expectedMatches: true };
  }

  if (hostName && hostName !== dnsLabel) {
    return { exitNode: null, expectedMatches: false };
  }
  const exitNode = hostName || dnsName;
  return {
    exitNode,
    expectedMatches: expected === exitNode || expected === dnsName,
  };
}

function selectedExitNode(status, expected) {
  const peers = status.Peer;
  if (!peers || typeof peers !== 'object' || Array.isArray(peers)) {
    return { exitNode: null, exitNodeOk: false };
  }
  const selected = Object.values(peers).filter((peer) =>
    peer && typeof peer === 'object' && !Array.isArray(peer) && peer.ExitNode === true
  );
  if (selected.length !== 1) {
    return { exitNode: null, exitNodeOk: false };
  }

  const peer = selected[0];
  const { exitNode, expectedMatches } = exitNodeIdentity(peer, expected);
  if (!exitNode) {
    return { exitNode: null, exitNodeOk: false };
  }

  const exitNodeStatus = status.ExitNodeStatus;
  const peerId = typeof peer.ID === 'string' ? peer.ID : '';
  const statusId = typeof exitNodeStatus?.ID === 'string' ? exitNodeStatus.ID : '';
  const statusMatchesPeer = Boolean(
    exitNodeStatus
    && typeof exitNodeStatus === 'object'
    && !Array.isArray(exitNodeStatus)
    && exitNodeStatus.Online === true
    && peerId
    && statusId
    && peerId === statusId
    && sameNonEmptyIpSet(peer.TailscaleIPs, exitNodeStatus.TailscaleIPs)
  );

  return {
    exitNode,
    exitNodeOk: peer.Online === true && statusMatchesPeer && expectedMatches,
  };
}

async function defaultSampleTailscaleStatus(deps) {
  const result = await runProcess(
    deps,
    'tailscale',
    ['status', '--json'],
    { timeoutMs: tailscaleTimeoutMs(deps) }
  );
  if (result.exitCode !== 0) {
    throw new Error('tailscale status failed');
  }
  return result.stdout;
}

async function sampleExitNode(deps) {
  const sample = deps.sampleTailscaleStatus ?? defaultSampleTailscaleStatus;
  const status = normalizeTailscaleStatus(await sample(deps));
  return selectedExitNode(status, expectedExitNode(deps));
}

async function guardedExitNodeSample(deps) {
  let result;
  try {
    result = await sampleExitNode(deps);
  } catch {
    throw new Error('Tailscale 出口检查失败');
  }
  if (!result.exitNodeOk) {
    throw new Error(
      `Tailscale 出口不安全: expected=${expectedExitNode(deps)}, selected=${result.exitNode ?? 'none'}`
    );
  }
  return result;
}

async function health(deps) {
  const hostname = resolveHostname(deps);
  let sample = null;
  let diskError = false;
  try {
    sample = normalizeDiskSample(await sampleDisk(deps));
  } catch {
    diskError = true;
  }

  let exit = { exitNode: null, exitNodeOk: false };
  let tailscaleError = false;
  try {
    exit = await sampleExitNode(deps);
  } catch {
    tailscaleError = true;
  }

  const result = {
    ok: !diskError && !tailscaleError,
    hostname,
    freeGiB: sample?.freeGiB ?? null,
    usedPercent: sample?.usedPercent ?? null,
    capacity: sample?.capacity ?? null,
    exitNode: exit.exitNode,
    exitNodeOk: exit.exitNodeOk,
    enabled: Boolean(sample && diskEnabled(sample, deps) && exit.exitNodeOk),
  };
  if (diskError || tailscaleError) {
    result.error = [
      diskError ? '磁盘采样失败' : null,
      tailscaleError ? 'Tailscale 出口检查失败' : null,
    ].filter(Boolean).join('; ');
  }
  return result;
}

const TRUSTED_METADATA_FIELDS = [
  'actor',
  'sessionId',
  'project',
  'name',
  'branch',
  'slotDir',
  'codexHome',
  'launcherPath',
  'metadataPath',
  'logsDir',
  'worktreePath',
];

function metadataFor(deps, input, paths) {
  const now = resolveNow(deps).toISOString();
  const hostname = resolveHostname(deps);
  return {
    ok: true,
    sessionId: input.sessionId,
    actor: input.actor,
    project: input.project,
    name: input.name,
    hostname,
    branch: `slot/${input.actor}/${input.sessionId}`,
    state: 'prepared',
    createdAt: now,
    updatedAt: now,
    slotDir: paths.slotDir,
    codexHome: paths.codexHome,
    launcherPath: paths.launcherPath,
    metadataPath: paths.metadataPath,
    logsDir: paths.logsDir,
    worktreePath: paths.worktreePath,
  };
}

function assertMetadataExact(raw, expected) {
  for (const field of TRUSTED_METADATA_FIELDS) {
    if (raw[field] !== expected[field]) {
      throw new Error(`metadata trusted field mismatch: ${field}`);
    }
  }
}

async function validateMetadataPaths(fs, paths) {
  await assertNoSymlink(fs, paths.slotRoot, 'slot root', 'directory');
  await assertNoSymlink(fs, paths.actorDir, 'actor directory', 'directory');
  await assertNoSymlink(fs, paths.slotDir, 'slot directory', 'directory');
  await assertNoSymlink(fs, paths.codexHome, 'codex home', 'directory');
  await assertNoSymlink(fs, paths.metadataPath, 'metadata', 'file');
  await assertNoSymlink(fs, paths.worktreeRoot, 'worktree root', 'directory');
  await assertNoSymlink(fs, dirname(paths.worktreePath), 'worktree project directory', 'directory');
  await assertNoSymlink(fs, paths.worktreePath, 'worktree', 'directory');
  await assertRealPathWithin(fs, paths.slotRoot, paths.actorDir, 'actor directory');
  await assertRealPathWithin(fs, paths.slotRoot, paths.slotDir, 'slot directory');
  await assertRealPathWithin(fs, paths.slotRoot, paths.codexHome, 'codex home');
  await assertRealPathWithin(fs, paths.slotRoot, paths.metadataPath, 'metadata');
  await assertRealPathWithin(fs, paths.worktreeRoot, paths.worktreePath, 'worktree');
}

async function validateFoundMetadata(deps, raw, scannedActor, sessionId, metadataPath) {
  const actor = validateSafeSegment(raw.actor, 'metadata actor');
  const rawSessionId = validateSafeSegment(raw.sessionId, 'metadata session');
  const project = validateSafeSegment(raw.project, 'metadata project');
  const name = validateSafeSegment(raw.name, 'metadata name');

  if (actor !== scannedActor) {
    throw new Error('metadata ownership conflict: actor does not match scanned actor');
  }
  if (rawSessionId !== sessionId) {
    throw new Error('metadata ownership conflict: session does not exactly match requested session');
  }
  if (!resolveAllowedProjects(deps).has(project)) {
    throw new Error(`metadata project not allowed: ${project}`);
  }

  const paths = sessionPaths(deps, { actor, sessionId: rawSessionId, project });
  const expected = metadataFor(deps, {
    actor,
    sessionId: rawSessionId,
    project,
    name,
  }, paths);
  expected.createdAt = raw.createdAt;
  expected.updatedAt = raw.updatedAt;
  expected.hostname = raw.hostname;
  expected.state = raw.state;
  expected.ok = raw.ok;

  if (metadataPath !== paths.metadataPath) {
    throw new Error('metadata path does not match trusted path');
  }
  assertMetadataExact(raw, expected);
  await validateMetadataPaths(resolveFs(deps), paths);
  return { ...raw, ...Object.fromEntries(TRUSTED_METADATA_FIELDS.map((field) => [field, expected[field]])) };
}

function sessionLockPath(deps, sessionId) {
  return join(basePaths(deps).slotRoot, '.locks', `${sessionId}.lock`);
}

async function gitBranchExists(deps, repoPath, branch) {
  const result = await runProcess(
    deps,
    'git',
    ['-C', repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]
  );
  if (result.exitCode === 0) {
    return true;
  }
  if (result.exitCode === 1) {
    return false;
  }
  throw new Error(`git show-ref failed: ${result.stderr?.trim() || result.stdout?.trim() || result.exitCode}`);
}

async function rollbackPrepare(deps, fs, input, state) {
  const paths = sessionPaths(deps, input);
  const branch = `slot/${input.actor}/${input.sessionId}`;
  const cleanupErrors = [];

  if (state.worktreeOwnedByAttempt) {
    try {
      await assertDirectoryIdentity(fs, state.worktreeParentIdentity);
      const worktree = await assertNoSymlink(fs, paths.worktreePath, 'owned worktree', 'directory');
      if (!sameIdentity(worktree, state.worktreeIdentity)) {
        throw new Error(`owned worktree identity changed: ${paths.worktreePath}`);
      }
      const result = await runProcess(
        deps,
        'git',
        ['-C', paths.repoPath, 'worktree', 'remove', '--force', paths.worktreePath]
      );
      if (result.exitCode !== 0) {
        throw new Error(`git rollback failed: ${result.stderr?.trim() || result.exitCode}`);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (state.branchOwnedByAttempt) {
    try {
      const result = await runProcess(
        deps,
        'git',
        ['-C', paths.repoPath, 'branch', '-D', branch]
      );
      if (result.exitCode !== 0) {
        throw new Error(`git rollback failed: ${result.stderr?.trim() || result.exitCode}`);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (state.slotOwnedByAttempt) {
    try {
      await assertDirectoryIdentity(fs, state.actorIdentity);
      const slot = await assertNoSymlink(fs, paths.slotDir, 'owned slot', 'directory');
      if (!sameIdentity(slot, state.slotIdentity)) {
        throw new Error(`owned slot identity changed: ${paths.slotDir}`);
      }
      await unlinkIfPresent(fs, paths.metadataPath);
      await unlinkIfPresent(fs, paths.launcherPath);
      await removeFinalEntry(fs, paths.codexHome);
      await removeFinalEntry(fs, paths.logsDir);
      await fs.rmdir(paths.slotDir);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  return cleanupErrors;
}

async function prepareAgentUnlocked(input, deps) {
  const fs = resolveFs(deps);
  const paths = sessionPaths(deps, input);
  const existingMetadata = await findMetadataBySession(deps, input.sessionId);
  if (existingMetadata) {
    const expected = metadataFor(deps, input, paths);
    assertMetadataExact(existingMetadata, expected);
    return existingMetadata;
  }

  await assertNoSymlink(fs, paths.repoPath, 'repo', 'directory');
  const expected = metadataFor(deps, input, paths);
  const state = {
    slotOwnedByAttempt: false,
    worktreeOwnedByAttempt: false,
    branchOwnedByAttempt: false,
    actorIdentity: null,
    slotIdentity: null,
    worktreeParentIdentity: null,
    worktreeIdentity: null,
  };

  try {
    state.actorIdentity = await ensurePrivateChildDir(fs, paths.actorDir, 'actor directory');
    await assertDirectoryIdentity(fs, state.actorIdentity);
    await createOwnedDir(fs, paths.slotDir, 'metadata');
    state.slotIdentity = await captureDirectoryIdentity(fs, paths.slotDir, 'owned slot');
    state.slotOwnedByAttempt = true;

    await createOwnedDir(fs, paths.codexHome, 'codex home');
    await createOwnedDir(fs, paths.logsDir, 'logs directory');
    await ensurePrivateDir(fs, paths.worktreeRoot);
    state.worktreeParentIdentity = await ensurePrivateChildDir(
      fs,
      dirname(paths.worktreePath),
      'worktree project directory'
    );
    await assertDirectoryIdentity(fs, state.worktreeParentIdentity);

    const worktreeBefore = await lstatOrNull(fs, paths.worktreePath);
    if (worktreeBefore) {
      throw new Error(worktreeBefore.isSymbolicLink()
        ? 'worktree ownership conflict: symlink'
        : 'worktree ownership conflict');
    }
    if (await gitBranchExists(deps, paths.repoPath, expected.branch)) {
      throw new Error(`branch ownership conflict: ${expected.branch}`);
    }

    let git;
    let gitError = null;
    try {
      git = await runProcess(
        deps,
        'git',
        ['-C', paths.repoPath, 'worktree', 'add', '-b', expected.branch, paths.worktreePath]
      );
    } catch (error) {
      gitError = error;
    }

    if (await gitBranchExists(deps, paths.repoPath, expected.branch)) {
      state.branchOwnedByAttempt = true;
    }
    await assertDirectoryIdentity(fs, state.worktreeParentIdentity);
    const worktreeAfter = await lstatOrNull(fs, paths.worktreePath);
    if (worktreeAfter?.isSymbolicLink()) {
      throw new Error(`worktree symlink rejected: ${paths.worktreePath}`);
    }
    if (worktreeAfter?.isDirectory()) {
      state.worktreeIdentity = {
        dev: worktreeAfter.dev,
        ino: worktreeAfter.ino,
      };
      state.worktreeOwnedByAttempt = true;
    }

    if (gitError) {
      throw new Error(`git worktree add failed: ${gitError.message}`);
    }
    if (git.exitCode !== 0) {
      throw new Error(`git worktree add failed: ${git.stderr?.trim() || git.stdout?.trim() || git.exitCode}`);
    }
    if (!state.branchOwnedByAttempt || !state.worktreeOwnedByAttempt) {
      throw new Error('git worktree add did not create the expected branch and worktree');
    }

    await assertDirectoryIdentity(fs, state.actorIdentity);
    await assertDirectoryIdentity(fs, state.worktreeParentIdentity);
    await atomicWriteJson(fs, paths.metadataPath, expected);
    return expected;
  } catch (error) {
    const cleanupErrors = await rollbackPrepare(deps, fs, input, state);
    if (cleanupErrors.length > 0) {
      error.message = `${error.message}; rollback errors: ${cleanupErrors.map((item) => item.message).join('; ')}`;
    }
    throw error;
  }
}

async function withSessionLock(deps, sessionId, fn) {
  const fs = resolveFs(deps);
  const lockPath = sessionLockPath(deps, sessionId);
  await ensurePrivateDir(fs, basePaths(deps).slotRoot);
  await ensurePrivateDir(fs, dirname(lockPath));
  const lock = deps.withDirLock ?? withDirLock;
  return lock(lockPath, fn);
}

async function prepareAgent(argv, deps) {
  const input = parsePrepare(argv);
  if (!resolveAllowedProjects(deps).has(input.project)) {
    throw new Error(`project not allowed: ${input.project}`);
  }
  await guardedExitNodeSample(deps);
  await guardedDiskSample(deps);
  return withSessionLock(
    deps,
    input.sessionId,
    () => prepareAgentUnlocked(input, deps)
  );
}

async function findMetadataBySession(deps, sessionId) {
  validateSafeSegment(sessionId, 'session');
  const fs = resolveFs(deps);
  const { slotRoot } = basePaths(deps);
  let actors;

  try {
    await assertNoSymlink(fs, slotRoot, 'slot root', 'directory');
    actors = await fs.readdir(slotRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const matches = [];
  for (const actorEntry of actors) {
    const actor = actorEntry.name;
    if (actor === '.locks') {
      continue;
    }
    if (actorEntry.isSymbolicLink?.()) {
      throw new Error(`actor directory symlink rejected: ${actor}`);
    }
    if (actorEntry.isDirectory && !actorEntry.isDirectory()) {
      continue;
    }
    validateSafeSegment(actor, 'scanned actor');
    const actorPath = join(slotRoot, actor);
    await assertNoSymlink(fs, actorPath, 'actor directory', 'directory');
    await assertRealPathWithin(fs, slotRoot, actorPath, 'actor directory');
    const metadataPath = join(slotRoot, actor, sessionId, 'metadata.json');
    const metadataInfo = await lstatOrNull(fs, metadataPath);
    if (!metadataInfo) {
      continue;
    }
    if (metadataInfo.isSymbolicLink()) {
      throw new Error(`metadata symlink rejected: ${metadataPath}`);
    }
    if (!metadataInfo.isFile()) {
      throw new Error(`metadata must be a regular file: ${metadataPath}`);
    }
    const metadata = await readJson(fs, metadataPath);
    if (metadata) {
      matches.push(await validateFoundMetadata(deps, metadata, actor, sessionId, metadataPath));
    }
  }

  if (matches.length > 1) {
    throw new Error(`ambiguous session metadata: ${sessionId}`);
  }
  return matches[0] ?? null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function revalidateMetadata(deps, sessionId, previous) {
  const current = await findMetadataBySession(deps, sessionId);
  if (!current) {
    throw new Error(`metadata not found during revalidation: ${sessionId}`);
  }
  assertMetadataExact(current, previous);
  return current;
}

async function writeLauncher(fs, metadata, paths) {
  const launcher = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `export CODEX_HOME=${shellQuote(paths.codexHome)}`,
    `cd ${shellQuote(paths.worktreePath)}`,
    'exec codex',
    '',
  ].join('\n');
  await atomicWriteFile(fs, paths.launcherPath, launcher, 0o700);
}

async function hasTmuxSession(deps, sessionName) {
  const result = await runProcess(
    deps,
    'tmux',
    ['has-session', '-t', exactTmuxTarget(sessionName)],
    { timeoutMs: tmuxTimeoutMs(deps) }
  );
  if (result.exitCode === 0) {
    return true;
  }
  if (result.exitCode === 1) {
    return false;
  }
  throw new Error(
    `tmux has-session failed: ${result.stderr?.trim() || result.stdout?.trim() || result.exitCode}`
  );
}

async function tmuxPanePid(deps, sessionName) {
  const result = await runProcess(
    deps,
    'tmux',
    ['list-panes', '-F', '#{pane_pid}', '-t', exactTmuxTarget(sessionName)],
    { timeoutMs: tmuxTimeoutMs(deps) }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `tmux list-panes failed: ${result.stderr?.trim() || result.stdout?.trim() || result.exitCode}`
    );
  }
  const raw = result.stdout.trim().split(/\r?\n/)[0];
  const pid = Number(raw);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`tmux list-panes returned invalid pane pid: ${raw || '<empty>'}`);
  }
  return pid;
}

async function launchAgentUnlocked(sessionId, deps) {
  let metadata = await findMetadataBySession(deps, sessionId);
  if (!metadata) {
    throw new Error(`metadata not found: ${sessionId}`);
  }

  const fs = resolveFs(deps);
  metadata = await revalidateMetadata(deps, sessionId, metadata);
  let paths = sessionPaths(deps, metadata);
  await writeLauncher(fs, metadata, paths);
  metadata = await revalidateMetadata(deps, sessionId, metadata);
  paths = sessionPaths(deps, metadata);

  const sessionName = tmuxSessionName(sessionId);
  const alreadyRunning = await hasTmuxSession(deps, sessionName);
  if (!alreadyRunning) {
    const launched = await runProcess(
      deps,
      'tmux',
      ['new-session', '-d', '-s', sessionName, '/bin/bash', paths.launcherPath],
      { timeoutMs: tmuxTimeoutMs(deps) }
    );
    const runningAfterLaunch = await hasTmuxSession(deps, sessionName);
    if (!runningAfterLaunch && launched.exitCode === 0) {
      throw new Error(`tmux launch did not stay running: ${sessionName}`);
    }
    if (!runningAfterLaunch) {
      throw new Error(`tmux new-session failed: ${launched.stderr?.trim() || launched.stdout?.trim() || launched.exitCode}`);
    }
  }

  return {
    ok: true,
    sessionId,
    tmuxSession: sessionName,
    launcherPath: paths.launcherPath,
    alreadyRunning,
  };
}

async function launchAgent(argv, deps) {
  const sessionId = parseSessionOnly(argv);
  return withSessionLock(
    deps,
    sessionId,
    () => launchAgentUnlocked(sessionId, deps)
  );
}

async function statusAgentUnlocked(sessionId, deps) {
  const sessionName = tmuxSessionName(sessionId);
  const metadata = await findMetadataBySession(deps, sessionId);
  if (!metadata) {
    return {
      ok: true,
      sessionId,
      state: 'missing',
      metadata: null,
      tmux: { running: false, session: sessionName, pid: null },
    };
  }

  const running = await hasTmuxSession(deps, sessionName);
  const pid = running ? await tmuxPanePid(deps, sessionName) : null;
  return {
    ok: true,
    sessionId,
    state: running ? 'running' : 'stopped',
    metadata,
    tmux: { running, session: sessionName, pid },
  };
}

async function statusAgent(argv, deps) {
  const sessionId = parseSessionOnly(argv);
  return withSessionLock(
    deps,
    sessionId,
    () => statusAgentUnlocked(sessionId, deps)
  );
}

async function removeAllowlistedHeartbeat(fs, path) {
  const info = await lstatOrNull(fs, path);
  if (!info) {
    return;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    await fs.unlink(path);
    return;
  }
  await removeFinalEntry(fs, join(path, 'lease.json'));
  await fs.rmdir(path);
}

async function removeTransientState(fs, paths) {
  for (const path of [
    join(paths.codexHome, 'auth.json'),
    join(paths.codexHome, 'auth.json.tmp'),
    join(paths.codexHome, 'auth.json.new'),
    join(paths.codexHome, 'lease.json'),
  ]) {
    await removeFinalEntry(fs, path);
  }
  for (const path of [
    join(paths.codexHome, 'lease-heartbeat'),
    join(paths.slotDir, 'lease-heartbeat'),
  ]) {
    await removeAllowlistedHeartbeat(fs, path);
  }
}

async function stopTmuxSession(deps, sessionName) {
  if (!await hasTmuxSession(deps, sessionName)) {
    return;
  }

  const killed = await runProcess(
    deps,
    'tmux',
    ['kill-session', '-t', exactTmuxTarget(sessionName)],
    { timeoutMs: tmuxTimeoutMs(deps) }
  );
  if (killed.exitCode !== 0) {
    throw new Error(
      `tmux kill-session failed: ${killed.stderr?.trim() || killed.stdout?.trim() || killed.exitCode}`
    );
  }
  if (await hasTmuxSession(deps, sessionName)) {
    throw new Error('tmux session still running after kill-session');
  }
}

async function stopAgentUnlocked(sessionId, deps) {
  const sessionName = tmuxSessionName(sessionId);
  let metadata = await findMetadataBySession(deps, sessionId);
  await stopTmuxSession(deps, sessionName);

  if (!metadata) {
    return {
      ok: true,
      sessionId,
      state: 'missing',
      stopped: false,
      verified: true,
      tmux: { running: false, session: sessionName, pid: null },
    };
  }

  const fs = resolveFs(deps);
  metadata = await revalidateMetadata(deps, sessionId, metadata);
  const paths = sessionPaths(deps, metadata);
  await removeTransientState(fs, paths);

  return {
    ok: true,
    sessionId,
    state: 'stopped',
    stopped: true,
    verified: true,
    tmux: { running: false, session: sessionName, pid: null },
  };
}

async function stopAgent(argv, deps) {
  const sessionId = parseSessionOnly(argv);
  return withSessionLock(
    deps,
    sessionId,
    () => stopAgentUnlocked(sessionId, deps)
  );
}

async function legacyList(argv, deps) {
  const { flags, positionals } = parseFlags(argv);
  rejectPositionals(positionals);
  rejectUnknownFlags(flags, new Set(['host']));

  const host = validateSafeSegment(
    flags.host === undefined
      ? (deps.legacyHost ?? 'us-m4')
      : requireStringFlag(flags, 'host'),
    'legacy host'
  );
  const entries = new Map(Array.from({ length: 10 }, (_, index) => {
    const slot = `slot${index + 1}`;
    return [slot, {
      handle: `legacy/${host}/${slot}`,
      host,
      tmuxSession: slot,
      running: false,
      attached: false,
      lastActivity: null,
    }];
  }));

  try {
    const listed = await runProcess(
      deps,
      'tmux',
      ['list-sessions', '-F', '#S\t#{session_attached}\t#{session_activity}'],
      { timeoutMs: tmuxTimeoutMs(deps) }
    );
    if (listed.exitCode === 0) {
      for (const line of listed.stdout.trim().split(/\r?\n/).filter(Boolean)) {
        const [name, attached, activity] = line.split('\t');
        const entry = entries.get(name);
        if (entry) {
          entry.running = true;
          entry.attached = Number(attached) > 0;
          entry.lastActivity = Number.isFinite(Number(activity)) ? Number(activity) : null;
        }
      }
    }
  } catch {
    return Array.from(entries.values());
  }

  return Array.from(entries.values());
}

export async function runAgent(argv, deps = {}) {
  if (!Array.isArray(argv)) {
    throw new Error('argv must be an array');
  }
  const [command, ...rest] = argv;
  if (!command) {
    throw new Error('missing command');
  }

  switch (command) {
    case 'health': {
      const { flags, positionals } = parseFlags(rest);
      rejectPositionals(positionals);
      rejectUnknownFlags(flags, new Set());
      return health(deps);
    }
    case 'prepare':
      return prepareAgent(rest, deps);
    case 'launch':
      return launchAgent(rest, deps);
    case 'status':
      return statusAgent(rest, deps);
    case 'stop':
      return stopAgent(rest, deps);
    case 'legacy-list':
      return legacyList(rest, deps);
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

async function main() {
  try {
    const result = await runAgent(process.argv.slice(2), {});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  await main();
}
