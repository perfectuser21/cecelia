import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat as fsStat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runBroker } from './codex-slot-broker.mjs';

const NOW = new Date('2026-07-23T00:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

async function tempRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'codex-slot-broker-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function jwtWithExp(expSeconds, marker = 'secret') {
  return [
    base64urlJson({ alg: 'none', typ: 'JWT' }),
    base64urlJson({ exp: expSeconds, marker }),
    `sig-${marker}`,
  ].join('.');
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

async function writeAuth(home, team, options = {}) {
  const {
    mode = 0o600,
    exp = NOW_SECONDS + 200_000,
    marker = team,
    refresh = `refresh-secret-${team}`,
  } = options;
  const dir = join(home, `.codex-${team}`);
  await mkdir(dir, { recursive: true });
  const authPath = join(dir, 'auth.json');
  await writeFile(
    authPath,
    `${JSON.stringify({
      access_token: jwtWithExp(exp, marker),
      refresh_token: refresh,
    })}\n`,
    'utf8'
  );
  await chmod(authPath, mode);
  return authPath;
}

function brokerDeps(root, home, overrides = {}) {
  return {
    root,
    home,
    user: 'administrator',
    actorMap: { administrator: 'alex', morgan: 'morgan' },
    now: () => NOW,
    queryUsage: async ({ team }) => ({ usedPercent: ({ team1: 50 }[team] ?? 25) }),
    ...overrides,
  };
}

function slotHost(root) {
  return {
    'xian-m4': {
      slotRoot: join(root, 'hosts', 'xian-m4', 'slots'),
      sshHost: 'xian-m4.example',
    },
    'xian-m1': {
      slotRoot: join(root, 'hosts', 'xian-m1', 'slots'),
      sshHost: 'xian-m1.example',
    },
  };
}

function remoteAuthPath(hostRegistry, host, actor, sessionId) {
  return resolve(join(hostRegistry[host].slotRoot, actor, sessionId, 'codex-home', 'auth.json'));
}

test('identity uses the server-side user mapping and ignores client actor input', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');

  const out = await runBroker(
    ['identity', '--actor', 'coworker'],
    brokerDeps(root, home)
  );

  assert.deepEqual(out, { ok: true, user: 'administrator', actor: 'alex' });
});

test('identity rejects an unmapped server user', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');

  await assert.rejects(
    runBroker(['identity'], brokerDeps(root, home, { user: 'unknown-user' })),
    /unknown user/
  );
});

test('acquire rejects forged actor and manually selected team', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');

  await assert.rejects(
    runBroker(
      ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4', '--actor', 'coworker'],
      brokerDeps(root, home)
    ),
    /不允许客户端指定 actor/
  );
  await assert.rejects(
    runBroker(
      ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4', '--team', 'team1'],
      brokerDeps(root, home)
    ),
    /不允许手工选择 team/
  );
});

test('acquire filters auth sources and leases the lowest usage valid team without leaking tokens', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1', { marker: 'high-usage-secret' });
  await writeAuth(home, 'team3', { marker: 'low-usage-secret' });

  const out = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home, {
      queryUsage: async ({ team }) => ({
        usedPercent: team === 'team1' ? 70 : 12,
      }),
    })
  );

  assert.equal(out.team, 'team3');
  assert.equal(out.actor, 'alex');
  assert.equal(out.sessionId, 'alex-infra-main');
  assert.doesNotMatch(JSON.stringify(out), /access_token|refresh_token|secret|eyJ/);
});

test('acquire replays only the exact actor request session tuple', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  await writeAuth(home, 'team2');
  const deps = brokerDeps(root, home);

  const first = await runBroker(
    [
      'acquire',
      '--session',
      'alex-infra-main',
      '--host',
      'xian-m4',
      '--request',
      'request-main',
    ],
    deps
  );
  const replay = await runBroker(
    [
      'acquire',
      '--session',
      'alex-infra-main',
      '--host',
      'xian-m4',
      '--request',
      'request-main',
    ],
    deps
  );
  assert.equal(replay.leaseId, first.leaseId);
  assert.equal(replay.requestId, 'request-main');

  const other = await runBroker(
    [
      'acquire',
      '--session',
      'alex-infra-main',
      '--host',
      'xian-m4',
      '--request',
      'request-other',
    ],
    deps
  );
  assert.notEqual(other.leaseId, first.leaseId);
  assert.equal(other.requestId, 'request-other');
});

