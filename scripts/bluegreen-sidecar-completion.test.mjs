import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const sha = 'a'.repeat(40), previousSha = 'b'.repeat(40);
const image = `sha256:${'1'.repeat(64)}`, previousImage = `sha256:${'2'.repeat(64)}`;
const container = '3'.repeat(64), deployment = '11111111-1111-4111-8111-111111111111';
async function fixture(t, scenario = '') {
  const root = await mkdtemp(join(tmpdir(), 'sidecar-completion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'scripts/brain-image-retention'), { recursive: true });
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'ledger'), { mode: 0o700 });
  await copyFile(new URL('./lib/brain-image-retention.sh', import.meta.url), join(root, 'scripts/lib/brain-image-retention.sh'));
  const request = { deployment_id: deployment, version: '1.360.5', git_sha: sha };
  const previous = { id: previousImage, git_sha: previousSha, tags: ['cecelia-brain:1.360.3'] };
  await writeFile(join(root, 'ledger/ledger.json'), JSON.stringify({ schema_version: 1, generation: 1, pending: { deployment_id: deployment, request, previous }, successes: [] }), { mode: 0o600 });
  await writeFile(join(root, `ledger/deployment-${deployment}.json`), JSON.stringify({ request, previous, receipt: null }), { mode: 0o600 });
  // 脚本真实执行，Docker 进程边界隔离；finish 使用正式 ledger 逻辑真实落盘。
  await writeFile(join(root, 'scripts/brain-image-retention/cli.mjs'), `
    import {createDeploymentLedger} from ${JSON.stringify(new URL('./brain-image-retention/ledger.mjs', import.meta.url).href)};
    import {createStore} from ${JSON.stringify(new URL('./brain-image-retention/storage.mjs', import.meta.url).href)};
    if(process.env.BRAIN_URL !== 'http://127.0.0.1:5221' || process.env.SCENARIO === 'finish-fail') process.exit(1);
    const recovered=process.argv.at(-1)==='recovered';
    const id=recovered?${JSON.stringify(previousImage)}:${JSON.stringify(image)};
    const git_sha=recovered?${JSON.stringify(previousSha)}:${JSON.stringify(sha)};
    const version=recovered?'1.360.3':'1.360.5';
    const ledger=createDeploymentLedger({store:createStore(process.env.CECELIA_IMAGE_RETENTION_DIR),docker:{snapshot:async()=>({containers:[{name:'/cecelia-node-brain',running:true,image_id:id}],images:[{id,git_sha,tags:['cecelia-brain:'+version]}]})},health:async()=>({status:'healthy',version,git_sha})});
    const receipt=await ledger.finish(process.argv.at(-2),process.argv.at(-1));
    process.stdout.write(receipt.outcome+'\\n');
  `);
  await writeFile(join(root, 'bin/docker.cjs'), `
    const fs=require('node:fs'),cp=require('node:child_process');
    const args=process.argv.slice(2), root=process.env.FIXTURE_ROOT, scenario=process.env.SCENARIO;
    fs.appendFileSync(root+'/calls',JSON.stringify(args)+'\\n');
    const exists=fs.existsSync(root+'/started'), recovered=fs.existsSync(root+'/fallback');
    let id=recovered?'${previousImage}':'${image}', s=recovered?'${previousSha}':'${sha}';
    if(args[0]==='image' && args[1]==='inspect') {
      const fallback=args.at(-1)==='cecelia-brain:blue-fallback';
      console.log((fallback?'${previousImage}':'${image}')+'|'+JSON.stringify(['cecelia-brain:'+(fallback?'1.360.3':'1.360.5')])+'|GIT_SHA='+(fallback?'${previousSha}':'${sha}'));process.exit(0);
    }
    if(args[0]==='inspect') {
      if(!exists)process.exit(1);
      const drift=scenario==='drift' && fs.existsSync(root+'/healthy');
      console.log((drift?'${'4'.repeat(64)}':'${container}')+' '+(scenario==='wrong-image'?'${previousImage}':id)+' /cecelia-node-brain true node-brain');process.exit(0);
    }
    if(args[0]==='compose') {
      if(process.env.BRAIN_VERSION==='blue-fallback') fs.writeFileSync(root+'/fallback','');
      else if(scenario==='fallback')process.exit(7);
      fs.writeFileSync(root+'/started','');process.exit(0);
    }
    if(args[0]==='exec') {
      if(!args.includes('${container}'))process.exit(91);
      if(args.some(x=>x.endsWith('/healthz')))process.exit(scenario==='unhealthy'?22:0);
      if(args.some(x=>x.endsWith('/health'))) {
        fs.writeFileSync(root+'/healthy','');console.log(JSON.stringify({status:scenario==='degraded'?'degraded':'healthy',version:recovered?'1.360.3':'1.360.5',git_sha:scenario==='wrong-sha'?'${previousSha}':s}));process.exit(0);
      }
      if(args.some(x=>x.endsWith('/drain-cancel'))) {
        if(scenario==='drain-fail')process.exit(22);
        console.log(JSON.stringify({success:scenario!=='drain-false'}));process.exit(0);
      }
      if(args.includes('finish')) {
        const env={...process.env};for(const a of args)if(a.startsWith('BRAIN_URL=')||a.startsWith('CECELIA_IMAGE_RETENTION_DIR=')){const i=a.indexOf('=');env[a.slice(0,i)]=a.slice(i+1);}
        const r=cp.spawnSync(process.execPath,[root+'/scripts/brain-image-retention/cli.mjs',...args.slice(args.indexOf('finish'))],{env,stdio:'inherit'});process.exit(r.status??1);
      }
    }
    process.exit(90);
  `, { mode: 0o755 });
  await writeFile(join(root, 'bin/docker'), '#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' -- \"$0.cjs\" \"$@\"\n', { mode: 0o755 });
  await writeFile(join(root, 'bin/curl'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
  await writeFile(join(root, 'bin/sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, FIXTURE_ROOT: root, SCENARIO: scenario, BRAIN_VERSION: '1.360.5', EXPECTED_SHA: scenario === 'request-sha' ? previousSha : sha, ENV_REGION: 'us', DEPLOY_ROOT: root, CECELIA_INTERNAL_ENV_FILE: `${root}/internal.env`, CECELIA_IMAGE_DEPLOYMENT_ID: deployment, CECELIA_IMAGE_RETENTION_DIR: `${root}/ledger`, BARK_TOKEN: '' };
  const result = await run('bash', [new URL('./lib/bluegreen-sidecar.sh', import.meta.url).pathname], { env, timeout: 20000 }).then(x => ({ ...x, code: 0 }), e => ({ ...e, code: e.code }));
  return { ...result, root, calls: (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse), ledger: JSON.parse(await readFile(join(root, 'ledger/ledger.json'), 'utf8')) };
}
test('宿主端口不可达时经固定容器localhost确认健康、恢复drain及正式ledger真实收尾', async t => {
  const f = await fixture(t);
  assert.equal(f.code, 0, f.stdout + f.stderr);
  assert.equal(f.ledger.pending, null);
  assert.equal(f.ledger.successes.length, 1);
  assert.equal(f.ledger.successes[0].git_sha, sha);
  const execs = f.calls.filter(x => x[0] === 'exec');
  assert.ok(execs.some(x => x.includes('http://127.0.0.1:5221/api/brain/health')));
  assert.ok(execs.every(x => x.includes(container)));
});
for (const scenario of ['request-sha', 'wrong-image', 'wrong-sha', 'drift', 'unhealthy', 'degraded', 'drain-fail', 'drain-false', 'finish-fail']) {
  test(`${scenario} 必须非零并保持pending、不得写成功历史`, async t => {
    const f = await fixture(t, scenario);
    assert.notEqual(f.code, 0);
    assert.equal(f.ledger.pending.deployment_id, deployment);
    assert.deepEqual(f.ledger.successes, []);
    assert.ok(!f.calls.some(x => ['rm', 'run'].includes(x[0])));
    if (!['drain-fail', 'drain-false', 'finish-fail'].includes(scenario)) assert.ok(!f.calls.some(x => x.some(a => a.endsWith('/drain-cancel'))));
  });
}
test('fallback只确认旧镜像真实恢复，不新增成功部署历史', async t => {
  const f = await fixture(t, 'fallback');
  assert.equal(f.code, 0, f.stdout + f.stderr);
  assert.equal(f.ledger.pending, null);
  assert.deepEqual(f.ledger.successes, []);
  const row = JSON.parse(await readFile(join(f.root, `ledger/deployment-${deployment}.json`), 'utf8'));
  assert.equal(row.receipt.outcome, 'recovered');
  assert.equal(row.receipt.image_id, previousImage);
});
