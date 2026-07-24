#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile as fsReadFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const DEFAULT_CONFIG = Object.freeze({
  broker: 'mmv',
  hosts: ['xian-m4', 'xian-m1'],
  brokerScript: '~/.local/lib/codex-slot/codex-slot-broker.mjs',
  agentScript: '~/.local/lib/codex-slot/codex-slot-agent.mjs',
});
const NON_INTERACTIVE_TIMEOUT_MS = 30_000;
const REMOTE_FIXED_PATH = '/Applications/Tailscale.app/Contents/MacOS:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const SSH_OPTIONS = Object.freeze([
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=15',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=2',
]);
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_SSH_HOST = /^[A-Za-z0-9][A-Za-z0-9._@:-]*$/;
const STATES = new Set(['running', 'stopped']);

function validateSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    throw new Error(`${label} 必须是安全的非空 segment`);
  }
  return value;
}

function validateHost(value, label = 'host') {
  if (typeof value !== 'string' || !SAFE_SSH_HOST.test(value)) {
    throw new Error(`${label} 配置无效`);
  }
  return value;
}

function validateRemoteScript(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`${label} 配置无效`);
  }
  return value;
}

function quotePosix(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function renderRemoteScript(script) {
  if (script.startsWith('~/')) {
    return `"$HOME"/${quotePosix(script.slice(2))}`;
  }
  return quotePosix(script);
}

function resolveLocalScript(script, home) {
  if (script.startsWith('~/')) {
    return join(home, script.slice(2));
  }
  if (isAbsolute(script)) {
    return script;
  }
  throw new Error('local agentScript 必须是绝对路径或 ~/ 路径');
}

function renderNodeRemoteCommand(script, args, logicalHost) {
  return [
    'env',
    `PATH=${REMOTE_FIXED_PATH}`,
    ...(logicalHost === undefined
      ? []
      : [`CODEX_SLOT_HOST=${validateHost(logicalHost)}`]),
    'node',
    renderRemoteScript(script),
    ...args.map(quotePosix),
  ].join(' ');
}

function renderTmuxAttachRemoteCommand(tmuxTarget) {
  return ['env', `PATH=${REMOTE_FIXED_PATH}`, 'tmux', 'attach-session', '-t', tmuxTarget]
    .map((value, index) => (index <= 2 ? value : quotePosix(value)))
    .join(' ');
}

export function sessionIdFor(actor, project, name) {
  validateSegment(actor, 'actor');
  validateSegment(project, 'project');
  validateSegment(name, 'name');
  const digest = createHash('sha256')
    .update(actor)
    .update('\0')
    .update(project)
    .update('\0')
    .update(name)
    .digest('hex')
    .slice(0, 32);
  return `s-${digest}`;
}

function stableHandle(actor, project, name) {
  return `${actor}/${project}/${name}`;
}

function parseHandle(value, actor) {
  if (typeof value !== 'string') {
    throw new Error('缺少 handle');
  }
  const parts = value.split('/');
  if (parts.length !== 3) {
    throw new Error('handle 必须是 actor/project/name');
  }
  const [handleActor, project, name] = parts;
  validateSegment(handleActor, 'handle actor');
  validateSegment(project, 'handle project');
  validateSegment(name, 'handle name');
  if (handleActor !== actor) {
    throw new Error('handle actor 与当前 actor 不一致');
  }
  return {
    actor,
    project,
    name,
    handle: stableHandle(actor, project, name),
    sessionId: sessionIdFor(actor, project, name),
  };
}

function rejectAuthorityFlags(argv) {
  for (const arg of argv) {
    if (/^--(?:actor|team)(?:=|$)/.test(arg)) {
      const name = arg.startsWith('--actor') ? '--actor' : '--team';
      throw new Error(`用户不允许传入 ${name}`);
    }
  }
}

function parseFlags(argv) {
  const flags = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const equalAt = arg.indexOf('=');
    const name = arg.slice(2, equalAt === -1 ? undefined : equalAt);
    if (!name || Object.hasOwn(flags, name)) {
      throw new Error(name ? `重复选项 --${name}` : '空选项无效');
    }
    if (equalAt !== -1) {
      const value = arg.slice(equalAt + 1);
      if (!value) throw new Error(`选项 --${name} 缺少值`);
      flags[name] = value;
      continue;
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

function rejectUnknownFlags(flags, allowed) {
  for (const name of Object.keys(flags)) {
    if (!allowed.has(name)) {
      throw new Error(`未知选项 --${name}`);
    }
  }
}

function noPositionals(positionals) {
  if (positionals.length > 0) {
    throw new Error(`不接受参数: ${positionals[0]}`);
  }
}

function oneOptionalPositional(positionals) {
  if (positionals.length > 1) {
    throw new Error('只接受一个 handle');
  }
  return positionals[0];
}

function oneRequiredPositional(positionals) {
  const value = oneOptionalPositional(positionals);
  if (!value) throw new Error('缺少 handle');
  return value;
}

function stringFlag(flags, name, fallback) {
  const value = flags[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`选项 --${name} 需要值`);
  }
  return value;
}

function booleanFlag(flags, name) {
  const value = flags[name];
  if (value === undefined) return false;
  if (value !== true) throw new Error(`选项 --${name} 不接受值`);
  return true;
}

function currentCwd(transport) {
  const value = typeof transport.cwd === 'function' ? transport.cwd() : transport.cwd;
  return value ?? process.cwd();
}

function currentNow(transport) {
  const value = typeof transport.now === 'function' ? transport.now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('transport now 无效');
  return date.toISOString();
}

function configuredHosts(transport) {
  const values = transport.hosts ?? transport.config?.hosts ?? DEFAULT_CONFIG.hosts;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('hosts 配置必须是非空数组');
  }
  return values.map((host) => validateHost(host));
}

async function identity(transport) {
  const result = await transport.broker(['identity']);
  if (!result || result.ok !== true) throw new Error('broker identity 失败');
  return validateSegment(result.actor, 'broker actor');
}

function brokerSessionState(session) {
  const state = session?.state ?? session?.status;
  if (!STATES.has(state)) throw new Error('server session status 无效');
  return state;
}

function expectedTmux(sessionId) {
  return `codex-slot-${sessionId}`;
}

function assertKnownSession(raw, expected, hosts) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('server session 不存在');
  }
  if (
    raw.actor !== expected.actor ||
    raw.project !== expected.project ||
    raw.name !== expected.name ||
    raw.sessionId !== expected.sessionId
  ) {
    throw new Error('server session identity 不一致');
  }
  if (raw.handle !== undefined && raw.handle !== expected.handle) {
    throw new Error('server session handle 不一致');
  }
  validateHost(raw.host, 'server host');
  if (!hosts.includes(raw.host)) {
    throw new Error('server session host 不在配置中');
  }
  const tmuxSession = raw.tmuxSession ?? expectedTmux(expected.sessionId);
  if (tmuxSession !== expectedTmux(expected.sessionId)) {
    throw new Error('server session tmux 不一致');
  }
  brokerSessionState(raw);
  return { ...raw, handle: expected.handle, tmuxSession };
}

