import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { root, fixture, clientCommands } from './fixtures/smoke-production-guard-fixture.mjs';

const scripts = ['notion-mapping-r4', 'notion-endpoints', 'notion-brain-first'];

for (const script of scripts) {
  test(`${script}: no explicit authorization sends no requests`, async () => {
    await fixture(async ({ requests, smoke }) => {
      const result = await smoke(script);
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(requests, [], 'default smoke contacted a live Brain');
    });
  });
  test(`${script}: authorized isolated test container still exercises writes`, async () => {
    await fixture(async ({ requests, smoke }) => {
      const result = await smoke(script, { SMOKE_ALLOW_WRITE: '1' });
      assert.equal(result.code, 0, result.output);
      assert.ok(requests.some(req => req.method === 'POST'), 'authorized test smoke did not exercise API');
    });
  });
}

for (const [name, mutate] of [
  ['production DB', info => { info.Config.Env[1] = 'DB_NAME=cecelia'; }],
  ['production NODE_ENV', info => { info.Config.Env[0] = 'NODE_ENV=production'; }],
  ['production DATABASE_URL override', info => { info.Config.Env.push('DATABASE_URL=postgresql://user@host/cecelia'); }],
  ['unknown database', info => { info.Config.Env[1] = 'DB_NAME=customer_test'; }],
  ['stopped container', info => { info.State.Running = false; }],
  ['mismatched host port', info => { info.Config.Env[2] = 'BRAIN_PORT=9'; }],
  ['shared container network', info => { info.HostConfig.NetworkMode = 'container:production'; }],
  ['bridge without published port', info => { info.HostConfig.NetworkMode = 'bridge'; }],
]) {
  test(`authorized smoke rejects ${name} without API requests`, async () => {
    await fixture(async ({ requests, smoke, info }) => {
      mutate(info);
      const result = await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' }, info);
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(requests, [], `${name} passed write guard`);
    });
  });
}

test('unknown Docker identity cannot authorize writes', async () => {
  await fixture(async ({ requests, smoke }) => {
    const result = await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1', GUARD_DOCKER_FIXTURE: 'invalid JSON' });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(requests, []);
  });
});

test('production scheduler behind a matching proxy receives only a health GET', async () => {
  process.env.GUARD_FIXTURE_ROLE = 'scheduler_only';
  try {
    await fixture(async ({ requests, smoke }) => {
      const result = await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' });
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(requests, [{ method: 'GET', url: '/api/brain/health' }]);
    });
  } finally { delete process.env.GUARD_FIXTURE_ROLE; }
});

