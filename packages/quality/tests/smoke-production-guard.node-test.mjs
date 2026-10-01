import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const scripts = ['notion-mapping-r4', 'notion-endpoints', 'notion-brain-first'];

async function fixture(run) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/health')) {
        res.end(JSON.stringify({ local_execution: { role: process.env.GUARD_FIXTURE_ROLE || 'executor' } }));
      } else if (req.method === 'POST') {
        const data = JSON.parse(body);
        res.statusCode = data.title || data.name ? 201 : 400;
        res.end(JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', warnings: [] }));
      } else { res.end('{}'); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const temp = await mkdtemp(resolve(tmpdir(), 'smoke-write-guard-'));
  const dockerLog = resolve(temp, 'docker-calls');
  await writeFile(resolve(temp, 'docker'), '#!/usr/bin/env node\nconst fs = require("node:fs"); fs.appendFileSync(process.env.GUARD_DOCKER_LOG, JSON.stringify(process.argv.slice(2))+"\\n"); if(process.argv[2]==="exec") process.stdout.write("fixture-token"); else process.stdout.write(process.env.GUARD_DOCKER_FIXTURE);\n', { mode: 0o755 });
  await writeFile(resolve(temp, 'psql'), '#!/usr/bin/env bash\ncase "$*" in *COUNT*) echo 1;; *) echo 1;; esac\n', { mode: 0o755 });
  const info = { State: { Running: true }, Config: { Env: ['NODE_ENV=test', 'DB_NAME=cecelia_test', `BRAIN_PORT=${port}`] }, HostConfig: { NetworkMode: 'host' }, NetworkSettings: { Ports: {} } };
  async function smoke(script, overrides = {}, dockerInfo = info, guardOnly = false) {
    let args = [`packages/brain/scripts/smoke/${script.endsWith('.sh') ? script : script + '-smoke.sh'}`];
    if (guardOnly) {
      const source = await readFile(resolve(root, args[0]), 'utf8');
      const prefix = source.slice(0, source.indexOf('\nfi') + 3)
        .replace(/\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/lib/g, resolve(root, 'packages/brain/scripts/lib'));
      args = ['-c', prefix + '\nprintf "GUARD_ACCEPTED"\n'];
    }
    return new Promise((resolve, reject) => {
      const proc = spawn('bash', args, {
        cwd: root,
        env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, BRAIN: `http://127.0.0.1:${port}`, BRAIN_URL: `http://127.0.0.1:${port}`, BRAIN_CONTAINER: 'cecelia-brain-smoke', DATABASE_URL: 'postgresql://cecelia@localhost:5432/cecelia_test', SMOKE_ALLOW_WRITE: '', PGHOSTADDR: '', PGSERVICE: '', PGSERVICEFILE: '', http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '', all_proxy: '', ALL_PROXY: '', GUARD_DOCKER_LOG: dockerLog, GUARD_DOCKER_FIXTURE: JSON.stringify(dockerInfo), ...overrides },
      });
      let output = '';
      proc.stdout.on('data', data => { output += data; });
      proc.stderr.on('data', data => { output += data; });
      proc.on('error', reject);
      proc.on('close', code => resolve({ code, output }));
    });
  }
  async function dockerCalls() { return (await readFile(resolve(temp, 'docker-calls'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); }
  try { await run({ requests, smoke, info, port, dockerCalls }); }
  finally { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); }
}

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
  const optional = new Set(['notion-mapping-r4-smoke.sh', 'notion-endpoints-smoke.sh', 'notion-brain-first-smoke.sh']);
  for (const name of await readdir(smokeDir)) {
    if (!name.endsWith('.sh')) continue;
    const source = await readFile(resolve(smokeDir, name), 'utf8');
    if (!/-X\s+(POST|PATCH|DELETE|PUT|["']?\$)/.test(source)) continue;
    if (name === 'callback-stage-receipt-smoke.sh') {
      assert.match(source, /127\.0\.0\.1:\$PORT/, 'fixture exception must remain tied to its private server');
      continue;
    }
    assert.ok(listed.has(name), `${name}: new live write script must join write guard inventory`);
    assert.match(source, /smoke-production-guard\.mjs/, `${name}: standalone write guard missing`);
    if (!optional.has(name)) {
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
