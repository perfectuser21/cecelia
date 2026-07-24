#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  open as fsOpen,
  readFile as fsReadFile,
  readdir,
  rm,
  stat as fsStat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireLease,
  getSession,
  heartbeatLease,
  listSessions,
  putSession,
  releaseLease,
  validateSegment,
  withDirLock,
} from './codex-slot-store.mjs';

const DEFAULT_ACTOR_MAP = { administrator: 'alex' };
const DEFAULT_TEAMS = ['team1', 'team2', 'team3', 'team4', 'team5'];
const DEFAULT_MIN_REMAINING_SECONDS = 172_800;
const DEFAULT_ADMIN_USERS = ['administrator'];
const DEFAULT_DELIVER_TIMEOUT_MS = 30_000;
const SSH_DELIVER_OPTIONS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=15',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=2',
];
const SAFE_REMOTE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const USABLE_THRESHOLD = 90;

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
      throw new Error('duplicate option');
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
    throw new Error('unexpected argument');
  }
}

function rejectUnknownFlags(flags, allowed) {
  for (const name of Object.keys(flags)) {
    if (!allowed.has(name)) {
      throw new Error('unknown option');
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

function optionalStringFlag(flags, name, fallback) {
  const value = flags[name];
  if (value === undefined || value === true) {
    return fallback;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid --${name}`);
  }
  return value;
}

function parseJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed;
}

function resolveHome(deps) {
  return deps.home ?? homedir();
}

function resolveRoot(deps, home) {
  return deps.root ?? process.env.CODEX_SLOT_ROOT ?? join(home, '.codex-slot');
}

function resolveActorMap(deps) {
  if (deps.actorMap) {
    return {
      ...DEFAULT_ACTOR_MAP,
      ...deps.actorMap,
    };
  }

  return {
    ...DEFAULT_ACTOR_MAP,
    ...parseJsonEnv('CODEX_SLOT_ACTOR_MAP_JSON'),
  };
}

function resolveAdminUsers(deps) {
  const adminUsers = deps.adminUsers ?? DEFAULT_ADMIN_USERS;
  if (!Array.isArray(adminUsers)) {
    throw new Error('adminUsers must be an array');
  }
  for (const user of adminUsers) {
    if (typeof user !== 'string' || user.length === 0) {
      throw new Error('adminUsers must contain non-empty users');
    }
  }
  return new Set(adminUsers);
}

function resolveUser(deps) {
  return deps.user ?? process.env.CODEX_SLOT_USER ?? process.env.USER ?? process.env.LOGNAME;
}

function resolveIdentity(deps) {
  const user = resolveUser(deps);
  if (typeof user !== 'string' || user.length === 0) {
    throw new Error('unknown user');
  }

  const actorMap = resolveActorMap(deps);
  const actor = actorMap[user];
  if (typeof actor !== 'string' || actor.length === 0) {
    throw new Error(`unknown user: ${user}`);
  }

  validateSegment(actor, 'actor');
  return { user, actor };
}

function resolveNow(deps) {
  const value = typeof deps.now === 'function' ? deps.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('now must be a valid date');
  }
  return date;
}

function minRemainingSeconds(deps) {
  const value = deps.minRemainingSeconds ?? process.env.CODEX_MIN_REMAINING_SECONDS;
  if (value === undefined || value === '') {
    return DEFAULT_MIN_REMAINING_SECONDS;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('CODEX_MIN_REMAINING_SECONDS must be a non-negative number');
  }
  return parsed;
}

function defaultHostRegistry(home) {
  return {
    'xian-m4': { slotRoot: join(home, '.codex-slots'), sshHost: 'xian-m4' },
    'xian-m1': { slotRoot: join(home, '.codex-slots'), sshHost: 'xian-m1' },
  };
}

function validateHostRegistry(registry, label) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error(`${label} must be a JSON object`);
  }
  for (const [host, entry] of Object.entries(registry)) {
    validateSegment(host, 'host');
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${label} entry must be a JSON object`);
    }
    if (typeof entry.slotRoot !== 'string' || !isAbsolute(entry.slotRoot)) {
      throw new Error(`${label} slotRoot must be an absolute path`);
    }
    assertSafeRemoteSegment(entry.sshHost, `${label} sshHost`);
  }
  return registry;
}

async function readHostRegistryFile(path, deps, required) {
  try {
    const readFile = deps.readHostRegistryFile ?? fsReadFile;
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return validateHostRegistry(parsed, 'host registry file');
  } catch (error) {
    if (!required && error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function resolveHostRegistry(deps, home) {
  if (deps.hostRegistry) {
    return validateHostRegistry(deps.hostRegistry, 'hostRegistry');
  }
  if (process.env.CODEX_SLOT_HOST_REGISTRY_JSON) {
    const parsed = JSON.parse(process.env.CODEX_SLOT_HOST_REGISTRY_JSON);
    return validateHostRegistry(parsed, 'CODEX_SLOT_HOST_REGISTRY_JSON');
  }

  const configuredPath = deps.hostRegistryPath
    ?? process.env.CODEX_SLOT_HOST_REGISTRY_FILE;
  if (configuredPath) {
    return readHostRegistryFile(configuredPath, deps, true);
  }

  const bundledPath = join(
    dirname(fileURLToPath(import.meta.url)),
    'broker-hosts.json'
  );
  const bundledRegistry = await readHostRegistryFile(bundledPath, deps, false);
  if (bundledRegistry) {
    return bundledRegistry;
  }
  return validateHostRegistry(defaultHostRegistry(home), 'default host registry');
}

function authPathFor(home, team) {
  return join(home, `.codex-${team}`, 'auth.json');
}

function leasePathFor(root, team) {
  return join(root, 'registry', 'leases', `${validateSegment(team, 'team')}.json`);
}

function leaseLockPathFor(root, team) {
  return join(root, 'locks', `lease-${validateSegment(team, 'team')}.lock`);
}

function sessionLockPathFor(root, sessionId) {
  return join(root, 'locks', `session-${validateSegment(sessionId, 'sessionId')}.lock`);
}

function getAccessToken(auth) {
  return auth?.access_token
    ?? auth?.accessToken
    ?? auth?.tokens?.access_token
    ?? auth?.tokens?.accessToken;
}

function getAccountId(auth) {
  return auth?.account_id
    ?? auth?.accountId
    ?? auth?.tokens?.account_id
    ?? auth?.tokens?.accountId;
}

function decodeJwtPayload(token) {
  if (typeof token !== 'string') {
    throw new Error('missing access token');
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('access token must be JWT');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

function jwtRemainingSeconds(token, now) {
  const payload = decodeJwtPayload(token);
  if (!Number.isFinite(payload.exp)) {
    throw new Error('access token JWT missing exp');
  }
  return payload.exp - Math.floor(now.getTime() / 1000);
}

async function defaultQueryUsage({ auth }) {
  const accessToken = getAccessToken(auth);
  const accountId = getAccountId(auth);
  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
    },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error('usage query failed');
  }

  const body = await response.json();
  return {
    usedPercent: body?.rate_limit?.primary_window?.used_percent ?? 100,
  };
}

async function inspectTeam({ team, home, readFile, stat, queryUsage, now, minRemaining }) {
  const authPath = authPathFor(home, team);

  let authStat;
  try {
    authStat = await stat(authPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    return null;
  }

  if ((authStat.mode & 0o777) !== 0o600) {
    return null;
  }

  let auth;
  try {
    auth = JSON.parse(await readFile(authPath, 'utf8'));
    const accessToken = getAccessToken(auth);
    if (jwtRemainingSeconds(accessToken, now) < minRemaining) {
      return null;
    }
  } catch {
    return null;
  }

  let usage;
  try {
    usage = await queryUsage({ team, auth, authPath });
  } catch {
    return null;
  }

  const usedPercent = Number(usage?.usedPercent);
  if (!Number.isFinite(usedPercent) || usedPercent >= USABLE_THRESHOLD) {
    return null;
  }

  return { team, usedPercent };
}

async function collectUsableTeams({ home, deps, now }) {
  const readFile = deps.readFile ?? fsReadFile;
  const stat = deps.stat ?? fsStat;
  const queryUsage = deps.queryUsage ?? defaultQueryUsage;
  const minRemaining = minRemainingSeconds(deps);

  const inspected = await Promise.all(
    DEFAULT_TEAMS.map((team) => inspectTeam({
      team,
      home,
      readFile,
      stat,
      queryUsage,
      now,
      minRemaining,
    }))
  );

  return inspected
    .filter(Boolean)
    .sort((a, b) => a.usedPercent - b.usedPercent)
    .map((candidate) => candidate.team);
}

async function readJson(path) {
  try {
    return JSON.parse(await fsReadFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readValidatedAuthBytesForDeliver({ authPath, deps, now }) {
  const open = deps.open ?? fsOpen;
  const handle = await open(authPath, 'r');
  try {
    const authStat = await handle.stat();
    if ((authStat.mode & 0o777) !== 0o600) {
      throw new Error('auth mode must be 0600');
    }

    const bytes = await handle.readFile();
    const auth = JSON.parse(bytes.toString('utf8'));
    const remaining = jwtRemainingSeconds(getAccessToken(auth), now);
    if (remaining < minRemainingSeconds(deps)) {
      throw new Error('auth token expires too soon');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function writeDeliverySnapshot({ root, bytes }) {
  const tmpRoot = join(root, 'tmp');
  await mkdir(tmpRoot, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(tmpRoot, 'deliver-'));
  const source = join(dir, 'auth.json');
  try {
    await writeFile(source, bytes, { mode: 0o600 });
    return { dir, source };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function leaseIdOf(lease) {
  return lease?.leaseId ?? lease?.lease_id;
}

function sessionIdOf(lease) {
  return lease?.sessionId ?? lease?.session;
}

async function defaultLoadLease({ root, leaseId }) {
  validateSegment(leaseId, 'leaseId');
  let entries;
  try {
    entries = await readdir(join(root, 'registry', 'leases'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const lease = await readJson(join(root, 'registry', 'leases', entry));
    if (lease && leaseIdOf(lease) === leaseId) {
      return lease;
    }
  }
  return null;
}

async function loadLease({ root, leaseId, deps }) {
  const loader = deps.loadLease ?? defaultLoadLease;
  const lease = await loader({ root, leaseId });
  if (!lease) {
    throw new Error('lease not found');
  }
  return lease;
}

async function loadCurrentLeaseForTeam({ root, team, leaseId, deps }) {
  if (deps.loadLease) {
    return loadLease({ root, leaseId, deps });
  }
  const lease = await readJson(leasePathFor(root, team));
  if (!lease) {
    throw new Error(`lease not found for team ${team}`);
  }
  return lease;
}

function assertLeaseMatches({ lease, leaseId, actor, team, requireActive = true }) {
  if (leaseIdOf(lease) !== leaseId) {
    throw new Error('leaseId mismatch');
  }
  if (team !== undefined && lease.team !== team) {
    throw new Error('lease team mismatch');
  }
  if (lease.actor !== actor) {
    throw new Error('lease actor mismatch');
  }
  if (requireActive && lease.state !== 'active') {
    throw new Error('lease is not active');
  }
}

function assertKnownHost(hostRegistry, host, label) {
  validateSegment(host, label);
  const entry = hostRegistry[host];
  if (!entry || typeof entry !== 'object') {
    throw new Error(`unknown ${label} host`);
  }
  if (typeof entry.slotRoot !== 'string' || entry.slotRoot.length === 0) {
    throw new Error(`${label} host missing slotRoot`);
  }
  return entry;
}

function assertInsideSlotRoot(path, slotRoot) {
  if (!isAbsolute(path)) {
    throw new Error('path must be an absolute path');
  }

  const normalizedPath = resolve(path);
  const normalizedRoot = resolve(slotRoot);
  const rel = relative(normalizedRoot, normalizedPath);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return normalizedPath;
  }
  throw new Error('path outside host slotRoot');
}

function assertSafeRemoteSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_REMOTE_SEGMENT.test(value)) {
    throw new Error(`${label} must match [A-Za-z0-9._-]+`);
  }
  return value;
}

function expectedDeliverPath(slotRoot, lease) {
  const actor = assertSafeRemoteSegment(lease.actor, 'actor');
  const sessionId = assertSafeRemoteSegment(sessionIdOf(lease), 'sessionId');
  return resolve(join(slotRoot, actor, sessionId, 'codex-home', 'auth.json'));
}

function assertExactDeliverPath({ rawPath, normalizedPath, slotRoot, lease }) {
  const expectedPath = expectedDeliverPath(slotRoot, lease);
  if (rawPath !== expectedPath || normalizedPath !== expectedPath) {
    throw new Error('deliver path mismatch');
  }
  return expectedPath;
}

export function quotePosixShell(value) {
  if (typeof value !== 'string') {
    throw new Error('shell value must be a string');
  }
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildDeliverCommands({ sshHost, source, path, mode }) {
  if (!Number.isInteger(mode) || mode < 0) {
    throw new Error('mode must be an integer');
  }
  const modeText = mode.toString(8);
  const quotedPath = quotePosixShell(path);
  return [
    {
      cmd: 'scp',
      args: [
        ...SSH_DELIVER_OPTIONS,
        '-p',
        source,
        `${sshHost}:${quotedPath}`,
      ],
    },
    {
      cmd: 'ssh',
      args: [
        ...SSH_DELIVER_OPTIONS,
        sshHost,
        `chmod ${modeText} ${quotedPath}`,
      ],
    },
  ];
}

export function runProcess(cmd, args, options = {}) {
  const { timeoutMs, ...spawnOptions } = options;
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
  ) {
    throw new Error('timeoutMs must be a positive number');
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...spawnOptions,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutTimer = null;
    let forceKillTimer = null;

    function clearTimers() {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimers();
      rejectPromise(error);
    });
    if (timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
        }
        forceKillTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, 1_000);
        forceKillTimer.unref?.();
      }, timeoutMs);
      timeoutTimer.unref?.();
    }
    child.once('close', (code, signal) => {
      clearTimers();
      if (timedOut) {
        rejectPromise(new Error(`${cmd} timed out after ${timeoutMs}ms`));
        return;
      }
      if (code === 0 && signal === null) {
        resolvePromise({ stdout, stderr });
        return;
      }
      const details = stderr.trim();
      rejectPromise(new Error(details ? `${cmd} failed: ${details}` : `${cmd} failed`));
    });
  });
}

export function makeDefaultDeliverAuth(hostRegistry, options = {}) {
  const execute = options.runProcess ?? runProcess;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DELIVER_TIMEOUT_MS;
  return async ({ source, target, path, mode }) => {
    const entry = hostRegistry[target];
    const sshHost = entry?.sshHost ?? entry?.host ?? target;
    for (const command of buildDeliverCommands({ sshHost, source, path, mode })) {
      await execute(command.cmd, command.args, { timeoutMs });
    }
  };
}

function parseBase64UrlJson(encoded) {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

async function writeOutput(result, deps) {
  if (typeof deps.write === 'function') {
    await deps.write(`${JSON.stringify(result)}\n`);
  }
}

async function commandIdentity({ deps }) {
  const { user, actor } = resolveIdentity(deps);
  return { ok: true, user, actor };
}

async function commandAcquire({ flags, positionals, deps, root, home, hostRegistry }) {
  rejectPositionals(positionals);
  if (flags.actor !== undefined) {
    throw new Error('不允许客户端指定 actor');
  }
  if (flags.team !== undefined) {
    throw new Error('不允许手工选择 team');
  }
  rejectUnknownFlags(flags, new Set(['session', 'host', 'request']));

  const sessionId = assertSafeRemoteSegment(requireStringFlag(flags, 'session'), 'sessionId');
  const requestId = assertSafeRemoteSegment(
    optionalStringFlag(flags, 'request', sessionId),
    'requestId'
  );
  const host = requireStringFlag(flags, 'host');
  assertKnownHost(hostRegistry, host, 'host');
  const { actor } = resolveIdentity(deps);
  assertSafeRemoteSegment(actor, 'actor');
  const now = resolveNow(deps);
  const accounts = await collectUsableTeams({ home, deps, now });
  try {
    return await acquireLease({
      root,
      actor,
      requestId,
      sessionId,
      host,
      accounts,
      lookupAccounts: DEFAULT_TEAMS,
      now: now.toISOString(),
    });
  } catch (error) {
    if (accounts.length === 0 && error?.message === 'no available lease') {
      throw new Error('no usable account');
    }
    throw error;
  }
}

async function commandDeliver({ flags, positionals, deps, root, home, hostRegistry }) {
  rejectPositionals(positionals);
  rejectUnknownFlags(flags, new Set(['lease', 'target', 'path']));

  const requestedLeaseId = requireStringFlag(flags, 'lease');
  const target = requireStringFlag(flags, 'target');
  const destinationPath = requireStringFlag(flags, 'path');
  const targetEntry = assertKnownHost(hostRegistry, target, 'target');
  const normalizedPath = assertInsideSlotRoot(destinationPath, targetEntry.slotRoot);
  const { actor } = resolveIdentity(deps);
  const lease = await loadLease({ root, leaseId: requestedLeaseId, deps });
  assertLeaseMatches({ lease, leaseId: requestedLeaseId, actor });
  if (lease.host !== target) {
    throw new Error('lease host mismatch');
  }
  assertExactDeliverPath({
    rawPath: destinationPath,
    normalizedPath,
    slotRoot: targetEntry.slotRoot,
    lease,
  });

  const team = validateSegment(lease.team, 'team');
  const deliverAuth = deps.deliverAuth ?? makeDefaultDeliverAuth(hostRegistry);

  return withDirLock(leaseLockPathFor(root, team), async () => {
    const currentLease = await loadCurrentLeaseForTeam({
      root,
      team,
      leaseId: requestedLeaseId,
      deps,
    });
    assertLeaseMatches({
      lease: currentLease,
      leaseId: requestedLeaseId,
      actor,
      team,
    });
    if (currentLease.host !== target) {
      throw new Error('lease host mismatch');
    }
    const exactPath = assertExactDeliverPath({
      rawPath: destinationPath,
      normalizedPath,
      slotRoot: targetEntry.slotRoot,
      lease: currentLease,
    });

    const authPath = authPathFor(home, currentLease.team);
    const bytes = await readValidatedAuthBytesForDeliver({
      authPath,
      deps,
      now: resolveNow(deps),
    });
    const snapshot = await writeDeliverySnapshot({ root, bytes });
    try {
      await deliverAuth({
        source: snapshot.source,
        target,
        path: exactPath,
        mode: 0o600,
      });
    } finally {
      await rm(snapshot.dir, { recursive: true, force: true });
    }

    return { ok: true, team: currentLease.team, target };
  });
}

async function commandHeartbeat({ flags, positionals, deps, root }) {
  rejectPositionals(positionals);
  rejectUnknownFlags(flags, new Set(['team', 'lease']));

  const team = requireStringFlag(flags, 'team');
  const requestedLeaseId = requireStringFlag(flags, 'lease');
  const { actor } = resolveIdentity(deps);
  const lease = await loadLease({ root, leaseId: requestedLeaseId, deps });
  assertLeaseMatches({ lease, leaseId: requestedLeaseId, actor, team });

  return heartbeatLease({
    root,
    team,
    leaseId: requestedLeaseId,
    now: resolveNow(deps).toISOString(),
  });
}

async function commandRelease({ flags, positionals, deps, root }) {
  rejectPositionals(positionals);
  rejectUnknownFlags(flags, new Set(['team', 'lease', 'state']));

  const team = requireStringFlag(flags, 'team');
  const requestedLeaseId = requireStringFlag(flags, 'lease');
  const state = optionalStringFlag(flags, 'state', 'released');
  const { actor } = resolveIdentity(deps);
  const lease = await loadLease({ root, leaseId: requestedLeaseId, deps });
  assertLeaseMatches({
    lease,
    leaseId: requestedLeaseId,
    actor,
    team,
    requireActive: false,
  });

  return releaseLease({
    root,
    team,
    leaseId: requestedLeaseId,
    state,
    now: resolveNow(deps).toISOString(),
  });
}

async function commandSessionPut({ flags, positionals, deps, root }) {
  rejectPositionals(positionals);
  rejectUnknownFlags(flags, new Set(['json']));

  const { actor } = resolveIdentity(deps);
  const payload = parseBase64UrlJson(requireStringFlag(flags, 'json'));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('session JSON must be an object');
  }
  if (payload.actor !== undefined && payload.actor !== actor) {
    throw new Error('session actor mismatch');
  }
  assertSafeRemoteSegment(actor, 'actor');
  const sessionId = assertSafeRemoteSegment(payload.sessionId, 'sessionId');

  return withDirLock(sessionLockPathFor(root, sessionId), async () => {
    const existing = await getSession({
      root,
      sessionId,
    });
    if (existing && existing.actor !== actor) {
      throw new Error('existing session actor mismatch');
    }

    return putSession({
      root,
      session: {
        ...payload,
        sessionId,
        actor,
      },
    });
  });
}

async function commandSessionGet({ flags, positionals, deps, root }) {
  rejectPositionals(positionals);
  rejectUnknownFlags(flags, new Set(['session']));

  const { actor } = resolveIdentity(deps);
  const session = await getSession({
    root,
    sessionId: requireStringFlag(flags, 'session'),
  });
  if (!session || session.actor !== actor) {
    return null;
  }
  return session;
}

async function commandSessionList({ flags, positionals, deps, root }) {
  rejectPositionals(positionals);
  rejectUnknownFlags(flags, new Set(['admin']));

  const { user, actor } = resolveIdentity(deps);
  const admin = flags.admin === true || flags.admin === 'true';
  if (admin && !resolveAdminUsers(deps).has(user)) {
    throw new Error('admin access denied');
  }
  return listSessions({
    root,
    actor,
    admin,
  });
}

export async function runBroker(argv, deps = {}) {
  if (!Array.isArray(argv)) {
    throw new Error('argv must be an array');
  }

  const command = argv[0];
  const { flags, positionals } = parseFlags(argv.slice(1));
  const home = resolveHome(deps);
  const root = resolveRoot(deps, home);
  const hostRegistry = await resolveHostRegistry(deps, home);
  let result;

  if (command === 'identity') {
    result = await commandIdentity({ deps });
  } else if (command === 'acquire') {
    result = await commandAcquire({ flags, positionals, deps, root, home, hostRegistry });
  } else if (command === 'deliver') {
    result = await commandDeliver({ flags, positionals, deps, root, home, hostRegistry });
  } else if (command === 'heartbeat') {
    result = await commandHeartbeat({ flags, positionals, deps, root });
  } else if (command === 'release') {
    result = await commandRelease({ flags, positionals, deps, root });
  } else if (command === 'session-put') {
    result = await commandSessionPut({ flags, positionals, deps, root });
  } else if (command === 'session-get') {
    result = await commandSessionGet({ flags, positionals, deps, root });
  } else if (command === 'session-list') {
    result = await commandSessionList({ flags, positionals, deps, root });
  } else {
    throw new Error('unknown command');
  }

  await writeOutput(result, deps);
  return result;
}

function sanitizeCliError(error) {
  const message = error?.message ?? String(error);
  return message.replace(/access_token|refresh_token/gi, '[redacted]');
}

async function main() {
  try {
    const result = await runBroker(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${sanitizeCliError(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
