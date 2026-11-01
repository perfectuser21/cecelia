import './basic-ci-admission-workflow.test.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cruise} from 'dependency-cruiser';
import {extractSpawnEdges} from '../../../packages/brain/src/lib/graph-extract.js';
import {publishCiAdmissionBaseline} from '../ci-admission-publisher.mjs';
import {buildCiAdmissionDraft} from '../ci-admission-builder.mjs';
import {baselineFixture} from './fixtures/ci-admission-pr.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'ci-admission-native-entry-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return directory;
}

test('轻入口真实publisher拒绝manual事件，不查询身份、不启动worker、不写产物',async t=>{
 const directory=fixture(t),output=join(directory,'publication'),repo='perfectuser21/cecelia',sha='a'.repeat(40);let queries=0,workers=0;
 const options={repository:repo,eventName:'workflow_dispatch',sourceRoot:directory,controlRoot:directory,sourceRevision:sha,controlRevision:sha,sourceRunId:11,outputDir:output,
  event:{action:'completed',workflow_run:{id:11,head_sha:sha,event:'push',head_branch:'main',status:'completed',conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo}}}};
 await assert.rejects(publishCiAdmissionBaseline(options,{api:async()=>{queries++;throw Error('unexpected authority query');},runWorker:async()=>{workers++;throw Error('unexpected worker');}}),{code:'CI_ADMISSION_PUBLISHER_EVENT'});
 assert.equal(queries,0);assert.equal(workers,0);assert.equal(existsSync(output),false);
});

test('轻入口真实builder核对私有Git checkout身份，在scratch前拒绝',async t=>{
 const f=await baselineFixture(t);let writes=0;
 const actualHead=f.options.event.pull_request.head.sha;assert.notEqual(actualHead,f.control);
 await assert.rejects(buildCiAdmissionDraft({sourceRoot:f.candidate,controlRoot:f.root,sourceRevision:f.control,controlRevision:f.control},{openScratch:async()=>{writes++;throw Error('must not create scratch');}}),{code:'CI_ADMISSION_CHECKOUT_MISMATCH'});
 assert.equal(writes,0);assert.equal(f.options.event.pull_request.base.sha,f.control);assert.equal(existsSync(join(f.candidate,'pr-input')),true);
});

test('轻入口真实worker进程拒绝错误argv，不写draft且不继承线上环境',async t=>{
 const directory=fixture(t),output=join(directory,'draft.json');
 const result=await new Promise(resolve=>execFile('node',['scripts/ci/ci-admission-worker.mjs',directory,root,'a'.repeat(40),'b'.repeat(40),output,'unexpected'],{
  cwd:root,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:directory,TMPDIR:directory,CI:'true',NODE_ENV:'test',DB_HOST:'127.0.0.1',DB_PORT:'1',DB_NAME:'cecelia_scratch',DB_USER:'ci',DB_PASSWORD:'isolated-ci'},timeout:5000,maxBuffer:1024*1024,
 },(error,stdout,stderr)=>resolve({error,stdout,stderr})));
 assert.equal(result.error?.code,1);assert.match(result.stderr,/CI_ADMISSION_WORKER_ARGUMENTS/);assert.equal(result.stdout.includes('ci_worker_format'),false);assert.equal(existsSync(output),false);
});