test('acquire recovers an exact lease even when its team is no longer allocatable', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  await writeAuth(home, 'team2');
  let replay = false;
  const deps = brokerDeps(root, home, {
    queryUsage: async ({ team }) => ({
      usedPercent: replay
        ? 95
        : (team === 'team1' ? 10 : 20),
    }),
  });
  const argv = [
    'acquire',
    '--session',
    'alex-infra-main',
    '--host',
    'xian-m4',
    '--request',
    'request-main',
  ];

  const first = await runBroker(argv, deps);
  replay = true;
  const recovered = await runBroker(argv, deps);

  assert.equal(recovered.leaseId, first.leaseId);
  assert.equal(recovered.team, 'team1');
});

test('acquire fails closed for missing auth, wrong mode, short JWT and usage query failure', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team2', { mode: 0o644, marker: 'mode-secret' });
  await writeAuth(home, 'team3', {
    exp: NOW_SECONDS + 3_600,
    marker: 'expiring-secret',
  });
  await writeAuth(home, 'team4', { marker: 'usage-secret' });

  await assert.rejects(
    async () => runBroker(
      ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
      brokerDeps(root, home, {
        queryUsage: async ({ team, auth }) => {
          if (team === 'team4') {
            throw new Error(`usage failed ${auth.access_token} ${auth.refresh_token}`);
          }
          return { usedPercent: 10 };
        },
      })
    ),
    (error) => {
      assert.match(error.message, /no usable account/);
      assert.doesNotMatch(String(error.stack), /access_token|refresh_token|secret|eyJ/);
      return true;
    }
  );
});

test('acquire skips teams at or above 90 percent usage', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  await writeAuth(home, 'team2');

  const out = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home, {
      queryUsage: async ({ team }) => ({
        usedPercent: team === 'team1' ? 90 : 89.9,
      }),
    })
  );

  assert.equal(out.team, 'team2');
});

test('acquire rejects unsafe actor and session before usage checks and lease writes', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  let usageCalls = 0;

  for (const attempt of [
    {
      argv: ['acquire', '--session', 'alex;touch', '--host', 'xian-m4'],
      deps: brokerDeps(root, home, {
        queryUsage: async () => {
          usageCalls += 1;
          return { usedPercent: 10 };
        },
      }),
      error: /sessionId.*\[A-Za-z0-9\._-\]\+/,
    },
    {
      argv: ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
      deps: brokerDeps(root, home, {
        actorMap: { administrator: 'alex;touch' },
        queryUsage: async () => {
          usageCalls += 1;
          return { usedPercent: 10 };
        },
      }),
      error: /actor.*\[A-Za-z0-9\._-\]\+/,
    },
  ]) {
    await assert.rejects(
      runBroker(attempt.argv, attempt.deps),
      attempt.error
    );
  }

  assert.equal(usageCalls, 0);
  await assert.rejects(
    fsStat(join(root, 'registry', 'leases', 'team1.json')),
    /ENOENT/
  );
});

test('deliver validates the lease, actor, target host, path boundary and output metadata', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1', { marker: 'deliver-secret' });
  const hostRegistry = slotHost(root);
  const targetPath = remoteAuthPath(hostRegistry, 'xian-m4', 'alex', 'alex-infra-main');
  let delivered = null;
  let deliveredMode = null;

  const lease = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home)
  );
  const out = await runBroker(
    ['deliver', '--lease', lease.leaseId, '--target', 'xian-m4', '--path', targetPath],
    brokerDeps(root, home, {
      hostRegistry,
      deliverAuth: async (args) => {
        delivered = args;
        deliveredMode = (await fsStat(args.source)).mode & 0o777;
      },
    })
  );

  assert.deepEqual(out, { ok: true, team: 'team1', target: 'xian-m4' });
  assert.equal(delivered.target, 'xian-m4');
  assert.equal(delivered.path, targetPath);
  assert.equal(delivered.mode, 0o600);
  assert.notEqual(delivered.source, join(home, '.codex-team1', 'auth.json'));
  assert.ok(delivered.source.startsWith(join(root, 'tmp', 'deliver-')));
  assert.equal(deliveredMode, 0o600);
  assert.doesNotMatch(JSON.stringify(out), /access_token|refresh_token|secret|eyJ/);
});

