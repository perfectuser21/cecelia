import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../../src/orchestrator/commander-decision.js';
import { readOwnedFile } from './launch.mjs';
import { createDiscoveryServices, confirmDiscovery, createProvider } from './native-discovery.mjs';

const id = '1234567890123456789';
const video = { videoId:id,videoUrl:'https://www.douyin.com/video/'+id,keyword:'AI办公',metrics:{digest:'abc'} };

test('已固定的发布 Profile 可读取完整定义，通用文件及超限 Profile 仍拒绝', async () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'native-profile-size-'));
  vi.stubEnv('CECELIA_INTERNAL_TOKEN','fixture');
  vi.stubEnv('BRAIN_INTERNAL_TOKEN','fixture');
  try {
    const profile = {cwd:directory, release:{ definitions:'a'.repeat(2_500_000) }};
    const path = join(directory,'profile.json');
    writeFileSync(path, JSON.stringify(profile), {mode:0o600});
    assert.throws(() => readOwnedFile(path), /standalone_file_untrusted/);
    const job = { input:{binding_key:'fixture'}, tenant_id:'default' };
    const options = { bindings:{ fixture:{ tenant_id:'default', profile:path, profile_sha256:digest(profile) } } };
    await assert.rejects(createProvider(job,options), /standalone_provider_toolkit_unfrozen/);
    truncateSync(path, 8 * 1024 * 1024 + 1);
    await assert.rejects(createProvider(job,options), /standalone_file_untrusted/);
  } finally {
    vi.unstubAllEnvs();
    rmSync(directory,{recursive:true,force:true});
  }
});

test('业务读回只认本轮指定、实测已持久化的一条候选', async () => {
  const call = async () => ({ok:true,result:{ok:true,result:{metrics_verified:true,metrics_digest:'abc',handoff:{video_id:id,video_url:video.videoUrl}}}});
  const checked = await confirmDiscovery(video, 'AI办公', call);
  assert.deepEqual(checked.evidence,[video.videoUrl]);
  assert.equal(await confirmDiscovery(video, '其他关键词', call),null);
  assert.equal(await confirmDiscovery(video, 'AI办公', async()=>({ok:true,result:{ok:true,result:{metrics_verified:false}}})),null);
});

test('只有原版本和原业务范围就绪才允许接触手机', async () => {
  const job = {task_id:'t',run_id:'r',release_id:'release',machine_id:'us-mac-m4',input:{binding_key:'company',business:{keyword:'AI办公',max_candidates:1}}};
  await assert.rejects(createDiscoveryServices(job,{profile:{domain_adapter:{config:{snapshot:{release:{id:'other'}}}}}}),/standalone_profile_mismatch/);
});