test('published bridge port can identify isolated staging', async () => {
  await fixture(async ({ requests, smoke, info, port }) => {
    info.HostConfig.NetworkMode = 'bridge';
    info.Config.Env[1] = 'DB_NAME=cecelia_staging';
    info.Config.Env[2] = 'BRAIN_PORT=5221';
    info.NetworkSettings.Ports = { '5221/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] };
    const result = await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' }, info);
    assert.equal(result.code, 0, result.output);
    assert.ok(requests.some(req => req.method === 'POST'));
  });
});

test('DB-writing smoke refuses a production cleanup connection', async () => {
  await fixture(async ({ requests, smoke }) => {
    const result = await smoke('notion-brain-first', { SMOKE_ALLOW_WRITE: '1', DATABASE_URL: 'postgresql://cecelia@localhost:5432/cecelia' });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(requests, []);
  });
});

for (const overrides of [
  { BRAIN_CONTAINER: '' },
  { SMOKE_ALLOW_WRITE: 'true' },
  { BRAIN: 'http://100.79.41.61:5221' },
  { BRAIN: 'http://127.0.0.1:5221/api/brain' },
]) {
  test(`unverifiable target configuration is denied: ${JSON.stringify(overrides)}`, async () => {
    await fixture(async ({ requests, smoke }) => {
      const result = await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1', ...overrides });
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(requests, []);
    });
  });
}

for (const connection of [
  'postgresql://cecelia@localhost:5432/cecelia_test?dbname=cecelia',
  'postgresql://cecelia@localhost:5432/cecelia_test#cecelia',
  'https://localhost:5432/cecelia_test',
  'postgresql://cecelia@remote-server:5432/cecelia_test',
  'postgresql://cecelia@localhost:9999/cecelia_test',
]) {
  test(`cleanup connection must resolve to the same local DB service: ${connection}`, async () => {
    await fixture(async ({ requests, smoke }) => {
      const result = await smoke('notion-brain-first', { SMOKE_ALLOW_WRITE: '1', DATABASE_URL: connection });
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(requests, [], 'unsafe effective cleanup DB target passed guard');
    });
  });
}

for (const script of ['inbox-p1', 'clips-notion', 'claimed-by-cleared', 'task-tasks-dedup']) {
  test(`${script}: direct entry must refuse unauthorized writes`, async () => {
    await fixture(async ({ requests, smoke }) => {
      await smoke(script);
      assert.deepEqual(requests, [], 'standalone smoke mutated Brain without authorization');
    });
  });
}


test('all explicit live Brain shell write entries remain registered and guarded', async () => {
  const listed = new Set((await readFile(resolve(root, 'packages/quality/smoke-write-targets.txt'), 'utf8'))
    .split('\n').filter(line => line && !line.startsWith('#')));
  const smokeDir = resolve(root, 'packages/brain/scripts/smoke');
  const sqlClassification = JSON.parse(await readFile(resolve(root, 'packages/quality/smoke-sql-targets.json'), 'utf8'));
  const optional = new Set(['notion-mapping-r4-smoke.sh', 'notion-endpoints-smoke.sh', 'notion-brain-first-smoke.sh']);
  for (const name of await readdir(smokeDir)) {
    if (!name.endsWith('.sh')) continue;
    const source = await readFile(resolve(smokeDir, name), 'utf8');
    const httpWrite = /\b(?:curl|brain_curl)\b[^\n]*-X\s+(POST|PATCH|DELETE|PUT|["']?\$)/
      .test(source.replace(/\\\r?\n/g, ' '));
    const sqlWrite = /\bpsql\b/.test(source)
      && /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\s/i.test(source);
    if (!httpWrite && !sqlWrite) continue;
    if (!httpWrite && sqlClassification[name]?.kind === 'readonly') {
      assert.equal(createHash('sha256').update(source).digest('hex'), sqlClassification[name].sha256,
        `${name}: changed SQL classification requires review before readonly exemption`);
      assert.ok(sqlClassification[name].evidence);
      continue;
    }
    if (name === 'callback-stage-receipt-smoke.sh') {
      assert.match(source, /127\.0\.0\.1:\$PORT/, 'fixture exception must remain tied to its private server');
      continue;
    }
    assert.ok(listed.has(name), `${name}: new live write script must join write guard inventory`);
    assert.match(source, /smoke-production-guard\.mjs/, `${name}: standalone write guard missing`);
    if (name === 'unified-work-router-role-chain-smoke.sh') {
      const prefix = source.slice(0, source.indexOf('if ! node '));
      assert.doesNotMatch(prefix, /(?:^|[ \t;(])(?:curl|psql|mkdir|docker|cd|git|node)\b|\$\(/m,
        'Harness input checks must remain inert before write guard');
    } else if (!optional.has(name)) {
      const commands = source.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      assert.match(commands[1], /if ! node.*smoke-production-guard\.mjs/, `${name}: guard must run before any side effect`);
    }
  }
});

test('ratchet runner does not execute a registered write script without authorization', async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'smoke-runner-guard-'));
  const marker = resolve(temp, 'mutated');
  await writeFile(resolve(temp, 'inbox-p1-smoke.sh'), `#!/bin/bash\ntouch '${marker}'\n`);
  try {
    const result = await new Promise((resolveResult, reject) => {
      const proc = spawn('bash', ['packages/quality/scripts/run-smoke-ratchet.sh'], {
        cwd: root, env: { ...process.env, SMOKE_DIR: temp, SMOKE_ALLOW_WRITE: '' },
      });
      let output = '';
      proc.stdout.on('data', data => { output += data; });
      proc.stderr.on('data', data => { output += data; });
      proc.on('error', reject);
      proc.on('close', code => resolveResult({ code, output }));
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /SKIP.*write-guard/);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});


for (const script of ['blade-bc-harness-gates', 'claimed-by-cleared', 'claude-headed-dispatch',
  'codex-headed-dispatch', 'golden-paths-t1', 'golden-path-step-nfr', 'journey-goldenpaths-invariants', 'unified-map-api']) {
  test(`${script}: ignored DB_URL cannot mask the actual production DATABASE_URL`, async () => {
    await fixture(async ({ smoke }) => {
      const result = await smoke(script, { SMOKE_ALLOW_WRITE: '1', DB_URL: 'postgresql://localhost/cecelia_test',
        DATABASE_URL: 'postgresql://localhost/cecelia' }, undefined, true);
      assert.doesNotMatch(result.output, /GUARD_ACCEPTED/, 'guard and operation resolve different DBs');
    });
  });
}
for (const script of ['impact-contract']) {
  test(`${script}: fixture helper DB connection is checked before it can write`, async () => {
    await fixture(async ({ smoke }) => {
      const result = await smoke(script, { SMOKE_ALLOW_WRITE: '1', DATABASE_URL: 'postgresql://localhost/cecelia' }, undefined, true);
      assert.doesNotMatch(result.output, /GUARD_ACCEPTED/);
    });
  });
}
test('task-delete discrete DB_* target must be checked instead of an unrelated URI', async () => {
  await fixture(async ({ smoke }) => {
    const result = await smoke('task-delete-postdeploy-filter', { SMOKE_ALLOW_WRITE: '1', DB_NAME: 'cecelia',
      DB_HOST: 'localhost', DB_PORT: '5432' }, undefined, true);
    assert.doesNotMatch(result.output, /GUARD_ACCEPTED/);
  });
});
test('Brain DB_HOST cannot be hidden behind an unused loopback DATABASE_URL', async () => {
  await fixture(async ({ requests, smoke, info }) => {
    info.Config.Env.push('DB_HOST=remote-production', 'DATABASE_URL=postgresql://localhost/cecelia_test');
    const result = await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' }, info);
    assert.deepEqual(requests, [], result.output);
  });
});


for (const script of ['attempt-run', 'contract-seal', 'merge-pr', 'publish-pr']) {
  test(`${script}: token comes only from the validated test container`, async () => {
    await fixture(async ({ smoke, dockerCalls }) => {
      const result = await smoke(script, { SMOKE_ALLOW_WRITE: '1', BRAIN_INTERNAL_TOKEN: '' });
      const reads = (await dockerCalls()).filter(args => args[0] === 'exec');
      assert.ok(reads.length, 'token fallback was not exercised');
      assert.ok(reads.every(args => args[1] === 'cecelia-brain-smoke'), 'read credential from an unvalidated container');
    });
  });
}
test('dispatcher route authority helper uses a checked DATABASE_URL', async () => {
  await fixture(async ({ smoke }) => {
    const result = await smoke('dispatcher-real-paths.sh', { SMOKE_ALLOW_WRITE: '1', DATABASE_URL: 'postgresql://localhost/cecelia' }, undefined, true);
    assert.doesNotMatch(result.output, /GUARD_ACCEPTED/);
  });
});
test('phone registry checks the PG_* connection it actually uses when no URI exists', async () => {
  await fixture(async ({ smoke }) => {
    const result = await smoke('phone-registry', { SMOKE_ALLOW_WRITE: '1', DATABASE_URL: '', PGDATABASE: 'cecelia', PGHOST: 'localhost' }, undefined, true);
    assert.doesNotMatch(result.output, /GUARD_ACCEPTED/);
  });
});

test('standalone claimed-by script rejects actual production DATABASE_URL before POST', async () => {
  await fixture(async ({ requests, smoke }) => {
    const result = await smoke('claimed-by-cleared', { SMOKE_ALLOW_WRITE: '1', DB_URL: 'postgresql://localhost/cecelia_test',
      DATABASE_URL: 'postgresql://localhost/cecelia' });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(requests, [], 'standalone operation escaped the checked DB target');
  });
});
test('ignored DB_URL does not replace a safe actual DATABASE_URL', async () => {
  await fixture(async ({ smoke }) => {
    const result = await smoke('claimed-by-cleared', { SMOKE_ALLOW_WRITE: '1', DB_URL: 'postgresql://remote/cecelia' }, undefined, true);
    assert.match(result.output, /GUARD_ACCEPTED/);
  });
});


for (const variable of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) {
  for (const [script, connection] of [
    ['claimed-by-cleared', {}],
    ['task-delete-postdeploy-filter', { DB_NAME: 'cecelia_test', DB_HOST: 'localhost', DB_PORT: '5432' }],
    ['phone-registry', { DATABASE_URL: '', PGDATABASE: 'cecelia_test', PGHOST: 'localhost', PGPORT: '5432' }],
  ]) {
    test(`${script}: libpq ${variable} cannot override a checked local target`, async () => {
      await fixture(async ({ requests, smoke }) => {
        const result = await smoke(script, { SMOKE_ALLOW_WRITE: '1', ...connection,
          [variable]: variable === 'PGHOSTADDR' ? '192.0.2.10' : 'external-service' }, undefined, true);
        assert.doesNotMatch(result.output, /GUARD_ACCEPTED/, 'libpq target override escaped identity validation');
        assert.deepEqual(requests, [], 'unsafe libpq settings reached Brain before rejection');
      });
    });
  }
  test(`container libpq ${variable} cannot override its checked local target`, async () => {
    await fixture(async ({ requests, smoke, info }) => {
      info.Config.Env.push(`${variable}=external-service`);
      const result = await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' }, info);
      assert.deepEqual(requests, [], result.output);
    });
  });
}


test('curl proxy must not redirect authorized smoke writes outside the checked container', async () => {
  const proxied = [];
  const proxy = createServer((req, res) => {
    proxied.push({ method: req.method, url: req.url });
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ warnings: [] }));
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    await fixture(async ({ requests, smoke }) => {
      const result = await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1',
        http_proxy: `http://127.0.0.1:${proxy.address().port}`, HTTP_PROXY: '',
        HTTPS_PROXY: '', https_proxy: '', ALL_PROXY: '', all_proxy: '',
        NO_PROXY: '', no_proxy: '' });
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(proxied, [], 'curl wrote through a proxy outside the validated container');
      assert.deepEqual(requests, [], 'configured proxy must be denied before target contact');
    });
  } finally { await new Promise(resolve => proxy.close(resolve)); }
});