test('deliver rejects a loaded lease whose id does not match the requested lease id', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  const hostRegistry = slotHost(root);
  const targetPath = join(hostRegistry['xian-m4'].slotRoot, 'alex', 'main', 'auth.json');

  await assert.rejects(
    runBroker(
      ['deliver', '--lease', 'requested-lease', '--target', 'xian-m4', '--path', targetPath],
      brokerDeps(root, home, {
        hostRegistry,
        loadLease: async () => ({
          leaseId: 'different-lease',
          team: 'team1',
          actor: 'alex',
          state: 'active',
        }),
      })
    ),
    /leaseId mismatch/
  );
});

test('deliver rejects leases owned by another actor', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  const hostRegistry = slotHost(root);
  const targetPath = join(hostRegistry['xian-m4'].slotRoot, 'alex', 'main', 'auth.json');

  const lease = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home)
  );

  await assert.rejects(
    runBroker(
      ['deliver', '--lease', lease.leaseId, '--target', 'xian-m4', '--path', targetPath],
      brokerDeps(root, home, {
        user: 'morgan',
        hostRegistry,
      })
    ),
    /lease actor mismatch/
  );
});

test('deliver rejects unknown targets and paths outside the host slot root', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  const hostRegistry = slotHost(root);
  const lease = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home)
  );

  await assert.rejects(
    runBroker(
      ['deliver', '--lease', lease.leaseId, '--target', 'unknown-host', '--path', '/tmp/auth.json'],
      brokerDeps(root, home, { hostRegistry })
    ),
    /unknown target host/
  );
  await assert.rejects(
    runBroker(
      ['deliver', '--lease', lease.leaseId, '--target', 'xian-m4', '--path', 'relative/auth.json'],
      brokerDeps(root, home, { hostRegistry })
    ),
    /absolute path/
  );
  await assert.rejects(
    runBroker(
      [
        'deliver',
        '--lease',
        lease.leaseId,
        '--target',
        'xian-m4',
        '--path',
        resolve(hostRegistry['xian-m4'].slotRoot, '..', 'outside', 'auth.json'),
      ],
      brokerDeps(root, home, { hostRegistry })
    ),
    /outside host slotRoot/
  );
});

test('deliver rejects cross-host and non-exact auth destinations under a slot root', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  const hostRegistry = slotHost(root);
  const lease = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home)
  );

  const attempts = [
    {
      name: 'xian-m4 lease delivered to xian-m1',
      target: 'xian-m1',
      path: remoteAuthPath(hostRegistry, 'xian-m1', 'alex', 'alex-infra-main'),
      error: /lease host mismatch/,
    },
    {
      name: 'same root other actor',
      target: 'xian-m4',
      path: remoteAuthPath(hostRegistry, 'xian-m4', 'morgan', 'alex-infra-main'),
      error: /deliver path mismatch/,
    },
    {
      name: 'same root other session',
      target: 'xian-m4',
      path: remoteAuthPath(hostRegistry, 'xian-m4', 'alex', 'alex-infra-other'),
      error: /deliver path mismatch/,
    },
    {
      name: 'same root other file',
      target: 'xian-m4',
      path: resolve(join(hostRegistry['xian-m4'].slotRoot, 'alex', 'alex-infra-main', 'codex-home', 'auth.json.bak')),
      error: /deliver path mismatch/,
    },
    {
      name: 'semicolon path injection',
      target: 'xian-m4',
      path: resolve(join(hostRegistry['xian-m4'].slotRoot, 'alex', 'alex-infra-main', 'codex-home', 'auth.json; touch /tmp/pwned')),
      error: /deliver path mismatch/,
    },
  ];

  for (const attempt of attempts) {
    await assert.rejects(
      runBroker(
        ['deliver', '--lease', lease.leaseId, '--target', attempt.target, '--path', attempt.path],
        brokerDeps(root, home, {
          hostRegistry,
          deliverAuth: async () => {
            throw new Error(`unexpected delivery for ${attempt.name}`);
          },
        })
      ),
      attempt.error,
      attempt.name
    );
  }
});

