import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runPredecessorScenario} from './helpers/brain-deploy-predecessor.fixture.mjs';
for(const failure of ['http503','invalid-json','ok'])test(`同镜像实际发布EXIT必须经过官方固定容器业务验收：${failure}`,t=>{
 let ledgerPath,readLedger;
 const r=runPredecessorScenario(t,'same-image-business',{prepare(f){
  const local=f.state('local');local.production={id:'1'.repeat(64),image:f.env.IMAGE,status:'running',version:'1.0.0'};
  local.tags['cecelia-brain:1.0.0']=f.env.IMAGE;fs.writeFileSync(f.dir+'/state/local.json',JSON.stringify(local));
  ledgerPath=f.dir+'/ledger';fs.mkdirSync(ledgerPath,{mode:0o700});ledgerPath=fs.realpathSync(ledgerPath);fs.mkdirSync(f.dir+'/volume');
  fs.writeFileSync(ledgerPath+'/config.json',JSON.stringify({schema_version:1,machine_registry_id:'1a379d80-ad36-47d3-88ba-e545ab299a54',daemon_id:'production-daemon',docker_root_dir:f.dir+'/volume',volume_dev:fs.statSync(ledgerPath).dev}),{mode:0o600});
  f.env.CECELIA_IMAGE_RETENTION_DIR=ledgerPath;f.env.CECELIA_RETENTION_DATA_PATH=f.dir+'/volume';
  // 官方runtime使用固定data path；仅fixture挂载根替身，仍执行真实adapter身份核验。
  const runtime=f.repo+'/scripts/brain-image-retention/runtime.mjs';let rt=fs.readFileSync(runtime,'utf8');rt=rt.replace("'/run/cecelia-docker-data'",JSON.stringify(f.dir+'/volume'));fs.writeFileSync(runtime,rt);
  fs.mkdirSync(f.repo+'/scripts/map',{recursive:true});fs.writeFileSync(f.repo+'/scripts/map/product-map-adapter.mjs','process.exit(0)');
  fs.mkdirSync(f.repo+'/packages/brain/config/map-manifests',{recursive:true});fs.writeFileSync(f.repo+'/packages/brain/config/map-manifests/cecelia.v1.json',JSON.stringify({source_decision_id:'11111111-1111-4111-8111-111111111111'}));
  let docker=fs.readFileSync(f.dir+'/bin/docker','utf8');const at="const disk=e.STATE_DIR+'/local.json'";
  docker=docker.replace(at,`const z=JSON.parse(fs.readFileSync(e.STATE_DIR+'/local.json'));const img={Id:e.IMAGE,RepoTags:['cecelia-brain:1.0.0'],Config:{Env:['GIT_SHA='+e.EXPECTED_SHA]}};const ctr={Id:'1'.repeat(64),Name:'/cecelia-node-brain',Image:e.IMAGE,State:{Running:true}};
if(original[0]==='info'&&original.includes('{{json .}}')){console.log(JSON.stringify({OSType:'linux',ID:'production-daemon',DockerRootDir:${JSON.stringify(f.dir+'/volume')}}));process.exit(0);}
if(original[0]==='container'&&original[1]==='ls'&&original.includes('--quiet')){console.log(ctr.Id);process.exit(0);}
if(original[0]==='container'&&original[1]==='inspect'){console.log(JSON.stringify([ctr]));process.exit(0);}
if(original[0]==='image'&&original[1]==='ls'&&original.includes('--all')){console.log(img.Id);process.exit(0);}
if(original[0]==='image'&&original[1]==='inspect'&&!original.includes('--format')){console.log(JSON.stringify([img]));process.exit(0);}
if(original[0]==='exec'&&original.includes(ctr.Id)){
 if(original.some(a=>a.includes('/tasks?limit=1'))){${failure==='http503'?'process.exit(22);':`process.stdout.write(${JSON.stringify(failure==='invalid-json'?'garbage\n200':'[]\n200')});process.exit(0);`}}
 process.stdout.write(JSON.stringify({status:'healthy',version:'1.0.0',git_sha:e.EXPECTED_SHA})+'\\n200');process.exit(0);
}
`+at);
  fs.writeFileSync(f.dir+'/bin/docker',docker,{mode:0o755});
  fs.writeFileSync(f.dir+'/health.mjs',`globalThis.fetch=async url=>{if(!String(url).endsWith('/api/brain/health'))throw Error('forbidden');return new Response(JSON.stringify({status:'healthy',version:'1.0.0',git_sha:${JSON.stringify(f.sha)}}));};`);f.env.NODE_OPTIONS='--import='+f.dir+'/health.mjs';
  readLedger=()=>JSON.parse(fs.readFileSync(ledgerPath+'/ledger.json'));
 }});
 assert.match(r.stdout,/image SHA 一致/,r.stderr);assert.equal(r.signal,null,r.stderr);
 assert.equal(r.exit_code,failure==='ok'?0:1,r.stdout+r.stderr);
 assert.equal(r.status.status,failure==='ok'?'success':'failed');
 const ledger=readLedger();assert.equal(ledger.pending===null,failure==='ok');assert.equal(ledger.successes.length,failure==='ok'?1:0);
 assert.equal(r.compose.length,0,'同镜像不得重建或回滚');
 assert.ok(r.docker_calls.some(a=>a.includes('1'.repeat(64))&&a.some(x=>x.includes('/tasks?limit=1'))));
});
