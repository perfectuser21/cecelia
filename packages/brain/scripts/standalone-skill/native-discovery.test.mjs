import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createDiscoveryServices, confirmDiscovery } from './native-discovery.mjs';

const id = '1234567890123456789';
const video = { videoId:id,videoUrl:'https://www.douyin.com/video/'+id,keyword:'AI办公',metrics:{digest:'abc'} };

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

test('按派单身份先固定启动和核证，才打开工具宿主并核对业务', async () => {
  const {writeFileSync,readFileSync,mkdtempSync,realpathSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {randomUUID,createHash}=await import('node:crypto');
  const root=mkdtempSync(join(realpathSync(tmpdir()),'native-direct-101-'));
  try {
    const calls=[];
    const hash=value=>createHash('sha256').update(Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
    const skillPath=join(root,'SKILL.md');
    writeFileSync(skillPath,'冻结Skill',{mode:0o600});
    const skill={path:'skill/SKILL.md',sha256:hash(readFileSync(skillPath))};
    const company={company_id:randomUUID(),tenant_id:randomUUID(),version:1,policy_id:'fixture'};
    const machine='us-mac-m4', version=randomUUID(), observation=randomUUID(), release=randomUUID(), taskId=randomUUID(), runId=randomUUID();
    const job={task_id:taskId,run_id:runId,machine_id:machine,release_id:release,claimer:'standalone:'+machine,claimed_at:new Date().toISOString(),
      definition:{workflow_definition_version_id:version,observation_id:observation},input:{binding_key:'company',business:{keyword:'AI办公',max_candidates:1}}};
    const profile={metadata:{collect:{runtime_snapshot_sha256:'a'.repeat(64)}},domain_adapter:{budget:{max_duration_s:60,cleanup_grace_s:30},config:{
      workflow_key:'douyin_video_discovery',primary_host:'codex-exec-v1',company,standalone_skill:skill,
      resources:{machine,profile:'bound',serial:'fixture',line:'test',account:'bound-account'},
      snapshot:{deployment:{source_commit:'b'.repeat(40),observation_id:observation},release:{id:release},workflow_version:{id:version},
        activities:[{reference:{slot_key:'collect',reference_id:randomUUID(),activity_id:randomUUID(),activity_version_id:randomUUID()}}]},
    }}};
    let scope;
    const toolkit={
      hash,agentInput:env=>({task_id:env.WF_BRAIN_TASK_ID,limit:Number(env.LEADGEN_LIMIT)}),
      preparePublicDomainSnapshot:({identity})=>({env:{},snapshot:{
        standalone_skill:{...identity,company,scope,scope_sha256:hash(scope)},
      }}),
      startStandaloneSkillRuntime:async({runDirectory})=>{
        calls.push('host');
        assert.equal(JSON.parse(readFileSync(join(runDirectory,'run-definition.json'))).standalone_skill.run_id,runId);
        return {connectionPath:'fixture-connection',close:async()=>{}};
      },
      callStandaloneSkillTool:async()=>({ok:true,result:{ok:true,result:{metrics_verified:true,metrics_digest:'abc'}}}),
    };
    const services=await createDiscoveryServices(job,{profile,skillPath,stateRoot:root,toolkit},{
      post:async(path,body)=>{
        if (path.endsWith('/start-skill')) {
          calls.push('start');
          scope=body.standalone.scope;
          assert.equal(scope.task_id,taskId);
          return {task_run_id:randomUUID(),binding:{id:randomUUID(),workflow_id:randomUUID(),workflow_definition_version_id:version,attempt_key:taskId+':1'}};
        }
        calls.push('attest');
        assert.equal(body.identity.run_id,runId);
        return {attested:true};
      },
      runModel:async({modelOutput})=>{
        calls.push('agent');
        writeFileSync(modelOutput,JSON.stringify({video}),{mode:0o600});
      },
    });
    const host=await services.startHost();
    await services.runAgent(host);
    assert.deepEqual((await services.verifyBusiness(host)).evidence,[video.videoUrl]);
    assert.deepEqual(calls,['start','attest','host','agent']);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