function assertAbsolutePath(value, label) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`${label} 必须是绝对路径`);
  }
  return value;
}

function assertPrepare(result, expected, host) {
  if (
    !result ||
    result.ok !== true ||
    result.sessionId !== expected.sessionId ||
    result.actor !== expected.actor ||
    result.project !== expected.project ||
    result.name !== expected.name ||
    result.hostname !== host
  ) {
    throw new Error('agent prepare metadata 不一致');
  }
  return {
    ...result,
    codexHome: assertAbsolutePath(result.codexHome, 'prepare.codexHome'),
    worktreePath: assertAbsolutePath(result.worktreePath, 'prepare.worktreePath'),
  };
}

function assertLaunch(result, sessionId) {
  if (
    !result ||
    result.ok !== true ||
    result.sessionId !== sessionId ||
    result.tmuxSession !== expectedTmux(sessionId)
  ) {
    throw new Error('agent launch 结果不一致');
  }
  return result;
}

function assertAgentStatus(result, session, requiredState) {
  const metadata = result?.metadata;
  const tmux = result?.tmux;
  if (
    !result ||
    result.ok !== true ||
    result.sessionId !== session.sessionId ||
    result.state !== requiredState ||
    !metadata ||
    metadata.actor !== session.actor ||
    metadata.sessionId !== session.sessionId ||
    metadata.project !== session.project ||
    metadata.name !== session.name ||
    metadata.hostname !== session.host ||
    !tmux ||
    tmux.session !== session.tmuxSession
  ) {
    throw new Error('agent status session/metadata/host 不一致');
  }
  assertAbsolutePath(metadata.codexHome, 'status.metadata.codexHome');
  assertAbsolutePath(metadata.worktreePath, 'status.metadata.worktreePath');
  if (requiredState === 'running' && tmux.running !== true) {
    throw new Error('agent status 未确认 running');
  }
  if (requiredState === 'stopped' && tmux.running !== false) {
    throw new Error('agent status 未确认 stopped');
  }
  return result;
}

