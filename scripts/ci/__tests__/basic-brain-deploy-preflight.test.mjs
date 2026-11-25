import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
const entry = fileURLToPath(new URL('../brain-deploy-preflight.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'brain-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'cp-fixture'); git(root, 'config', 'core.hooksPath', join(root, '.git', 'hooks')); git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'core.filemode', 'true');
  const put = async (path, text = 'initial') => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  const commit = () => { git(root, 'add', '-A'); git(root, 'commit', '-qm', 'fixture'); return git(root, 'rev-parse', 'HEAD'); };
  await put('packages/brain/server.js'); await put('.prd.md'); await put('scripts/ops/us-vps/opc-watchdog.sh');
  const a = commit();
  const receipt = { deployment_id: '12345678-1234-4234-9234-123456789abc', outcome: 'success',
    git_sha: a, image_id: 'sha256:' + 'a'.repeat(64), container_id: 'b'.repeat(64), version: '1.2.3', confirmed_at: '2026-11-25T00:00:00.000Z',
    business_readback: { protocol: 'brain-release-readback/v1', status: 'passed', container_id: 'b'.repeat(64), task_count: 0, task_sample_sha256: 'e'.repeat(64), scope: 'read_only', external_services: 'not_evaluated' } };
  const state = { status: 'idle', git_sha: a, settled: true, settlement: receipt };
  const health = { status: 'healthy', git_sha: a, version: '1.2.3', runtime: { isolated: false, background_automation: true } };
  const ledger = join(root, 'ledger.json'); await writeFile(ledger, JSON.stringify(receipt));
  // Native read-only ledger remains separate from the fixture repository commits.
  git(root, 'config', 'core.excludesFile', join(root, '.git', 'exclude-fixture'));
  await writeFile(join(root, '.git', 'exclude-fixture'), 'ledger.json\nreport*.json\ngithub-output\n');
  const calls = []; let statusReads = 0;
  const server = createServer((req, res) => {
    calls.push([req.method, req.url]);
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const value = req.url === '/api/brain/deploy/status' ? (statusReads++, state) : req.url === '/api/brain/health' ? health : null;
    if (!value) { res.writeHead(404); res.end(); return; }
    if (f.respond) { f.respond(req, res, value, statusReads); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const f = { root, a, put, commit, state, receipt, health, calls, ledger, respond: null,
    async run(target = git(root, 'rev-parse', 'HEAD'), extra = [], env = {}) {
      const output = join(root, 'report.json'), github = join(root, 'github-output');
      await rm(output, { force: true }); await rm(github, { force: true });
      const child = spawn(process.execPath, [entry, '--repo-root', root, '--target', target,
        '--brain-url', `http://127.0.0.1:${server.address().port}`, '--output', output, ...extra],
      { env: { ...process.env, GITHUB_OUTPUT: github, FORCE_BRAIN_DEPLOY: '', ...env } });
      let stdout = '', stderr = ''; child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
      const code = await new Promise(resolve => child.on('close', resolve));
      let report = null; try { report = JSON.parse(await readFile(output, 'utf8')); } catch {}
      return { code, stdout, stderr, report, github: await readFile(github, 'utf8').catch(() => '') };
    } };
  return f;
}
async function assertDecision(f, wanted, target) {
  const before = await readFile(f.ledger);
  const result = await f.run(target);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.report?.deploy_required, wanted, '真实发布决策不符合业务边界');
  assert.match(result.github, new RegExp(`^deploy_required=${wanted}$`, 'm'));
  assert.deepEqual(await readFile(f.ledger), before);
  assert.equal(f.calls.filter(([method]) => method !== 'GET').length, 0);
  return result.report;
}
test('累计认证文档和宿主watchdog变化保留实际A，Brain变化D要求发布', async t => {
  const f = await fixture(t);
  await f.put('.prd.md', 'B'); const b = f.commit();
  const proof = await assertDecision(f, false, b);
  assert.equal(proof.action, 'no_brain_change'); assert.equal(proof.actual_runtime_sha, f.a);
  assert.equal(proof.target_sha, b); assert.equal(proof.schema, 'brain-deploy-preflight/v1');
  assert.equal(proof.baseline_tree_hash, proof.target_tree_hash);
  assert.deepEqual(proof.certified_excluded_changed_paths, ['.prd.md']);
  assert.equal(proof.host_ops_installation, 'not_evaluated'); assert.equal(proof.external_services, 'not_evaluated');
  assert.equal(proof.native_receipt.deployment_id, f.receipt.deployment_id);
  await f.put('scripts/ops/us-vps/opc-watchdog.sh', 'C'); const c = f.commit();
  await assertDecision(f, false, c);
  await f.put('packages/brain/server.js', 'D'); await assertDecision(f, true, f.commit());
});
test('实际target已在线也必须经过双读健康证明', async t => {
  const f = await fixture(t); const proof = await assertDecision(f, false, f.a);
  assert.equal(proof.action, 'already_current');
  assert.deepEqual(f.calls.map(x => x[1]), ['/api/brain/deploy/status','/api/brain/health','/api/brain/deploy/status','/api/brain/health']);
});
test('未知路径、运行资料、发布控制面全部参与完整树投影', async t => {
  const f = await fixture(t);
  for (const path of ['docs/instruction-book/a.md','docs/registry/coding-workflow-authority.json','scripts/ops/janitor.sh','scripts/ops/node-onboarding.sh','docs/unknown.md','scripts/ops/unknown.sh','packages/brain/Dockerfile','.dockerignore','docker-compose.yml','package-lock.json','.github/workflows/ci.yml','scripts/ci/brain-deploy-preflight.mjs','odd space\nname']) {
    git(f.root, 'reset', '--hard', f.a); await f.put(path, 'changed'); await assertDecision(f, true, f.commit());
  }
});
test('模式变化、排除路径symlink及submodule都不得获得无需发布证明', async t => {
  const f = await fixture(t);
  await chmod(join(f.root, 'packages/brain/server.js'), 0o755); await assertDecision(f, true, f.commit());
  git(f.root, 'reset', '--hard', f.a); await chmod(join(f.root, '.prd.md'), 0o755); await assertDecision(f, true, f.commit());
  git(f.root, 'reset', '--hard', f.a); await rm(join(f.root, '.prd.md')); await symlink('packages/brain/server.js', join(f.root, '.prd.md')); await assertDecision(f, true, f.commit());
  git(f.root, 'reset', '--hard', f.a); git(f.root, 'update-index', '--add', '--cacheinfo', `160000,${f.a},.prd.md`);
  git(f.root, 'commit', '-qm', 'submodule'); await assertDecision(f, true);
});
test('认证普通文本删除或新增可排除，未知重命名仍发布，工作区不充当产物', async t => {
  const f = await fixture(t);
  await rm(join(f.root, '.prd.md')); await assertDecision(f, false, f.commit());
  git(f.root, 'reset', '--hard', f.a); git(f.root, 'mv', '.prd.md', 'renamed.md'); await assertDecision(f, true, f.commit());
  git(f.root, 'reset', '--hard', f.a); await f.put('.dod.md', 'new'); const target = f.commit();
  await f.put('packages/brain/server.js', 'uncommitted'); await assertDecision(f, false, target);
});
test('缺失SHA、未知commit、HEAD不符和非祖先均回原发布', async t => {
  const f = await fixture(t);
  for (const target of ['', f.a.slice(0,12), 'f'.repeat(40)]) await assertDecision(f, true, target);
  await f.put('.prd.md', 'next'); const next = f.commit(); await assertDecision(f, true, f.a);
  f.state.git_sha = next; f.receipt.git_sha = next; f.health.git_sha = next;
  git(f.root, 'reset', '--hard', f.a); await assertDecision(f, true, f.a);
  f.state.git_sha = 'f'.repeat(40); f.receipt.git_sha = f.state.git_sha; f.health.git_sha = f.state.git_sha; await assertDecision(f, true);
});
test('任何不完整、失败、隔离或身份不一致的native证明都回原发布', async t => {
  const f = await fixture(t); const baseline = structuredClone([f.state,f.health]);
  const cases = [() => f.state.settled = false, () => f.state.status = 'running', () => f.state.status = 'failed', () => f.state.status = 'rolled_back',
    () => delete f.state.settlement, () => f.receipt.outcome = 'failed', () => f.receipt.git_sha = 'a'.repeat(40), () => f.receipt.image_id = 'invalid',
    () => f.receipt.container_id = 'short', () => f.receipt.deployment_id = 'unknown', () => f.receipt.version = 'bad', () => f.receipt.confirmed_at = 'bad',
    () => delete f.receipt.business_readback, () => f.receipt.business_readback.status = 'failed', () => f.receipt.business_readback.scope = 'write',
    () => f.receipt.business_readback.container_id = 'c'.repeat(64), () => f.health.status = 'degraded', () => f.health.git_sha = 'c'.repeat(40),
    () => f.health.version = '1.2.4', () => f.health.runtime.isolated = true, () => f.health.runtime.background_automation = false];
  for (const change of cases) {
    Object.keys(f.state).forEach(k => delete f.state[k]); Object.assign(f.state, structuredClone(baseline[0])); f.receipt = f.state.settlement;
    Object.keys(f.health).forEach(k => delete f.health[k]); Object.assign(f.health, structuredClone(baseline[1]));
    change(); await assertDecision(f, true);
  }
});
test('两次观测任何native身份漂移均回原发布', async t => {
  const f = await fixture(t); const original = structuredClone(f.receipt);
  for (const key of ['git_sha','image_id','container_id','deployment_id','version','confirmed_at']) {
    Object.assign(f.receipt, original); let reads = 0;
    f.respond = (req,res,value) => {
      if (req.url.endsWith('/status') && ++reads === 2) {
        const copy = structuredClone(value);
        copy.settlement[key] = key === 'version' ? '1.2.4' : key === 'confirmed_at' ? '2026-11-26T00:00:00.000Z' : key === 'deployment_id' ? '22345678-1234-4234-9234-123456789abc' : key === 'image_id' ? 'sha256:'+'c'.repeat(64) : 'c'.repeat(key === 'git_sha' ? 40 : 64);
        res.end(JSON.stringify(copy));
      } else res.end(JSON.stringify(value));
    };
    await assertDecision(f, true);
  }
});
test('force参数和环境开关都强制原发布', async t => {
  const f = await fixture(t);
  for (const [args,env] of [[['--force'],{}],[[],{ FORCE_BRAIN_DEPLOY:'1' }]]) {
    const result = await f.run(f.a,args,env); assert.equal(result.code,0); assert.equal(result.report.deploy_required,true);
  }
});
test('HTTP错误、非JSON、超大响应和超时保守发布', async t => {
  const f = await fixture(t);
  for (const respond of [(req,res) => {res.writeHead(503);res.end('{}');}, (req,res) => res.end('not json'),
    (req,res) => res.end('x'.repeat(1024*1024+1)), () => {}]) {
    f.respond = respond; const result = await f.run(f.a,['--request-timeout-ms','50']);
    assert.equal(result.code,0); assert.equal(result.report.deploy_required,true);
  }
});
test('报告写失败返回非零且不能输出无需发布绿灯', async t => {
  const f = await fixture(t); const result = await f.run(f.a,['--output',join(f.root,'missing','report.json')]);
  assert.notEqual(result.code,0); assert.doesNotMatch(result.github,/deploy_required=false/);
});
