import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const targetURL = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const advisory = (url = targetURL, severity = 'high') => ({ name: 'braces', dependency: 'braces', url, severity, range: '<=3.0.3' });
const audit = (via = [advisory()]) => ({ auditReportVersion: 2, vulnerabilities: { braces: {
  name: 'braces', via, nodes: ['node_modules/braces'], severity: 'high', range: '*',
} } });
function gate(t, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(dir, 'npm'), '#!/bin/sh\ncat "$AUDIT_FIXTURE"\nexit 1\n', { mode: 0o700 });
  return spawnSync('bash', ['scripts/ci/dep-audit-runtime-high.sh'], { cwd: root,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, AUDIT_FIXTURE: path.join(dir, 'audit.json') }, encoding: 'utf8' });
}
test('gate：仅本精确advisory且冻结条件满足可通过', t => {
  const result = gate(t, audit());
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
for (const severity of ['high', 'critical']) test(`gate：同包新增${severity}仍拒绝`, t => {
  assert.equal(gate(t, audit([advisory(), advisory('https://github.com/advisories/GHSA-new-high', severity)])).status, 1);
});
for (const data of [null, {}, { auditReportVersion: 2 }, { auditReportVersion: 2, vulnerabilities: [] }, audit([{}]), audit([])]) {
  test('gate：缺失或坏schema拒绝', t => assert.equal(gate(t, data).status, 1));
}
const api = () => require('../runtime-advisory-filter.cjs');
test('逐advisory：仅精确本条可豁免；相似URL/异包/未知条件拒绝', () => {
  const { filterAudit } = api();
  assert.deepEqual(filterAudit(audit(), new Set(), { ok: true }), []);
  for (const url of [targetURL + '?x', '', 'https://github.com/advisories/GHSA-new-high']) {
    assert.ok(filterAudit(audit([advisory(url)]), new Set(), { ok: true }).length > 0);
  }
  assert.ok(filterAudit(audit(), new Set(), { ok: false }).length > 0);
  assert.ok(filterAudit(audit([advisory('https://github.com/advisories/new')]), new Set(['braces']), { ok: true }).length > 0);
  const wrong = audit(); wrong.vulnerabilities.other = wrong.vulnerabilities.braces; delete wrong.vulnerabilities.braces;
  assert.ok(filterAudit(wrong, new Set(), { ok: true }).length > 0);
});
test('旧包豁免及纯继承保持；非本条critical不可吞', () => {
  const { filterAudit } = api();
  const data = { auditReportVersion: 2, vulnerabilities: {
    uuid: { name: 'uuid', via: [{ name: 'uuid', url: 'https://github.com/advisories/legacy', severity: 'high' }] },
    inherited: { name: 'inherited', via: ['braces'] },
  } };
  assert.deepEqual(filterAudit(data, new Set(['uuid']), { ok: false }), []);
  assert.ok(filterAudit(audit([advisory(targetURL, 'critical')]), new Set(), { ok: true }).length > 0);
});
test('条件：真实当前source/lock/installed闭包与固定期限', () => {
  const { verifyCondition } = api();
  const profile = JSON.parse(fs.readFileSync(path.join(root, 'scripts/ci/runtime-advisory-conditions.json')));
  assert.equal(verifyCondition(root, profile, new Date('2026-10-03T00:00:00Z')).ok, true);
  assert.equal(verifyCondition(root, profile, new Date('2026-10-10T00:00:00Z')).ok, false);
  for (const mutate of [p => p.source.count++, p => p.source.sha256 = '0'.repeat(64),
    p => p.closure.sha256 = '0'.repeat(64), p => p.serverSha256 = '0'.repeat(64),
    p => p.installed[0].version = '3.0.4', p => p.installed = [], p => p.schemaVersion = 9,
    p => p.knownLinks['packages/brain/sprints'] = '../../../other']) {
    const bad = structuredClone(profile); mutate(bad);
    assert.equal(verifyCondition(root, bad, new Date('2026-10-03T00:00:00Z')).ok, false);
  }
});
test('源码census：新runtime consumer/脚本/非JS配置/.gitignore改动均失效', t => {
  const { sourceCensus } = api();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = spawnSync('git', ['init', '-q', dir]); assert.equal(run.status, 0);
  fs.mkdirSync(path.join(dir, 'apps/api/src'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'apps/api/src/server.ts'), 'export {};');
  spawnSync('git', ['add', '.'], { cwd: dir });
  const before = sourceCensus(dir);
  for (const [file, value] of [['apps/api/src/new.ts', 'require("http-proxy-middleware")'],
    ['scripts/runtime.py', 'print("runtime")'], ['apps/api/src/routing.yaml', 'pathFilter: /**'],
    ['config/new-routing.json', '{"pathFilter":"/**"}'], ['frontend/runtime.js', 'require("braces")'],
    ['new-directory/new-consumer.js', 'require("micromatch")'],
    ['.gitignore', 'node_modules/\napps/api/src/\n']]) {
    const q = path.join(dir, file); fs.mkdirSync(path.dirname(q), { recursive: true });
    const old = fs.existsSync(q) ? fs.readFileSync(q) : null; fs.writeFileSync(q, value);
    assert.notEqual(sourceCensus(dir).sha256, before.sha256, file);
    if (old) fs.writeFileSync(q, old); else fs.unlinkSync(q);
  }
});
test('symlink：仅两固定tracked link文字纳入，未知/target/type变更拒绝', t => {
  const { sourceCensus } = api();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-link-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', dir]).status, 0);
  fs.mkdirSync(path.join(dir, 'packages/brain'), { recursive: true });
  const known = path.join(dir, 'packages/brain/sprints');
  fs.symlinkSync('../../sprints', known);
  assert.equal(spawnSync('git', ['add', '.'], { cwd: dir }).status, 0);
  const before = sourceCensus(dir);
  const unknown = path.join(dir, 'packages/brain/runtime-link');
  fs.symlinkSync('/tmp/no-read-external', unknown);
  assert.throws(() => sourceCensus(dir), /symlink/); fs.unlinkSync(unknown);
  fs.unlinkSync(known); fs.symlinkSync('../../../other', known);
  assert.throws(() => sourceCensus(dir), /symlink/);
  fs.unlinkSync(known); fs.writeFileSync(known, '../../sprints');
  assert.throws(() => sourceCensus(dir), /type drift/);
  fs.unlinkSync(known); fs.symlinkSync('../../sprints', known);
  assert.deepEqual(sourceCensus(dir), before);
  fs.writeFileSync(path.join(dir, 'packages/brain/regular.js'), 'x');
  spawnSync('git', ['add', '.'], { cwd: dir });
  fs.unlinkSync(path.join(dir, 'packages/brain/regular.js'));
  fs.symlinkSync('../../sprints', path.join(dir, 'packages/brain/regular.js'));
  assert.throws(() => sourceCensus(dir), /symlink/);
});
test('锁闭包：新production上游及版本变更都失效，dev不冒充runtime', () => {
  const { runtimeClosure } = api();
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  const before = runtimeClosure(lock);
  const changed = structuredClone(lock); changed.packages['node_modules/new-runtime'] = { version: '1', dependencies: { braces: '^3.0.3' } };
  assert.notEqual(runtimeClosure(changed).sha256, before.sha256);
  changed.packages['node_modules/new-runtime'].dev = true;
  assert.equal(runtimeClosure(changed).sha256, before.sha256);
  const version = structuredClone(lock); version.packages['node_modules/micromatch'].version = '4.0.9';
  assert.notEqual(runtimeClosure(version).sha256, before.sha256);
});
test('实际HPM普通HTTP/WS默认无glob：深raw/encoded URI；glob负控确达陷阱', () => {
  const mm = require.resolve('micromatch'); const previous = require.cache[mm]; let calls = 0;
  require.cache[mm] = { id: mm, filename: mm, loaded: true, exports: () => { calls++; throw Error('glob reached'); } };
  const hp = require.resolve('http-proxy-middleware/dist/http-proxy-middleware.js');
  const pf = require.resolve('http-proxy-middleware/dist/path-filter.js');
  delete require.cache[hp]; delete require.cache[pf];
  const { HttpProxyMiddleware } = require(hp);
  return (async () => {
    try {
      let web = 0, ws = 0;
      for (let i = 0; i < 7; i++) {
        const h = new HttpProxyMiddleware({ target: 'http://127.0.0.1:1', logger: { error() {}, warn() {}, info() {} } });
        h.proxy.web = () => web++; h.proxy.ws = () => ws++;
        for (const url of ['/normal', '/' + '{'.repeat(5000) + 'x' + '}'.repeat(5000),
          '/' + encodeURIComponent('{'.repeat(5000) + 'x' + '}'.repeat(5000))]) {
          assert.equal(h.shouldProxy(undefined, { url }), true);
          await h.middleware({ url }, {}, () => assert.fail('unexpected next'));
          await h.handleUpgrade({ url }, {}, Buffer.alloc(0));
        }
        h.proxy.close();
      }
      assert.equal(web, 21); assert.equal(ws, 21); assert.equal(calls, 0);
      const h = new HttpProxyMiddleware({ target: 'http://127.0.0.1:1', logger: { error() {}, warn() {}, info() {} } });
      assert.equal(h.shouldProxy('/{a,b}/**', { url: '/normal' }), false); assert.equal(calls, 1); h.proxy.close();
    } finally { if (previous) require.cache[mm] = previous; else delete require.cache[mm]; delete require.cache[hp]; delete require.cache[pf]; }
  })();
});
