import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

it('actual PG CLI imports and reporter keep machine-readable proof alone on stdout', () => {
  const path = fileURLToPath(new URL('../../scripts/lib/walking-ci-pg-state.mjs', import.meta.url));
  const source = readFileSync(path, 'utf8');
  const prefix = source.split('\nlet checkpointer;', 1)[0];
  const reporter = source.match(/\n  (?:console\.log|process\.stdout\.write)\(JSON\.stringify\(\{ thread_id: thread,[\s\S]*?\);\n/)[0];
  // Format-only fixture: actual imports construct a lazy pool, never query PG or run a graph.
  // The CI owner remains responsible for actual persisted checkpoint and event acceptance.
  const program = `${prefix}
if (pool.totalCount !== 0) throw new Error('format fixture must not connect to PG');
const state = { config: { configurable: { checkpoint_id: 'format-only-fixture' } },
  values: { finalized: false, restartInstanceId: null } };
const lookup = [{ container_id: 'format-only-fixture' }]; const events = 0;
${reporter}
await pool.end(); clearTimeout(deadline);`;
  const env = { ...process.env, CI: 'true', WALKING_CI_OWNER: '1', NODE_ENV: 'test',
    DB_NAME: 'cecelia_test', DB_HOST: 'localhost', DB_PORT: '5432', BRAIN_PORT: '5221',
    DATABASE_URL: 'postgresql://localhost:5432/cecelia_test' };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy',
    'all_proxy', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete env[key];
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, path,
    'waiting', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], { cwd: dirname(path), env, encoding: 'utf8', timeout: 10000 });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ thread_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    mode: 'waiting', container_id: 'format-only-fixture', checkpoint_id: 'format-only-fixture',
    restart_instance: null, finalized: false, events: 0 });
  expect(result.stderr).toContain('PostgreSQL pool configured:');
});
