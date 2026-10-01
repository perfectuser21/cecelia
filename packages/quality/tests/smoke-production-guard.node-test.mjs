import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
  await writeFile(resolve(temp, 'docker'), '#!/usr/bin/env node\nprocess.stdout.write(process.env.GUARD_DOCKER_FIXTURE);\n', { mode: 0o755 });
  await writeFile(resolve(temp, 'psql'), '#!/usr/bin/env bash\ncase "$*" in *COUNT*) echo 1;; *) echo 1;; esac\n', { mode: 0o755 });
  const info = { State: { Running: true }, Config: { Env: ['NODE_ENV=test', 'DB_NAME=cecelia_test', `BRAIN_PORT=${port}`] }, HostConfig: { NetworkMode: 'host' }, NetworkSettings: { Ports: {} } };
  async function smoke(script, overrides = {}, dockerInfo = info) {
    return new Promise((resolve, reject) => {
      const proc = spawn('bash', [`packages/brain/scripts/smoke/${script}-smoke.sh`], {
        cwd: root,
        env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, BRAIN: `http://127.0.0.1:${port}`, BRAIN_URL: `http://127.0.0.1:${port}`, BRAIN_CONTAINER: 'cecelia-brain-smoke', DATABASE_URL: 'postgresql://cecelia@localhost:5432/cecelia_test', SMOKE_ALLOW_WRITE: '', GUARD_DOCKER_FIXTURE: JSON.stringify(dockerInfo), ...overrides },
      });
      let output = '';
      proc.stdout.on('data', data => { output += data; });
      proc.stderr.on('data', data => { output += data; });
      proc.on('error', reject);
      proc.on('close', code => resolve({ code, output }));
    });
  }
  try { await run({ requests, smoke, info, port }); }
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
