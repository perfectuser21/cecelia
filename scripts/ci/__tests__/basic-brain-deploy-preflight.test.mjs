import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, readFile, rm, chmod, symlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createStore } from '../../brain-image-retention/storage.mjs';
import { createDeploymentLedger } from '../../brain-image-retention/ledger.mjs';
import { fixture, git, assertDecision } from './helpers/brain-deploy-preflight-fixture.mjs';
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

test('原生只读settlement与CLI联动保持真实磁盘ledger和deployment收据字节不变', async t => {
  const f = await fixture(t), root = join(await realpath(f.root), '.git', 'native-ledger');
  await mkdir(root, { mode: 0o700 }); const store = createStore(root);
  const docker = {
    snapshot: async () => ({ containers: [{ id: f.receipt.container_id, name: '/cecelia-node-brain', running: true, image_id: f.receipt.image_id }],
      images: [{ id: f.receipt.image_id, git_sha: f.a, tags: ['cecelia-brain:1.2.3'] }] }),
    containerHealth: async () => f.health, containerBusinessReadback: async () => f.receipt.business_readback,
  };
  const ledger = createDeploymentLedger({ store, docker, health: async () => f.health });
  const request = { deployment_id: f.receipt.deployment_id, git_sha: f.a, version: '1.2.3' };
  await ledger.begin(request); await ledger.finish(request.deployment_id, 'success');
  f.ledger = join(root, 'ledger.json'); const deployment = join(root, `deployment-${request.deployment_id}.json`);
  const before = await readFile(deployment);
  f.respond = async (req,res,value) => {
    try { res.end(JSON.stringify(req.url.endsWith('/status') ? { ...value, settlement: await ledger.settlement(f.a) } : value)); }
    catch { res.end(JSON.stringify({ ...value, settled: false, settlement: null })); }
  };
  await f.put('.prd.md', 'only task documentation'); await assertDecision(f, false, f.commit());
  assert.deepEqual(await readFile(deployment), before);
});
test('原生业务readback限定最多一条样本，伪造多条样本不能免发布', async t => {
  const f = await fixture(t); f.receipt.business_readback.task_count = 2; await assertDecision(f, true);
});
test('二进制任务文档不纳入认证普通文本排除', async t => {
  const f = await fixture(t); await f.put('.prd.md', Buffer.from([0,1,2])); await assertDecision(f, true, f.commit());
});
test('Git命令超时回原发布，不把未知产物变为绿色证明', async t => {
  const f = await fixture(t), bin = join(f.root,'.git','slow-bin'); await mkdir(bin);
  await writeFile(join(bin,'git'), '#!/bin/sh\nsleep 1\n', { mode: 0o755 });
  const result = await f.run(f.a, ['--git-timeout-ms','10'], { PATH: bin + ':' + process.env.PATH });
  assert.equal(result.code,0); assert.equal(result.report.deploy_required,true);
});