test('现行Node根实际导入轻入口，正式静态图与spawn抽取器必须见到受测生产链',async()=>{
 const entry='scripts/ci/__tests__/basic-ci-admission-native-entry.test.mjs',nodeRoot='scripts/ci/__tests__/implementation-main-snapshot.test.mjs';
 const impactReader='scripts/ci/__tests__/basic-ci-admission-impact-workflow.test.mjs',contractRoot='scripts/ci/__tests__/device-patrol-governance.test.mjs',aggregate='scripts/ci/__tests__/ci-admission-mechanisms.test.mjs';
 const factoryRoot='scripts/ci/__tests__/implementation-skill-source.test.mjs',factory='scripts/ci/__tests__/factory-workflow-config-source.test.mjs';
 const result=await cruise([nodeRoot,entry,impactReader,contractRoot,factoryRoot],{baseDir:root,doNotFollow:{path:'node_modules'},exclude:{path:'node_modules'}}),graph=typeof result.output==='string'?JSON.parse(result.output):result.output;
 const dependency=(from,to)=>graph.modules.some(m=>m.source===from&&m.dependencies.some(d=>!d.couldNotResolve&&resolve(root,d.resolved)===resolve(root,to)));
 assert.ok(dependency(nodeRoot,entry),'actual selected Node root must consume the light regression');
 assert.ok(dependency(contractRoot,aggregate),'full contracts must run on an existing root-dependency Node lane');
 assert.ok(dependency(factoryRoot,factory),'factory regressions must share the existing parallel root-dependency step');
 assert.equal(dependency(nodeRoot,factory),false,'factory regressions must not serialize with HTTP cases');
 assert.equal(dependency(nodeRoot,aggregate),false,'heavy contracts must not return to the expensive root');
 assert.equal(existsSync(join(root,'packages/brain/src/__tests__/ci-admission-baseline-contracts.test.js')),false,'Brain-only npm install cannot run root-dependency contracts');
 assert.ok(dependency(impactReader,'scripts/ci/implementation-multi-pr-gate.mjs'),'workflow/provider verification must consume the actual provider API');
 for(const path of ['scripts/ci/ci-admission-publisher.mjs','scripts/ci/ci-admission-builder.mjs'])assert.ok(dependency(entry,path),path);
 assert.ok(extractSpawnEdges(readFileSync(new URL(import.meta.url),'utf8'),entry).some(e=>e.src_path===entry&&e.dst_path==='scripts/ci/ci-admission-worker.mjs'&&e.edge_type==='spawn'));
 const {relations}=JSON.parse(readFileSync(new URL('../../../.implementation-source-relations.json',import.meta.url),'utf8'));
 const expected=[
  {"owner_path":"scripts/ci/ci-admission-archive.mjs","path":"scripts/ci/__tests__/basic-ci-admission-archive.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-artifact.mjs","path":"scripts/ci/__tests__/basic-ci-admission-artifact.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-authority.mjs","path":"scripts/ci/__tests__/basic-ci-admission-authority.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-builder.mjs","path":"scripts/ci/__tests__/basic-ci-admission-builder.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-envelope.mjs","path":"scripts/ci/__tests__/basic-ci-admission-envelope.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-publisher.mjs","path":"scripts/ci/__tests__/basic-ci-admission-feature-smoke.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/implementation-multi-pr-gate.mjs","path":"scripts/ci/__tests__/basic-ci-admission-impact-workflow.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/implementation-infra-inputs.mjs","path":"scripts/ci/__tests__/basic-ci-admission-infra.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-inputs.mjs","path":"scripts/ci/__tests__/basic-ci-admission-inputs.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-authority.mjs","path":"scripts/ci/__tests__/basic-ci-admission-legacy.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-publisher.mjs","path":"scripts/ci/__tests__/basic-ci-admission-publisher.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/implementation-pr-baseline.mjs","path":"scripts/ci/__tests__/basic-ci-admission-resolver.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/implementation-scratch.mjs","path":"scripts/ci/__tests__/basic-ci-admission-scratch-import.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-scratch.mjs","path":"scripts/ci/__tests__/basic-ci-admission-scratch.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-seed.mjs","path":"scripts/ci/__tests__/basic-ci-admission-seed.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/implementation-skill-source.mjs","path":"scripts/ci/__tests__/basic-ci-admission-skill-cache.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-worker-runner.mjs","path":"scripts/ci/__tests__/basic-ci-admission-worker.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-publisher.mjs","path":"scripts/ci/__tests__/basic-ci-admission-workflow.test.mjs","role":"verification"},
  {"owner_path":"scripts/ci/ci-admission-publisher.mjs","path":"scripts/ci/__tests__/ci-admission-mechanisms.test.mjs","role":"verification"}
 ];
 for(const row of expected)assert.deepEqual(relations.filter(item=>item.path===row.path),[row]);
 for(const path of ['scripts/ci/ci-admission-publisher.mjs','scripts/ci/ci-admission-builder.mjs','scripts/ci/ci-admission-worker.mjs'])assert.equal(relations.some(row=>row.path===path),false,'production source must have a real native carrier');
});
