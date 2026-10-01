import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const docker = vi.hoisted(() => vi.fn(() => 'container'));
vi.mock('node:child_process', () => ({ execFileSync: docker }));
vi.mock('../../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
import { spawnNode } from '../../workflows/walking-skeleton-1node.graph.js';
const { spawn } = await vi.importActual('node:child_process');
const oldInstance = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const newInstance = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function runWorker(failures, restart = false, badInstance = false) {
  await spawnNode({ triggerId: oldInstance, restartInstanceId: restart ? oldInstance : null });
  const args = docker.mock.calls.at(-1)[1];
  const worker = args.at(-1);
  const calls = []; let instances = 0;
  const server = createServer((req, res) => {
    calls.push([req.method, req.url]);
    if (req.method === 'GET') { instances++;
      if (badInstance) { res.writeHead(503); res.end('{"instance_id":"not-a-uuid"}'); }
      else res.end(JSON.stringify({ instance_id: instances < 3 ? oldInstance : newInstance })); }
    else { const count = calls.filter(([method]) => method === 'POST').length;
      res.writeHead(count <= failures ? 503 : 200); res.end(JSON.stringify({ ok: count > failures })); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const temp = await mkdtemp(join(tmpdir(), 'walking-worker-'));
  try {
    // HTTP transport only: execute the actual graph-generated shell script against a local server.
    await writeFile(join(temp, 'wget'), `#!/usr/bin/env node
const fs=require('node:fs'),a=process.argv.slice(2),p=a.find(x=>x.startsWith('--post-data=')),i=a.indexOf('-O');
fetch(a.at(-1),{method:p?'POST':'GET',body:p?.slice(12),signal:AbortSignal.timeout(1000)})
.then(async r=>{const text=await r.text();if(i>=0&&a[i+1]!=='-')fs.writeFileSync(a[i+1],text);else process.stdout.write(text);process.exit(r.ok?0:1);}).catch(()=>process.exit(1));
`, { mode: 0o755 });
    await writeFile(join(temp, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const transported = worker.replaceAll('http://host.docker.internal:5221', `http://127.0.0.1:${server.address().port}`)
      .replaceAll('http://127.0.0.1:5221', `http://127.0.0.1:${server.address().port}`);
    const child = spawn('sh', ['-c', transported], { env: { ...process.env, PATH: `${temp}:${process.env.PATH}` } });
    let output = ''; child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
    const code = await new Promise((r, j) => { child.on('close', r); child.on('error', j); });
    return { code, calls, output, args };
  } finally { await new Promise(r => server.close(r)); await rm(temp, { recursive: true, force: true }); }
}
beforeEach(() => { docker.mockClear(); vi.unstubAllEnvs(); });
afterEach(() => vi.unstubAllEnvs());
describe('actual Walking callback worker', () => {
  it('transport 503 retries until actual success, preserving production callback hostname', async () => {
    const result = await runWorker(2);
    expect(result.code, result.output).toBe(0);
    expect(result.calls.filter(([method]) => method === 'POST')).toHaveLength(3);
    expect(result.args.at(-1)).toContain('http://host.docker.internal:5221');
  });
  it('transport retry exhaustion fails instead of echoing success', async () => {
    const result = await runWorker(Infinity);
    expect(result.code, result.output).not.toBe(0);
    expect(result.calls.length).toBeGreaterThan(1);
    expect(result.calls.length).toBeLessThanOrEqual(40);
  });
  it('strict CI worker waits for a new process instance before sending callback', async () => {
    for (const [key, value] of Object.entries({ CI: 'true', WALKING_CI_OWNER: '1', NODE_ENV: 'test',
      DB_NAME: 'cecelia_test', DB_HOST: 'localhost', DB_PORT: '5432', BRAIN_PORT: '5221',
      DATABASE_URL: 'postgresql://localhost:5432/cecelia_test' })) vi.stubEnv(key, value);
    const result = await runWorker(0, true);
    expect(result.code, result.output).toBe(0);
    expect(result.args).toContain('--network'); expect(result.args).toContain('host');
    expect(result.calls.slice(0, 3).map(([method]) => method)).toEqual(['GET', 'GET', 'GET']);
    expect(result.calls.filter(([method]) => method === 'POST')).toHaveLength(1);
  });
  it('restart control cannot be used in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(spawnNode({ triggerId: oldInstance, restartInstanceId: oldInstance })).rejects.toThrow();
    expect(docker).not.toHaveBeenCalled();
  });
  it('failed or malformed instance replies never release restart callback', async () => {
    for (const [key, value] of Object.entries({ CI: 'true', WALKING_CI_OWNER: '1', NODE_ENV: 'test',
      DB_NAME: 'cecelia_test', DB_HOST: 'localhost', DB_PORT: '5432', BRAIN_PORT: '5221',
      DATABASE_URL: 'postgresql://localhost:5432/cecelia_test' })) vi.stubEnv(key, value);
    const result = await runWorker(0, true, true);
    expect(result.code).not.toBe(0);
    expect(result.calls.every(([method]) => method === 'GET')).toBe(true);
    expect(result.calls.length).toBeLessThanOrEqual(40);
  });
  it('CI remote database override is rejected before Docker', async () => {
    vi.stubEnv('CI', 'true'); vi.stubEnv('WALKING_CI_OWNER', '1'); vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_NAME', 'cecelia_test'); vi.stubEnv('DATABASE_URL', 'postgresql://remote/cecelia_test');
    await expect(spawnNode({ triggerId: oldInstance })).rejects.toThrow();
    expect(docker).not.toHaveBeenCalled();
  });
});