function leaseFrom(result, expected, host, requestId) {
  const leaseId = result?.leaseId ?? result?.lease_id;
  if (
    !result ||
    typeof leaseId !== 'string' ||
    typeof result.team !== 'string' ||
    result.actor !== expected.actor ||
    result.requestId !== requestId ||
    (result.sessionId ?? result.session) !== expected.sessionId ||
    result.host !== host ||
    result.state !== 'active'
  ) {
    throw new Error('broker acquire lease metadata 不一致');
  }
  validateSegment(leaseId, 'leaseId');
  validateSegment(result.team, 'team');
  return { leaseId, team: result.team };
}

function acquireRequestId(sessionId) {
  return `request-${validateSegment(sessionId, 'sessionId')}`;
}

async function acquireExactLease(transport, expected, host) {
  const requestId = acquireRequestId(expected.sessionId);
  const args = [
    'acquire',
    '--request',
    requestId,
    '--session',
    expected.sessionId,
    '--host',
    host,
  ];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return leaseFrom(
        await transport.broker(args),
        expected,
        host,
        requestId
      );
    } catch (error) {
      lastError = sanitizedError(error);
    }
  }
  const error = new Error(`broker acquire outcome unknown: ${lastError.message}`);
  error.preserveResources = true;
  throw error;
}

function capacityEligible(health) {
  if (!health || health.ok !== true || health.enabled !== true) return false;
  if (health.exitNodeOk !== true || typeof health.exitNode !== 'string' || !health.exitNode) return false;
  if (health.capacityAvailable !== undefined && health.capacityAvailable !== true) return false;
  if (health.availableSlots !== undefined) {
    return Number.isFinite(Number(health.availableSlots)) && Number(health.availableSlots) > 0;
  }
  if (typeof health.capacity === 'number') return health.capacity > 0;
  if (health.capacity && typeof health.capacity === 'object' && health.capacity.available !== undefined) {
    return Number(health.capacity.available) > 0;
  }
  return true;
}

function hostReady(health, host) {
  return capacityEligible(health) && health.hostname === host;
}

function assertHostReady(health, host) {
  if (!hostReady(health, host)) {
    throw new Error('没有 ok、enabled、exitNodeOk 且容量合格的 host');
  }
  return health;
}

async function selectHost(transport, hosts) {
  const results = [];
  for (const host of hosts) {
    try {
      const health = await transport.agent(host, ['health']);
      results.push({ host, health });
    } catch (error) {
      results.push({ host, error });
    }
  }
  for (const candidate of results) {
    if (hostReady(candidate.health, candidate.host)) {
      return candidate.host;
    }
  }
  throw new Error('没有 ok、enabled、exitNodeOk 且容量合格的 host');
}

function encodeSession(session) {
  return Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
}

function sameSessionCore(actual, expected) {
  return Boolean(
    actual &&
    typeof actual === 'object' &&
    !Array.isArray(actual) &&
    expected &&
    isDeepStrictEqual(actual, expected)
  );
}

function sanitizedError(error) {
  return new Error(sanitizeErrorText(error?.message ?? String(error)));
}

function registrationOutcomeUnknown() {
  const error = new Error('session-put outcome unknown; tmux and lease preserved');
  error.preserveResources = true;
  return error;
}

async function registerRunningSession(transport, expected, previous = null) {
  let mutationError;
  try {
    const response = await transport.broker([
      'session-put',
      '--json',
      encodeSession(expected),
    ]);
    if (sameSessionCore(response, expected)) return;
    mutationError = new Error('session-put response metadata 不可信');
  } catch (error) {
    mutationError = sanitizedError(error);
  }

  let readback;
  try {
    readback = await transport.broker([
      'session-get',
      '--session',
      expected.sessionId,
    ]);
  } catch {
    throw registrationOutcomeUnknown();
  }
  if (sameSessionCore(readback, expected)) return;
  if (readback === null) throw mutationError;
  if (previous && sameSessionCore(readback, previous)) throw mutationError;
  throw registrationOutcomeUnknown();
}

function registryOutcomeUnknown(phase) {
  return new Error(`${phase} outcome unknown; registry state preserved for retry`);
}