for (const variable of ['HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  test(`configured ${variable} cannot change a validated write target`, async () => {
    await fixture(async ({ requests, smoke }) => {
      const result = await smoke('claimed-by-cleared', { SMOKE_ALLOW_WRITE: '1',
        [variable]: 'http://127.0.0.1:9' }, undefined, true);
      assert.doesNotMatch(result.output, /GUARD_ACCEPTED/);
      assert.deepEqual(requests, []);
    });
  });
}


test('default curlrc cannot redirect writes from the checked test container', async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'smoke-curlrc-'));
  const proxied = [];
  const proxy = createServer((req, res) => {
    proxied.push(req.method);
    req.resume();
    res.end(JSON.stringify({ warnings: [] }));
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  await writeFile(resolve(temp, '.curlrc'), `proxy = "http://127.0.0.1:${proxy.address().port}"\nnoproxy = ""\n`);
  try {
    await fixture(async ({ requests, smoke }) => {
      const result = await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1', CURL_HOME: temp });
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(proxied, [], 'default curlrc redirected smoke writes outside the checked container');
      assert.ok(requests.some(req => req.method === 'POST'), 'direct authorized write was not exercised');
    });
  } finally {
    await new Promise(resolve => proxy.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});

test('guarded live shell curl calls must disable default config before other flags', async () => {
  const smokeDir = resolve(root, 'packages/brain/scripts/smoke');
  for (const name of await readdir(smokeDir)) {
    if (!name.endsWith('.sh')) continue;
    const source = await readFile(resolve(smokeDir, name), 'utf8');
    if (!source.includes('smoke-production-guard.mjs')) continue;
    const commands = clientCommands(source);
    assert.doesNotMatch(commands, /\bcurl[ \t]+(?!-q(?:[ \t]|$))/, `${name}: curl must not read external defaults`);
  }
});


// 最小 PostgreSQL wire fixture：仅回显 1，不连接或写入任何数据库。
function postgresFixture() {
  const message = (type, body) => { const size = Buffer.alloc(4); size.writeInt32BE(body.length + 4); return Buffer.concat([Buffer.from(type), size, body]); };
  return createTcpServer(socket => {
    socket.setTimeout(5000, () => socket.destroy());
    let pending = Buffer.alloc(0), started = false;
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= (started ? 5 : 8)) {
        const length = pending.readInt32BE(started ? 1 : 0);
        if (pending.length < length + (started ? 1 : 0)) return;
        if (!started && pending.readInt32BE(4) === 80877103) {
          pending = pending.subarray(length); socket.write('N'); continue;
        }
        const type = started ? String.fromCharCode(pending[0]) : '';
        pending = pending.subarray(length + (started ? 1 : 0));
        if (!started) {
          started = true;
          socket.write(Buffer.concat([message('R', Buffer.alloc(4)), message('S', Buffer.from('client_encoding\0UTF8\0')), message('S', Buffer.from('server_version\0' + '16.0\0')), message('Z', Buffer.from('I'))]));
        } else if (type === 'Q') {
          const meta = Buffer.alloc(18); meta.writeInt32BE(23, 6); meta.writeInt16BE(4, 10); meta.writeInt32BE(-1, 12);
          const row = Buffer.from([0, 1, 0, 0, 0, 1, 49]);
          socket.write(Buffer.concat([message('T', Buffer.concat([Buffer.from([0, 1]), Buffer.from('?column?\0'), meta])), message('D', row), message('C', Buffer.from('SELECT 1\0')), message('Z', Buffer.from('I'))]));
        } else if (type === 'X') { socket.end(); }
      }
    });
  });
}

