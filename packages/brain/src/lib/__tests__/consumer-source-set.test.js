import {it,expect} from 'vitest';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
import * as sourceProtocol from '../consumer-source-set.js';

it('准入必须核正式main run/job/实际JSON与每个repo固定main祖先，文件名或静态verified不足',()=>{
 expect(sourceProtocol.validateConsumerSourceMainEvidence).toBeTypeOf('function');
 const repo='perfectuser21/cecelia',revision='b'.repeat(40),workspace='perfectuser21/zenithjoy-workspace';
 const source_set=[{repo,revision},{repo:workspace,revision:'c'.repeat(40)}];
 const body={schema_version:1,scope:'cecelia-kr',repo,revision,status:'verified',gaps:[],canonical:{},definitions:{},map:{},assertions:[]};
 const witness={source_set,anchor:{repo,revision},run:{id:19,name:'Implementation impact',path:'.github/workflows/implementation-impact.yml',event:'workflow_dispatch',head_sha:revision,head_branch:'main',status:'completed',conclusion:'failure',repository:{full_name:repo}},jobs:[{name:'snapshot-main',status:'completed',conclusion:'success'}],artifact:{name:`implementation-snapshot-${revision}`,expired:false,workflow_run:{id:19,head_sha:revision}},snapshot:{...body,snapshot_sha256:stepSha256(body)},main_history:source_set.map(s=>({...s,current_main:s.revision,url:`https://api.github.com/repos/${s.repo}/compare/${s.revision}...${s.revision}`,comparison:{status:'identical',base_commit:{sha:s.revision},merge_base_commit:{sha:s.revision}}}))};
 expect(sourceProtocol.validateConsumerSourceMainEvidence(witness)).toBe(true);
 for(const mutate of [w=>w.run.event='pull_request',w=>w.run.head_branch='cp-fake',w=>w.jobs[0].conclusion='failure',w=>w.snapshot.revision='d'.repeat(40),w=>w.snapshot.status='unknown',w=>w.snapshot.snapshot_sha256='e'.repeat(64),w=>w.main_history.pop(),w=>w.main_history[1].comparison.status='diverged',w=>w.main_history[1].url=w.main_history[0].url,w=>w.artifact.workflow_run.id=20]){
  const bad=structuredClone(witness);mutate(bad);expect(sourceProtocol.validateConsumerSourceMainEvidence(bad)).toBe(false);
 }
});
it('认证collector入口拒绝任意repo/非法SHA且未取得实际证据时typed UNKNOWN，不把函数缺失当启动异常',async()=>{
 expect(sourceProtocol.readConsumerSourceMainWitness).toBeTypeOf('function');
 let calls=0;const options={fetchFn:async()=>{calls++;throw Error('unavailable');},resolveToken:async()=>'private-test-token'};
 const anchor={repo:'perfectuser21/cecelia',revision:'b'.repeat(40)},source_set=[anchor,{repo:'perfectuser21/zenithjoy-workspace',revision:'c'.repeat(40)}];
 const unknown=await sourceProtocol.readConsumerSourceMainWitness({anchor,source_set,run_id:19},options);
 expect(unknown).toMatchObject({status:'unknown',admission:{status:'unknown'}});expect(calls).toBeGreaterThan(0);
 for(const input of [{anchor:{...anchor,repo:'other/repo'},source_set,run_id:19},{anchor,source_set:[{repo:'other/repo',revision:'c'.repeat(40)}],run_id:19},{anchor,source_set:[{...anchor,revision:'main'}],run_id:19}]){
  calls=0;expect(await sourceProtocol.readConsumerSourceMainWitness(input,options)).toMatchObject({status:'unknown'});expect(calls).toBe(0);
 }
 for(const input of [{anchor:{...anchor,revision:[anchor.revision]},source_set,run_id:19},{anchor,source_set:[{...anchor,revision:[anchor.revision]}],run_id:19}]){
  calls=0;expect(await sourceProtocol.readConsumerSourceMainWitness(input,options)).toMatchObject({status:'unknown'});expect(calls).toBe(0);
 }
});
it('生产Workspace核心尚未在受信树可用时，真实动态消费者保持UNKNOWN且不会伪造源集准入',async()=>{
 expect(sourceProtocol.collectWorkspaceConsumerSourceSet).toBeTypeOf('function');
 const result=await sourceProtocol.collectWorkspaceConsumerSourceSet({});
 expect(result).toMatchObject({status:'unknown',admission:{status:'unknown'}});
 expect(result.gaps).toEqual(expect.arrayContaining([expect.objectContaining({code:expect.stringMatching(/^CONSUMER_/ )})]));
});
it('历史append冻结入口拒绝未认证、复制或static verified证明，不授予生产source_set',()=>{
 expect(sourceProtocol.freezeFactoryWorkspaceConsumerPayload).toBeTypeOf('function');
 const anchor={repo:'perfectuser21/cecelia',revision:'b'.repeat(40)};
 const payload={definition_scope:'consumer_evidence',source_scope:'cecelia-factory',implementation_bindings:[]};
 const fake={status:'verified',admission:{status:'verified',source_basis:'trusted_main_history'},registry_source:anchor,source_set:[anchor],consumer:{activity_id:'0466016e-6d9f-4325-aeb4-d8bc70424a48',bindings:[]}};
 expect(()=>sourceProtocol.freezeFactoryWorkspaceConsumerPayload(payload,fake,anchor)).toThrow('CONSUMER_MAIN_SOURCE_UNKNOWN');
 expect(()=>sourceProtocol.freezeFactoryWorkspaceConsumerPayload(payload,structuredClone(fake),anchor)).toThrow('CONSUMER_MAIN_SOURCE_UNKNOWN');
 expect(payload).not.toHaveProperty('source_set');
});