async function putSessionAndConfirm(transport, expected, phase) {
  try {
    await transport.broker([
      'session-put',
      '--json',
      encodeSession(expected),
    ]);
  } catch {
    // The write may have committed before the response was lost.
  }

  let readback;
  try {
    readback = await transport.broker([
      'session-get',
      '--session',
      expected.sessionId,
    ]);
  } catch {
    throw registryOutcomeUnknown(phase);
  }
  if (!sameSessionCore(readback, expected)) {
    throw registryOutcomeUnknown(phase);
  }
}

function leaseInfo(session) {
  const leaseId = session.leaseId ?? session.lease?.leaseId ?? null;
  const team = session.team ?? session.lease?.team ?? null;
  if ((leaseId === null) !== (team === null)) {
    throw new Error('server lease metadata 不完整');
  }
  if (leaseId !== null) {
    validateSegment(leaseId, 'leaseId');
    validateSegment(team, 'team');
  }
  return { leaseId, team };
}

function publicSession(session) {
  return {
    handle: session.handle,
    host: session.host,
    status: session.state ?? session.status,
    updatedAt: session.updatedAt ?? null,
    ...(session.worktreePath ? { worktreePath: session.worktreePath } : {}),
  };
}

async function emitResult(transport, result) {
  if (typeof transport.write === 'function') {
    await transport.write(`${JSON.stringify(result)}\n`);
  }
  return result;
}

function confirmedStopped(result, sessionId) {
  return Boolean(
    result &&
    result.ok === true &&
    result.verified === true &&
    result.sessionId === sessionId &&
    result.tmux?.running === false &&
    result.tmux?.session === expectedTmux(sessionId) &&
    (result.state === 'stopped' || result.state === 'missing')
  );
}

async function releaseLease(transport, lease, state) {
  return transport.broker([
    'release',
    '--team',
    lease.team,
    '--lease',
    lease.leaseId,
    '--state',
    state,
  ]);
}

async function releaseStoppedLease(transport, lease) {
  let result;
  try {
    result = await releaseLease(transport, lease, 'released');
  } catch (error) {
    throw sanitizedError(error);
  }
  const leaseId = result?.leaseId ?? result?.lease_id;
  if (
    !result ||
    result.team !== lease.team ||
    leaseId !== lease.leaseId ||
    result.state !== 'released'
  ) {
    throw new Error('release outcome unknown; stopped+lease preserved for retry');
  }
}

function errorWithCompensation(original, errors) {
  const error = sanitizedError(original);
  if (errors.length > 0) {
    error.message = `${error.message}; compensation: ${errors
      .map((item) => sanitizeErrorText(item.message))
      .join('; ')}`;
  }
  return error;
}