test('native psql default config cannot reconnect a guarded smoke to another endpoint', async t => {
  let psql;
  try { psql = execFileSync('which', ['psql'], { encoding: 'utf8' }).trim(); }
  catch { t.skip('native psql unavailable; mandatory guarded command checks still run'); return; }
  const db = postgresFixture();
  let redirects = 0;
  const other = createTcpServer(socket => { redirects++; socket.destroy(); });
  const temp = await mkdtemp(resolve(tmpdir(), 'smoke-psqlrc-'));
  await Promise.all([new Promise(r => db.listen(0, '127.0.0.1', r)), new Promise(r => other.listen(0, '127.0.0.1', r))]);
  const config = resolve(temp, 'psqlrc');
  await writeFile(config, `\\connect postgresql://fixture@127.0.0.1:${other.address().port}/cecelia_test\n`);
  try {
    await fixture(async ({ requests, smoke, info }) => {
      info.Config.Env.push(`DB_PORT=${db.address().port}`);
      await smoke('notion-brain-first', { SMOKE_ALLOW_WRITE: '1', GUARD_NATIVE_PSQL: psql,
        DATABASE_URL: `postgresql://fixture@127.0.0.1:${db.address().port}/cecelia_test`, PSQLRC: config });
      assert.equal(redirects, 0, 'psql default config changed the actual endpoint');
      assert.ok(requests.some(req => req.method === 'POST'), 'safe native psql did not reach authorized smoke writes');
    });
  } finally {
    await Promise.all([new Promise(r => db.close(r)), new Promise(r => other.close(r))]);
    await rm(temp, { recursive: true, force: true });
  }
});

