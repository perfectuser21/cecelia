import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const root = fileURLToPath(new URL('../../../', import.meta.url));

function unavailableDatabase(connection) {
  const directory = mkdtempSync(join(tmpdir(), 'capture-schema-offline-'));
  const touched = join(directory, 'query-started');
  const adapter = join(directory, 'pg.mjs');
  writeFileSync(adapter, `import {writeFileSync} from 'node:fs';
    class Pool {
      async query() { writeFileSync(${JSON.stringify(touched)}, 'called'); throw new Error('AUDIT_CAPTURE_DATABASE_UNAVAILABLE'); }
      async end() {}
    }
    export default {Pool};`);
  const config = join(directory, 'vitest.config.mjs');
  writeFileSync(config, `export default {resolve:{alias:{pg:${JSON.stringify(adapter)}}},
    test:{environment:'node',include:['tests/capture/db.test.ts'],testTimeout:5000,hookTimeout:5000}};`);
  const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'),
    'run', '--root', join(root, 'apps/api'), '--config', config, '--reporter=dot'], {
    cwd: root, encoding: 'utf8', timeout: 20000,
    env: {...process.env, CI: 'true', API_CAPTURE_SCHEMA_INTEGRATION: '1',
      TEST_DATABASE_URL: connection, DB_HOST: '127.0.0.1', DB_PORT: '9',
      DB_NAME: 'cecelia_scratch', DB_USER: 'ci', DB_PASSWORD: 'isolated-ci'},
  });
  try {
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return {exitCode: result.status, output: result.stdout + result.stderr, queried: existsSync(touched)};
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

test('captures schema PG不可达必须失败，不能把六条无断言返回记为通过', () => {
  const result = unavailableDatabase('postgresql://ci:isolated-ci@127.0.0.1:9/cecelia_scratch');
  assert.notEqual(result.exitCode, 0, result.output);
  assert.equal(result.queried, true, result.output);
  assert.match(result.output, /AUDIT_CAPTURE_DATABASE_UNAVAILABLE/);
});

test('captures schema拒绝外部地址和非测试库，且拒绝前不能尝试查询', () => {
  for (const connection of ['postgresql://ci@db.production.invalid/cecelia', 'postgresql://ci@127.0.0.1:9/cecelia']) {
    const result = unavailableDatabase(connection);
    assert.notEqual(result.exitCode, 0, result.output);
    assert.equal(result.queried, false, result.output);
  }
});

test('captures schema从无库API单元移出，并由已迁移的Nightly数据库真实接收', () => {
  const api = readFileSync(join(root, 'apps/api/vitest.config.ts'), 'utf8');
  assert.ok(api.includes("'tests/capture/db.test.ts'"), '无库API单元不应选入真实schema回归');
  const workflow = yaml.load(readFileSync(join(root, '.github/workflows/nightly-regression.yml'), 'utf8'));
  const job = workflow.jobs['brain-integration'];
  const index = job.steps.findIndex(step => step.run === 'cd apps/api && npx --no-install vitest run --config vitest.schema.config.ts --reporter=dot');
  assert.ok(index >= 0, 'Nightly缺少真正执行captures schema的命令');
  assert.ok(job.steps.slice(0, index).some(step => step.run?.includes('node src/migrate.js')));
  const step = job.steps[index];
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  assert.equal(step.env.API_CAPTURE_SCHEMA_INTEGRATION, '1');
  assert.equal(job.env.TEST_DATABASE_URL, 'postgresql://cecelia:isolated-ci@localhost:5432/cecelia_test');
});