test('deliver rejects unsafe lease actor and session segments before remote path use', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  const hostRegistry = slotHost(root);

  await assert.rejects(
    runBroker(
      [
        'deliver',
        '--lease',
        'unsafe-actor-lease',
        '--target',
        'xian-m4',
        '--path',
        resolve(join(hostRegistry['xian-m4'].slotRoot, 'alex;touch', 'alex-infra-main', 'codex-home', 'auth.json')),
      ],
      brokerDeps(root, home, {
        actorMap: { administrator: 'alex;touch' },
        hostRegistry,
        loadLease: async () => ({
          leaseId: 'unsafe-actor-lease',
          team: 'team1',
          actor: 'alex;touch',
          sessionId: 'alex-infra-main',
          host: 'xian-m4',
          state: 'active',
        }),
        deliverAuth: async () => {
          throw new Error('unexpected delivery for unsafe actor');
        },
      })
    ),
    /actor.*\[A-Za-z0-9\._-\]\+/
  );

  await assert.rejects(
    runBroker(
      [
        'deliver',
        '--lease',
        'unsafe-session-lease',
        '--target',
        'xian-m4',
        '--path',
        resolve(join(hostRegistry['xian-m4'].slotRoot, 'alex', 'alex-infra-main;touch', 'codex-home', 'auth.json')),
      ],
      brokerDeps(root, home, {
        hostRegistry,
        loadLease: async () => ({
          leaseId: 'unsafe-session-lease',
          team: 'team1',
          actor: 'alex',
          sessionId: 'alex-infra-main;touch',
          host: 'xian-m4',
          state: 'active',
        }),
        deliverAuth: async () => {
          throw new Error('unexpected delivery for unsafe session');
        },
      })
    ),
    /sessionId.*\[A-Za-z0-9\._-\]\+/
  );
});

test('deliver re-reads auth JSON and rejects a token that becomes too short after acquire', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  const hostRegistry = slotHost(root);
  const lease = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home)
  );

  await writeAuth(home, 'team1', {
    exp: NOW_SECONDS + 60,
    marker: 'short-after-acquire',
  });

  await assert.rejects(
    runBroker(
      [
        'deliver',
        '--lease',
        lease.leaseId,
        '--target',
        'xian-m4',
        '--path',
        remoteAuthPath(hostRegistry, 'xian-m4', 'alex', 'alex-infra-main'),
      ],
      brokerDeps(root, home, {
        hostRegistry,
        queryUsage: async () => {
          throw new Error('usage must not run during deliver');
        },
        deliverAuth: async () => {
          throw new Error('unexpected delivery for short JWT');
        },
      })
    ),
    /auth token expires too soon/
  );
});

test('deliver holds the lease lock until delivery finishes so release cannot settle early', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  const hostRegistry = slotHost(root);
  const lease = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home)
  );
  const deliveryEntered = deferred();
  const unblockDelivery = deferred();
  let releaseSettled = false;

  const deliverPromise = runBroker(
    [
      'deliver',
      '--lease',
      lease.leaseId,
      '--target',
      'xian-m4',
      '--path',
      remoteAuthPath(hostRegistry, 'xian-m4', 'alex', 'alex-infra-main'),
    ],
    brokerDeps(root, home, {
      hostRegistry,
      deliverAuth: async () => {
        deliveryEntered.resolve();
        await unblockDelivery.promise;
      },
    })
  );

  await deliveryEntered.promise;
  const releasePromise = runBroker(
    ['release', '--team', 'team1', '--lease', lease.leaseId],
    brokerDeps(root, home)
  ).finally(() => {
    releaseSettled = true;
  });

  try {
    await sleep(80);
    assert.equal(releaseSettled, false);
    unblockDelivery.resolve();
    const [delivered, released] = await Promise.all([deliverPromise, releasePromise]);
    assert.deepEqual(delivered, { ok: true, team: 'team1', target: 'xian-m4' });
    assert.equal(released.state, 'released');
  } finally {
    unblockDelivery.resolve();
    await Promise.allSettled([deliverPromise, releasePromise]);
  }
});

