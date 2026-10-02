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
  const previous = { id: previousImage, git_sha: previousSha, tags: ['cecelia-brain:1.360.3'] };
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
    if(args[0]==='info') {
      if(scenario==='finish-fail')process.exit(1);
      console.log(JSON.stringify({OSType:'linux',ID:'fixture-daemon',DockerRootDir:root+'/volume'}));process.exit(0);
    }
    if(args[0]==='image' && args[1]==='ls'){console.log(id);process.exit(0);}
    if(args[0]==='container' && args[1]==='ls'){console.log(scenario==='finish-drift'?'${'4'.repeat(64)}':'${container}');process.exit(0);}
    if(args[0]==='container' && args[1]==='inspect'){
      const fixed=scenario==='finish-drift'?'${'4'.repeat(64)}':'${container}';
      console.log(JSON.stringify([{Id:fixed,Name:'/cecelia-node-brain',Image:id,State:{Running:true}}]));process.exit(0);
    }
    if(args[0]==='image' && args[1]==='inspect' && !args.includes('--format')) {
      console.log(JSON.stringify([{Id:id,RepoTags:['cecelia-brain:'+(recovered?'1.360.3':'1.360.5')],RepoDigests:[],Config:{Env:['GIT_SHA='+s]}}]));process.exit(0);
    }
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
        fs.writeFileSync(root+'/healthy','');console.log(JSON.stringify({status:scenario==='degraded'?'degraded':'healthy',version:recovered?'1.360.3':'1.360.5',git_sha:scenario==='wrong-sha'?'${previousSha}':s,...(scenario==='health-oversize'?{padding:'x'.repeat(300000)}:{})}));if(args.includes('-w'))process.stdout.write(scenario==='health-redirect'?'302':'200');return;
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
  await writeFile(join(root, 'bin/curl'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
  await writeFile(join(root, 'bin/sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, NODE_OPTIONS: `--import=${root}/deny-http.mjs`, FIXTURE_ROOT: root, SCENARIO: scenario, BRAIN_VERSION: '1.360.5', EXPECTED_SHA: scenario === 'request-sha' ? previousSha : sha, ENV_REGION: 'us', DEPLOY_ROOT: root, CECELIA_INTERNAL_ENV_FILE: `${root}/internal.env`, CECELIA_IMAGE_DEPLOYMENT_ID: deployment, CECELIA_IMAGE_RETENTION_DIR: `${root}/ledger`, BARK_TOKEN: '' };
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
for (const scenario of ['request-sha', 'wrong-image', 'wrong-sha', 'drift', 'unhealthy', 'degraded', 'drain-fail', 'drain-false', 'finish-fail', 'finish-drift', 'health-redirect', 'health-oversize', 'drain-oversize', 'docker-hang']) {
  test(`${scenario} 必须非零并保持pending、不得写成功历史`, async t => {
    const f = await fixture(t, scenario);
    assert.equal(f.code, 1, 'sidecar必须自己非零收口，不能由测试父进程超时冒充');
    assert.equal(f.ledger.pending.deployment_id, deployment);
    assert.deepEqual(f.ledger.successes, []);
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