async function compensateBeforeRegistration({ transport, host, sessionId, lease, prepared }) {
  const errors = [];
  let safeToRelease = !prepared;
  if (prepared) {
    try {
      const stopped = await transport.agent(host, ['stop', '--session', sessionId]);
      safeToRelease = confirmedStopped(stopped, sessionId);
      if (!safeToRelease) errors.push(new Error('agent stop 无法确认'));
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (lease) {
    try {
      await releaseLease(transport, lease, safeToRelease ? 'released' : 'quarantined');
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return errors;
}

function makeSessionRecord({
  expected,
  host,
  lease,
  prepare,
  launch,
  previous,
  now,
}) {
  return {
    ...(previous ?? {}),
    sessionId: expected.sessionId,
    handle: expected.handle,
    actor: expected.actor,
    project: expected.project,
    name: expected.name,
    host,
    state: 'running',
    status: 'running',
    tmuxSession: launch.tmuxSession,
    codexHome: prepare.codexHome,
    worktreePath: prepare.worktreePath,
    leaseId: lease.leaseId,
    team: lease.team,
    lease: {
      leaseId: lease.leaseId,
      team: lease.team,
      state: 'active',
    },
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

async function attachRunning(transport, session) {
  const status = await transport.agent(
    session.host,
    ['status', '--session', session.sessionId]
  );
  assertAgentStatus(status, session, 'running');
  await transport.attach(session.host, `=${session.tmuxSession}`);
}

async function commandStart(flags, positionals, transport, actor, hosts) {
  rejectUnknownFlags(flags, new Set(['project', 'name']));
  noPositionals(positionals);
  const project = validateSegment(
    stringFlag(flags, 'project', basename(currentCwd(transport))),
    'project'
  );
  const name = validateSegment(stringFlag(flags, 'name', 'main'), 'name');
  const expected = {
    actor,
    project,
    name,
    handle: stableHandle(actor, project, name),
    sessionId: sessionIdFor(actor, project, name),
  };

  const duplicate = await transport.broker([
    'session-get',
    '--session',
    expected.sessionId,
  ]);
  if (duplicate !== null && duplicate !== undefined) {
    assertKnownSession(duplicate, expected, hosts);
    throw new Error(`session 已存在，请使用 resume: ${expected.handle}`);
  }

  const host = await selectHost(transport, hosts);
  let lease = null;
  let prepared = false;
  let registered = false;
  try {
    const prepare = assertPrepare(
      await transport.agent(host, [
        'prepare',
        '--session',
        expected.sessionId,
        '--actor',
        actor,
        '--project',
        project,
        '--name',
        name,
      ]),
      expected,
      host
    );
    prepared = true;
    lease = await acquireExactLease(transport, expected, host);
    await transport.broker([
      'deliver',
      '--lease',
      lease.leaseId,
      '--target',
      host,
      '--path',
      join(prepare.codexHome, 'auth.json'),
    ]);
    const launch = assertLaunch(
      await transport.agent(host, ['launch', '--session', expected.sessionId]),
      expected.sessionId
    );
    const session = makeSessionRecord({
      expected,
      host,
      lease,
      prepare,
      launch,
      now: currentNow(transport),
    });
    await registerRunningSession(transport, session);
    registered = true;
    await transport.attach(host, `=${launch.tmuxSession}`);
    return publicSession(session);
  } catch (error) {
    if (registered || error?.preserveResources === true) throw error;
    const compensation = await compensateBeforeRegistration({
      transport,
      host,
      sessionId: expected.sessionId,
      lease,
      prepared,
    });
    throw errorWithCompensation(error, compensation);
  }
}

async function selectResumeSession(transport, actor, hosts, handleValue) {
  if (handleValue) {
    const expected = parseHandle(handleValue, actor);
    const raw = await transport.broker([
      'session-get',
      '--session',
      expected.sessionId,
    ]);
    return assertKnownSession(raw, expected, hosts);
  }

  const project = validateSegment(basename(currentCwd(transport)), 'project');
  const listed = await transport.broker(['session-list']);
  if (!Array.isArray(listed)) throw new Error('broker session-list 输出无效');
  const candidates = listed
    .filter((session) => session?.actor === actor && session?.project === project)
    .map((session) => {
      const expected = parseHandle(
        session.handle ?? stableHandle(session.actor, session.project, session.name),
        actor
      );
      return assertKnownSession(session, expected, hosts);
    })
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt ?? 0).getTime();
      const bTime = new Date(b.updatedAt ?? 0).getTime();
      return bTime - aTime;
    });
  if (candidates.length === 0) {
    throw new Error(`当前 project 没有可 resume 的 session: ${project}`);
  }
  return candidates[0];
}

async function commandResume(flags, positionals, transport, actor, hosts) {
  rejectUnknownFlags(flags, new Set());
  const handleValue = oneOptionalPositional(positionals);
  const session = await selectResumeSession(transport, actor, hosts, handleValue);
  const state = brokerSessionState(session);
  const status = assertAgentStatus(
    await transport.agent(session.host, ['status', '--session', session.sessionId]),
    session,
    state
  );

  if (state === 'running') {
    await transport.attach(session.host, `=${session.tmuxSession}`);
    return publicSession(session);
  }

  const expected = {
    actor: session.actor,
    project: session.project,
    name: session.name,
    handle: session.handle,
    sessionId: session.sessionId,
  };
  let lease = null;
  let prepare = null;
  let registered = false;
  try {
    assertHostReady(
      await transport.agent(session.host, ['health']),
      session.host
    );
    prepare = assertPrepare(
      await transport.agent(session.host, [
        'prepare',
        '--session',
        session.sessionId,
        '--actor',
        session.actor,
        '--project',
        session.project,
        '--name',
        session.name,
      ]),
      expected,
      session.host
    );
    lease = await acquireExactLease(transport, expected, session.host);
    await transport.broker([
      'deliver',
      '--lease',
      lease.leaseId,
      '--target',
      session.host,
      '--path',
      join(prepare.codexHome, 'auth.json'),
    ]);
    const launch = assertLaunch(
      await transport.agent(session.host, ['launch', '--session', session.sessionId]),
      session.sessionId
    );
    const updated = makeSessionRecord({
      expected,
      host: session.host,
      lease,
      prepare,
      launch,
      previous: session,
      now: currentNow(transport),
    });
    await registerRunningSession(transport, updated, session);
    registered = true;
    await transport.attach(session.host, `=${launch.tmuxSession}`);
    return publicSession(updated);
  } catch (error) {
    if (registered || error?.preserveResources === true) throw error;
    const compensation = await compensateBeforeRegistration({
      transport,
      host: session.host,
      sessionId: session.sessionId,
      lease,
      prepared: Boolean(lease && prepare),
    });
    throw errorWithCompensation(error, compensation);
  }
}

async function commandAttach(flags, positionals, transport, actor, hosts) {
  rejectUnknownFlags(flags, new Set());
  const expected = parseHandle(oneRequiredPositional(positionals), actor);
  const raw = await transport.broker([
    'session-get',
    '--session',
    expected.sessionId,
  ]);
  const session = assertKnownSession(raw, expected, hosts);
  if (brokerSessionState(session) !== 'running') {
    throw new Error('attach 只允许 running session');
  }
  await attachRunning(transport, session);
  return publicSession(session);
}

function listedSession(session, status) {
  return {
    handle: session.handle,
    host: session.host,
    status: status?.state ?? brokerSessionState(session),
    updatedAt: session.updatedAt ?? null,
  };
}

function publicLegacy(entry, expectedHost) {
  if (!entry || typeof entry !== 'object' || entry.host !== expectedHost) {
    throw new Error('legacy-list host metadata 不一致');
  }
  return {
    handle: String(entry.handle),
    host: expectedHost,
    tmuxSession: String(entry.tmuxSession),
    running: entry.running === true,
    attached: entry.attached === true,
    lastActivity: entry.lastActivity ?? null,
  };
}

async function commandList(flags, positionals, transport, actor, hosts) {
  rejectUnknownFlags(flags, new Set(['status', 'legacy']));
  noPositionals(positionals);
  const withStatus = booleanFlag(flags, 'status');
  const withLegacy = booleanFlag(flags, 'legacy');
  const raw = await transport.broker(['session-list']);
  if (!Array.isArray(raw)) throw new Error('broker session-list 输出无效');

  const sessions = [];
  for (const item of raw) {
    if (item?.actor !== actor) continue;
    const expected = parseHandle(
      item.handle ?? stableHandle(item.actor, item.project, item.name),
      actor
    );
    const session = assertKnownSession(item, expected, hosts);
    let status = null;
    if (withStatus) {
      status = assertAgentStatus(
        await transport.agent(
          session.host,
          ['status', '--session', session.sessionId]
        ),
        session,
        brokerSessionState(session)
      );
    }
    sessions.push(listedSession(session, status));
  }

  const legacy = [];
  if (withLegacy) {
    for (const host of hosts) {
      const items = await transport.agent(host, ['legacy-list', '--host', host]);
      if (!Array.isArray(items)) throw new Error('agent legacy-list 输出无效');
      legacy.push(...items.map((entry) => publicLegacy(entry, host)));
    }
  }
  return withLegacy ? { sessions, legacy } : { sessions };
}

async function quarantineOnUnconfirmedStop(transport, session, cause) {
  const lease = leaseInfo(session);
  const errors = [];
  if (lease.leaseId) {
    try {
      await releaseLease(transport, lease, 'quarantined');
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  const original = cause instanceof Error ? cause : new Error(String(cause));
  if (!/stop|停止|unreachable/i.test(original.message)) {
    original.message = `停止无法确认: ${original.message}`;
  }
  throw errorWithCompensation(original, errors);
}

async function commandStop(flags, positionals, transport, actor, hosts) {
  rejectUnknownFlags(flags, new Set());
  const expected = parseHandle(oneRequiredPositional(positionals), actor);
  const raw = await transport.broker([
    'session-get',
    '--session',
    expected.sessionId,
  ]);
  const session = assertKnownSession(raw, expected, hosts);
  const state = brokerSessionState(session);
  const lease = leaseInfo(session);
  if (state === 'stopped' && !lease.leaseId) {
    return publicSession(session);
  }

  let stoppedWithLease = session;
  if (state === 'running') {
    let stopped;
    try {
      stopped = await transport.agent(
        session.host,
        ['stop', '--session', session.sessionId]
      );
    } catch (error) {
      return quarantineOnUnconfirmedStop(transport, session, error);
    }
    if (!confirmedStopped(stopped, session.sessionId)) {
      return quarantineOnUnconfirmedStop(
        transport,
        session,
        new Error('agent stop 无法确认停止')
      );
    }

    stoppedWithLease = {
      ...session,
      state: 'stopped',
      status: 'stopped',
      updatedAt: currentNow(transport),
    };
    await putSessionAndConfirm(
      transport,
      stoppedWithLease,
      'stop checkpoint session-put'
    );
  }

  if (lease.leaseId) {
    await releaseStoppedLease(transport, lease);
  }
  const updated = {
    ...stoppedWithLease,
    state: 'stopped',
    status: 'stopped',
    leaseId: null,
    team: null,
    lease: null,
    updatedAt: currentNow(transport),
  };
  await putSessionAndConfirm(transport, updated, 'stop clear-lease session-put');
  return publicSession(updated);
}

export async function runClient(argv, transport) {
  if (!Array.isArray(argv)) throw new Error('argv 必须是数组');
  if (
    !transport ||
    typeof transport.broker !== 'function' ||
    typeof transport.agent !== 'function' ||
    typeof transport.attach !== 'function'
  ) {
    throw new Error('transport 必须提供 broker/agent/attach');
  }
  rejectAuthorityFlags(argv);
  const [command, ...rest] = argv;
  if (!command) throw new Error('缺少命令');
  const { flags, positionals } = parseFlags(rest);
  const hosts = configuredHosts(transport);
  const actor = await identity(transport);
  let result;
  switch (command) {
    case 'start':
      result = await commandStart(flags, positionals, transport, actor, hosts);
      break;
    case 'list':
      result = await commandList(flags, positionals, transport, actor, hosts);
      break;
    case 'status':
      result = await commandList(
        { ...flags, status: true },
        positionals,
        transport,
        actor,
        hosts
      );
      break;
    case 'resume':
      result = await commandResume(flags, positionals, transport, actor, hosts);
      break;
    case 'attach':
      result = await commandAttach(flags, positionals, transport, actor, hosts);
      break;
    case 'stop':
      result = await commandStop(flags, positionals, transport, actor, hosts);
      break;
    default:
      throw new Error(`未知命令: ${command}`);
  }
  return emitResult(transport, result);
}

function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('codex-slot config 必须是 JSON object');
  }
  const config = {
    ...DEFAULT_CONFIG,
    ...raw,
    hosts: raw.hosts ?? DEFAULT_CONFIG.hosts,
  };
  validateHost(config.broker, 'broker');
  if (!Array.isArray(config.hosts) || config.hosts.length === 0) {
    throw new Error('config.hosts 必须是非空数组');
  }
  config.hosts = config.hosts.map((host) => validateHost(host));
  if (new Set(config.hosts).size !== config.hosts.length) {
    throw new Error('config.hosts 不允许重复');
  }
  if (config.localHost !== undefined) {
    config.localHost = validateHost(config.localHost, 'localHost');
    if (!config.hosts.includes(config.localHost)) {
      throw new Error('localHost 必须包含在 hosts 中');
    }
  }
  validateRemoteScript(config.brokerScript, 'brokerScript');
  validateRemoteScript(config.agentScript, 'agentScript');
  return config;
}

async function readJsonConfig(path, readFile, optional) {
  try {
    const text = await readFile(path, 'utf8');
    return normalizeConfig(JSON.parse(text));
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null;
    throw new Error(`读取配置失败 ${path}: ${error.message}`);
  }
}

export async function loadClientConfig(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const readFile = options.readFile ?? fsReadFile;
  if (env.CODEX_SLOT_CONFIG) {
    return readJsonConfig(env.CODEX_SLOT_CONFIG, readFile, false);
  }
  const userConfig = await readJsonConfig(
    join(home, '.config', 'codex-slot', 'config.json'),
    readFile,
    true
  );
  return userConfig ?? normalizeConfig({});
}

function sanitizeErrorText(value) {
  return String(value)
    .replace(/(access_token|refresh_token)(["'\s:=]+)[^\s"',}]+/gi, '$1$2[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\b/g, '[redacted-jwt]');
}

export function runProcess(cmd, args = [], options = {}) {
  const {
    timeoutMs,
    spawnImpl = spawn,
    stdio,
    ...spawnOptions
  } = options;
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    let settled = false;
    let closed = false;
    let timedOut = false;
    let stdout = '';
    let stderr = '';
    let timeoutTimer = null;
    let forceKillTimer = null;
    const onStdout = (chunk) => {
      stdout += chunk.toString();
    };
    const onStderr = (chunk) => {
      stderr += chunk.toString();
    };
    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      child?.stdout?.removeListener('data', onStdout);
      child?.stderr?.removeListener('data', onStderr);
      child?.removeListener('error', onError);
      child?.removeListener('close', onClose);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const timeoutError = () => new Error(`${cmd} timed out after ${timeoutMs}ms`);
    const onError = (error) => {
      if (!timedOut) finish(rejectPromise, error);
    };
    const onClose = (code, signal) => {
      closed = true;
      if (timedOut) {
        finish(rejectPromise, timeoutError());
        return;
      }
      if (code === 0) {
        finish(resolvePromise, { stdout, stderr, code, signal });
        return;
      }
      const detail = sanitizeErrorText(stderr.trim());
      finish(
        rejectPromise,
        new Error(detail ? `${cmd} failed: ${detail}` : `${cmd} failed`)
      );
    };

    try {
      child = spawnImpl(cmd, args, {
        ...spawnOptions,
        shell: false,
        ...(stdio ? { stdio } : {}),
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.on('error', onError);
    child.on('close', onClose);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } finally {
          if (!closed && !settled) {
            forceKillTimer = setTimeout(() => {
              if (!closed && !settled) child.kill('SIGKILL');
            }, 1000);
          }
        }
      }, timeoutMs);
    }
  });
}

function parseStrictJson(stdout, source) {
  if (typeof stdout !== 'string' || stdout.trim().length === 0) {
    throw new Error(`${source} returned empty JSON`);
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${source} returned invalid JSON: ${error.message}`);
  }
}

export async function createSshTransport(options = {}) {
  const config = options.config
    ? normalizeConfig(options.config)
    : await loadClientConfig(options);
  const home = options.home ?? homedir();
  const callerEnv = options.env ?? process.env;
  const runCommand = options.runCommand ?? runProcess;
  const runInteractive = options.runInteractive ?? runProcess;
  const command = async (host, script, args, broker = false) => {
    const sshArgs = [
      ...(broker ? ['-T'] : []),
      ...SSH_OPTIONS,
      host,
      renderNodeRemoteCommand(
        script,
        args,
        broker ? undefined : validateHost(host)
      ),
    ];
    let result;
    try {
      result = await runCommand('ssh', sshArgs, {
        timeoutMs: NON_INTERACTIVE_TIMEOUT_MS,
        shell: false,
      });
    } catch (error) {
      throw new Error(sanitizeErrorText(error.message));
    }
    return parseStrictJson(result.stdout, `${host} ${args[0]}`);
  };

  return {
    config,
    hosts: [...config.hosts],
    cwd: options.cwd ?? (() => process.cwd()),
    now: options.now ?? (() => new Date()),
    write: options.write ?? (async (text) => {
      process.stdout.write(text);
    }),
    broker: (args) => command(config.broker, config.brokerScript, args, true),
    agent: async (host, args) => {
      if (!config.hosts.includes(host)) throw new Error('agent host 不在配置中');
      if (host === config.localHost) {
        let result;
        try {
          result = await runCommand(
            'node',
            [resolveLocalScript(config.agentScript, home), ...args],
            {
              timeoutMs: NON_INTERACTIVE_TIMEOUT_MS,
              shell: false,
              env: {
                ...callerEnv,
                PATH: REMOTE_FIXED_PATH,
                CODEX_SLOT_HOST: host,
              },
            }
          );
        } catch (error) {
          throw new Error(sanitizeErrorText(error.message));
        }
        return parseStrictJson(result.stdout, `${host} ${args[0]}`);
      }
      return command(host, config.agentScript, args, false);
    },
    attach: async (host, tmuxTarget) => {
      if (!config.hosts.includes(host)) throw new Error('attach host 不在配置中');
      if (
        typeof tmuxTarget !== 'string' ||
        !/^=codex-slot-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tmuxTarget)
      ) {
        throw new Error('tmux target 必须是精确 session 名');
      }
      try {
        if (host === config.localHost) {
          return await runInteractive(
            'tmux',
            [callerEnv.TMUX ? 'switch-client' : 'attach-session', '-t', tmuxTarget],
            {
              shell: false,
              stdio: 'inherit',
              env: {
                ...callerEnv,
                PATH: REMOTE_FIXED_PATH,
              },
            }
          );
        }
        return await runInteractive(
          'ssh',
          ['-t', host, renderTmuxAttachRemoteCommand(tmuxTarget)],
          { shell: false, stdio: 'inherit' }
        );
      } catch (error) {
        throw new Error(sanitizeErrorText(error.message));
      }
    },
  };
}

async function main() {
  try {
    const transport = await createSshTransport();
    await runClient(process.argv.slice(2), transport);
  } catch (error) {
    process.stderr.write(`${sanitizeErrorText(error.message)}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  await main();
}