test('guarded live psql invocations must disable default startup config', async () => {
  const smokeDir = resolve(root, 'packages/brain/scripts/smoke');
  for (const name of await readdir(smokeDir)) {
    if (!name.endsWith('.sh')) continue;
    const source = await readFile(resolve(smokeDir, name), 'utf8');
    if (!source.includes('smoke-production-guard.mjs')) continue;
    const commands = clientCommands(source);
    assert.doesNotMatch(commands, /\bpsql[ \t]+(?!-X(?:[ \t]|$))/, `${name}: psql must not read startup config`);
  }
});


for (const [name, overrides, expected] of [
  ['disabled Harness', { HARNESS_ROLE_CHAIN_ENABLED: '' }, 'SKIP: real Harness role chain requires explicit opt-in'],
  ['missing explicit DB', { HARNESS_ROLE_CHAIN_ENABLED: '1', DB_URL: '' }, 'DB_URL is required'],
]) {
  test(`role-chain keeps its inert input contract: ${name}`, async () => {
    await fixture(async ({ requests, smoke }) => {
      const result = await smoke('unified-work-router-role-chain', overrides);
      assert.ok(result.output.includes(expected), result.output);
      if (name === 'missing explicit DB') assert.notEqual(result.code, 0);
      assert.deepEqual(requests, []);
    });
  });
}
test('valid Harness inputs still cannot write without the general write authorization', async () => {
  await fixture(async ({ requests, smoke }) => {
    const result = await smoke('unified-work-router-role-chain', { HARNESS_ROLE_CHAIN_ENABLED: '1',
      DB_URL: 'postgresql://localhost/cecelia_test', BASELINE_SHA: 'fixture' });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(requests, []);
  });
});

