import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

// 执行现役入口和真实 HTTP 子进程；数据库只提供抵达 HTTP 合同所需的决策留存夹具。
function runResponseCase(scenario) {
  const root = mkdtempSync(join(tmpdir(), 'basic-runtime-response-'));
  try {
    mkdirSync(join(root, 'scripts/ci'), {recursive: true});
    mkdirSync(join(root, 'packages/brain'), {recursive: true});
    mkdirSync(join(root, 'node_modules/pg'), {recursive: true});
    copyFileSync(new URL('../basic-runtime-smoke.mjs', import.meta.url), join(root, 'scripts/ci/basic-runtime-smoke.mjs'));
    writeFileSync(join(root, 'node_modules/pg/package.json'), JSON.stringify({type: 'module', exports: './index.js'}));
    writeFileSync(join(root, 'node_modules/pg/index.js'), `
      class Pool {
        async connect() { return this; }
        release() {}
        async end() {}
        async query(sql, values) {
          if (sql.includes('current_database()')) return {rows: [{name: 'cecelia_scratch'}]};
          if (sql.includes('INSERT INTO decisions')) this.row = {id: values[0], topic: values[1], decision: values[2], created_at: 'fixture-date'};
          if (sql.includes('cleanup_decisions')) return {rows: [{n: 0}]};
          return {rows: this.row ? [this.row] : []};
        }
      }
      export default {Pool};
    `);
    writeFileSync(join(root, 'packages/brain/server.js'), `
      const {createServer} = require('node:http');
      const {appendFileSync} = require('node:fs');
      const scenario = process.env.RUNTIME_RESPONSE_CASE;
      const server = createServer((req, res) => {
        appendFileSync(process.env.RUNTIME_RESPONSE_REQUESTS, req.url + '\\n');
        res.setHeader('Content-Type', 'application/json');
        let body;
        if (req.url === '/') {
          res.statusCode = scenario === 'root-http' ? 503 : 200;
          body = {service: scenario === 'root-service' ? 'another-service' : 'cecelia-brain', status: scenario === 'root-status' ? 'stopped' : 'running'};
        } else if (req.url === '/api/brain/health') {
          res.statusCode = scenario === 'health-http' ? 503 : 200;
          body = {status: scenario === 'health-status' ? 'unknown' : scenario === 'degraded' ? 'degraded' : 'healthy', runtime: {isolated: true, background_automation: false}};
        } else {
          // 明确停止在任务边界，避免为后续业务复制另一个冒烟实现。
          res.statusCode = 418;
          body = {error: 'response-fixture-task-boundary'};
        }
        res.end(JSON.stringify(body));
      });
      server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('Cecelia Brain running on http://localhost:' + process.env.PORT));
      process.on('SIGTERM', () => server.close(() => process.exit(0)));
    `);
    const requestsPath = join(root, 'requests');
    const result = spawnSync(process.execPath, [join(root, 'scripts/ci/basic-runtime-smoke.mjs')], {
      env: {...process.env, DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1/cecelia_scratch',
        RUNTIME_RESPONSE_CASE: scenario, RUNTIME_RESPONSE_REQUESTS: requestsPath},
      encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.error, undefined, result.stderr);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, 0);
    return {stderr: result.stderr, requests: readFileSync(requestsPath, 'utf8').trim().split('\n')};
  } finally { rmSync(root, {recursive: true, force: true}); }
}

for (const scenario of ['root-http', 'root-service', 'root-status', 'health-http', 'health-status']) {
  test(`现役运行冒烟拒绝响应合同错误：${scenario}`, () => {
    const result = runResponseCase(scenario);
    assert.ok(result.requests.includes('/'), '必须实际请求本人服务的根路径');
    assert.ok(!result.requests.includes('/api/brain/tasks'), '响应合同错误后不得进入任务写入');
    assert.doesNotMatch(result.stderr, /response-fixture-task-boundary/);
  });
}

for (const scenario of ['healthy', 'degraded']) {
  test(`根路径和${scenario}健康响应合格后进入任务合同`, () => {
    const result = runResponseCase(scenario);
    assert.deepEqual(result.requests, ['/', '/api/brain/health', '/api/brain/tasks']);
    assert.match(result.stderr, /response-fixture-task-boundary/);
  });
}
