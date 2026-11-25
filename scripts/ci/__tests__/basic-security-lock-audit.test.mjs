import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {mkdtemp, mkdir, writeFile, readFile, symlink, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import yaml from 'js-yaml';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = yaml.load(await readFile(join(root, '.github/workflows/ci.yml'), 'utf8'));
// 直接消费真实security的全部shell步骤；公告服务是隔离边界，npm与审计脚本均为真实实现。
const command = workflow.jobs.security.steps.filter(step => step.run).map(step => step.run).join('\n');
const prod = 'ci-prod-fixture';
const dev = 'ci-dev-fixture';

async function fixture({vulnerable, severity = 'high', registryFailure = false, missingLock = false} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ci-security-lock-'));
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const decoded = req.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body;
    const entry = {method: req.method, path: req.url};
    if (decoded.length) entry.body = JSON.parse(decoded.toString());
    requests.push(entry);
    res.setHeader('Content-Type', 'application/json');
    if (registryFailure) { res.writeHead(503); res.end('{}'); return; }
    if (req.url === '/-/npm/v1/security/advisories/bulk') {
      const report = vulnerable && entry.body[vulnerable] ? {[vulnerable]: [{
        id: 900001, name: vulnerable, title: '隔离公告夹具', severity,
        url: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
        vulnerable_versions: '<2.0.0', cwe: [], cvss: {score: 8, vectorString: null},
      }]} : {};
      res.end(JSON.stringify(report)); return;
    }
    const name = decodeURIComponent(req.url.slice(1));
    if ([prod, dev].includes(name)) {
      res.end(JSON.stringify({name, 'dist-tags': {latest: '1.0.0'},
        versions: {'1.0.0': {name, version: '1.0.0'}}})); return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const registry = `http://127.0.0.1:${server.address().port}`;
  const manifest = {name: 'ci-audit-consumer', version: '1.0.0', private: true,
    dependencies: {[prod]: '1.0.0'}, devDependencies: {[dev]: '1.0.0'}};
  const lock = {name: manifest.name, version: manifest.version, lockfileVersion: 3,
    requires: true, packages: {'': manifest,
      [`node_modules/${prod}`]: {version: '1.0.0', resolved: `${registry}/${prod}.tgz`},
      [`node_modules/${dev}`]: {version: '1.0.0', resolved: `${registry}/${dev}.tgz`, dev: true}}};
  await mkdir(join(directory, 'scripts'));
  await symlink(join(root, 'scripts/ci'), join(directory, 'scripts/ci'), 'dir');
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
  if (!missingLock) await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock));
  await writeFile(join(directory, 'npmrc'), '');
  let result;
  try {
    result = await execute('bash', ['-e', '-o', 'pipefail', '-c', command], {
      cwd: directory, timeout: 20000,
      env: {...process.env, npm_config_registry: registry, npm_config_cache: join(directory, 'cache'),
        npm_config_userconfig: join(directory, 'npmrc'), npm_config_fetch_retries: '0',
        npm_config_update_notifier: 'false', npm_config_package_lock: 'true'},
    }).then(value => ({status: 0, ...value}), error => ({status: error.code, stdout: error.stdout, stderr: error.stderr}));
    await assert.rejects(access(join(directory, 'node_modules')), {code: 'ENOENT'});
    if (!missingLock) assert.deepEqual(JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8')), lock);
    return {...result, requests};
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  }
}

test('真实security入口无需安装，npm分别审计运行时与完整锁定集合', async () => {
  const result = await fixture();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const bulk = result.requests.filter(req => req.path.endsWith('/advisories/bulk'));
  assert.deepEqual(bulk.map(req => Object.keys(req.body).sort()), [[prod], [dev, prod].sort()]);
  for (const request of bulk) for (const versions of Object.values(request.body)) assert.deepEqual(versions, ['1.0.0']);
  assert.ok(!result.requests.some(req => req.path.endsWith('.tgz')));
});

for (const [name, options, gate] of [
  ['未知运行时high', {vulnerable: prod}, 'dep-audit-runtime-high'],
  ['未知开发依赖critical', {vulnerable: dev, severity: 'critical'}, 'dep-audit-critical'],
]) test(`真实npm报告仍拦截${name}`, async () => {
  const result = await fixture(options);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, new RegExp(gate + ' 发现未豁免'));
  assert.ok(result.requests.some(req => req.path.endsWith('/advisories/bulk')));
});

test('真实npm公告服务故障不能被无安装入口误判成功', async () => {
  const result = await fixture({registryFailure: true});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /审计工具异常|未获得有效证据/);
  assert.ok(result.requests.some(req => req.path.includes('/security/')));
});

test('真实npm缺锁错误必须拒绝，不能成为零漏洞通过', async () => {
  const result = await fixture({missingLock: true});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /审计工具异常|未获得有效证据/);
});