test('deliver passes a 0600 auth snapshot that survives live auth replacement and is removed afterward', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  const liveAuthPath = await writeAuth(home, 'team1', { marker: 'original-marker' });
  const hostRegistry = slotHost(root);
  const lease = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home)
  );
  let deliveredSource = null;
  let deliveredMode = null;
  let deliveredBytes = null;

  await runBroker(
    [
      'deliver',
      '--lease',
      lease.leaseId,
      '--target',
      'xian-m4',
      '--path',
      remoteAuthPath(hostRegistry, 'xian-m4', 'alex', 'alex-infra-main'),
    ],
    brokerDeps(root, home, {
      hostRegistry,
      deliverAuth: async ({ source }) => {
        deliveredSource = source;
        await writeAuth(home, 'team1', { marker: 'replaced-marker' });
        deliveredMode = (await fsStat(source)).mode & 0o777;
        deliveredBytes = await readFile(source, 'utf8');
      },
    })
  );

  assert.notEqual(deliveredSource, liveAuthPath);
  assert.ok(deliveredSource.startsWith(join(root, 'tmp', 'deliver-')));
  assert.equal(deliveredMode, 0o600);
  assert.match(deliveredBytes, /original-marker/);
  assert.doesNotMatch(deliveredBytes, /replaced-marker/);
  await assert.rejects(fsStat(deliveredSource), /ENOENT/);
});

test('default deliverAuth hardens ssh commands and POSIX-quotes remote paths', async () => {
  const broker = await import('./codex-slot-broker.mjs');
  assert.equal(typeof broker.makeDefaultDeliverAuth, 'function');
  const calls = [];
  const hostRegistry = {
    'xian-m4': {
      slotRoot: '/unused',
      sshHost: 'xian-m4.example',
    },
  };
  const deliverAuth = broker.makeDefaultDeliverAuth(hostRegistry, {
    runProcess: async (cmd, args, options) => {
      calls.push({ cmd, args, options });
    },
  });
  const remotePath = '/tmp/slots/alex/main/codex-home/auth.json; touch /tmp/pwned';
  const quotedRemotePath = "'/tmp/slots/alex/main/codex-home/auth.json; touch /tmp/pwned'";

  await deliverAuth({
    source: '/local/auth.json',
    target: 'xian-m4',
    path: remotePath,
    mode: 0o600,
  });

  assert.deepEqual(calls, [
    {
      cmd: 'scp',
      args: [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=15',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=2',
        '-p',
        '/local/auth.json',
        `xian-m4.example:${quotedRemotePath}`,
      ],
      options: { timeoutMs: 30_000 },
    },
    {
      cmd: 'ssh',
      args: [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=15',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=2',
        'xian-m4.example',
        `chmod 600 ${quotedRemotePath}`,
      ],
      options: { timeoutMs: 30_000 },
    },
  ]);
});

test('runProcess enforces a local timeout and kills long-running children', async () => {
  const broker = await import('./codex-slot-broker.mjs');
  assert.equal(typeof broker.runProcess, 'function');
  const startedAt = Date.now();

  await assert.rejects(
    broker.runProcess(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000);'],
      { timeoutMs: 50 }
    ),
    /timed out after 50ms/
  );

  assert.ok(Date.now() - startedAt < 5_000);
});

test('heartbeat and release verify the current actor before mutating a lease', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  const lease = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home)
  );

  const heartbeat = await runBroker(
    ['heartbeat', '--team', 'team1', '--lease', lease.leaseId],
    brokerDeps(root, home)
  );
  assert.equal(heartbeat.updatedAt, NOW.toISOString());

  await assert.rejects(
    runBroker(
      ['release', '--team', 'team1', '--lease', lease.leaseId],
      brokerDeps(root, home, { user: 'morgan' })
    ),
    /lease actor mismatch/
  );

  const released = await runBroker(
    ['release', '--team', 'team1', '--lease', lease.leaseId, '--state', 'quarantined'],
    brokerDeps(root, home)
  );
  assert.equal(released.state, 'quarantined');
});

