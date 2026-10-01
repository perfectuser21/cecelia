import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
for (const [name, uri, accepted] of [['missing', null, false],
  ['test', 'postgresql://localhost:5432/cecelia_test', true],
  ['production', 'postgresql://localhost:5432/cecelia', false]]) {
  test(`actual walking entry requires checked container checkpointer URI: ${name}`, async () => {
    const temp = await mkdtemp(resolve(tmpdir(), 'walking-target-'));
    const requests = [];
    const server = createServer((req, res) => {
      requests.push([req.method, req.url]);
      res.end(JSON.stringify({ local_execution: { role: 'executor' } }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    try {
      const info = { State: { Running: true }, Config: { Env: ['NODE_ENV=test', 'DB_NAME=cecelia_test',
        `BRAIN_PORT=${server.address().port}`, ...(uri ? [`DATABASE_URL=${uri}`] : [])] },
      HostConfig: { NetworkMode: 'host' } };
      await writeFile(resolve(temp, 'docker'), `#!/usr/bin/env node
const a=process.argv.slice(2);
if(a[0]==='context') console.log(a[1]==='show'?'default':JSON.stringify('unix:///var/run/docker.sock'));
else if(a[0]==='inspect') console.log(process.env.WALKING_INSPECT);
else console.log('cecelia-node-brain');
`, { mode: 0o755 });
      const source = await readFile(resolve(root, 'packages/brain/scripts/smoke/walking-skeleton-1node-smoke.sh'), 'utf8');
      const prefix = source.slice(0, source.indexOf('\nCONTAINER='))
        .replace(/\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/lib/g, resolve(root, 'packages/brain/scripts/lib'))
        .replaceAll('http://localhost:5221', `http://127.0.0.1:${server.address().port}`);
      const env = { ...process.env, PATH: `${temp}:${process.env.PATH}`, SMOKE_ALLOW_WRITE: '1',
        BRAIN_CONTAINER: 'walking-ci-brain', WALKING_INSPECT: JSON.stringify(info) };
      for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE',
        'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
      const child = spawn('bash', ['-c', prefix + '\nprintf GUARD_ACCEPTED'], { cwd: root, env, timeout: 15000, killSignal: 'SIGKILL' });
      let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
      const code = await new Promise((r, j) => { child.on('close', r); child.on('error', j); });
      assert.equal(output.includes('GUARD_ACCEPTED'), accepted, output);
      assert.equal(code, accepted ? 0 : 1, 'explicit positive owner must fail on denied target');
      assert.deepEqual(requests, accepted ? [['GET', '/api/brain/health']] : [], 'identity checked before HTTP');
    } finally { await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true }); }
  });
}
