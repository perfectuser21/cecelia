import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  createSshTransport,
  loadClientConfig,
  runClient,
  runProcess,
  sessionIdFor,
} from './codex-slot-client.mjs';

const CLIENT_PATH = resolve('scripts/codex-slot-client.mjs');
const ENTRY_PATH = resolve('scripts/codex-slot');
const REMOTE_FIXED_PATH = '/Applications/Tailscale.app/Contents/MacOS:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function decodeSessionPut(args) {
  return JSON.parse(Buffer.from(option(args, 'json'), 'base64url').toString('utf8'));
}

function remoteShellInvocation(remoteCommand, executable) {
  const collector = [
    'env() {',
    '  while [ "$#" -gt 0 ]; do',
    '    case "$1" in',
    '      *=*) printf "ENVARG=%s\\n" "$1"; shift ;;',
    '      *) break ;;',
    '    esac',
    '  done;',
    '  printf "UTILITY=%s\\n" "$1";',
    '  shift;',
    '  for arg do printf "ARG=%s\\n" "$arg"; done',
    '}',
    remoteCommand,
  ].join('\n');
  const result = spawnSync('/bin/sh', ['-c', collector], {
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME ?? '',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trimEnd().split('\n');
  const env = {};
  while (lines[0]?.startsWith('ENVARG=')) {
    const assignment = lines.shift().slice('ENVARG='.length);
    const separator = assignment.indexOf('=');
    assert.notEqual(separator, -1);
    env[assignment.slice(0, separator)] = assignment.slice(separator + 1);
  }
  const utility = lines.shift();
  assert.equal(utility, `UTILITY=${executable}`);
  return {
    env,
    envPath: env.PATH,
    utility: utility.slice('UTILITY='.length),
    argv: lines.map((line) => {
      assert.match(line, /^ARG=/);
      return line.slice('ARG='.length);
    }),
  };
}

function remoteShellArgv(remoteCommand, executable) {
  return remoteShellInvocation(remoteCommand, executable).argv;
}

async function writeFakeRemoteExecutable(dir, name) {
  const path = join(dir, name);
  await writeFile(
    path,
    [
      '#!/bin/sh',
      `printf 'UTILITY=%s\\n' '${name}'`,
      'printf "INHERITED_PATH=%s\\n" "$PATH"',
      'printf "INHERITED_CODEX_SLOT_HOST=%s\\n" "${CODEX_SLOT_HOST-unset}"',
      'for arg do printf "ARG=%s\\n" "$arg"; done',
      '',
    ].join('\n'),
    'utf8'
  );
  await chmod(path, 0o755);
}

async function runRemoteWithFakeExecutable(t, remoteCommand, executable, initialPath) {
  const root = await mkdtemp(join(tmpdir(), 'codex-slot-remote-path-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const bin = join(root, 'bin');
  await mkdir(bin, { recursive: true });
  await writeFakeRemoteExecutable(bin, executable);
  const collector = [
    'env() {',
    '  remote_path=;',
    '  logical_host=;',
    '  logical_host_set=0;',
    '  while [ "$#" -gt 0 ]; do',
    '    case "$1" in',
    '      PATH=*) remote_path="${1#PATH=}" ;;',
    '      CODEX_SLOT_HOST=*) logical_host="${1#CODEX_SLOT_HOST=}"; logical_host_set=1 ;;',
    '      *=*) printf "bad env assignment: %s\\n" "$1" >&2; return 64 ;;',
    '      *) break ;;',
    '    esac',
    '    shift;',
    '  done;',
    '  utility="$1";',
    '  shift;',
    '  if [ "$logical_host_set" -eq 1 ]; then',
    '    PATH="$remote_path" CODEX_SLOT_HOST="$logical_host" "$FAKE_BIN/$utility" "$@";',
    '  else',
    '    PATH="$remote_path" "$FAKE_BIN/$utility" "$@";',
    '  fi',
    '}',
    remoteCommand,
  ].join('\n');
  const result = spawnSync('/bin/sh', ['-c', collector], {
    encoding: 'utf8',
    env: {
      FAKE_BIN: bin,
      HOME: process.env.HOME ?? '',
      PATH: initialPath,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.shift(), `UTILITY=${executable}`);
  const inherited = lines.shift();
  assert.equal(inherited, `INHERITED_PATH=${REMOTE_FIXED_PATH}`);
  const inheritedHost = lines.shift();
  assert.match(inheritedHost, /^INHERITED_CODEX_SLOT_HOST=/);
  return {
    inheritedHost: inheritedHost.slice('INHERITED_CODEX_SLOT_HOST='.length),
    argv: lines.map((line) => {
      assert.match(line, /^ARG=/);
      return line.slice('ARG='.length);
    }),
  };
}

function runningSession(overrides = {}) {
  const actor = overrides.actor ?? 'alex';
  const project = overrides.project ?? 'infrastructure';
  const name = overrides.name ?? 'main';
  const sessionId = overrides.sessionId ?? sessionIdFor(actor, project, name);
  const host = overrides.host ?? 'xian-m4';
  return {
    sessionId,
    handle: `${actor}/${project}/${name}`,
    actor,
    project,
    name,
    host,
    state: 'running',
    status: 'running',
    tmuxSession: `codex-slot-${sessionId}`,
    codexHome: `/Users/${actor}/.codex-slots/${actor}/${sessionId}/codex-home`,
    worktreePath: `/Users/${actor}/worktrees/${project}/${sessionId}`,
    leaseId: 'lease-existing',
    team: 'team3',
    createdAt: '2026-07-23T01:00:00.000Z',
    updatedAt: '2026-07-23T02:00:00.000Z',
    ...overrides,
  };
}

function agentStatus(session, overrides = {}) {
  return {
    ok: true,
    sessionId: session.sessionId,
    state: session.state,
    metadata: {
      actor: session.actor,
      sessionId: session.sessionId,
      project: session.project,
      name: session.name,
      hostname: session.host,
      codexHome: session.codexHome,
      worktreePath: session.worktreePath,
    },
    tmux: {
      running: session.state === 'running',
      session: session.tmuxSession,
      pid: session.state === 'running' ? 4321 : null,
    },
    ...overrides,
  };
}

function makeTransport(options = {}) {
  const calls = [];
  const output = [];
  const sessions = new Map(
    (options.sessions ?? []).map((session) => [session.sessionId, { ...session }])
  );
  const actor = options.actor ?? 'alex';
  const hosts = options.hosts ?? ['xian-m4', 'xian-m1'];
  let leaseCounter = 0;

  const transport = {
    calls,
    output,
    sessions,
    hosts,
    cwd: options.cwd ?? '/repo/infrastructure',
    now: options.now ?? (() => new Date('2026-07-23T03:00:00.000Z')),
    write: async (text) => output.push(text),
    broker: async (args) => {
      const command = args[0];
      calls.push({ op: command, args: [...args] });
      if (options.broker) {
        const overridden = await options.broker(args, { calls, sessions, actor });
        if (overridden !== undefined) return overridden;
      }
      switch (command) {
        case 'identity':
          return { ok: true, user: 'administrator', actor };
        case 'session-get':
          return sessions.get(option(args, 'session')) ?? null;
        case 'session-list':
          return Array.from(sessions.values());
        case 'acquire':
          leaseCounter += 1;
          return {
            leaseId: `lease-${leaseCounter}`,
            team: leaseCounter === 1 ? 'team2' : 'team4',
            actor,
            requestId: option(args, 'request'),
            sessionId: option(args, 'session'),
            host: option(args, 'host'),
            state: 'active',
          };
        case 'deliver':
          return { ok: true, team: 'team2', target: option(args, 'target') };
        case 'session-put': {
          const session = decodeSessionPut(args);
          sessions.set(session.sessionId, session);
          return session;
        }
        case 'release':
          return {
            ok: true,
            team: option(args, 'team'),
            leaseId: option(args, 'lease'),
            state: option(args, 'state') ?? 'released',
          };
        default:
          throw new Error(`unexpected broker command: ${command}`);
      }
    },
    agent: async (host, args) => {
      const command = args[0];
      calls.push({ op: `${command}:${host}`, host, args: [...args] });
      if (options.agent) {
        const overridden = await options.agent(host, args, { calls, sessions, actor });
        if (overridden !== undefined) return overridden;
      }
      const sessionId = option(args, 'session');
      const session = sessions.get(sessionId);
      switch (command) {
        case 'health':
          return {
            ok: true,
            hostname: host,
            enabled: host === 'xian-m4',
            exitNode: 'mmv',
            exitNodeOk: true,
            availableSlots: host === 'xian-m4' ? 1 : 0,
          };
        case 'prepare':
          return {
            ok: true,
            sessionId,
            actor,
            project: option(args, 'project'),
            name: option(args, 'name'),
            hostname: host,
            codexHome: `/Users/${actor}/.codex-slots/${actor}/${sessionId}/codex-home`,
            worktreePath: `/Users/${actor}/worktrees/${option(args, 'project')}/${sessionId}`,
          };
        case 'launch':
          return {
            ok: true,
            sessionId,
            tmuxSession: `codex-slot-${sessionId}`,
            alreadyRunning: false,
          };
        case 'status':
          return agentStatus(session);
        case 'stop':
          return {
            ok: true,
            sessionId,
            state: 'stopped',
            stopped: true,
            verified: true,
            tmux: { running: false, session: `codex-slot-${sessionId}`, pid: null },
          };
        case 'legacy-list':
          return [{
            handle: `legacy/${host}/slot1`,
            host,
            tmuxSession: 'slot1',
            running: true,
            attached: false,
            lastActivity: 123,
          }];
        default:
          throw new Error(`unexpected agent command: ${command}`);
      }
    },
    attach: async (host, tmuxTarget) => {
      calls.push({ op: `attach:${host}`, host, tmuxTarget });
      if (options.attach) return options.attach(host, tmuxTarget, { calls, sessions });
      return { ok: true };
    },
  };
  return transport;
}

test('session id is a deterministic safe segment derived from actor/project/name', () => {
  const first = sessionIdFor('alex', 'infrastructure', 'main');
  assert.equal(first, sessionIdFor('alex', 'infrastructure', 'main'));
  assert.notEqual(first, sessionIdFor('alex', 'infrastructure', 'other'));
  assert.match(first, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.doesNotMatch(first, /alex|infrastructure|main/);
});

test('start checks identity, duplicate, every host health then orchestrates in plan order', async () => {
  const transport = makeTransport();
  const result = await runClient(
    ['start', '--project', 'infrastructure', '--name', 'main'],
    transport
  );

  assert.deepEqual(transport.calls.map((call) => call.op), [
    'identity',
    'session-get',
    'health:xian-m4',
    'health:xian-m1',
    'prepare:xian-m4',
    'acquire',
    'deliver',
    'launch:xian-m4',
    'session-put',
    'attach:xian-m4',
  ]);
  assert.equal(result.handle, 'alex/infrastructure/main');
  assert.equal(result.host, 'xian-m4');
  assert.equal(result.status, 'running');

  const prepared = transport.calls[4].args;
  const acquiredSession = option(transport.calls[5].args, 'session');
  assert.equal(option(prepared, 'actor'), 'alex');
  assert.equal(option(prepared, 'session'), acquiredSession);
  assert.equal(option(prepared, 'project'), 'infrastructure');
  assert.equal(option(prepared, 'name'), 'main');

  const delivered = transport.calls[6].args;
  assert.equal(option(delivered, 'target'), 'xian-m4');
  assert.equal(
    option(delivered, 'path'),
    `/Users/alex/.codex-slots/alex/${acquiredSession}/codex-home/auth.json`
  );
  assert.equal(
    transport.calls.at(-1).tmuxTarget,
    `=codex-slot-${acquiredSession}`
  );
});

test('start prepare failure happens before lease acquisition or token delivery', async () => {
  const transport = makeTransport({
    agent: async (_host, args) => {
      if (args[0] === 'prepare') {
        throw new Error('Tailscale 出口不安全 on second sample');
      }
      return undefined;
    },
  });

  await assert.rejects(
    runClient(['start', '--project', 'infrastructure'], transport),
    /Tailscale 出口不安全/
  );
  assert.deepEqual(transport.calls.map(({ op }) => op), [
    'identity',
    'session-get',
    'health:xian-m4',
    'health:xian-m1',
    'prepare:xian-m4',
  ]);
  assert.equal(transport.calls.some(({ op }) => op === 'acquire'), false);
  assert.equal(transport.calls.some(({ op }) => op === 'deliver'), false);
  assert.equal(transport.calls.some(({ op }) => op === 'release'), false);
});

test('start preserves prepared resources when acquire outcome is unknown', async () => {
  const transport = makeTransport({
    broker: async (args) => {
      if (args[0] === 'acquire') throw new Error('broker unavailable');
      return undefined;
    },
  });

  await assert.rejects(
    runClient(['start', '--project', 'infrastructure'], transport),
    /broker acquire outcome unknown/
  );
  assert.equal(transport.calls.filter(({ op }) => op === 'acquire').length, 2);
  assert.equal(transport.calls.some(({ op }) => op.startsWith('stop:')), false);
  assert.equal(transport.calls.some(({ op }) => op === 'deliver'), false);
  assert.equal(transport.calls.some(({ op }) => op === 'release'), false);
});

test('start selects first configured ok enabled host with available capacity', async () => {
  const transport = makeTransport({
    agent: async (host, args) => {
      if (args[0] !== 'health') return undefined;
      return {
        ok: true,
        hostname: host,
        enabled: true,
        exitNode: 'mmv',
        exitNodeOk: true,
        availableSlots: host === 'xian-m4' ? 0 : 2,
      };
    },
  });

  await runClient(['start', '--project', 'infrastructure'], transport);
  assert.equal(option(transport.calls.find((call) => call.op === 'acquire').args, 'host'), 'xian-m1');
  assert.ok(transport.calls.some((call) => call.op === 'prepare:xian-m1'));
});

test('start prepares the logical health alias before acquiring its lease', async () => {
  const transport = makeTransport({
    agent: async (host, args) => {
      if (args[0] !== 'health') return undefined;
      return {
        ok: true,
        hostname: host,
        enabled: host === 'xian-m4',
        exitNode: 'mmv',
        exitNodeOk: true,
        availableSlots: host === 'xian-m4' ? 1 : 0,
      };
    },
  });

  await runClient(['start', '--project', 'infrastructure', '--name', 'main'], transport);

  const operations = transport.calls.map((call) => call.op);
  const prepareIndex = operations.indexOf('prepare:xian-m4');
  assert.notEqual(prepareIndex, -1);
  assert.equal(operations.indexOf('acquire'), prepareIndex + 1);
});

test('start health-checks every host and never acquires when exit-node contract is unsafe', async () => {
  const transport = makeTransport({
    agent: async (host, args) => {
      if (args[0] !== 'health') return undefined;
      return {
        ok: true,
        hostname: host,
        enabled: true,
        exitNode: host === 'xian-m4' ? 'china-gateway' : 'mmv',
        exitNodeOk: false,
        availableSlots: 1,
      };
    },
  });

  await assert.rejects(
    runClient(['start', '--project', 'infrastructure'], transport),
    /没有.*host/
  );
  assert.deepEqual(transport.calls.map(({ op }) => op), [
    'identity',
    'session-get',
    'health:xian-m4',
    'health:xian-m1',
  ]);
});

test('start rejects legacy health without explicit exitNodeOk before acquire or deliver', async () => {
  const transport = makeTransport({
    hosts: ['xian-m4'],
    agent: async (host, args) => {
      if (args[0] !== 'health') return undefined;
      return {
        ok: true,
        hostname: host,
        enabled: true,
        availableSlots: 1,
      };
    },
  });

  await assert.rejects(
    runClient(['start', '--project', 'infrastructure'], transport),
    /没有.*host/
  );
  assert.equal(transport.calls.some(({ op }) => op === 'acquire'), false);
  assert.equal(transport.calls.some(({ op }) => op === 'deliver'), false);
});

test('start and stopped resume recover one exact lease after the first acquire response is lost', async () => {
  const stopped = runningSession({
    state: 'stopped',
    status: 'stopped',
    leaseId: null,
    team: null,
  });
  for (const scenario of [
    { argv: ['start', '--project', 'infrastructure'], sessions: [] },
    { argv: ['resume', stopped.handle], sessions: [stopped] },
  ]) {
    let acquired = null;
    const transport = makeTransport({
      sessions: scenario.sessions,
      broker: async (args, { actor }) => {
        if (args[0] !== 'acquire') return undefined;
        if (!acquired) {
          acquired = {
            leaseId: 'lease-response-lost',
            team: 'team2',
            actor,
            requestId: option(args, 'request'),
            sessionId: option(args, 'session'),
            host: option(args, 'host'),
            state: 'active',
          };
          throw new Error('acquire response lost');
        }
        return acquired;
      },
    });

    const result = await runClient(scenario.argv, transport);
    assert.equal(result.status, 'running');
    const acquireCalls = transport.calls.filter((call) => call.op === 'acquire');
    assert.equal(acquireCalls.length, 2);
    assert.equal(
      option(acquireCalls[0].args, 'request'),
      option(acquireCalls[1].args, 'request')
    );
    assert.equal(option(acquireCalls[0].args, 'session'), acquired.sessionId);
    assert.equal(transport.calls.some((call) => call.op === 'release'), false);
  }
});

test('start launch failure compensates with agent stop then released lease', async () => {
  const transport = makeTransport({
    agent: async (_host, args) => {
      if (args[0] === 'launch') throw new Error('tmux failed');
      return undefined;
    },
  });

  await assert.rejects(
    runClient(['start', '--project', 'infrastructure'], transport),
    /tmux failed/
  );
  assert.deepEqual(transport.calls.slice(-2).map((call) => call.op), [
    'stop:xian-m4',
    'release',
  ]);
  assert.equal(option(transport.calls.at(-1).args, 'state'), 'released');
  assert.equal(transport.calls.some((call) => call.op === 'session-put'), false);
});

test('start quarantines lease when compensation cannot confirm agent stopped', async () => {
  const transport = makeTransport({
    agent: async (_host, args) => {
      if (args[0] === 'launch') throw new Error('launch failed');
      if (args[0] === 'stop') throw new Error('agent unreachable');
      return undefined;
    },
  });

  await assert.rejects(
    runClient(['start', '--project', 'infrastructure'], transport),
    /launch failed/
  );
  const release = transport.calls.at(-1);
  assert.equal(release.op, 'release');
  assert.equal(option(release.args, 'state'), 'quarantined');
});

test('start compensation rejects a stopped response for the wrong exact tmux session', async () => {
  const transport = makeTransport({
    agent: async (_host, args) => {
      if (args[0] === 'launch') throw new Error('launch failed');
      if (args[0] === 'stop') {
        return {
          ok: true,
          sessionId: option(args, 'session'),
          state: 'stopped',
          stopped: true,
          tmux: {
            running: false,
            session: 'codex-slot-s-cross-wired',
            pid: null,
          },
        };
      }
      return undefined;
    },
  });

  await assert.rejects(
    runClient(['start', '--project', 'infrastructure'], transport),
    /launch failed/
  );
  const release = transport.calls.at(-1);
  assert.equal(release.op, 'release');
  assert.equal(option(release.args, 'state'), 'quarantined');
  assert.equal(transport.calls.some((call) => call.op === 'session-put'), false);
});

test('start attach failure preserves registered running session and active lease', async () => {
  const transport = makeTransport({
    attach: async () => {
      throw new Error('interactive ssh disconnected');
    },
  });

  await assert.rejects(
    runClient(['start', '--project', 'infrastructure'], transport),
    /interactive ssh disconnected/
  );
  const registeredIndex = transport.calls.findIndex((call) => call.op === 'session-put');
  assert.ok(registeredIndex >= 0);
  assert.deepEqual(
    transport.calls.slice(registeredIndex + 1).map((call) => call.op),
    ['attach:xian-m4']
  );
  assert.equal(Array.from(transport.sessions.values())[0].state, 'running');
});

test('start and stopped resume attach when lost session-put response is confirmed by exact readback', async () => {
  const stopped = runningSession({
    state: 'stopped',
    status: 'stopped',
    leaseId: null,
    team: null,
  });
  for (const scenario of [
    { argv: ['start', '--project', 'infrastructure'], sessions: [] },
    { argv: ['resume', stopped.handle], sessions: [stopped] },
  ]) {
    let putResponseLost = false;
    const transport = makeTransport({
      sessions: scenario.sessions,
      broker: async (args, { sessions }) => {
        if (args[0] === 'session-put') {
          const stored = decodeSessionPut(args);
          sessions.set(stored.sessionId, stored);
          putResponseLost = true;
          throw new Error('session-put response lost');
        }
        return undefined;
      },
    });

    const result = await runClient(scenario.argv, transport);
    assert.equal(result.status, 'running');
    const putIndex = transport.calls.findIndex((call) => call.op === 'session-put');
    assert.deepEqual(
      transport.calls.slice(putIndex, putIndex + 3).map((call) => call.op),
      ['session-put', 'session-get', 'attach:xian-m4']
    );
    assert.equal(putResponseLost, true);
    assert.equal(transport.calls.some((call) => call.op.startsWith('stop:')), false);
    assert.equal(transport.calls.some((call) => call.op === 'release'), false);
  }
});

test('failed running registration compensates only after null or exact old-stopped readback', async () => {
  const stopped = runningSession({
    state: 'stopped',
    status: 'stopped',
    leaseId: null,
    team: null,
  });
  for (const scenario of [
    { argv: ['start', '--project', 'infrastructure'], sessions: [] },
    { argv: ['resume', stopped.handle], sessions: [stopped] },
  ]) {
    let putFailed = false;
    const transport = makeTransport({
      sessions: scenario.sessions,
      broker: async (args) => {
        if (args[0] === 'session-put') {
          putFailed = true;
          throw new Error('session-put rejected before write');
        }
        return undefined;
      },
    });

    await assert.rejects(runClient(scenario.argv, transport), /session-put rejected/);
    const putIndex = transport.calls.findIndex((call) => call.op === 'session-put');
    assert.deepEqual(
      transport.calls.slice(putIndex).map((call) => call.op),
      ['session-put', 'session-get', 'stop:xian-m4', 'release']
    );
    assert.equal(putFailed, true);
    assert.equal(option(transport.calls.at(-1).args, 'state'), 'released');
  }
});

test('unknown running registration readback preserves tmux and lease and redacts errors', async () => {
  const stopped = runningSession({
    state: 'stopped',
    status: 'stopped',
    leaseId: null,
    team: null,
  });
  for (const scenario of [
    {
      argv: ['start', '--project', 'infrastructure'],
      sessions: [],
      readback: 'unreachable',
    },
    {
      argv: ['resume', stopped.handle],
      sessions: [stopped],
      readback: 'untrusted',
    },
  ]) {
    let afterPut = false;
    const transport = makeTransport({
      sessions: scenario.sessions,
      broker: async (args, { sessions }) => {
        if (args[0] === 'session-put') {
          const expected = decodeSessionPut(args);
          afterPut = true;
          if (scenario.readback === 'untrusted') {
            sessions.set(expected.sessionId, { ...expected, team: 'team5' });
          }
          throw new Error('network access_token=registration-secret');
        }
        if (args[0] === 'session-get' && afterPut && scenario.readback === 'unreachable') {
          throw new Error('readback refresh_token=readback-secret');
        }
        return undefined;
      },
    });

    let error;
    try {
      await runClient(scenario.argv, transport);
      assert.fail('expected unknown registration outcome');
    } catch (caught) {
      error = caught;
    }
    assert.match(error.message, /outcome unknown/);
    assert.doesNotMatch(error.message, /registration-secret|readback-secret/);
    assert.equal(transport.calls.some((call) => call.op.startsWith('stop:')), false);
    assert.equal(transport.calls.some((call) => call.op === 'release'), false);
    assert.equal(transport.calls.some((call) => call.op.startsWith('attach:')), false);
  }
});

test('running registration rejects readback whose authoritative status differs', async () => {
  let afterPut = false;
  const transport = makeTransport({
    broker: async (args, { sessions }) => {
      if (args[0] === 'session-put') {
        const expected = decodeSessionPut(args);
        sessions.set(expected.sessionId, { ...expected, status: 'stopped' });
        afterPut = true;
        throw new Error('session-put response lost');
      }
      if (args[0] === 'session-get' && afterPut) {
        return sessions.get(option(args, 'session'));
      }
      return undefined;
    },
  });

  await assert.rejects(
    runClient(['start', '--project', 'infrastructure'], transport),
    /outcome unknown/
  );
  assert.equal(transport.calls.some((call) => call.op.startsWith('stop:')), false);
  assert.equal(transport.calls.some((call) => call.op === 'release'), false);
  assert.equal(transport.calls.some((call) => call.op.startsWith('attach:')), false);
});

test('all commands reject user supplied actor or team before transport calls', async () => {
  for (const argv of [
    ['start', '--project', 'infrastructure', '--actor', 'alex'],
    ['list', '--team=team1'],
    ['resume', '--actor=coworker'],
    ['attach', 'alex/infrastructure/main', '--team', 'team1'],
    ['stop', 'alex/infrastructure/main', '--actor'],
  ]) {
    const transport = makeTransport();
    await assert.rejects(runClient(argv, transport), /--(?:actor|team).*不允许|不允许.*--(?:actor|team)/);
    assert.equal(transport.calls.length, 0);
  }
});

test('resume without handle selects current actor project by most recent updatedAt', async () => {
  const older = runningSession({
    name: 'older',
    sessionId: sessionIdFor('alex', 'infrastructure', 'older'),
    updatedAt: '2026-07-23T01:00:00.000Z',
  });
  const newer = runningSession({
    name: 'newer',
    sessionId: sessionIdFor('alex', 'infrastructure', 'newer'),
    updatedAt: '2026-07-23T02:00:00.000Z',
  });
  const otherProject = runningSession({
    project: 'cecelia',
    sessionId: sessionIdFor('alex', 'cecelia', 'main'),
    updatedAt: '2026-07-23T03:00:00.000Z',
  });
  const transport = makeTransport({
    sessions: [older, newer, otherProject],
    cwd: '/repo/infrastructure',
  });

  const result = await runClient(['resume'], transport);
  assert.equal(result.handle, newer.handle);
  assert.equal(
    option(transport.calls.find((call) => call.op === 'status:xian-m4').args, 'session'),
    newer.sessionId
  );
  assert.equal(transport.calls.at(-1).op, 'attach:xian-m4');
});

test('resume running validates agent status and directly attaches without lease or health mutation', async () => {
  const session = runningSession();
  const transport = makeTransport({
    sessions: [session],
    agent: async (_host, args) => {
      if (args[0] === 'health') throw new Error('health must not gate running resume');
      return undefined;
    },
  });
  await runClient(['resume', session.handle], transport);

  assert.deepEqual(transport.calls.map((call) => call.op), [
    'identity',
    'session-get',
    'status:xian-m4',
    'attach:xian-m4',
  ]);
  assert.equal(transport.calls.at(-1).tmuxTarget, `=${session.tmuxSession}`);
});

test('resume stopped health-checks fixed home host, idempotently prepares, then reacquires', async () => {
  const session = runningSession({
    host: 'xian-m1',
    state: 'stopped',
    status: 'stopped',
    leaseId: null,
    team: null,
  });
  const transport = makeTransport({
    sessions: [session],
    agent: async (host, args) => {
      if (args[0] !== 'health') return undefined;
      return {
        ok: true,
        hostname: host,
        enabled: true,
        exitNode: 'mmv',
        exitNodeOk: true,
        availableSlots: 1,
      };
    },
  });
  const result = await runClient(['resume', session.handle], transport);

  assert.deepEqual(transport.calls.map((call) => call.op), [
    'identity',
    'session-get',
    'status:xian-m1',
    'health:xian-m1',
    'prepare:xian-m1',
    'acquire',
    'deliver',
    'launch:xian-m1',
    'session-put',
    'attach:xian-m1',
  ]);
  const prepared = transport.calls[4].args;
  assert.equal(option(prepared, 'actor'), session.actor);
  assert.equal(option(prepared, 'session'), session.sessionId);
  assert.equal(option(prepared, 'project'), session.project);
  assert.equal(option(prepared, 'name'), session.name);
  assert.equal(option(transport.calls[5].args, 'host'), 'xian-m1');
  assert.equal(
    option(transport.calls[6].args, 'path'),
    `/Users/alex/.codex-slots/alex/${session.sessionId}/codex-home/auth.json`
  );
  assert.equal(result.status, 'running');
});

test('resume stopped rejects unsafe or legacy health before prepare, acquire, or deliver', async () => {
  const session = runningSession({
    state: 'stopped',
    status: 'stopped',
    leaseId: null,
    team: null,
  });
  for (const health of [
    {
      ok: true,
      hostname: session.host,
      enabled: true,
      availableSlots: 1,
    },
    {
      ok: true,
      hostname: session.host,
      enabled: true,
      exitNode: 'china-gateway',
      exitNodeOk: false,
      availableSlots: 1,
    },
    {
      ok: true,
      hostname: session.host,
      enabled: true,
      exitNode: 'mmv',
      exitNodeOk: true,
      availableSlots: 0,
    },
  ]) {
    const transport = makeTransport({
      sessions: [session],
      agent: async (_host, args) => {
        if (args[0] === 'health') return health;
        return undefined;
      },
    });

    await assert.rejects(
      runClient(['resume', session.handle], transport),
      /没有.*host/
    );
    assert.deepEqual(transport.calls.map((call) => call.op), [
      'identity',
      'session-get',
      'status:xian-m4',
      'health:xian-m4',
    ]);
    assert.equal(transport.calls.some((call) => call.op.startsWith('prepare:')), false);
    assert.equal(transport.calls.some((call) => call.op === 'acquire'), false);
    assert.equal(transport.calls.some((call) => call.op === 'deliver'), false);
  }
});

test('resume stopped prepare failure happens before lease acquisition or token delivery', async () => {
  const session = runningSession({
    state: 'stopped',
    status: 'stopped',
    leaseId: null,
    team: null,
  });
  const transport = makeTransport({
    sessions: [session],
    agent: async (_host, args) => {
      if (args[0] === 'prepare') throw new Error('Tailscale 出口不安全 on second sample');
      return undefined;
    },
  });

  await assert.rejects(
    runClient(['resume', session.handle], transport),
    /Tailscale 出口不安全/
  );
  assert.deepEqual(transport.calls.map((call) => call.op), [
    'identity',
    'session-get',
    'status:xian-m4',
    'health:xian-m4',
    'prepare:xian-m4',
  ]);
  assert.equal(transport.calls.some((call) => call.op === 'acquire'), false);
  assert.equal(transport.calls.some((call) => call.op === 'deliver'), false);
  assert.equal(transport.calls.some((call) => call.op === 'release'), false);
});

test('resume and attach fail closed on cross actor, unreachable host, or metadata mismatch', async () => {
  const session = runningSession();
  const crossActor = makeTransport({ sessions: [session] });
  await assert.rejects(
    runClient(['resume', 'coworker/infrastructure/main'], crossActor),
    /actor.*不一致|handle.*actor/
  );
  assert.deepEqual(crossActor.calls.map((call) => call.op), ['identity']);

  const unreachable = makeTransport({
    sessions: [session],
    agent: async (_host, args) => {
      if (args[0] === 'status') throw new Error('host unreachable');
      return undefined;
    },
  });
  await assert.rejects(runClient(['resume', session.handle], unreachable), /host unreachable/);
  assert.equal(unreachable.calls.some((call) => call.op === 'attach:xian-m4'), false);

  const mismatch = makeTransport({
    sessions: [session],
    agent: async (_host, args) => {
      if (args[0] === 'status') {
        return agentStatus(session, {
          metadata: {
            ...agentStatus(session).metadata,
            hostname: 'xian-m1',
          },
        });
      }
      return undefined;
    },
  });
  await assert.rejects(runClient(['attach', session.handle], mismatch), /host.*不一致|metadata.*host/);
  assert.equal(mismatch.calls.some((call) => call.op === 'attach:xian-m4'), false);
});

test('attach only accepts running sessions and uses exact server tmux name', async () => {
  const stopped = runningSession({ state: 'stopped', status: 'stopped' });
  const stoppedTransport = makeTransport({ sessions: [stopped] });
  await assert.rejects(
    runClient(['attach', stopped.handle], stoppedTransport),
    /running/
  );
  assert.equal(stoppedTransport.calls.some((call) => call.op.startsWith('status:')), false);

  const running = runningSession();
  const transport = makeTransport({ sessions: [running] });
  await runClient(['attach', running.handle], transport);
  assert.equal(transport.calls.at(-1).tmuxTarget, `=${running.tmuxSession}`);
});

test('list trusts broker actor visibility defensively, optionally probes status, and emits no secrets', async () => {
  const mine = runningSession();
  const other = runningSession({
    actor: 'coworker',
    sessionId: sessionIdFor('coworker', 'infrastructure', 'main'),
    handle: 'coworker/infrastructure/main',
    team: 'team5',
    access_token: 'token-secret',
  });
  const transport = makeTransport({ sessions: [mine, other] });
  const result = await runClient(['list', '--status'], transport);

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].handle, mine.handle);
  assert.equal(transport.calls.some((call) => option(call.args ?? [], 'session') === other.sessionId), false);
  const serialized = JSON.stringify({ result, output: transport.output });
  assert.doesNotMatch(serialized, /team[1-5]|token-secret|access_token|refresh_token|lease-/i);
});

test('list --legacy calls every configured agent read-only and keeps output secret-free', async () => {
  const mine = runningSession();
  const transport = makeTransport({ sessions: [mine] });
  const result = await runClient(['list', '--legacy'], transport);

  assert.deepEqual(
    transport.calls.filter((call) => call.op.startsWith('legacy-list:')).map((call) => call.op),
    ['legacy-list:xian-m4', 'legacy-list:xian-m1']
  );
  assert.deepEqual(
    transport.calls
      .filter((call) => call.op.startsWith('legacy-list:'))
      .map((call) => option(call.args, 'host')),
    ['xian-m4', 'xian-m1']
  );
  assert.equal(result.legacy.length, 2);
  assert.doesNotMatch(JSON.stringify({ result, output: transport.output }), /team|token|lease/i);
});

test('stop releases current lease after confirmed stop, records stopped, and is idempotent', async () => {
  const session = runningSession();
  const transport = makeTransport({ sessions: [session] });

  const first = await runClient(['stop', session.handle], transport);
  assert.equal(first.status, 'stopped');
  assert.deepEqual(transport.calls.map((call) => call.op), [
    'identity',
    'session-get',
    'stop:xian-m4',
    'session-put',
    'session-get',
    'release',
    'session-put',
    'session-get',
  ]);
  const mutations = transport.calls
    .filter((call) => call.op === 'session-put')
    .map((call) => decodeSessionPut(call.args));
  assert.equal(mutations[0].state, 'stopped');
  assert.equal(mutations[0].leaseId, session.leaseId);
  assert.equal(mutations[0].team, session.team);
  assert.equal(mutations[1].state, 'stopped');
  assert.equal(mutations[1].leaseId, null);
  assert.equal(mutations[1].team, null);
  const stored = transport.sessions.get(session.sessionId);
  assert.equal(stored.state, 'stopped');
  assert.equal(stored.leaseId, null);
  assert.equal(stored.team, null);

  transport.calls.length = 0;
  const second = await runClient(['stop', session.handle], transport);
  assert.equal(second.status, 'stopped');
  assert.deepEqual(transport.calls.map((call) => call.op), ['identity', 'session-get']);
});

test('stop confirms lost checkpoint and clear responses by exact registry readback', async () => {
  for (const lostPut of [1, 2]) {
    const session = runningSession();
    let putCount = 0;
    const transport = makeTransport({
      sessions: [session],
      broker: async (args, { sessions }) => {
        if (args[0] !== 'session-put') return undefined;
        putCount += 1;
        const stored = decodeSessionPut(args);
        sessions.set(stored.sessionId, stored);
        if (putCount === lostPut) throw new Error('session-put response lost');
        return stored;
      },
    });

    const result = await runClient(['stop', session.handle], transport);
    assert.equal(result.status, 'stopped');
    assert.equal(putCount, 2);
    assert.equal(transport.sessions.get(session.sessionId).leaseId, null);
    for (const putIndex of transport.calls
      .map((call, index) => call.op === 'session-put' ? index : -1)
      .filter((index) => index >= 0)) {
      assert.equal(transport.calls[putIndex + 1].op, 'session-get');
    }
  }
});

test('stop final readback rejects a stopped no-lease record with nested active lease', async () => {
  const session = runningSession({
    lease: {
      leaseId: 'lease-existing',
      team: 'team3',
      state: 'active',
    },
  });
  let putCount = 0;
  const transport = makeTransport({
    sessions: [session],
    broker: async (args, { sessions }) => {
      if (args[0] !== 'session-put') return undefined;
      putCount += 1;
      const expected = decodeSessionPut(args);
      const stored = putCount === 2
        ? {
            ...expected,
            lease: {
              leaseId: session.leaseId,
              team: session.team,
              state: 'active',
            },
          }
        : expected;
      sessions.set(stored.sessionId, stored);
      return stored;
    },
  });

  await assert.rejects(
    runClient(['stop', session.handle], transport),
    /outcome unknown/
  );
  const stored = transport.sessions.get(session.sessionId);
  assert.equal(stored.state, 'stopped');
  assert.equal(stored.leaseId, null);
  assert.equal(stored.lease.state, 'active');
});

test('stop preserves retry state when checkpoint or clear readback fails', async () => {
  for (const failedReadbackAfterPut of [1, 2]) {
    const session = runningSession();
    let putCount = 0;
    let failNextReadback = false;
    const transport = makeTransport({
      sessions: [session],
      broker: async (args, { sessions }) => {
        if (args[0] === 'session-put') {
          putCount += 1;
          const stored = decodeSessionPut(args);
          sessions.set(stored.sessionId, stored);
          if (putCount === failedReadbackAfterPut) failNextReadback = true;
          return stored;
        }
        if (args[0] === 'session-get' && failNextReadback) {
          failNextReadback = false;
          throw new Error('registry readback unreachable');
        }
        return undefined;
      },
    });

    await assert.rejects(
      runClient(['stop', session.handle], transport),
      /outcome unknown|readback/i
    );
    const afterFailure = transport.sessions.get(session.sessionId);
    assert.equal(afterFailure.state, 'stopped');
    assert.equal(
      afterFailure.leaseId,
      failedReadbackAfterPut === 1 ? session.leaseId : null
    );
    if (failedReadbackAfterPut === 1) {
      assert.equal(transport.calls.some((call) => call.op === 'release'), false);
    }

    transport.calls.length = 0;
    const retry = await runClient(['stop', session.handle], transport);
    assert.equal(retry.status, 'stopped');
    assert.equal(transport.sessions.get(session.sessionId).leaseId, null);
    assert.equal(transport.calls.some((call) => call.op.startsWith('stop:')), false);
  }
});

test('stop retries a lost release response through idempotent released readback and converges', async () => {
  const session = runningSession();
  let releaseCount = 0;
  const transport = makeTransport({
    sessions: [session],
    broker: async (args) => {
      if (args[0] !== 'release') return undefined;
      releaseCount += 1;
      if (releaseCount === 1) throw new Error('release response lost');
      return {
        ok: true,
        team: option(args, 'team'),
        leaseId: option(args, 'lease'),
        state: 'released',
      };
    },
  });

  await assert.rejects(
    runClient(['stop', session.handle], transport),
    /release response lost/
  );
  const checkpoint = transport.sessions.get(session.sessionId);
  assert.equal(checkpoint.state, 'stopped');
  assert.equal(checkpoint.leaseId, session.leaseId);

  transport.calls.length = 0;
  const retry = await runClient(['stop', session.handle], transport);
  assert.equal(retry.status, 'stopped');
  assert.equal(releaseCount, 2);
  assert.deepEqual(transport.calls.map((call) => call.op), [
    'identity',
    'session-get',
    'release',
    'session-put',
    'session-get',
  ]);
  assert.equal(transport.sessions.get(session.sessionId).leaseId, null);
});

test('stop preserves the session lease pointer on an ambiguous inactive release error', async () => {
  const session = runningSession({
    state: 'stopped',
    status: 'stopped',
  });
  const transport = makeTransport({
    sessions: [session],
    broker: async (args) => {
      if (args[0] === 'release') {
        throw new Error('ssh failed: lease is not active');
      }
      return undefined;
    },
  });

  await assert.rejects(
    runClient(['stop', session.handle], transport),
    /lease is not active/
  );
  const stored = transport.sessions.get(session.sessionId);
  assert.equal(stored.leaseId, session.leaseId);
  assert.equal(stored.team, session.team);
  assert.equal(transport.calls.some((call) => call.op === 'session-put'), false);
});

test('stop quarantines active lease and reports error when agent is unreachable or stop unconfirmed', async () => {
  for (const agentBehavior of [
    async (_host, args) => {
      if (args[0] === 'stop') throw new Error('agent unreachable');
      return undefined;
    },
    async (_host, args) => {
      if (args[0] === 'stop') {
        return {
          ok: true,
          state: 'running',
          stopped: false,
          tmux: { running: true },
        };
      }
      return undefined;
    },
  ]) {
    const session = runningSession();
    const transport = makeTransport({ sessions: [session], agent: agentBehavior });
    await assert.rejects(runClient(['stop', session.handle], transport), /停止|stop|unreachable/i);
    const release = transport.calls.find((call) => call.op === 'release');
    assert.ok(release);
    assert.equal(option(release.args, 'state'), 'quarantined');
    assert.equal(transport.calls.some((call) => call.op === 'session-put'), false);
  }
});

test('stop quarantines and preserves the registry lease pointer for an unverified missing response', async () => {
  const session = runningSession();
  const transport = makeTransport({
    sessions: [session],
    agent: async (_host, args) => {
      if (args[0] !== 'stop') return undefined;
      return {
        ok: true,
        sessionId: session.sessionId,
        state: 'missing',
        stopped: false,
        tmux: {
          running: false,
          session: session.tmuxSession,
          pid: null,
        },
      };
    },
  });

  await assert.rejects(
    runClient(['stop', session.handle], transport),
    /停止|stop/i
  );
  const release = transport.calls.find((call) => call.op === 'release');
  assert.ok(release);
  assert.equal(option(release.args, 'state'), 'quarantined');
  assert.equal(transport.calls.some((call) => call.op === 'session-put'), false);
  const stored = transport.sessions.get(session.sessionId);
  assert.equal(stored.leaseId, session.leaseId);
  assert.equal(stored.team, session.team);
});

test('stop rejects a stopped response for another session and never releases its lease', async () => {
  const session = runningSession();
  const transport = makeTransport({
    sessions: [session],
    agent: async (_host, args) => {
      if (args[0] !== 'stop') return undefined;
      return {
        ok: true,
        sessionId: 's-cross-wired',
        state: 'stopped',
        stopped: true,
        tmux: {
          running: false,
          session: session.tmuxSession,
          pid: null,
        },
      };
    },
  });

  await assert.rejects(
    runClient(['stop', session.handle], transport),
    /停止|stop/i
  );
  const release = transport.calls.find((call) => call.op === 'release');
  assert.ok(release);
  assert.equal(option(release.args, 'state'), 'quarantined');
  assert.equal(transport.calls.some((call) => call.op === 'session-put'), false);
  assert.equal(transport.sessions.get(session.sessionId).leaseId, session.leaseId);
});

test('loadClientConfig honors env path, user path, then safe defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-slot-client-config-'));
  const envPath = join(root, 'env.json');
  const userPath = join(root, '.config', 'codex-slot', 'config.json');
  const files = new Map([
    [envPath, JSON.stringify({ broker: 'env-broker', hosts: ['env-host'] })],
    [userPath, JSON.stringify({ broker: 'user-broker', hosts: ['user-host'] })],
  ]);
  const fakeReadFile = async (path) => {
    if (files.has(path)) return files.get(path);
    const error = new Error('missing');
    error.code = 'ENOENT';
    throw error;
  };

  assert.deepEqual(
    await loadClientConfig({
      env: { CODEX_SLOT_CONFIG: envPath },
      home: root,
      readFile: fakeReadFile,
    }),
    {
      broker: 'env-broker',
      hosts: ['env-host'],
      brokerScript: '~/.local/lib/codex-slot/codex-slot-broker.mjs',
      agentScript: '~/.local/lib/codex-slot/codex-slot-agent.mjs',
    }
  );
  assert.equal(
    (await loadClientConfig({ env: {}, home: root, readFile: fakeReadFile })).broker,
    'user-broker'
  );
  files.delete(userPath);
  assert.deepEqual(
    await loadClientConfig({ env: {}, home: root, readFile: fakeReadFile }),
    {
      broker: 'mmv',
      hosts: ['xian-m4', 'xian-m1'],
      brokerScript: '~/.local/lib/codex-slot/codex-slot-broker.mjs',
      agentScript: '~/.local/lib/codex-slot/codex-slot-agent.mjs',
    }
  );
});

test('real transport sends one POSIX-quoted remote command and preserves exact arguments', async () => {
  const calls = [];
  const runCommand = async (cmd, args, options) => {
    calls.push({ kind: 'command', cmd, args, options });
    return { stdout: '{"ok":true,"actor":"alex"}\n', stderr: '' };
  };
  const runInteractive = async (cmd, args, options) => {
    calls.push({ kind: 'interactive', cmd, args, options });
    return { ok: true };
  };
  const transport = await createSshTransport({
    config: {
      broker: 'broker-host',
      hosts: ['xian-m4'],
      brokerScript: "~/.local/lib/codex slot's/codex-slot-broker.mjs",
      agentScript: "/remote/codex slot's/codex-slot-agent.mjs",
    },
    runCommand,
    runInteractive,
  });

  const deliverPath = "/remote/codex home/slot's/auth.json";
  await transport.broker(['deliver', '--path', deliverPath]);
  const agentCommands = [
    ['health'],
    ['prepare', '--session', 's-safe'],
    ['status', '--session', 's-safe'],
    ['launch', '--session', 's-safe'],
    ['stop', '--session', 's-safe'],
    ['legacy-list', '--host', 'xian-m4'],
  ];
  for (const args of agentCommands) {
    await transport.agent('xian-m4', args);
  }
  await transport.attach('xian-m4', '=codex-slot-s-abc');

  const required = [
    'BatchMode=yes',
    'ConnectTimeout=15',
    'ServerAliveInterval=15',
    'ServerAliveCountMax=2',
  ];
  assert.equal(calls[0].cmd, 'ssh');
  assert.equal(calls[0].args[0], '-T');
  for (const value of required) assert.ok(calls[0].args.includes(value));
  assert.deepEqual(calls[0].args.slice(-2), [
    'broker-host',
    `env PATH=${REMOTE_FIXED_PATH} node "$HOME"/'.local/lib/codex slot'\\''s/codex-slot-broker.mjs' 'deliver' '--path' '/remote/codex home/slot'\\''s/auth.json'`,
  ]);
  const brokerInvocation = remoteShellInvocation(calls[0].args.at(-1), 'node');
  assert.equal(brokerInvocation.envPath, REMOTE_FIXED_PATH);
  assert.equal(Object.hasOwn(brokerInvocation.env, 'CODEX_SLOT_HOST'), false);
  assert.deepEqual(brokerInvocation.argv, [
    `${process.env.HOME}/.local/lib/codex slot's/codex-slot-broker.mjs`,
    'deliver',
    '--path',
    deliverPath,
  ]);
  assert.equal(calls[0].options.timeoutMs, 30_000);
  assert.equal(calls[0].options.shell, false);

  assert.equal(calls[1].args.includes('-T'), false);
  for (const value of required) assert.ok(calls[1].args.includes(value));
  assert.deepEqual(calls[1].args.slice(-2), [
    'xian-m4',
    `env PATH=${REMOTE_FIXED_PATH} CODEX_SLOT_HOST=xian-m4 node '/remote/codex slot'\\''s/codex-slot-agent.mjs' 'health'`,
  ]);
  for (const [index, expectedArgs] of agentCommands.entries()) {
    const call = calls[index + 1];
    const invocation = remoteShellInvocation(call.args.at(-1), 'node');
    assert.equal(invocation.envPath, REMOTE_FIXED_PATH);
    assert.equal(invocation.env.CODEX_SLOT_HOST, 'xian-m4');
    assert.deepEqual(invocation.argv, [
      "/remote/codex slot's/codex-slot-agent.mjs",
      ...expectedArgs,
    ]);
    assert.equal(call.options.timeoutMs, 30_000);
  }

  assert.deepEqual(calls.at(-1), {
    kind: 'interactive',
    cmd: 'ssh',
    args: [
      '-t',
      'xian-m4',
      `env PATH=${REMOTE_FIXED_PATH} tmux 'attach-session' '-t' '=codex-slot-s-abc'`,
    ],
    options: { shell: false, stdio: 'inherit' },
  });
  const tmuxInvocation = remoteShellInvocation(calls.at(-1).args.at(-1), 'tmux');
  assert.equal(tmuxInvocation.envPath, REMOTE_FIXED_PATH);
  assert.equal(Object.hasOwn(tmuxInvocation.env, 'CODEX_SLOT_HOST'), false);
  assert.deepEqual(tmuxInvocation.argv, [
    'attach-session',
    '-t',
    '=codex-slot-s-abc',
  ]);

  const invalid = await createSshTransport({
    config: {
      broker: 'broker-host',
      hosts: ['agent-host'],
      brokerScript: '/remote/broker.mjs',
      agentScript: '/remote/agent.mjs',
    },
    runCommand: async () => ({ stdout: '{"ok":true}\\ntrailing', stderr: '' }),
    runInteractive,
  });
  await assert.rejects(invalid.broker(['identity']), /JSON/);
});

test('remote env prefix lets fake node and tmux inherit fixed PATH with empty or minimal caller PATH', async (t) => {
  const calls = [];
  const runCommand = async (cmd, args, options) => {
    calls.push({ kind: 'command', cmd, args, options });
    return { stdout: '{"ok":true,"actor":"alex"}\n', stderr: '' };
  };
  const runInteractive = async (cmd, args, options) => {
    calls.push({ kind: 'interactive', cmd, args, options });
    return { ok: true };
  };
  const transport = await createSshTransport({
    config: {
      broker: 'broker-host',
      hosts: ['xian-m4'],
      brokerScript: '~/.local/lib/codex-slot/codex-slot-broker.mjs',
      agentScript: '/remote/codex-slot-agent.mjs',
    },
    runCommand,
    runInteractive,
  });

  await transport.broker(['identity']);
  await transport.agent('xian-m4', ['health']);
  await transport.attach('xian-m4', '=codex-slot-s-abc');

  for (const initialPath of ['', '/usr/bin:/bin:/usr/sbin:/sbin']) {
    const broker = await runRemoteWithFakeExecutable(
      t,
      calls[0].args.at(-1),
      'node',
      initialPath
    );
    assert.equal(broker.inheritedHost, 'unset');
    assert.deepEqual(broker.argv, [
      `${process.env.HOME}/.local/lib/codex-slot/codex-slot-broker.mjs`,
      'identity',
    ]);

    const agent = await runRemoteWithFakeExecutable(
      t,
      calls[1].args.at(-1),
      'node',
      initialPath
    );
    assert.equal(agent.inheritedHost, 'xian-m4');
    assert.deepEqual(agent.argv, ['/remote/codex-slot-agent.mjs', 'health']);

    const attach = await runRemoteWithFakeExecutable(
      t,
      calls[2].args.at(-1),
      'tmux',
      initialPath
    );
    assert.equal(attach.inheritedHost, 'unset');
    assert.deepEqual(attach.argv, ['attach-session', '-t', '=codex-slot-s-abc']);
  }
});

test('runProcess waits for close after TERM, escalates to KILL, and settles timeout once', async () => {
  const signals = [];
  let spawnOptions;
  let child;
  const spawnImpl = (_cmd, _args, options) => {
    spawnOptions = options;
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => {
      signals.push(signal);
      if (signal === 'SIGKILL') {
        queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
      }
      return true;
    };
    return child;
  };

  let settleCount = 0;
  const startedAt = Date.now();
  const result = runProcess('ssh', ['host'], { timeoutMs: 5, spawnImpl }).then(
    (value) => {
      settleCount += 1;
      return value;
    },
    (error) => {
      settleCount += 1;
      throw error;
    }
  );
  await assert.rejects(
    result,
    /timed out/
  );
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(Date.now() - startedAt >= 900);
  assert.equal(settleCount, 1);
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(child.listenerCount('error'), 0);
  child.emit('close', 0, null);
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(settleCount, 1);
  assert.equal(spawnOptions.shell, false);
});

test('bash entry is the strict plan template and mode 755', async () => {
  assert.equal(
    await readFile(ENTRY_PATH, 'utf8'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
      'exec node "$SCRIPT_DIR/codex-slot-client.mjs" "$@"',
      '',
    ].join('\n')
  );
  assert.equal((await stat(ENTRY_PATH)).mode & 0o777, 0o755);
  assert.equal(CLIENT_PATH.endsWith('/scripts/codex-slot-client.mjs'), true);
});
