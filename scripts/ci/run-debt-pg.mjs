import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { startPrivatePg, checked, cleanProcessEnv } from './private-pg-backend.mjs';
import { verifyPrivatePg, assertVitestReport, dropOwnedScratch, restoreDump } from './private-pg-contract.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../packages/brain/package.json', import.meta.url));
const { Pool, Client } = require('pg');
export const readManifest = (repositoryRoot = root) => {
  const realRoot = realpathSync(repositoryRoot);
  const manifest = JSON.parse(readFileSync(join(realRoot, 'scripts/ci/debt-pg-tests.json'), 'utf8'));
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.tests) || !manifest.tests.length) throw Error('private PG manifest empty/invalid');
  const seen = new Set();
  for (const row of manifest.tests) {
    if (!/^(packages\/brain\/src\/|tests\/regression\/)[-A-Za-z0-9_./]+\.(test|spec)\.[cm]?[jt]s$/.test(row.path)
        || row.path.split('/').includes('..') || seen.has(row.path) || !['full', 'empty'].includes(row.mode) || !['ready', 'pending'].includes(row.status)) throw Error('private PG manifest invalid row');
    seen.add(row.path);
    const file = resolve(realRoot, row.path);
    if (!lstatSync(file).isFile() || realpathSync(file) !== file) throw Error('private PG test must be a regular file within the repository: ' + row.path);
  }
  return manifest;
};

export function testEnvironment(backend, directory) {
  const url = `postgresql://ci_debt:${backend.password}@127.0.0.1:${backend.port}/cecelia_scratch`;
  return { ...cleanProcessEnv(directory), CI: 'true', NODE_ENV: 'test', POSTGRES_INTEGRATION: '1',
    DB_HOST: '127.0.0.1', DB_PORT: String(backend.port), DB_USER: 'ci_debt', DB_PASSWORD: backend.password, DB_NAME: 'cecelia_scratch',
    DATABASE_URL: url, TEST_DATABASE_URL: url, CECELIA_PRIVATE_PG_OWNER: backend.owner };
}

export async function runPrivatePg({ nativeBin, files = [], includePending = false, output = join(root, 'artifacts', 'debt-pg-results.json') } = {}) {
  const manifest = readManifest();
  const rows = manifest.tests.filter(row => (row.status === 'ready' || includePending) && (!files.length || files.includes(row.path)));
  if (!rows.length || files.some(path => !rows.some(row => row.path === path))) throw Error('no eligible private PG tests or unknown requested file');
  const backend = await startPrivatePg({ nativeBin });
  const admin = new Pool(backend.config);
  const baseEnv = testEnvironment(backend, backend.directory);
  const results = [], report = { schema_version: 1, owner: backend.owner, results, status: 'failed' };
  let databaseExists = false, dump, executionError;
  const verify = async () => {
    const client = new Client({ ...backend.config, database: 'cecelia_scratch' });
    try {
      await client.connect();
      await verifyPrivatePg(client, baseEnv);
    } finally {
      // Pool.end can resolve before idle sockets close; DROP must wait for wire end.
      await client.end();
    }
  };
  const drop = async () => {
    if (!databaseExists) return;
    await dropOwnedScratch(admin, verify, backend.inspectOwner);
    databaseExists = false;
  };
  const create = async () => {
    backend.inspectOwner();
    await admin.query('CREATE DATABASE cecelia_scratch');
    databaseExists = true;
    // Identifier and owner are generated constants; comments cannot claim a foreign database.
    await admin.query(`COMMENT ON DATABASE cecelia_scratch IS '${backend.owner}'`);
    await verify();
  };
  try {
    if (rows.some(row => row.mode === 'full')) {
      await create();
      checked(process.execPath, ['packages/brain/src/migrate.js'], { cwd: root, env: baseEnv, timeout: 600000 });
      dump = backend.tool('pg_dump', ['--no-owner', '--no-acl', '-d', 'cecelia_scratch']);
      if (!dump.length) throw Error('full migration dump is empty');
      await drop();
    }
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], directory = join(backend.directory, `case-${index}`);
      mkdirSync(directory); mkdirSync(join(directory, 'home')); mkdirSync(join(directory, 'tmp'));
      const env = { ...testEnvironment(backend, directory), CECELIA_PRIVATE_PG_INCLUDE_PENDING: includePending ? '1' : '0' }, receipt = join(directory, 'vitest.json');
      let tests = 0, failure, details;
      try {
        await create();
        if (row.mode === 'full') {
          restoreDump(backend.tool, dump);
          await verify();
        }
        checked(process.execPath, [join(root, 'packages/brain/node_modules/vitest/vitest.mjs'), 'run',
          '--config', join(root, 'scripts/ci/debt-pg.config.mjs'), '--reporter=json', '--outputFile', receipt,
          resolve(root, row.path)], { cwd: join(root, 'packages/brain'), env, timeout: 600000 });
        tests = assertVitestReport(JSON.parse(readFileSync(receipt, 'utf8')));
      } catch (error) {
        failure = error.message;
        try {
          const detail = JSON.parse(readFileSync(receipt, 'utf8'));
          details = detail.testResults;
          const messages = (detail.testResults || []).flatMap(file => file.assertionResults || []).flatMap(a => (a.failureMessages || []).map(message => `${a.fullName}: ${message}`));
          if (messages.length) failure += '\n' + messages.join('\n');
        } catch { /* 缺失或坏收据保持失败，不能由日志推断通过。 */ }
      }
      try { await drop(); } catch (error) { failure = [failure, error.message].filter(Boolean).join('\n'); }
      results.push({ path: row.path, mode: row.mode, tests, status: failure ? 'failed' : 'passed', ...(failure ? { error: failure, details } : {}) });
      process.stdout.write(`${failure ? 'FAIL' : 'PASS'} ${row.path} (${tests})\n`);
      if (failure) process.stderr.write(failure + '\n');
      if (databaseExists) throw Error('refusing next test after database cleanup failure');
    }
    report.status = results.every(result => result.status === 'passed') ? 'passed' : 'failed';
  } catch (error) {
    executionError = error;
  } finally {
    const cleanupErrors = [];
    // 每项都必须尝试；报告落盘失败不能阻断本人后端回收。
    for (const cleanup of [drop, () => admin.end(), () => backend.close()]) {
      try { await cleanup(); } catch (error) { cleanupErrors.push(error); }
    }
    if (executionError || cleanupErrors.length) report.status = 'failed';
    try {
      mkdirSync(resolve(output, '..'), { recursive: true });
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) {
      const errors = [...(executionError ? [executionError] : []), ...cleanupErrors];
      throw new AggregateError(errors, errors.map(error => error.message).join('; '));
    }
  }
  if (executionError) throw executionError;
  if (report.status !== 'passed') throw Error('private postgres regression failed; see ' + output);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = { files: [] };
  try {
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--native-bin') options.nativeBin = args[++index];
      else if (args[index] === '--output') options.output = resolve(args[++index]);
      else if (args[index] === '--include-pending') options.includePending = true;
      else if (args[index] === '--file') options.files.push(args[++index]);
      else throw Error('unknown private postgres argument: ' + args[index]);
    }
    await runPrivatePg(options);
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
}
