import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, realpath, cp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const sha = 'a'.repeat(40), previousSha = 'b'.repeat(40);
const image = `sha256:${'1'.repeat(64)}`, previousImage = `sha256:${'2'.repeat(64)}`;
const container = '3'.repeat(64), deployment = '11111111-1111-4111-8111-111111111111';
async function fixture(t, scenario = '') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sidecar-completion-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts/lib'), { recursive: true });
  await mkdir(join(root, 'scripts/brain-image-retention'), { recursive: true });
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'ledger'), { mode: 0o700 });
  await copyFile(new URL('./lib/brain-image-retention.sh', import.meta.url), join(root, 'scripts/lib/brain-image-retention.sh'));
  const request = { deployment_id: deployment, version: '1.360.5', git_sha: sha };
  const previousTags=scenario.startsWith('fallback-prev-')?['cecelia-brain:prev-'+(scenario==='fallback-prev-wrong-version'?'1.360.4':'1.360.3')+'-'+(scenario==='fallback-prev-wrong-sha'?'c'.repeat(12):previousSha.slice(0,12))]:['cecelia-brain:1.360.3'];
  const primaryTags=scenario==='primary-prev-only'?['cecelia-brain:prev-1.360.5-'+sha.slice(0,12)]:['cecelia-brain:1.360.5'];
  const previous = { id: previousImage, git_sha: previousSha, tags: previousTags };
  await writeFile(join(root, 'ledger/ledger.json'), JSON.stringify({ schema_version: 1, generation: 1, pending: { deployment_id: deployment, request, previous }, successes: [] }), { mode: 0o600 });
  await writeFile(join(root, `ledger/deployment-${deployment}.json`), JSON.stringify({ request, previous, receipt: null }), { mode: 0o600 });
  // 正式 CLI/runtime/adapter/ledger/store 全链执行，只有 Docker 进程边界替身。
  await cp(new URL('./brain-image-retention', import.meta.url), join(root, 'scripts/brain-image-retention'), { recursive: true });
  await mkdir(join(root, 'volume'));
  await writeFile(join(root, 'ledger/config.json'), JSON.stringify({schema_version:1,machine_registry_id:'1a379d80-ad36-47d3-88ba-e545ab299a54',daemon_id:'fixture-daemon',docker_root_dir:join(root,'volume'),volume_dev:(await stat(join(root,'ledger'))).dev}), {mode:0o600});
  await writeFile(join(root, 'deny-http.mjs'), 'globalThis.fetch=()=>{throw Error("fixture禁止宿主HTTP")}');
  await writeFile(join(root, 'bin/docker.cjs'), `
    const fs=require('node:fs');
    const args=process.argv.slice(2), root=process.env.FIXTURE_ROOT, scenario=process.env.SCENARIO;
    fs.appendFileSync(root+'/calls',JSON.stringify(args)+'\\n');
    if(scenario==='docker-hang'){setInterval(()=>{},1000);return;}
    const exists=fs.existsSync(root+'/started'), recovered=fs.existsSync(root+'/fallback');
    let id=recovered?'${previousImage}':'${image}', s=recovered?'${previousSha}':'${sha}';
    if(fs.existsSync(root+'/wrong-fallback')){id='sha256:'+ '9'.repeat(64);s='9'.repeat(40);}
    if(args[0]==='info') {
      if(scenario==='finish-fail')process.exit(1);
      if(scenario==='finish-flaky'&&!fs.existsSync(root+'/info-failed-once')){fs.writeFileSync(root+'/info-failed-once','');process.exit(1);}
      console.log(JSON.stringify({OSType:'linux',ID:'fixture-daemon',DockerRootDir:root+'/volume'}));process.exit(0);
    }
    if(args[0]==='image' && args[1]==='ls'){console.log(id);process.exit(0);}
    if(args[0]==='container' && args[1]==='ls'){console.log(scenario==='finish-drift'?'${'4'.repeat(64)}':'${container}');process.exit(0);}
    if(args[0]==='container' && args[1]==='inspect'){
      const fixed=scenario==='finish-drift'?'${'4'.repeat(64)}':'${container}';
      console.log(JSON.stringify([{Id:fixed,Name:'/cecelia-node-brain',Image:id,State:{Running:true}}]));process.exit(0);
    }
    if(args[0]==='image' && args[1]==='inspect' && !args.includes('--format')) {
      console.log(JSON.stringify([{Id:id,RepoTags:recovered?${JSON.stringify(previousTags)}:${JSON.stringify(primaryTags)},RepoDigests:[],Config:{Env:['GIT_SHA='+s]}}]));process.exit(0);
    }
    if(args[0]==='image' && args[1]==='inspect') {
      const fallback=args.at(-1)==='cecelia-brain:blue-fallback'||args.at(-1)==='${previousImage}';
      if(scenario==='previous-id-mismatch'&&args.at(-1)==='${previousImage}'){console.log('sha256:'+ '9'.repeat(64)+'|[]|GIT_SHA='+ '9'.repeat(40));process.exit(0);}
      if(scenario==='fallback-pre-freeze-poison'&&args.at(-1)==='cecelia-brain:blue-fallback'){console.log('sha256:'+ '9'.repeat(64)+'|[]|GIT_SHA='+ '9'.repeat(40));process.exit(0);}
      console.log((fallback?'${previousImage}':'${image}')+'|'+JSON.stringify(fallback?${JSON.stringify(previousTags)}:${JSON.stringify(primaryTags)})+'|GIT_SHA='+(fallback?'${previousSha}':'${sha}'));process.exit(0);
    }
    if(args[0]==='inspect') {
      if(!exists)process.exit(1);
      const drift=scenario==='drift' && fs.existsSync(root+'/healthy');
      console.log((drift?'${'4'.repeat(64)}':'${container}')+' '+(scenario==='wrong-image'?'${previousImage}':id)+' /cecelia-node-brain true node-brain');process.exit(0);
    }
    if(args[0]==='compose') {
      if(process.env.BRAIN_VERSION==='blue-fallback'){fs.writeFileSync(root+'/fallback','');if(scenario==='fallback-tag-drift'&&process.env.CECELIA_RELEASE_IMAGE!=='${previousImage}')fs.writeFileSync(root+'/wrong-fallback','');}
      else if(scenario.startsWith('fallback'))process.exit(7);
      fs.writeFileSync(root+'/started','');process.exit(0);
    }
    if(args[0]==='exec') {
      if(!args.includes('${container}'))process.exit(91);
      if(args.some(x=>x.endsWith('/healthz'))){const sealed=['sealed-degraded','sealed-open-breaker'].includes(scenario),dbDown=['unhealthy','fallback-unhealthy'].includes(scenario),code=(sealed||dbDown)?503:200;const body=JSON.stringify(dbDown?{status:'degraded',db:'error',tick:'dead'}:sealed?{status:'degraded',db:'connected',tick:'dead'}:{status:'ok',db:'connected',tick:'alive'});if(args.some(a=>/^-[a-zA-Z]*f/.test(a))&&code>=400)process.exit(22);process.stdout.write(body+(args.includes('-w')?'\\n'+code:''));return;}
      if(args.some(x=>x.endsWith('/health'))) {
        fs.writeFileSync(root+'/healthy','');console.log(JSON.stringify({status:['degraded','sealed-degraded','sealed-open-breaker'].includes(scenario)?'degraded':'healthy',...(scenario==='sealed-degraded'?{organs:{scheduler:{enabled:false},circuit_breaker:{open:[]}}}:{}),...(scenario==='sealed-open-breaker'?{organs:{scheduler:{enabled:false},circuit_breaker:{open:['cecelia-run']}}}:{}),version:recovered?'1.360.3':'1.360.5',git_sha:scenario==='wrong-sha'?'${previousSha}':s,...(scenario==='health-oversize'?{padding:'x'.repeat(300000)}:{})}));if(args.includes('-w'))process.stdout.write(scenario==='health-redirect'?'302':'200');return;
      }
      if(args.some(x=>x.endsWith('/drain-cancel'))) {
        if(scenario==='drain-fail')process.exit(22);
        console.log(JSON.stringify({success:scenario!=='drain-false',...(scenario==='drain-oversize'?{padding:'x'.repeat(300000)}:{})}));return;
      }
    }
    process.exit(90);
  `, { mode: 0o755 });
  await writeFile(join(root, 'bin/docker'), '#!/bin/sh\nexec '+JSON.stringify(process.execPath)+' -- \"$0.cjs\" \"$@\"\n', { mode: 0o755 });
  await writeFile(join(root, 'bin/node'), `#!/bin/sh
if [ "$1" = /app/scripts/brain-image-retention/cli.mjs ]; then
  shift
  exec ${JSON.stringify(process.execPath)} "$FIXTURE_ROOT/scripts/brain-image-retention/cli.mjs" "$@"
fi
exec ${JSON.stringify(process.execPath)} "$@"
`, { mode: 0o755 });
  await writeFile(join(root, 'bin/curl'), '#!/bin/sh\necho "$*" >> "$FIXTURE_ROOT/curl-calls"\nexit 7\n', { mode: 0o755 });
  // 缩短重试时钟；生产仍为90轮，错误路径保留多次尝试。
  await writeFile(join(root, 'bin/seq'), '#!/bin/sh\nprintf \"1\\n2\\n3\\n\"\n', { mode: 0o755 });
  await writeFile(join(root, 'bin/sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, NODE_OPTIONS: `--import=${root}/deny-http.mjs`, FIXTURE_ROOT: root, SCENARIO: scenario, BRAIN_VERSION: '1.360.5', CECELIA_PREVIOUS_IMAGE: scenario==='previous-missing'?'':scenario==='previous-invalid'?'not-an-id':previousImage, EXPECTED_SHA: scenario === 'request-sha' ? previousSha : sha, ENV_REGION: 'us', DEPLOY_ROOT: root, CECELIA_INTERNAL_ENV_FILE: `${root}/internal.env`, CECELIA_IMAGE_DEPLOYMENT_ID: deployment, CECELIA_IMAGE_RETENTION_DIR: `${root}/ledger`, CECELIA_RETENTION_POLICY: `${root}/scripts/brain-image-retention/policy.mjs`, BARK_TOKEN: 'fixture-token' };
  const result = await run('bash', [new URL('./lib/bluegreen-sidecar.sh', import.meta.url).pathname], { env, timeout: 20000 }).then(x => ({ ...x, code: 0 }), e => ({ ...e, code: e.code }));
  const text = async name => readFile(join(root, name), 'utf8').catch(() => '');
  return { ...result, root, sidecarLog: await text('logs/cecelia-deploy-sidecar-failures.log'), barks: await text('curl-calls'), calls: (await readFile(join(root, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse), ledger: JSON.parse(await readFile(join(root, 'ledger/ledger.json'), 'utf8')) };
}
test('宿主端口不可达时经固定容器localhost确认健康、恢复drain及正式ledger真实收尾', async t => {
  const f = await fixture(t);
  assert.equal(f.code, 0, f.stdout + f.stderr);
  assert.equal(f.ledger.pending, null);
  assert.ok(f.calls.some(args => args.some(arg => arg.endsWith('/drain-cancel'))), '成功收尾必须实际取消 drain');
  assert.equal(f.ledger.successes.length, 1);
  assert.equal(f.ledger.successes[0].git_sha, sha);
  const execs = f.calls.filter(x => x[0] === 'exec');
  assert.ok(execs.some(x => x.includes('http://127.0.0.1:5221/api/brain/health')));
  assert.ok(execs.every(x => x.includes(container)));
});
for (const scenario of ['request-sha', 'wrong-image', 'wrong-sha', 'drift', 'unhealthy', 'degraded', 'sealed-open-breaker', 'drain-fail', 'drain-false', 'finish-fail', 'finish-drift', 'health-redirect', 'health-oversize', 'drain-oversize', 'docker-hang']) {
  test(`${scenario} 必须非零并保持pending、不得写成功历史`, async t => {
    const f = await fixture(t, scenario);
    assert.equal(f.code, 1, 'sidecar必须自己非零收口，不能由测试父进程超时冒充');
    assert.equal(f.ledger.pending.deployment_id, deployment);
    assert.deepEqual(f.ledger.successes, []);
    if (scenario === 'unhealthy') assert.match(f.sidecarLog, /\[cancel-drain-fail\] healthz_poll_timeout_or_identity_mismatch/);
    if (['drain-fail', 'drain-false'].includes(scenario)) {
      assert.match(f.sidecarLog, /\[cancel-drain-fail\] drain_cancel_retries_exhausted/);
      assert.equal(f.calls.filter(args => args.some(arg => arg.endsWith('/drain-cancel'))).length, 5);
    }
    assert.ok(!f.calls.some(x => ['rm', 'run'].includes(x[0])));
    if (!['drain-fail', 'drain-false', 'finish-fail', 'finish-drift', 'health-redirect', 'drain-oversize'].includes(scenario)) assert.ok(!f.calls.some(x => x.some(a => a.endsWith('/drain-cancel'))));
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
test('tick 被有意封停（决策 751f73be）的 degraded：sidecar 健康确认与官方收账同口径折算，完成 drain 恢复与 ledger 收尾', async t => {
  const f = await fixture(t, 'sealed-degraded');
  assert.equal(f.code, 0, f.stdout + f.stderr);
  assert.equal(f.ledger.pending, null);
  assert.equal(f.ledger.successes.length, 1);
  assert.equal(f.ledger.successes[0].git_sha, sha);
  assert.ok(f.calls.some(x => x.some(a => a.endsWith('/drain-cancel'))), '健康确认后必须恢复 drain');
});

// 任务 502f2852：retention_finish 只试一次 → 10-09 三次 pending 卡死部署链约 7 小时。
test('finish第一次失败、第二次成功：有界重试后正常收账，失败尝试的退出码与stderr落sidecar日志，不告警',async t=>{
  const f = await fixture(t, 'finish-flaky');
  assert.equal(f.code, 0, f.stdout + f.stderr);
  assert.equal(f.ledger.pending, null);
  assert.equal(f.ledger.successes.length, 1);
  assert.match(f.sidecarLog, /\[completion-retry\] retention_finish attempt=1\/\d+ outcome=success exit=1 stderr=\S+/);
  assert.ok(!f.sidecarLog.includes('[completion-fail]'), f.sidecarLog);
  assert.ok(!f.barks.includes('api.day.app'), '重试成功不应告警');
});
test('finish全部失败：重试有界、每次stderr落日志、最终告警且pending不清',async t=>{
  const f = await fixture(t, 'finish-fail');
  assert.equal(f.code, 1);
  assert.equal(f.ledger.pending.deployment_id, deployment);
  assert.deepEqual(f.ledger.successes, []);
  const retries = f.sidecarLog.match(/\[completion-retry\] retention_finish attempt=\d+\/\d+ outcome=success exit=1 stderr=\S+/g) || [];
  assert.ok(retries.length >= 2, f.sidecarLog);
  assert.ok(retries.length <= 10, '重试必须有界');
  assert.match(f.sidecarLog, /\[completion-fail\] retention_finish_unconfirmed outcome=success attempts=\d+ exit=1 stderr=\S+/);
  assert.match(f.barks, /api\.day\.app\/fixture-token\//, '最终失败必须告警，不能静默');
});

test('fallback可变tag漂移后仍用启动前冻结的不可变前驱ID恢复并真实收账',async t=>{
 const f=await fixture(t,'fallback-tag-drift');assert.equal(f.code,0,f.stdout+f.stderr);
 assert.equal(f.ledger.pending,null);assert.deepEqual(f.ledger.successes,[]);
 const row=JSON.parse(await readFile(join(f.root,`ledger/deployment-${deployment}.json`),'utf8'));
 assert.equal(row.receipt.image_id,previousImage);assert.equal(row.receipt.outcome,'recovered');
});
test('fallback compose返回成功但健康核验失败不能打印或告警已恢复',async t=>{
 const f=await fixture(t,'fallback-unhealthy');assert.notEqual(f.code,0,f.stdout+f.stderr);
 assert.doesNotMatch(f.stdout,/✅ blue-fallback 恢复成功/);assert.doesNotMatch(f.barks,/已恢复/);
 assert.ok(f.ledger.pending);
});
test('primary compose返回成功但finish失败不能打印发布成功',async t=>{
 const f=await fixture(t,'finish-fail');assert.notEqual(f.code,0);
 assert.doesNotMatch(f.stdout,/✅ compose up 成功/);assert.ok(f.ledger.pending);
});

test('sidecar首次读取前全局fallback标签已被替换，仍只恢复本次传入实际blue ID',async t=>{
 const f=await fixture(t,'fallback-pre-freeze-poison');assert.equal(f.code,0,f.stdout+f.stderr);
 assert.equal(f.ledger.pending,null);assert.deepEqual(f.ledger.successes,[]);
 const row=JSON.parse(await readFile(join(f.root,`ledger/deployment-${deployment}.json`),'utf8'));
 assert.equal(row.receipt.image_id,previousImage);assert.equal(row.receipt.outcome,'recovered');
 assert.ok(!f.calls.some(a=>a[0]==='image'&&a[1]==='inspect'&&a.at(-1)==='cecelia-brain:blue-fallback'),'运行时不得读取全局tag作为前驱真身');
});

for(const scenario of ['previous-missing','previous-invalid','previous-id-mismatch'])test(`sidecar前驱未知拒绝compose，不兼容猜tag：${scenario}`,async t=>{
 const f=await fixture(t,scenario);assert.equal(f.code,1,f.stdout+f.stderr);
 assert.equal(f.calls.some(a=>a[0]==='compose'),false);assert.ok(f.ledger.pending);
});

test('同版本不同SHA构建后仅剩精确prev-version-sha12标签的前驱仍可验真恢复',async t=>{
 const f=await fixture(t,'fallback-prev-only');assert.equal(f.code,0,f.stdout+f.stderr);
 assert.equal(f.ledger.pending,null);assert.deepEqual(f.ledger.successes,[]);
 const row=JSON.parse(await readFile(join(f.root,`ledger/deployment-${deployment}.json`),'utf8'));
 assert.equal(row.receipt.outcome,'recovered');assert.equal(row.receipt.image_id,previousImage);
});
for(const scenario of ['fallback-prev-wrong-version','fallback-prev-wrong-sha','primary-prev-only'])test(`prev标签严格合同拒绝错误版本/SHA与primary放宽：${scenario}`,async t=>{
 const f=await fixture(t,scenario);assert.equal(f.code,1,f.stdout+f.stderr);assert.ok(f.ledger.pending);
 assert.deepEqual(f.ledger.successes,[]);assert.equal(f.calls.some(a=>a.some(x=>x.endsWith('/drain-cancel'))),false);
});
