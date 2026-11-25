import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, git, assertDecision, certify, consumerDigest, runtime,
  certificatePath, certificateSchema, certificatePolicy } from './helpers/brain-deploy-preflight-fixture.mjs';

test('消费者B已发布不能续证：随后C只改watchdog仍须部署', async t => {
  const f = await fixture(t);
  await f.put('packages/brain/Dockerfile', 'COPY scripts/ops/us-vps/opc-watchdog.sh /app/watchdog.sh');
  const b = f.commit(); runtime(f,b);
  const certificateBefore = await readFile(join(f.root,certificatePath));
  await f.put('scripts/ops/us-vps/opc-watchdog.sh', 'C-runtime-consumed');
  const proof = await assertDecision(f,true,f.commit());
  assert.equal(proof.reason,'certification_expired'); assert.equal(proof.certification_status,'expired');
  assert.deepEqual(await readFile(join(f.root,certificatePath)), certificateBefore);
});
test('各类消费者或控制面已发布后，旧认证持续失效', async t => {
  const f = await fixture(t);
  for (const [path,content] of [
    ['packages/brain/src/read-dod.js', "readFileSync('DoD.md')"], ['.dockerignore','changed'],
    ['docker-compose.yml','changed'], ['packages/brain/src/config.js','changed'], ['scripts/ops/new-host-helper.sh','changed'],
    ['.github/workflows/ci.yml','changed'], ['scripts/ci/brain-deploy-preflight.mjs','changed'],
    ['scripts/ci/run-brain-deploy.sh','changed'], ['scripts/ci/__tests__/new.test.mjs','changed'], ['unknown-future-consumer','changed']]) {
    git(f.root,'reset','--hard',f.a); await f.put(path,content); runtime(f,f.commit());
    await f.put('DoD.md','subsequent excluded change'); const proof = await assertDecision(f,true,f.commit());
    assert.equal(proof.reason,'certification_expired',path);
  }
});
test('缺证书、仅target有证书不能授权不同SHA免部署', async t => {
  const f = await fixture(t,{ certified:false });
  await f.put('.prd.md','next'); await assertDecision(f,true,f.commit());
  await certify(f.root); await assertDecision(f,true,f.commit());
});
test('重新审查更新证书当次必须部署，部署后safe变化才恢复优化', async t => {
  const f = await fixture(t);
  await f.put('packages/brain/server.js','new consumer'); runtime(f,f.commit());
  await f.put('.prd.md','still requires deployment'); runtime(f,f.commit());
  await certify(f.root); const d = f.commit(); await assertDecision(f,true,d);
  runtime(f,d); await f.put('scripts/ops/us-vps/opc-watchdog.sh','safe after independent re-audit');
  const proof = await assertDecision(f,false,f.commit());
  assert.equal(proof.certification_status,'valid');
  assert.equal(proof.certification_schema,certificateSchema); assert.equal(proof.certification_policy_id,certificatePolicy);
  assert.equal(proof.certification_consumer_tree_sha256,proof.observed_consumer_tree_sha256);
});
test('完整性失败的证书即使已部署也不能用于后续排除', async t => {
  const f = await fixture(t), valid = JSON.parse(await readFile(join(f.root,certificatePath),'utf8'));
  const invalid = ['{', JSON.stringify({...valid,schema:'unknown'}), JSON.stringify({...valid,policy_id:'wide'}),
    JSON.stringify({...valid,consumer_tree_sha256:'f'.repeat(64)}), JSON.stringify({...valid,exclusions:['packages/brain/**']}),
    JSON.stringify({...valid,consumer_tree_sha256:1}), ' '.repeat(65537)];
  for (const text of invalid) {
    git(f.root,'reset','--hard',f.a); await f.put(certificatePath,text); runtime(f,f.commit());
    await f.put('.prd.md','next'); await assertDecision(f,true,f.commit());
  }
  for (const type of ['missing','executable','symlink']) {
    git(f.root,'reset','--hard',f.a);
    if(type==='missing')await rm(join(f.root,certificatePath));
    if(type==='executable')await chmod(join(f.root,certificatePath),0o755);
    if(type==='symlink'){await rm(join(f.root,certificatePath));await symlink('../../../.prd.md',join(f.root,certificatePath));}
    runtime(f,f.commit()); await f.put('.prd.md','next'); await assertDecision(f,true,f.commit());
  }
});
test('证书自身只在consumer摘要排除，摘要无自引用且无消费者变化累计仍有效', async t => {
  const f = await fixture(t), first = consumerDigest(f.root);
  await certify(f.root); assert.equal(consumerDigest(f.root),first); await certify(f.root); assert.equal(consumerDigest(f.root),first);
  for(const path of ['scripts/ops/us-vps/opc-watchdog.sh','.prd.md','DoD.md']) {
    await f.put(path,'safe-'+path); const proof = await assertDecision(f,false,f.commit());
    assert.equal(proof.actual_runtime_sha,f.a); assert.equal(proof.certification_status,'valid');
  }
});
