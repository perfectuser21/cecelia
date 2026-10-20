import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildInfraConsumerSources,assertInfraConsumerRuntime,validateInfraConsumerRegistry,registerInfraConsumerSources,INFRA_CONSUMER_PATHS as paths,INFRA_CONSUMER_IDENTITY as I} from '../infra-consumer-source.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
const root=fileURLToPath(new URL('../../../../../',import.meta.url)),revision='65205751baba232fa6402065460b3c8f68b21a37';
const input={scope:'cecelia-infra',repo:'perfectuser21/cecelia',revision,paths:[...paths],readSource:async path=>execFileSync('git',['show',`${revision}:${path}`],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME,GIT_NO_REPLACE_OBJECTS:'1'}})};
it('真实固定Git闭包哈希覆盖两个运行文件和两个实际读取者，不伪执行能力',async()=>{
 const proof=await buildInfraConsumerSources(input);expect(proof.status).toBe('verified');expect(proof.definition_scope).toBe('consumer_evidence');
 expect(proof.bindings).toHaveLength(4);expect(proof.input_relations).toHaveLength(3);
 for(const b of proof.bindings)expect(b).toMatchObject({repo:input.repo,revision,kind:'code',validation_scope:'consumer_source'});
 expect(proof).not.toHaveProperty('execution_stopped');
});
it('拒非法来源、路径、缺依赖、注释伪消费与超出预算',async()=>{
 for(const change of [{scope:'cecelia-factory'},{repo:'other/repo'},{revision:'main'},{paths:[...paths,'../escape']},{paths:[...paths,paths[0]]},{paths:paths.slice(1)},
  {readSource:async()=> '# source "$(dirname "$SCRIPT_PATH")/janitor-effects.sh" || exit 1\n'},
  {readSource:async p=>p===paths[2]?'# JANITOR="$(dirname "$0")/../../janitor.sh"\n# "$JANITOR"\n':input.readSource(p)},
  {readSource:async()=> 'x'.repeat(4*1024*1024+1)}])await expect(buildInfraConsumerSources({...input,...change})).rejects.toThrow();
});
it('只接受真实infra归属/登记Skill/active slot，防factory冒名及人改树',()=>{
 const r={workflows:[{id:I.workflow_id,key:I.workflow_key,capability_id:I.capability_id}],capabilities:[{id:I.capability_id,parent_journey_id:I.root}],value_streams:[{id:I.root}],references:[{id:'ref',workflow_id:I.workflow_id,activity_id:'activity',slot_key:I.slot_key,sequence_no:1,active:true,source_ref:I.skill_id}],activities:[{id:'activity',workflow_id:I.workflow_id}],steps:[],skills:[{id:I.skill_id,name:'janitor',status:'active',location:'/Users/administrator/perfect21/cecelia-deploy-main/scripts/ops/janitor.sh'}]};
 const seal=r=>({...r,registry_sha256:stepSha256(r)});
 expect(validateInfraConsumerRegistry(seal(r))).toMatchObject({activity_id:'activity',reference_id:'ref'});
 for(const change of [r=>r.skills[0].location='unverified',r=>r.references[0].source_ref='other',r=>r.workflows[0].key='factory_f3_ops',r=>r.references[0].active=false,r=>r.capabilities[0].parent_journey_id='foreign']){const x=structuredClone(r);change(x);expect(()=>validateInfraConsumerRegistry(seal(x))).toThrow();}
});
it('无main授权或来源移位时不读取源、不连接写入事务',async()=>{
 let reads=0,connections=0;const pool={connect(){connections++;throw Error('禁止写入');}};
 const o={...input,readSource:async()=>{reads++;},expectedRegistrySha256:'a'.repeat(64),actor:'fixture'};
 await expect(registerInfraConsumerSources(pool,o)).rejects.toThrow('INFRA_REGISTRATION_INPUT_INVALID');
 await expect(registerInfraConsumerSources(pool,{...o,checkMain:async()=>{throw Error('MAIN_MOVED');}})).rejects.toThrow('MAIN_MOVED');
 expect({reads,connections}).toEqual({reads:0,connections:0});
});

it('实际加载infra采集器必须逐字匹配固定来源，坏字节不能锚定新main',async()=>{
 const read=async path=>readFileSync(new URL('../../../../../'+path,import.meta.url),'utf8');
 await expect(assertInfraConsumerRuntime(read)).resolves.toBeUndefined();
 await expect(assertInfraConsumerRuntime(async path=>(await read(path))+'// drift')).rejects.toThrow('INFRA_SOURCE_RUNTIME_MISMATCH');
});