test.each([['101','bound'],['102','bound'],['103','bound'],['101','changed'],['101','unregistered'],['101','codex-stdin-eof']])('%s %s 经派单和 attestation 只加载本次冻结副本', async (stage,variant) => {
  const {existsSync,mkdirSync,writeFileSync,readFileSync,mkdtempSync,realpathSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {pathToFileURL}=await import('node:url');
  const {randomUUID,createHash}=await import('node:crypto');
  const root=mkdtempSync(join(realpathSync(tmpdir()),'native-direct-101-'));
  try {
    const calls=[];
    const realChild=variant==='codex-stdin-eof';
    const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
    const skillPath=join(root,'SKILL.md');
    writeFileSync(skillPath,'冻结Skill',{mode:0o600});
    const skill={path:'skill/SKILL.md',sha256:hash(readFileSync(skillPath))};
    const company={company_id:randomUUID(),tenant_id:randomUUID(),version:1,policy_id:'fixture'};
    const machine='us-mac-m4', version=randomUUID(), observation=randomUUID(), release=randomUUID(), taskId=randomUUID(), runId=randomUUID();
    const commentId=randomUUID(),leadId=randomUUID(),outboxId=randomUUID();
    const scoring=stage==='103', collection=stage==='102', hasSource=scoring||collection;
    const key=scoring?'douyin_comment_scoring':collection?'douyin_video_processing':'douyin_video_discovery';
    const sourceRun=scoring?'completed-102':'completed-101';
    const job={task_id:taskId,run_id:runId,machine_id:machine,release_id:release,claimer:'standalone:'+machine,claimed_at:new Date().toISOString(),
      definition:{workflow_definition_version_id:version,observation_id:observation},
      ...(hasSource?{workflow_key:key}:{}),input:{binding_key:'company',business:hasSource?{source_run:sourceRun}:{keyword:'AI办公',max_candidates:1}}};
    const installed=join(root,'installed'), runDir=join(root,runId), runRuntime=join(runDir,'runtime');
    mkdirSync(installed,{mode:0o700});
    const nativeEntry='standalone-skill-runtime.mjs', ipcEntry='standalone-skill-ipc.mjs';
    const runtimeModule=`import {dirname,join} from 'node:path';
      import {fileURLToPath} from 'node:url';
      import {readFileSync,writeFileSync} from 'node:fs';
      export async function startStandaloneSkillRuntime({runDirectory,environment}) {
        if (dirname(fileURLToPath(import.meta.url)) !== join(runDirectory,'runtime')) throw Error('EPOCH_ADMISSION_SCOPE');
        if (readFileSync(join(runDirectory,'attested'),'utf8') !== JSON.parse(readFileSync(join(runDirectory,'run-definition.json'))).standalone_skill.run_id) throw Error('NOT_ATTESTED');
        writeFileSync(join(runDirectory,'native-host-loaded'),environment.BRAIN_URL??'missing',{mode:0o600});
        return {connectionPath:'fixture-connection',close:async()=>{},readEvidence:async()=>JSON.parse(readFileSync(join(runDirectory,'native-proof.json')))};
      }`;
    const ipcModule=`export async function callStandaloneSkillTool(){return {ok:true,result:{ok:true,result:{metrics_verified:true,metrics_digest:'abc'}}};}`;
    const runtimeFiles={[nativeEntry]:Buffer.from(runtimeModule),[ipcEntry]:Buffer.from(ipcModule)};
    const profile={cwd:installed,files:Object.fromEntries(Object.entries(runtimeFiles).map(([name,bytes])=>[name,hash(bytes)])),metadata:{collect:{runtime_snapshot_sha256:'a'.repeat(64)}},domain_adapter:{budget:{max_duration_s:realChild?3:60,cleanup_grace_s:30},config:{
      workflow_key:key,primary_host:'codex-exec-v1',company,standalone_skill:skill,
      resources:{machine,profile:scoring?'mmv-scoring':'bound',serial:scoring?'none':'fixture',line:'test',account:scoring?'none':'bound-account'},
      snapshot:{deployment:{source_commit:'b'.repeat(40),observation_id:observation},release:{id:release},workflow_version:{id:version},
        activities:[{reference:{slot_key:'collect',reference_id:randomUUID(),activity_id:randomUUID(),activity_version_id:randomUUID()}}]},
    }}};
    let scope;
    const collectionProof={source_run:sourceRun,video_id:id,video_url:video.videoUrl,comment_ids:[commentId],
      coverage:'sampled',qualification:'matched',sample_target:1};
    for(const [name,bytes] of Object.entries(runtimeFiles)) writeFileSync(join(installed,name),bytes,{mode:0o600});
    const toolkit={
      ...await import(pathToFileURL(join(installed,nativeEntry)).href),
      ...await import(pathToFileURL(join(installed,ipcEntry)).href),
      hash,agentInput:env=>({task_id:env.WF_BRAIN_TASK_ID,limit:Number(env.LEADGEN_LIMIT),...(hasSource?{source_run:env.LEADGEN_SOURCE_RUN}:{})}),
      preparePublicDomainSnapshot:({identity})=>{
        mkdirSync(runRuntime,{mode:0o700});
        for(const [name,bytes] of Object.entries(runtimeFiles)) writeFileSync(join(runRuntime,name),bytes,{mode:0o600});
        const files=Object.fromEntries(Object.entries(profile.files).map(([name,digest])=>['runtime/'+name,digest]));
        if(variant==='unregistered') delete files['runtime/'+nativeEntry];
        return {env:{BRAIN_URL:'http://127.0.0.1:1'},snapshot:{files,standalone_skill:{...identity,company,scope,scope_sha256:hash(scope)}}};
      },
    };
    const saveProof=proof=>writeFileSync(join(runDir,'native-proof.json'),JSON.stringify(proof),{mode:0o600});
    let codex;
    if(realChild){
      const home=join(root,'codex-home'),command=join(root,'eof-codex.cjs');
      mkdirSync(home,{mode:0o700});
      writeFileSync(join(home,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'fixture-only'}),{mode:0o600});
      writeFileSync(command,`#!${process.execPath}
        const assert=require('node:assert/strict'), fs=require('node:fs'), args=process.argv.slice(2);
        assert.equal(args[0],'exec');
        assert.match(args.at(-1),/执行冻结的 101 Skill/);
        assert.equal(process.env.BRAIN_URL,undefined);
        let input='';
        process.stdin.setEncoding('utf8').on('data', chunk=>{input+=chunk;});
        process.stdin.on('end',()=>{
          assert.equal(input,'');
          fs.writeFileSync(args[args.indexOf('--output-last-message')+1],${JSON.stringify(JSON.stringify({video}))},{mode:0o600});
        });
      `,{mode:0o700});
      codex={command,model:'fixture',auth:{mode:'api-only',home}};
    }
    const brainUrl='http://127.0.0.1:41234';
    const services=await createDiscoveryServices(job,{profile,skillPath,stateRoot:root,toolkit,codex,brainUrl},{
      post:async(path,body)=>{
        if (path.endsWith('/start-skill')) {
          calls.push('start');
          scope=body.standalone.scope;
          assert.equal(scope.task_id,taskId);
          if(hasSource){assert.equal(scope.source_run,sourceRun);assert.deepEqual(scope.approved_keywords,[]);}
          return {task_run_id:randomUUID(),binding:{id:randomUUID(),workflow_id:randomUUID(),workflow_definition_version_id:version,attempt_key:taskId+':1'}};
        }
        calls.push('attest');
        assert.equal(body.identity.run_id,runId);
        writeFileSync(join(runDir,'attested'),runId,{mode:0o600});
        saveProof(scoring?{comment_ids:[commentId],lead_ids:[leadId],delivery_states:{[outboxId]:'confirmed'}}:collectionProof);
        if(variant==='changed') writeFileSync(join(runRuntime,nativeEntry),"throw Error('unexpected import')");
        return {attested:true};
      },
      runModel:realChild?undefined:async({modelOutput,prompt})=>{
        calls.push('agent');
        if(scoring){assert.match(prompt,/score_input/);assert.match(prompt,/score_submit/);}
        if(!hasSource)writeFileSync(modelOutput,JSON.stringify({video}),{mode:0o600});
      },
    });
    if(variant!=='bound'&&!realChild){
      const reason=variant==='changed'? /standalone_provider_toolkit_drift/:/standalone_provider_toolkit_unfrozen/;
      await assert.rejects(services.startHost(),reason);
      assert.equal(existsSync(join(runDir,'native-host-loaded')),false);
      assert.deepEqual(calls,['start','attest']);
      return;
    }
    const host=await services.startHost();
    assert.equal(readFileSync(join(runDir,'native-host-loaded'),'utf8'),brainUrl);
    await services.runAgent(host);
    if(realChild)assert.deepEqual(JSON.parse(readFileSync(join(runDir,'agent-receipt.json'))),{video});
    const evidence=(await services.verifyBusiness(host)).evidence;
    if(scoring){assert.ok(evidence.some(value=>value.includes(commentId)));assert.ok(evidence.some(value=>value.includes(outboxId)));}
    else if(collection) {
      assert.deepEqual(evidence,[video.videoUrl,`leadgen:comment:${commentId}`]);
      for(const change of [{coverage:'partial'},{sample_target:2},{source_run:'other-source'},{qualification:'rejected'}]) {
        saveProof({...collectionProof,...change});
        assert.equal(await services.verifyBusiness(host),null);
      }
    } else assert.deepEqual(evidence,[video.videoUrl]);
    assert.deepEqual(calls,realChild?['start','attest']:['start','attest','agent']);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