for (const [name, overrides] of [
  ['remote DOCKER_HOST', { DOCKER_HOST: 'tcp://remote.invalid:2376' }],
  ['explicit remote context', { DOCKER_CONTEXT: 'remote', GUARD_DOCKER_ENDPOINT: 'ssh://remote.invalid' }],
  ['active SSH context', { GUARD_DOCKER_ACTIVE_CONTEXT: 'remote', GUARD_DOCKER_ENDPOINT: 'ssh://remote.invalid' }],
  ['active TCP context', { GUARD_DOCKER_ACTIVE_CONTEXT: 'remote', GUARD_DOCKER_ENDPOINT: 'tcp://remote.invalid:2376' }],
  ['unknown context endpoint', { GUARD_DOCKER_ENDPOINT: 'invalid' }],
  ['context lookup error', { GUARD_DOCKER_CONTEXT_ERROR: '1' }],
]) {
  test(`Docker daemon identity rejects ${name} before HTTP or container inspection`, async () => {
    await fixture(async ({ requests, smoke, dockerCalls }) => {
      await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1', ...overrides });
      assert.deepEqual(requests, [], 'unverified daemon permitted Brain requests');
      assert.ok(!(await dockerCalls()).some(args => args[0] === 'inspect'), 'unverified daemon inspected a container');
    });
  });
}
test('authorized writes require a confirmed local Unix context endpoint', async () => {
  await fixture(async ({ requests, smoke, dockerCalls }) => {
    await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' });
    const calls = await dockerCalls();
    assert.deepEqual(calls.slice(0, 2), [['context', 'show'], ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}', 'default']]);
    assert.ok(requests.some(req => req.method === 'POST'));
  });
});