test('release replays the same terminal state but distinguishes quarantined from released', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  await writeAuth(home, 'team1');
  const lease = await runBroker(
    ['acquire', '--session', 'alex-infra-main', '--host', 'xian-m4'],
    brokerDeps(root, home)
  );

  const quarantined = await runBroker(
    ['release', '--team', lease.team, '--lease', lease.leaseId, '--state', 'quarantined'],
    brokerDeps(root, home)
  );
  const replay = await runBroker(
    ['release', '--team', lease.team, '--lease', lease.leaseId, '--state', 'quarantined'],
    brokerDeps(root, home)
  );
  assert.deepEqual(replay, quarantined);

  await assert.rejects(
    runBroker(
      ['release', '--team', lease.team, '--lease', lease.leaseId, '--state', 'released'],
      brokerDeps(root, home)
    ),
    /terminal state conflict: quarantined/
  );
});

test('session-put, session-get and session-list use broker actor visibility', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  const alexSession = {
    sessionId: 'alex-infra-main',
    actor: 'alex',
    host: 'xian-m4',
    state: 'running',
  };
  const morganSession = {
    sessionId: 'morgan-infra-main',
    actor: 'morgan',
    host: 'xian-m4',
    state: 'running',
  };

  await runBroker(
    ['session-put', '--json', base64urlJson(alexSession)],
    brokerDeps(root, home)
  );
  await runBroker(
    ['session-put', '--json', base64urlJson(morganSession)],
    brokerDeps(root, home, { user: 'morgan' })
  );
  await assert.rejects(
    runBroker(
      ['session-put', '--json', base64urlJson({ ...alexSession, actor: 'morgan' })],
      brokerDeps(root, home)
    ),
    /session actor mismatch/
  );
  await assert.rejects(
    runBroker(
      ['session-put', '--json', base64urlJson({ ...morganSession, actor: 'alex', state: 'hijacked' })],
      brokerDeps(root, home)
    ),
    /existing session actor mismatch/
  );

  assert.deepEqual(
    (await runBroker(['session-list'], brokerDeps(root, home))).map((item) => item.sessionId),
    ['alex-infra-main']
  );
  assert.deepEqual(
    (await runBroker(['session-list', '--admin'], brokerDeps(root, home))).map((item) => item.sessionId).sort(),
    ['alex-infra-main', 'morgan-infra-main']
  );
  await assert.rejects(
    runBroker(['session-list', '--admin'], brokerDeps(root, home, { user: 'morgan' })),
    /admin access denied/
  );
  assert.equal(
    (await runBroker(['session-get', '--session', 'alex-infra-main'], brokerDeps(root, home))).actor,
    'alex'
  );
  assert.equal(
    await runBroker(['session-get', '--session', 'morgan-infra-main'], brokerDeps(root, home)),
    null
  );
});

test('concurrent session-put for the same new session lets exactly one actor claim it', async (t) => {
  const root = await tempRoot(t);
  const home = join(root, 'home');
  const sessionId = 'shared-infra-main';
  const alexSession = {
    sessionId,
    actor: 'alex',
    host: 'xian-m4',
    state: 'alex-running',
  };
  const morganSession = {
    sessionId,
    actor: 'morgan',
    host: 'xian-m4',
    state: 'morgan-running',
  };

  const results = await Promise.allSettled([
    runBroker(
      ['session-put', '--json', base64urlJson(alexSession)],
      brokerDeps(root, home)
    ),
    runBroker(
      ['session-put', '--json', base64urlJson(morganSession)],
      brokerDeps(root, home, { user: 'morgan' })
    ),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /existing session actor mismatch/);

  const stored = await runBroker(
    ['session-get', '--session', sessionId],
    brokerDeps(root, home, { user: fulfilled[0].value.actor === 'alex' ? 'administrator' : 'morgan' })
  );
  assert.equal(stored.actor, fulfilled[0].value.actor);
  assert.equal(stored.state, fulfilled[0].value.state);
});
