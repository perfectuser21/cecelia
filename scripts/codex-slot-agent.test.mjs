import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as realFs from 'node:fs/promises';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from './codex-slot-agent.mjs';
import { withDirLock } from './codex-slot-store.mjs';

const NOW = new Date('2026-07-23T00:00:00.000Z');
const SESSION = 'alex-infra-main';
const ACTOR = 'alex';
const PROJECT = 'infrastructure';
const NAME = 'main';

function tailscaleStatus({
  hostName = 'mmv',
  dnsName = 'mmv.example.ts.net.',
  online = true,
  selected = true,
  self = {},
} = {}) {
  return {
    Self: {
      HostName: 'xian-m4',
      DNSName: 'xian-m4.example.ts.net.',
      Online: true,
      ExitNode: false,
      ...self,
    },
    Peer: {
      'node-key': {
        HostName: hostName,
        DNSName: dnsName,
        Online: online,
        ExitNode: selected,
      },
    },
  };
}

async function tempHome(t) {
  const home = await mkdtemp(join(tmpdir(), 'codex-slot-agent-'));
  t.after(async () => {
    await rm(home, { recursive: true, force: true });
  });
  return home;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function modeOf(path) {
  return (await stat(path)).mode & 0o777;
}

async function jsonAt(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function paths(home, actor = ACTOR, session = SESSION, project = PROJECT) {
  const slotDir = join(home, '.codex-slots', actor, session);
  return {
    actorDir: join(home, '.codex-slots', actor),
    slotDir,
    codexHome: join(slotDir, 'codex-home'),
    launcherPath: join(slotDir, 'launcher.sh'),
    metadataPath: join(slotDir, 'metadata.json'),
    logsDir: join(slotDir, 'logs'),
    lockPath: join(home, '.codex-slots', '.locks', `${session}.lock`),
    worktreeProjectDir: join(home, 'worktrees', project),
    worktreePath: join(home, 'worktrees', project, session),
    repoPath: join(home, 'repos', project),
  };
}

async function makeDeps(t, overrides = {}) {
  const home = overrides.home ?? await tempHome(t);
  const execCalls = [];
  const tmuxSessions = new Set(overrides.tmuxSessions ?? []);
  const panePids = new Map(overrides.panePids ?? [[`codex-slot-${SESSION}`, '4321']]);
  const branches = new Set(overrides.branches ?? []);
  const lockPaths = [];
  const processHook = overrides.processHook;

  function tmuxSessionForTarget(target) {
    const exact = target.startsWith('=');
    const requested = exact ? target.slice(1) : target;
    if (exact || tmuxSessions.has(requested)) {
      return tmuxSessions.has(requested) ? requested : null;
    }
    const matches = Array.from(tmuxSessions).filter((sessionName) =>
      sessionName.startsWith(requested)
    );
    return matches.length === 1 ? matches[0] : null;
  }

  const deps = {
    home,
    hostname: () => 'xian-m4',
    now: () => NOW,
    allowedProjects: [PROJECT, 'cecelia', 'Aivideogeneration'],
    sampleDisk: async () => ({
      freeGiB: 120,
      usedPercent: 31,
      capacity: '512GiB',
      sampledAt: NOW.toISOString(),
    }),
    sampleTailscaleStatus: async () => tailscaleStatus(),
    exitNode: 'mmv',
    runProcess: async (cmd, args = [], options = {}) => {
      execCalls.push({ cmd, args, options });

      const hooked = await processHook?.({ cmd, args, options, tmuxSessions, branches });
      if (hooked !== undefined) {
        return hooked;
      }

      if (cmd === 'df') {
        return {
          exitCode: 0,
          stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk 536870912 1 125829120 31% /\n',
          stderr: '',
        };
      }

      if (cmd === 'git' && args[2] === 'show-ref') {
        return {
          exitCode: branches.has(args.at(-1).replace(/^refs\/heads\//, '')) ? 0 : 1,
          stdout: '',
          stderr: '',
        };
      }

      if (cmd === 'git' && args[2] === 'worktree' && args[3] === 'add') {
        await mkdir(args.at(-1), { recursive: true, mode: 0o700 });
        branches.add(args.at(-2));
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      if (cmd === 'git' && args[2] === 'worktree' && args[3] === 'remove') {
        await rm(args.at(-1), { recursive: true, force: true });
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      if (cmd === 'git' && args[2] === 'branch' && args[3] === '-D') {
        branches.delete(args.at(-1));
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      if (cmd === 'tmux' && args[0] === 'has-session') {
        const sessionName = tmuxSessionForTarget(args.at(-1));
        return {
          exitCode: sessionName === null ? 1 : 0,
          stdout: '',
          stderr: '',
        };
      }

      if (cmd === 'tmux' && args[0] === 'new-session') {
        tmuxSessions.add(args[3]);
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      if (cmd === 'tmux' && args[0] === 'list-panes') {
        const sessionName = tmuxSessionForTarget(args.at(-1));
        return {
          exitCode: sessionName === null ? 1 : 0,
          stdout: sessionName === null ? '' : `${panePids.get(sessionName) ?? ''}\n`,
          stderr: sessionName === null ? 'session not found' : '',
        };
      }

      if (cmd === 'tmux' && args[0] === 'kill-session') {
        const sessionName = tmuxSessionForTarget(args.at(-1));
        if (sessionName === null) {
          return { exitCode: 1, stdout: '', stderr: 'session not found' };
        }
        tmuxSessions.delete(sessionName);
        return { exitCode: 0, stdout: '', stderr: '' };
      }

      if (cmd === 'tmux' && args[0] === 'list-sessions') {
        return {
          exitCode: 0,
          stdout: Array.from({ length: 10 }, (_, index) => {
            const slot = `slot${index + 1}`;
            return `${slot}\t${index % 2}\t${1_721_692_800 + index}`;
          }).join('\n'),
          stderr: '',
        };
      }

      throw new Error(`unexpected process: ${cmd} ${args.join(' ')}`);
    },
    withDirLock: async (lockPath, fn) => {
      lockPaths.push(lockPath);
      return fn();
    },
    ...overrides,
  };

  delete deps.tmuxSessions;
  delete deps.panePids;
  delete deps.branches;
  delete deps.processHook;
  return { deps, execCalls, home, tmuxSessions, branches, lockPaths };
}

async function prepare(deps) {
  await mkdir(paths(deps.home).repoPath, { recursive: true, mode: 0o700 });
  return runAgent([
    'prepare',
    '--session',
    SESSION,
    '--actor',
    ACTOR,
    '--project',
    PROJECT,
    '--name',
    NAME,
  ], deps);
}

test('health reports host disk capacity and enabled state', async (t) => {
  let sampleArgs;
  const { deps } = await makeDeps(t, {
    diskPath: '/injected-volume',
    sampleDisk: async (args) => {
      sampleArgs = args;
      return {
        freeGiB: 88,
        usedPercent: 44,
        capacity: '1TiB',
        sampledAt: NOW.toISOString(),
      };
    },
  });

  assert.deepEqual(await runAgent(['health'], deps), {
    ok: true,
    hostname: 'xian-m4',
    freeGiB: 88,
    usedPercent: 44,
    capacity: '1TiB',
    exitNode: 'mmv',
    exitNodeOk: true,
    enabled: true,
  });
  assert.equal(sampleArgs.diskPath, '/injected-volume');

  const darwin = await makeDeps(t, { platform: 'darwin' });
  delete darwin.deps.sampleDisk;
  await runAgent(['health'], darwin.deps);
  assert.equal(darwin.execCalls[0].args.at(-1), '/System/Volumes/Data');
  assert.equal(darwin.execCalls[0].options.timeoutMs, 5000);

  const linux = await makeDeps(t, { platform: 'linux' });
  delete linux.deps.sampleDisk;
  await runAgent(['health'], linux.deps);
  assert.equal(linux.execCalls[0].args.at(-1), linux.home);
});

test('health samples tailscale status --json and accepts the selected online mmv peer', async (t) => {
  const { deps, execCalls } = await makeDeps(t, {
    processHook: async ({ cmd, args }) => {
      if (cmd === 'tailscale') {
        assert.deepEqual(args, ['status', '--json']);
        return {
          exitCode: 0,
          stdout: JSON.stringify(tailscaleStatus()),
          stderr: '',
        };
      }
      return undefined;
    },
  });
  delete deps.sampleTailscaleStatus;
  delete deps.exitNode;

  const result = await runAgent(['health'], deps);

  assert.equal(result.exitNode, 'mmv');
  assert.equal(result.exitNodeOk, true);
  assert.equal(result.enabled, true);
  assert.equal(execCalls.filter(({ cmd }) => cmd === 'tailscale').length, 1);
});

test('health fails closed for every invalid exit-node state without exposing command output', async (t) => {
  const cases = [
    {
      name: 'command unavailable',
      sampleTailscaleStatus: async () => {
        throw new Error('tailscale unavailable access_token=company-secret');
      },
      exitNode: null,
    },
    {
      name: 'invalid json',
      sampleTailscaleStatus: async () => '{not-json access_token=company-secret',
      exitNode: null,
    },
    {
      name: 'not selected',
      sampleTailscaleStatus: async () => tailscaleStatus({ selected: false }),
      exitNode: null,
    },
    {
      name: 'selected peer offline',
      sampleTailscaleStatus: async () => tailscaleStatus({ online: false }),
      exitNode: 'mmv',
    },
    {
      name: 'wrong selected peer',
      sampleTailscaleStatus: async () => tailscaleStatus({
        hostName: 'china-gateway',
        dnsName: 'china-gateway.example.ts.net.',
      }),
      exitNode: 'china-gateway',
    },
    {
      name: 'conflicting HostName cannot be rescued by DNSName',
      sampleTailscaleStatus: async () => tailscaleStatus({
        hostName: 'china-gateway',
        dnsName: 'mmv',
      }),
      exitNode: null,
    },
    {
      name: 'Self must not count as selected peer',
      sampleTailscaleStatus: async () => ({
        Self: {
          HostName: 'mmv',
          DNSName: 'mmv.example.ts.net.',
          Online: true,
          ExitNode: true,
        },
        Peer: {},
      }),
      exitNode: null,
    },
    {
      name: 'selected peer without HostName or DNSName',
      sampleTailscaleStatus: async () => tailscaleStatus({
        hostName: '',
        dnsName: '',
      }),
      exitNode: null,
    },
  ];

  for (const scenario of cases) {
    const { deps } = await makeDeps(t, {
      sampleTailscaleStatus: scenario.sampleTailscaleStatus,
    });
    const result = await runAgent(['health'], deps);
    assert.equal(result.exitNode, scenario.exitNode, scenario.name);
    assert.equal(result.exitNodeOk, false, scenario.name);
    assert.equal(result.enabled, false, scenario.name);
    assert.doesNotMatch(JSON.stringify(result), /company-secret|access_token/, scenario.name);
  }
});

test('health can strictly match a selected peer by normalized DNSName', async (t) => {
  const { deps } = await makeDeps(t, {
    exitNode: 'mmv.example.ts.net',
    sampleTailscaleStatus: async () => tailscaleStatus({ hostName: '' }),
  });

  const result = await runAgent(['health'], deps);

  assert.equal(result.exitNode, 'mmv.example.ts.net');
  assert.equal(result.exitNodeOk, true);
  assert.equal(result.enabled, true);
});

test('health rejects selected peer when HostName and DNSName first label conflict', async (t) => {
  const { deps } = await makeDeps(t, {
    exitNode: 'china-gateway',
    sampleTailscaleStatus: async () => tailscaleStatus({
      hostName: 'china-gateway',
      dnsName: 'mmv.example.ts.net.',
    }),
  });

  const result = await runAgent(['health'], deps);

  assert.equal(result.exitNodeOk, false);
  assert.equal(result.enabled, false);
});

test('health normalizes selected peer and expected exit node case and trailing dots', async (t) => {
  const byHostName = await makeDeps(t, {
    exitNode: 'MMV...',
    sampleTailscaleStatus: async () => tailscaleStatus({
      hostName: 'MMV..',
      dnsName: 'mmv.example.ts.net...',
    }),
  });

  const hostResult = await runAgent(['health'], byHostName.deps);
  assert.equal(hostResult.exitNode, 'mmv');
  assert.equal(hostResult.exitNodeOk, true);
  assert.equal(hostResult.enabled, true);

  const byDnsName = await makeDeps(t, {
    exitNode: 'MMV.EXAMPLE.TS.NET...',
    sampleTailscaleStatus: async () => tailscaleStatus({
      hostName: '',
      dnsName: 'MMV.EXAMPLE.TS.NET...',
    }),
  });

  const dnsResult = await runAgent(['health'], byDnsName.deps);
  assert.equal(dnsResult.exitNode, 'mmv.example.ts.net');
  assert.equal(dnsResult.exitNodeOk, true);
  assert.equal(dnsResult.enabled, true);
});

test('health fails closed for empty unsafe or multiple selected exit-node config', async (t) => {
  for (const exitNode of ['', 'bad/name']) {
    const { deps } = await makeDeps(t, { exitNode });
    const result = await runAgent(['health'], deps);
    assert.equal(result.ok, false, exitNode || '<empty>');
    assert.equal(result.exitNode, null, exitNode || '<empty>');
    assert.equal(result.exitNodeOk, false, exitNode || '<empty>');
    assert.equal(result.enabled, false, exitNode || '<empty>');
  }

  const multiple = await makeDeps(t, {
    sampleTailscaleStatus: async () => ({
      Peer: {
        a: {
          HostName: 'mmv',
          DNSName: 'mmv.example.ts.net.',
          Online: true,
          ExitNode: true,
        },
        b: {
          HostName: 'backup',
          DNSName: 'backup.example.ts.net.',
          Online: true,
          ExitNode: true,
        },
      },
    }),
  });
  const result = await runAgent(['health'], multiple.deps);
  assert.equal(result.exitNode, null);
  assert.equal(result.exitNodeOk, false);
  assert.equal(result.enabled, false);
});

test('prepare independently resamples exit node and refuses before writes when health becomes unsafe', async (t) => {
  let samples = 0;
  const { deps, execCalls, home } = await makeDeps(t, {
    sampleTailscaleStatus: async () => {
      samples += 1;
      return samples === 1
        ? tailscaleStatus()
        : tailscaleStatus({
            hostName: 'china-gateway',
            dnsName: 'china-gateway.example.ts.net.',
          });
    },
  });
  await mkdir(paths(home).repoPath, { recursive: true, mode: 0o700 });

  const health = await runAgent(['health'], deps);
  assert.equal(health.enabled, true);
  await assert.rejects(
    runAgent([
      'prepare',
      '--session',
      SESSION,
      '--actor',
      ACTOR,
      '--project',
      PROJECT,
      '--name',
      NAME,
    ], deps),
    /Tailscale 出口/
  );

  assert.equal(samples, 2);
  assert.equal(execCalls.length, 0);
  assert.equal(await exists(join(home, '.codex-slots')), false);
  assert.equal(await exists(join(home, 'worktrees')), false);
});

test('prepare fails closed on low disk before exec or writes', async (t) => {
  const { deps, execCalls, home } = await makeDeps(t, {
    sampleDisk: async () => ({
      freeGiB: 13,
      usedPercent: 94,
      capacity: '256GiB',
      sampledAt: NOW.toISOString(),
    }),
  });

  await assert.rejects(
    runAgent([
      'prepare',
      '--session',
      SESSION,
      '--actor',
      ACTOR,
      '--project',
      PROJECT,
      '--name',
      NAME,
    ], deps),
    /磁盘容量不足/
  );
  assert.equal(execCalls.length, 0);
  assert.equal(await exists(join(home, '.codex-slots')), false);
  assert.equal(await exists(join(home, 'worktrees')), false);
});

test('prepare rejects failed and stale disk samples before exec', async (t) => {
  const failed = await makeDeps(t, {
    sampleDisk: async () => {
      throw new Error('df unavailable');
    },
  });

  await assert.rejects(
    runAgent(['prepare', '--session', SESSION, '--actor', ACTOR, '--project', PROJECT, '--name', NAME], failed.deps),
    /磁盘采样失败/
  );
  assert.equal(failed.execCalls.length, 0);

  const stale = await makeDeps(t, {
    diskSampleMaxAgeMs: 30_000,
    sampleDisk: async () => ({
      freeGiB: 120,
      usedPercent: 20,
      capacity: '512GiB',
      sampledAt: '2026-07-22T23:58:00.000Z',
    }),
  });

  await assert.rejects(
    runAgent(['prepare', '--session', SESSION, '--actor', ACTOR, '--project', PROJECT, '--name', NAME], stale.deps),
    /磁盘采样陈旧/
  );
  assert.equal(stale.execCalls.length, 0);
});

test('prepare validates safe segments and project allowlist before exec', async (t) => {
  const { deps, execCalls } = await makeDeps(t);

  await assert.rejects(
    runAgent(['prepare', '--session', '../bad', '--actor', ACTOR, '--project', PROJECT, '--name', NAME], deps),
    /unsafe session/
  );
  await assert.rejects(
    runAgent(['prepare', '--session', SESSION, '--actor', 'al/ex', '--project', PROJECT, '--name', NAME], deps),
    /unsafe actor/
  );
  await assert.rejects(
    runAgent(['prepare', '--session', SESSION, '--actor', ACTOR, '--project', 'infra/main', '--name', NAME], deps),
    /unsafe project/
  );
  await assert.rejects(
    runAgent(['prepare', '--session', SESSION, '--actor', ACTOR, '--project', 'unknown', '--name', NAME], deps),
    /project not allowed/
  );
  assert.equal(execCalls.length, 0);
});

test('prepare creates fixed private layout and git worktree branch', async (t) => {
  const { deps, execCalls, home } = await makeDeps(t);
  const out = await prepare(deps);
  const p = paths(home);

  assert.equal(out.sessionId, SESSION);
  assert.equal(out.actor, ACTOR);
  assert.equal(out.project, PROJECT);
  assert.equal(out.name, NAME);
  assert.equal(out.slotDir, p.slotDir);
  assert.equal(out.codexHome, p.codexHome);
  assert.equal(out.launcherPath, p.launcherPath);
  assert.equal(out.metadataPath, p.metadataPath);
  assert.equal(out.logsDir, p.logsDir);
  assert.equal(out.worktreePath, p.worktreePath);

  assert.equal(await modeOf(join(home, '.codex-slots')), 0o700);
  assert.equal(await modeOf(join(home, '.codex-slots', '.locks')), 0o700);
  assert.equal(await modeOf(join(home, '.codex-slots', ACTOR)), 0o700);
  assert.equal(await modeOf(p.slotDir), 0o700);
  assert.equal(await modeOf(p.codexHome), 0o700);
  assert.equal(await modeOf(p.logsDir), 0o700);
  assert.equal(await modeOf(join(home, 'worktrees')), 0o700);
  assert.equal(await modeOf(join(home, 'worktrees', PROJECT)), 0o700);
  assert.equal(await modeOf(p.metadataPath), 0o600);

  const metadata = await jsonAt(p.metadataPath);
  assert.equal(metadata.sessionId, SESSION);
  assert.equal(metadata.actor, ACTOR);
  assert.equal(metadata.project, PROJECT);
  assert.equal(metadata.branch, `slot/${ACTOR}/${SESSION}`);
  assert.equal(metadata.worktreePath, p.worktreePath);
  assert.equal(metadata.codexHome, p.codexHome);

  assert.deepEqual(execCalls.map((call) => [call.cmd, call.args]), [
    [
      'git',
      ['-C', p.repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/slot/${ACTOR}/${SESSION}`],
    ],
    [
      'git',
      ['-C', p.repoPath, 'worktree', 'add', '-b', `slot/${ACTOR}/${SESSION}`, p.worktreePath],
    ],
    [
      'git',
      ['-C', p.repoPath, 'show-ref', '--verify', '--quiet', `refs/heads/slot/${ACTOR}/${SESSION}`],
    ],
  ]);
});

test('prepare is idempotent for same metadata and refuses ownership conflicts', async (t) => {
  const { deps, execCalls, home } = await makeDeps(t);
  const first = await prepare(deps);
  const second = await prepare(deps);
  assert.deepEqual(second, first);
  assert.equal(
    execCalls.filter(
      (call) => call.cmd === 'git' && call.args[2] === 'worktree' && call.args[3] === 'add'
    ).length,
    1
  );

  const p = paths(home);
  const metadata = await jsonAt(p.metadataPath);
  metadata.actor = 'morgan';
  await writeFile(p.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });

  await assert.rejects(
    runAgent(['prepare', '--session', SESSION, '--actor', ACTOR, '--project', PROJECT, '--name', NAME], deps),
    /metadata ownership conflict/
  );

  await writeFile(p.metadataPath, `${JSON.stringify(first, null, 2)}\n`, { mode: 0o600 });
  const trustedMutations = {
    actor: 'morgan',
    sessionId: 'different-session',
    project: 'not-allowed',
    name: '../unsafe-name',
    branch: 'slot/other/branch',
    slotDir: join(home, 'outside-slot'),
    codexHome: join(home, 'outside-codex-home'),
    launcherPath: join(home, 'outside-launcher.sh'),
    metadataPath: join(home, 'outside-metadata.json'),
    logsDir: join(home, 'outside-logs'),
    worktreePath: join(home, 'outside-worktree'),
  };
  const commands = [
    ['launch', '--session', SESSION],
    ['status', '--session', SESSION],
    ['stop', '--session', SESSION],
    ['prepare', '--session', SESSION, '--actor', ACTOR, '--project', PROJECT, '--name', NAME],
  ];

  for (const [field, value] of Object.entries(trustedMutations)) {
    const tampered = { ...first, [field]: value };
    await writeFile(p.metadataPath, `${JSON.stringify(tampered, null, 2)}\n`, { mode: 0o600 });
    for (const command of commands) {
      await assert.rejects(runAgent(command, deps), /metadata|unsafe|allowed|conflict/);
    }
    assert.equal(await exists(join(home, 'outside-launcher.sh')), false);
    assert.equal(await exists(join(home, 'outside-codex-home')), false);
    assert.equal(await exists(join(home, 'outside-worktree')), false);
  }

  await writeFile(p.metadataPath, `${JSON.stringify(first, null, 2)}\n`, { mode: 0o600 });
  await rm(p.worktreePath, { recursive: true, force: true });
  await assert.rejects(prepare(deps), /worktree/);
  await writeFile(p.worktreePath, 'not a directory\n');
  await assert.rejects(prepare(deps), /worktree/);
  await rm(p.worktreePath, { force: true });
  const outsideWorktree = join(home, 'outside-real-worktree');
  await mkdir(outsideWorktree);
  await symlink(outsideWorktree, p.worktreePath);
  await assert.rejects(prepare(deps), /symlink|worktree/);
});

test('prepare refuses an existing unowned worktree', async (t) => {
  const { deps, execCalls, home } = await makeDeps(t);
  await mkdir(paths(home).repoPath, { recursive: true, mode: 0o700 });
  await mkdir(paths(home).worktreePath, { recursive: true, mode: 0o700 });
  const worktreeMarker = join(paths(home).worktreePath, 'owner-marker');
  await writeFile(worktreeMarker, 'keep\n');

  await assert.rejects(
    runAgent(['prepare', '--session', SESSION, '--actor', ACTOR, '--project', PROJECT, '--name', NAME], deps),
    /worktree ownership conflict/
  );
  assert.equal(execCalls.length, 0);
  assert.equal(await exists(paths(home).metadataPath), false);
  assert.equal(await readFile(worktreeMarker, 'utf8'), 'keep\n');

  await t.test('rejects symlink parents and a session marker injected during creation', async (t) => {
    for (const parentKind of ['actor', 'worktree-project']) {
      const linked = await makeDeps(t);
      const linkedPaths = paths(linked.home);
      await mkdir(linkedPaths.repoPath, { recursive: true, mode: 0o700 });
      const outsideParent = join(linked.home, `outside-${parentKind}`);
      const marker = join(outsideParent, 'marker');
      await mkdir(outsideParent, { recursive: true, mode: 0o700 });
      await writeFile(marker, 'keep\n');

      if (parentKind === 'actor') {
        await mkdir(join(linked.home, '.codex-slots'), { recursive: true, mode: 0o700 });
        await symlink(outsideParent, linkedPaths.actorDir);
      } else {
        await mkdir(join(linked.home, 'worktrees'), { recursive: true, mode: 0o700 });
        await symlink(outsideParent, linkedPaths.worktreeProjectDir);
      }

      await assert.rejects(prepare(linked.deps), /symlink/);
      assert.equal(await readFile(marker, 'utf8'), 'keep\n');
    }

    const raced = await makeDeps(t);
    const racedPaths = paths(raced.home);
    let injectMarker = true;
    const marker = join(racedPaths.slotDir, 'external-owner-marker');
    raced.deps.fs = {
      ...realFs,
      mkdir: async (path, options) => {
        if (injectMarker && path === racedPaths.actorDir) {
          injectMarker = false;
          await realFs.mkdir(racedPaths.slotDir, { recursive: true, mode: 0o700 });
          await realFs.writeFile(marker, 'keep\n');
        }
        return realFs.mkdir(path, options);
      },
    };

    await mkdir(racedPaths.repoPath, { recursive: true, mode: 0o700 });
    await assert.rejects(prepare(raced.deps), /ownership conflict|appeared during creation/);
    assert.equal(await readFile(marker, 'utf8'), 'keep\n');
  });

  await t.test('rollback refuses changed parent identities without traversing symlinks', async (t) => {
    for (const parentKind of ['actor', 'worktree-project']) {
      const raced = await makeDeps(t);
      const racedPaths = paths(raced.home);
      const originalParent = parentKind === 'actor'
        ? racedPaths.actorDir
        : racedPaths.worktreeProjectDir;
      const displacedParent = join(raced.home, `displaced-${parentKind}`);
      const outsideParent = join(raced.home, `outside-${parentKind}`);
      const outsideSession = parentKind === 'actor'
        ? join(outsideParent, SESSION)
        : join(outsideParent, SESSION);
      const marker = join(outsideSession, 'external-owner-marker');
      let failMetadataRename = true;

      await mkdir(outsideSession, { recursive: true, mode: 0o700 });
      await writeFile(marker, 'keep\n');
      raced.deps.fs = {
        ...realFs,
        rename: async (from, to) => {
          if (failMetadataRename && to === racedPaths.metadataPath) {
            failMetadataRename = false;
            await realFs.rename(originalParent, displacedParent);
            await realFs.symlink(outsideParent, originalParent);
            throw new Error(`injected ${parentKind} identity change`);
          }
          return realFs.rename(from, to);
        },
      };

      await mkdir(racedPaths.repoPath, { recursive: true, mode: 0o700 });
      await assert.rejects(prepare(raced.deps), /identity|symlink/);
      assert.equal(await readFile(marker, 'utf8'), 'keep\n');
      assert.equal((await lstat(originalParent)).isSymbolicLink(), true);
    }
  });

  await t.test('rolls back a branch and worktree created by a failed git add only when absent before', async (t) => {
    let addAttempts = 0;
    const partial = await makeDeps(t, {
      processHook: async ({ cmd, args, branches }) => {
        if (cmd !== 'git' || args[2] !== 'worktree' || args[3] !== 'add') {
          return undefined;
        }
        addAttempts += 1;
        const branch = args.at(-2);
        if (branches.has(branch)) {
          return { exitCode: 1, stdout: '', stderr: 'branch already exists' };
        }
        branches.add(branch);
        await mkdir(args.at(-1), { recursive: true, mode: 0o700 });
        return addAttempts === 1
          ? { exitCode: 1, stdout: '', stderr: 'failed after creating branch' }
          : { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    const branch = `slot/${ACTOR}/${SESSION}`;
    await mkdir(paths(partial.home).repoPath, { recursive: true, mode: 0o700 });

    await assert.rejects(prepare(partial.deps), /git worktree add failed/);
    assert.equal(partial.branches.has(branch), false);
    assert.equal(await exists(paths(partial.home).worktreePath), false);
    assert.equal((await prepare(partial.deps)).sessionId, SESSION);

    const preexisting = await makeDeps(t, { branches: [branch] });
    await mkdir(paths(preexisting.home).repoPath, { recursive: true, mode: 0o700 });
    await assert.rejects(prepare(preexisting.deps), /branch ownership conflict/);
    assert.equal(preexisting.branches.has(branch), true);
    assert.equal(
      preexisting.execCalls.some(
        (call) => call.cmd === 'git' && call.args[2] === 'branch' && call.args[3] === '-D'
      ),
      false
    );
  });

  const partial = await makeDeps(t, {
    processHook: async ({ cmd, args }) => {
      if (cmd === 'git' && args[2] === 'worktree' && args[3] === 'add') {
        await mkdir(args.at(-1), { recursive: true, mode: 0o700 });
        return { exitCode: 1, stdout: '', stderr: 'partial failure' };
      }
      return undefined;
    },
  });
  await mkdir(paths(partial.home).repoPath, { recursive: true, mode: 0o700 });
  await assert.rejects(prepare(partial.deps), /git worktree add failed/);
  assert.equal(await exists(paths(partial.home).slotDir), false);
  assert.equal(await exists(paths(partial.home).worktreePath), false);

  let failMetadataRename = true;
  const atomic = await makeDeps(t, {
    fs: {
      ...realFs,
      rename: async (from, to) => {
        if (failMetadataRename && to.endsWith('metadata.json')) {
          failMetadataRename = false;
          throw new Error('injected metadata rename failure');
        }
        return realFs.rename(from, to);
      },
    },
  });
  await mkdir(paths(atomic.home).repoPath, { recursive: true, mode: 0o700 });
  await assert.rejects(prepare(atomic.deps), /injected metadata rename failure/);
  assert.equal(await exists(paths(atomic.home).slotDir), false);
  assert.equal(await exists(paths(atomic.home).worktreePath), false);
  assert.deepEqual(
    atomic.execCalls.filter((call) => call.cmd === 'git').map((call) => call.args.slice(2, 5)),
    [
      ['show-ref', '--verify', '--quiet'],
      ['worktree', 'add', '-b'],
      ['show-ref', '--verify', '--quiet'],
      ['worktree', 'remove', '--force'],
      ['branch', '-D', `slot/${ACTOR}/${SESSION}`],
    ]
  );
  assert.equal((await prepare(atomic.deps)).sessionId, SESSION);

  const preexisting = await makeDeps(t);
  const preexistingPaths = paths(preexisting.home);
  await mkdir(preexistingPaths.repoPath, { recursive: true, mode: 0o700 });
  await mkdir(preexistingPaths.slotDir, { recursive: true, mode: 0o700 });
  const marker = join(preexistingPaths.slotDir, 'owner-marker');
  await writeFile(marker, 'keep\n');
  await assert.rejects(prepare(preexisting.deps), /metadata ownership conflict/);
  assert.equal(await readFile(marker, 'utf8'), 'keep\n');

  const concurrent = await makeDeps(t, { withDirLock });
  await mkdir(paths(concurrent.home).repoPath, { recursive: true, mode: 0o700 });
  const actorTwo = 'morgan';
  const results = await Promise.allSettled([
    prepare(concurrent.deps),
    runAgent([
      'prepare',
      '--session',
      SESSION,
      '--actor',
      actorTwo,
      '--project',
      PROJECT,
      '--name',
      NAME,
    ], concurrent.deps),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const metadataFiles = await Promise.all(
    [ACTOR, actorTwo].map((actor) => exists(paths(concurrent.home, actor).metadataPath))
  );
  assert.equal(metadataFiles.filter(Boolean).length, 1);

  for (const symlinkKind of ['actorDir', 'slotDir', 'codexHome', 'metadata', 'worktree']) {
    const escaped = await makeDeps(t);
    await prepare(escaped.deps);
    const escapedPaths = paths(escaped.home);
    const outside = join(escaped.home, `outside-${symlinkKind}`);
    const target = {
      actorDir: join(escaped.home, '.codex-slots', ACTOR),
      slotDir: escapedPaths.slotDir,
      codexHome: escapedPaths.codexHome,
      metadata: escapedPaths.metadataPath,
      worktree: escapedPaths.worktreePath,
    }[symlinkKind];
    await realFs.rename(target, outside);
    await symlink(outside, target);

    for (const command of [
      ['launch', '--session', SESSION],
      ['status', '--session', SESSION],
      ['stop', '--session', SESSION],
      ['prepare', '--session', SESSION, '--actor', ACTOR, '--project', PROJECT, '--name', NAME],
    ]) {
      await assert.rejects(runAgent(command, escaped.deps), /symlink/);
    }
    assert.equal((await lstat(target)).isSymbolicLink(), true);
    assert.equal(await exists(outside), true);
  }
});

test('prepare thresholds can be injected by deps', async (t) => {
  const { deps } = await makeDeps(t, {
    minFreeGiB: 10,
    maxUsedPercent: 95,
    sampleDisk: async () => ({
      freeGiB: 13,
      usedPercent: 94,
      capacity: '256GiB',
      sampledAt: NOW.toISOString(),
    }),
  });

  assert.equal((await prepare(deps)).sessionId, SESSION);
});

test('launch writes token-free mode700 launcher and creates tmux session idempotently', async (t) => {
  const { deps, execCalls, home } = await makeDeps(t);
  await prepare(deps);
  execCalls.length = 0;

  const launched = await runAgent(['launch', '--session', SESSION], deps);
  const p = paths(home);
  const launcher = await readFile(p.launcherPath, 'utf8');

  assert.equal(launched.tmuxSession, `codex-slot-${SESSION}`);
  assert.equal(await modeOf(p.launcherPath), 0o700);
  assert.match(launcher, /export CODEX_HOME=/);
  assert.match(launcher, new RegExp(escapeRe(p.codexHome)));
  assert.match(launcher, new RegExp(`cd .*${escapeRe(p.worktreePath)}`));
  assert.match(launcher, /\nexec codex\n$/);
  assert.doesNotMatch(launcher, /auth|token|access_token|refresh_token/i);

  assert.deepEqual(execCalls.map((call) => [call.cmd, call.args, call.options.timeoutMs]), [
    ['tmux', ['has-session', '-t', `=codex-slot-${SESSION}`], 10_000],
    ['tmux', ['new-session', '-d', '-s', `codex-slot-${SESSION}`, '/bin/bash', p.launcherPath], 10_000],
    ['tmux', ['has-session', '-t', `=codex-slot-${SESSION}`], 10_000],
  ]);

  await runAgent(['launch', '--session', SESSION], deps);
  assert.equal(execCalls.filter((call) => call.cmd === 'tmux' && call.args[0] === 'new-session').length, 1);
  assert.equal(
    execCalls.filter((call) => call.cmd === 'tmux').every((call) => call.options.timeoutMs === 10_000),
    true
  );

  for (const failure of ['exit2', 'timeout']) {
    let hasSessionCalls = 0;
    const failed = await makeDeps(t, {
      processHook: async ({ cmd, args }) => {
        if (cmd !== 'tmux' || args[0] !== 'has-session') {
          return undefined;
        }
        hasSessionCalls += 1;
        if (hasSessionCalls === 1) {
          return { exitCode: 1, stdout: '', stderr: '' };
        }
        if (failure === 'timeout') {
          throw new Error('process timed out: tmux');
        }
        return { exitCode: 2, stdout: '', stderr: 'tmux unavailable' };
      },
    });
    await prepare(failed.deps);

    await assert.rejects(
      runAgent(['launch', '--session', SESSION], failed.deps),
      failure === 'timeout' ? /process timed out: tmux/ : /tmux has-session failed/
    );
    assert.equal(hasSessionCalls, 2);
    assert.equal(
      failed.execCalls
        .filter((call) => call.cmd === 'tmux')
        .every((call) => call.options.timeoutMs === 10_000),
      true
    );
  }

  const vanished = await makeDeps(t, {
    processHook: async ({ cmd, args }) => {
      if (cmd === 'tmux' && args[0] === 'new-session') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return undefined;
    },
  });
  await prepare(vanished.deps);
  await assert.rejects(
    runAgent(['launch', '--session', SESSION], vanished.deps),
    /launch did not stay running/
  );

  const concurrent = await makeDeps(t, {
    processHook: async ({ cmd, args, tmuxSessions }) => {
      if (cmd === 'tmux' && args[0] === 'new-session') {
        tmuxSessions.add(`codex-slot-${SESSION}`);
        return { exitCode: 1, stdout: '', stderr: 'duplicate session' };
      }
      return undefined;
    },
  });
  await prepare(concurrent.deps);
  const concurrentLaunch = await runAgent(['launch', '--session', SESSION], concurrent.deps);
  assert.equal(concurrentLaunch.ok, true);
  assert.equal(concurrentLaunch.alreadyRunning, false);

  await t.test('revalidates trusted directories before writing launcher or invoking tmux', async (t) => {
    const raced = await makeDeps(t);
    const racedPaths = paths(raced.home);
    const displacedCodexHome = join(raced.home, 'displaced-codex-home');
    const outsideCodexHome = join(raced.home, 'outside-codex-home');
    const outsideAuth = join(outsideCodexHome, 'auth.json');
    let replaceCodexHome = false;

    raced.deps.fs = {
      ...realFs,
      realpath: async (path) => {
        const result = await realFs.realpath(path);
        if (replaceCodexHome && path === racedPaths.worktreePath) {
          replaceCodexHome = false;
          await realFs.rename(racedPaths.codexHome, displacedCodexHome);
          await realFs.symlink(outsideCodexHome, racedPaths.codexHome);
        }
        return result;
      },
    };

    await prepare(raced.deps);
    await mkdir(outsideCodexHome, { recursive: true, mode: 0o700 });
    await writeFile(outsideAuth, '{"access_token":"keep"}\n', { mode: 0o600 });
    replaceCodexHome = true;
    raced.execCalls.length = 0;

    await assert.rejects(runAgent(['launch', '--session', SESSION], raced.deps), /symlink/);
    assert.equal(
      raced.execCalls.some((call) => call.cmd === 'tmux'),
      false
    );
    assert.equal(await readFile(outsideAuth, 'utf8'), '{"access_token":"keep"}\n');
  });
});

test('launch status and stop use exact tmux targets without matching a longer prefix', async (t) => {
  const session = 'foo';
  const sessionName = `codex-slot-${session}`;
  const extraSessionName = `${sessionName}-extra`;
  const { deps, execCalls, tmuxSessions } = await makeDeps(t, {
    tmuxSessions: [extraSessionName],
    panePids: [[extraSessionName, '9876'], [sessionName, '4321']],
  });
  await mkdir(paths(deps.home, ACTOR, session).repoPath, { recursive: true, mode: 0o700 });
  await runAgent([
    'prepare',
    '--session',
    session,
    '--actor',
    ACTOR,
    '--project',
    PROJECT,
    '--name',
    NAME,
  ], deps);
  execCalls.length = 0;

  const launched = await runAgent(['launch', '--session', session], deps);
  const statusOut = await runAgent(['status', '--session', session], deps);
  const stopped = await runAgent(['stop', '--session', session], deps);

  assert.equal(launched.alreadyRunning, false);
  assert.equal(statusOut.state, 'running');
  assert.equal(statusOut.tmux.pid, 4321);
  assert.equal(stopped.stopped, true);
  assert.equal(tmuxSessions.has(sessionName), false);
  assert.equal(tmuxSessions.has(extraSessionName), true);

  const newSession = execCalls.find(
    (call) => call.cmd === 'tmux' && call.args[0] === 'new-session'
  );
  assert.equal(newSession.args[newSession.args.indexOf('-s') + 1], sessionName);

  const targetedCalls = execCalls.filter(
    (call) => call.cmd === 'tmux' && call.args.includes('-t')
  );
  assert.ok(targetedCalls.length > 0);
  for (const call of targetedCalls) {
    assert.equal(call.args[call.args.indexOf('-t') + 1], `=${sessionName}`);
  }
});

test('status reports metadata and tmux pid without treating missing as crash', async (t) => {
  const { deps } = await makeDeps(t);
  assert.deepEqual(await runAgent(['status', '--session', SESSION], deps), {
    ok: true,
    sessionId: SESSION,
    state: 'missing',
    metadata: null,
    tmux: { running: false, session: `codex-slot-${SESSION}`, pid: null },
  });

  await prepare(deps);
  await runAgent(['launch', '--session', SESSION], deps);
  const statusOut = await runAgent(['status', '--session', SESSION], deps);

  assert.equal(statusOut.state, 'running');
  assert.equal(statusOut.metadata.sessionId, SESSION);
  assert.equal(statusOut.metadata.actor, ACTOR);
  assert.deepEqual(statusOut.tmux, {
    running: true,
    session: `codex-slot-${SESSION}`,
    pid: 4321,
  });

  const stopped = await makeDeps(t);
  await prepare(stopped.deps);
  const stoppedOut = await runAgent(['status', '--session', SESSION], stopped.deps);
  assert.equal(stoppedOut.state, 'stopped');
  assert.deepEqual(stoppedOut.tmux, {
    running: false,
    session: `codex-slot-${SESSION}`,
    pid: null,
  });

  for (const failure of ['exit2', 'timeout']) {
    const failed = await makeDeps(t, {
      processHook: async ({ cmd, args }) => {
        if (cmd !== 'tmux' || args[0] !== 'has-session') {
          return undefined;
        }
        if (failure === 'timeout') {
          throw new Error('process timed out: tmux');
        }
        return { exitCode: 2, stdout: '', stderr: 'tmux unavailable' };
      },
    });
    await prepare(failed.deps);

    await assert.rejects(
      runAgent(['status', '--session', SESSION], failed.deps),
      failure === 'timeout' ? /process timed out: tmux/ : /tmux has-session failed/
    );
    assert.equal(
      failed.execCalls
        .filter((call) => call.cmd === 'tmux')
        .every((call) => call.options.timeoutMs === 10_000),
      true
    );
  }

  for (const failure of ['nonzero', 'timeout', 'invalid-pid']) {
    const failed = await makeDeps(t, {
      tmuxSessions: [`codex-slot-${SESSION}`],
      processHook: async ({ cmd, args }) => {
        if (cmd !== 'tmux' || args[0] !== 'list-panes') {
          return undefined;
        }
        if (failure === 'timeout') {
          throw new Error('process timed out: tmux');
        }
        if (failure === 'invalid-pid') {
          return { exitCode: 0, stdout: 'not-a-pid\n', stderr: '' };
        }
        return { exitCode: 2, stdout: '', stderr: 'pane lookup failed' };
      },
    });
    await prepare(failed.deps);

    await assert.rejects(
      runAgent(['status', '--session', SESSION], failed.deps),
      failure === 'timeout'
        ? /process timed out: tmux/
        : failure === 'invalid-pid'
          ? /tmux list-panes returned invalid pane pid/
          : /tmux list-panes failed/
    );
    assert.equal(
      failed.execCalls
        .filter((call) => call.cmd === 'tmux')
        .every((call) => call.options.timeoutMs === 10_000),
      true
    );
  }
});

test('stop without metadata verifies and kills only the exact tmux session without cleanup', async (t) => {
  const sessionName = `codex-slot-${SESSION}`;
  const live = await makeDeps(t, {
    tmuxSessions: [sessionName, `${sessionName}-extra`],
  });
  const unownedPaths = paths(live.home);
  const authPath = join(unownedPaths.codexHome, 'auth.json');
  await mkdir(unownedPaths.codexHome, { recursive: true, mode: 0o700 });
  await mkdir(unownedPaths.worktreePath, { recursive: true, mode: 0o700 });
  await writeFile(authPath, '{"access_token":"must-survive"}\n', { mode: 0o600 });

  const stopped = await runAgent(['stop', '--session', SESSION], live.deps);

  assert.equal(stopped.state, 'missing');
  assert.equal(stopped.verified, true);
  assert.equal(live.tmuxSessions.has(sessionName), false);
  assert.equal(live.tmuxSessions.has(`${sessionName}-extra`), true);
  assert.equal(await readFile(authPath, 'utf8'), '{"access_token":"must-survive"}\n');
  assert.equal(await exists(unownedPaths.worktreePath), true);
  assert.deepEqual(
    live.execCalls
      .filter((call) => call.cmd === 'tmux')
      .map((call) => [call.args[0], call.args.at(-1)]),
    [
      ['has-session', `=${sessionName}`],
      ['kill-session', `=${sessionName}`],
      ['has-session', `=${sessionName}`],
    ]
  );

  const absent = await makeDeps(t);
  const missing = await runAgent(['stop', '--session', SESSION], absent.deps);
  assert.equal(missing.state, 'missing');
  assert.equal(missing.verified, true);
  assert.deepEqual(
    absent.execCalls
      .filter((call) => call.cmd === 'tmux')
      .map((call) => [call.args[0], call.args.at(-1)]),
    [['has-session', `=${sessionName}`]]
  );
});

test('stop without metadata fails closed on tmux check kill or confirmation failure', async (t) => {
  const sessionName = `codex-slot-${SESSION}`;
  for (const failure of [
    'initial-error',
    'initial-timeout',
    'kill-error',
    'kill-timeout',
    'confirm-error',
    'confirm-timeout',
  ]) {
    let hasSessionCalls = 0;
    let killAttempted = false;
    const failed = await makeDeps(t, {
      tmuxSessions: [sessionName],
      processHook: async ({ cmd, args, tmuxSessions }) => {
        if (cmd !== 'tmux') return undefined;
        if (args[0] === 'has-session') {
          hasSessionCalls += 1;
          const phase = hasSessionCalls === 1 ? 'initial' : 'confirm';
          if (failure === `${phase}-timeout`) {
            throw new Error(`process timed out: tmux ${phase}`);
          }
          if (failure === `${phase}-error`) {
            return { exitCode: 2, stdout: '', stderr: `tmux ${phase} unavailable` };
          }
          return undefined;
        }
        if (args[0] === 'kill-session') {
          killAttempted = true;
          if (failure === 'kill-timeout') {
            throw new Error('process timed out: tmux kill');
          }
          if (failure === 'kill-error') {
            tmuxSessions.delete(sessionName);
            return { exitCode: 1, stdout: '', stderr: 'tmux kill failed' };
          }
        }
        return undefined;
      },
    });
    const unownedPaths = paths(failed.home);
    const authPath = join(unownedPaths.codexHome, 'auth.json');
    await mkdir(unownedPaths.codexHome, { recursive: true, mode: 0o700 });
    await mkdir(unownedPaths.worktreePath, { recursive: true, mode: 0o700 });
    await writeFile(authPath, '{"access_token":"must-survive"}\n', { mode: 0o600 });

    await assert.rejects(
      runAgent(['stop', '--session', SESSION], failed.deps),
      /tmux|kill|timed out|running/i,
      failure
    );
    assert.equal(await readFile(authPath, 'utf8'), '{"access_token":"must-survive"}\n');
    assert.equal(await exists(unownedPaths.worktreePath), true);
    assert.equal(
      failed.execCalls
        .filter((call) => call.cmd === 'tmux')
        .every((call) => call.args.at(-1) === `=${sessionName}`),
      true
    );
    if (failure.startsWith('initial-')) {
      assert.equal(killAttempted, false);
    }
  }
});

test('stop kills tmux and removes transient auth while preserving worktree history logs and metadata', async (t) => {
  await t.test('uses one session lock for prepare launch status and stop', async (t) => {
    const locked = await makeDeps(t);
    const lockPath = paths(locked.home).lockPath;
    await prepare(locked.deps);
    await runAgent(['launch', '--session', SESSION], locked.deps);
    await runAgent(['status', '--session', SESSION], locked.deps);
    await runAgent(['stop', '--session', SESSION], locked.deps);
    assert.deepEqual(locked.lockPaths, [lockPath, lockPath, lockPath, lockPath]);
  });

  await t.test('serializes launch and stop across the first tmux check', async (t) => {
    let releaseLaunchCheck;
    let announceLaunchCheck;
    const launchCheckEntered = new Promise((resolve) => {
      announceLaunchCheck = resolve;
    });
    const releaseLaunch = new Promise((resolve) => {
      releaseLaunchCheck = resolve;
    });
    let blockFirstHasSession = false;
    let blocked = false;
    let lockAttempts = 0;

    const locked = await makeDeps(t, {
      withDirLock: async (...args) => {
        lockAttempts += 1;
        return withDirLock(...args);
      },
      processHook: async ({ cmd, args }) => {
        if (
          blockFirstHasSession &&
          !blocked &&
          cmd === 'tmux' &&
          args[0] === 'has-session'
        ) {
          blocked = true;
          announceLaunchCheck();
          await releaseLaunch;
          return { exitCode: 1, stdout: '', stderr: '' };
        }
        return undefined;
      },
    });
    await prepare(locked.deps);
    const authPath = join(paths(locked.home).codexHome, 'auth.json');
    await writeFile(authPath, '{"access_token":"secret"}\n', { mode: 0o600 });
    blockFirstHasSession = true;

    const launchPromise = runAgent(['launch', '--session', SESSION], locked.deps);
    await launchCheckEntered;
    let stopSettled = false;
    const stopPromise = runAgent(['stop', '--session', SESSION], locked.deps)
      .finally(() => {
        stopSettled = true;
      });
    const waitStartedAt = Date.now();
    while (lockAttempts < 3 && !stopSettled) {
      if (Date.now() - waitStartedAt > 1000) {
        throw new Error('timed out waiting for stop to queue on the session lock');
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const settledWhileLaunchBlocked = stopSettled;
    const hasSessionCallsWhileBlocked = locked.execCalls.filter(
      (call) => call.cmd === 'tmux' && call.args[0] === 'has-session'
    ).length;
    releaseLaunchCheck();
    await launchPromise;
    await stopPromise;
    assert.equal(lockAttempts, 3);
    assert.equal(settledWhileLaunchBlocked, false);
    assert.equal(hasSessionCallsWhileBlocked, 1);
    assert.equal(locked.tmuxSessions.has(`codex-slot-${SESSION}`), false);
    assert.equal(await exists(authPath), false);
  });

  await t.test('revalidates codex home after tmux and safely removes only allowlisted leaves', async (t) => {
    let replaceOnHasSession = false;
    const raced = await makeDeps(t, {
      tmuxSessions: [`codex-slot-${SESSION}`],
      processHook: async ({ cmd, args }) => {
        if (replaceOnHasSession && cmd === 'tmux' && args[0] === 'has-session') {
          replaceOnHasSession = false;
          const racedPaths = paths(raced.home);
          await realFs.rename(racedPaths.codexHome, join(raced.home, 'displaced-codex-home'));
          await realFs.symlink(join(raced.home, 'outside-codex-home'), racedPaths.codexHome);
        }
        return undefined;
      },
    });
    await prepare(raced.deps);
    const outsideCodexHome = join(raced.home, 'outside-codex-home');
    const outsideAuth = join(outsideCodexHome, 'auth.json');
    await mkdir(outsideCodexHome, { recursive: true, mode: 0o700 });
    await writeFile(outsideAuth, '{"access_token":"keep"}\n', { mode: 0o600 });
    replaceOnHasSession = true;

    await assert.rejects(runAgent(['stop', '--session', SESSION], raced.deps), /symlink/);
    assert.equal(await readFile(outsideAuth, 'utf8'), '{"access_token":"keep"}\n');

    const cleaned = await makeDeps(t);
    await prepare(cleaned.deps);
    const cleanedPaths = paths(cleaned.home);
    const externalFile = join(cleaned.home, 'external-auth.json');
    const externalHeartbeat = join(cleaned.home, 'external-heartbeat');
    const externalLease = join(externalHeartbeat, 'lease.json');
    const recursiveRemovals = [];
    await writeFile(externalFile, '{"access_token":"keep"}\n', { mode: 0o600 });
    await mkdir(externalHeartbeat, { recursive: true, mode: 0o700 });
    await writeFile(externalLease, '{"lease":"keep"}\n', { mode: 0o600 });
    await symlink(externalFile, join(cleanedPaths.codexHome, 'auth.json'));
    await symlink(externalHeartbeat, join(cleanedPaths.codexHome, 'lease-heartbeat'));
    cleaned.deps.fs = {
      ...realFs,
      rm: async (path, options) => {
        if (options?.recursive) {
          recursiveRemovals.push(path);
        }
        return realFs.rm(path, options);
      },
    };

    await runAgent(['stop', '--session', SESSION], cleaned.deps);
    assert.deepEqual(recursiveRemovals, []);
    assert.equal(await readFile(externalFile, 'utf8'), '{"access_token":"keep"}\n');
    assert.equal(await readFile(externalLease, 'utf8'), '{"lease":"keep"}\n');
    assert.equal(await exists(join(cleanedPaths.codexHome, 'auth.json')), false);
    assert.equal(await exists(join(cleanedPaths.codexHome, 'lease-heartbeat')), false);
  });

  const { deps, execCalls, home } = await makeDeps(t);
  await prepare(deps);
  await runAgent(['launch', '--session', SESSION], deps);
  execCalls.length = 0;

  const p = paths(home);
  const historyPath = join(p.codexHome, 'history.jsonl');
  const authPath = join(p.codexHome, 'auth.json');
  const leasePath = join(p.codexHome, 'lease-heartbeat', 'lease.json');
  await mkdir(join(p.codexHome, 'lease-heartbeat'), { recursive: true, mode: 0o700 });
  await writeFile(authPath, '{"access_token":"secret"}\n', { mode: 0o600 });
  await writeFile(leasePath, '{"lease":"secret"}\n', { mode: 0o600 });
  await writeFile(historyPath, '{"role":"assistant"}\n', 'utf8');
  await writeFile(join(p.logsDir, 'agent.log'), 'log\n', 'utf8');

  assert.equal((await runAgent(['stop', '--session', SESSION], deps)).ok, true);
  assert.equal(await exists(authPath), false);
  assert.equal(await exists(leasePath), false);
  assert.equal(await exists(p.worktreePath), true);
  assert.equal(await exists(historyPath), true);
  assert.equal(await exists(p.logsDir), true);
  assert.equal(await exists(p.metadataPath), true);
  assert.equal(execCalls.some((call) => call.cmd === 'tmux' && call.args[0] === 'kill-session'), true);
  assert.equal(
    execCalls.filter((call) => call.cmd === 'tmux' && call.args[0] === 'has-session').length,
    2
  );

  const second = await runAgent(['stop', '--session', SESSION], deps);
  assert.equal(second.ok, true);
  assert.equal(await exists(authPath), false);
  assert.equal(await exists(historyPath), true);

  const escaped = await makeDeps(t);
  await prepare(escaped.deps);
  await runAgent(['launch', '--session', SESSION], escaped.deps);
  const escapedPaths = paths(escaped.home);
  const outsideHeartbeat = join(escaped.home, 'outside-heartbeat');
  const outsideLease = join(outsideHeartbeat, 'lease.json');
  await mkdir(outsideHeartbeat, { recursive: true, mode: 0o700 });
  await writeFile(outsideLease, '{"lease":"must survive"}\n', { mode: 0o600 });
  await symlink(outsideHeartbeat, join(escapedPaths.codexHome, 'lease-heartbeat'));
  await runAgent(['stop', '--session', SESSION], escaped.deps);
  assert.equal(await readFile(outsideLease, 'utf8'), '{"lease":"must survive"}\n');

  for (const failure of ['nonzero', 'timeout', 'still-running', 'verify-error']) {
    let killAttempted = false;
    const failed = await makeDeps(t, {
      processHook: async ({ cmd, args }) => {
        if (cmd !== 'tmux') {
          return undefined;
        }
        if (failure === 'verify-error' && args[0] === 'has-session' && killAttempted) {
          return { exitCode: 2, stdout: '', stderr: 'tmux unavailable' };
        }
        if (args[0] !== 'kill-session') {
          return undefined;
        }
        killAttempted = true;
        if (failure === 'timeout') {
          throw new Error('process timed out: tmux');
        }
        return {
          exitCode: failure === 'nonzero' ? 1 : 0,
          stdout: '',
          stderr: failure === 'nonzero' ? 'kill failed' : '',
        };
      },
    });
    await prepare(failed.deps);
    await runAgent(['launch', '--session', SESSION], failed.deps);
    const failedPaths = paths(failed.home);
    const failedAuth = join(failedPaths.codexHome, 'auth.json');
    const failedLease = join(failedPaths.codexHome, 'lease-heartbeat', 'lease.json');
    await mkdir(join(failedPaths.codexHome, 'lease-heartbeat'), { recursive: true, mode: 0o700 });
    await writeFile(failedAuth, '{"access_token":"keep"}\n', { mode: 0o600 });
    await writeFile(failedLease, '{"lease":"keep"}\n', { mode: 0o600 });

    await assert.rejects(runAgent(['stop', '--session', SESSION], failed.deps), /tmux|kill|running|timed out/);
    assert.equal(await exists(failedAuth), true);
    assert.equal(await exists(failedLease), true);
  }
});

test('legacy-list scans slot1 through slot10 read-only', async (t) => {
  const { deps, execCalls } = await makeDeps(t);
  const result = await runAgent(['legacy-list', '--host', 'xian-m4'], deps);

  assert.equal(result.length, 10);
  assert.deepEqual(result.map((entry) => entry.handle), Array.from({ length: 10 }, (_, index) => `legacy/xian-m4/slot${index + 1}`));
  assert.deepEqual(result.map((entry) => entry.host), Array(10).fill('xian-m4'));
  assert.deepEqual(result.map((entry) => entry.tmuxSession), Array.from({ length: 10 }, (_, index) => `slot${index + 1}`));
  assert.equal(execCalls.some((call) => /kill|remove|rename/.test([call.cmd, ...call.args].join(' '))), false);
});
