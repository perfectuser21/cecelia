import {describe,it,expect} from 'vitest';
import {validatePatrolContract,validatePatrolBootstrap,patrolSourceProof} from '../device-patrol-admission.js';
import {bootstrapPatrolScope} from '../device-patrol-registration.js';
const base='a'.repeat(40),introduced='b'.repeat(40);
const contract={schema_version:1,scope:'cecelia-device-patrol',capability_id:'2173a385-a743-41f3-bb7d-d0e4b1d51d4e',workflows:[{id:'66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff',key:'single-phone-account-patrol',activities:[{id:'d51eefa1-0ffd-43d7-94ba-16ff6b4d3800',key:'device-readiness',bindings:['scripts/phone-account-patrol/preflight.py'],assertion_ref:'node --test scripts/phone-account-patrol/implementation-regression.test.mjs'}]},{id:'7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70',key:'phone-account-patrol-batch',activities:[{id:'b33c9f29-5c5f-4fb1-908c-475bb9566085',key:'enabled-phone-list',bindings:['scripts/phone-account-patrol/runner.py'],assertion_ref:'node --test scripts/phone-account-patrol/implementation-regression.test.mjs'}]}],auxiliary_paths:['scripts/phone-account-patrol/implementation-contract.json'],maintenance_owner:'主理人',schedule:{time:'22:00',timezone:'Asia/Shanghai'}};
describe('手机巡查独立来源准入',()=>{
 it('保持真实系统看护身份与两个已登记Workflow',()=>expect(validatePatrolContract(contract)).toEqual(contract));
 it('后继镜子源码与真实渲染回归允许窄源绑定，未知辅助路径仍拒绝',()=>{const x=structuredClone(contract);x.workflows[0].activities[0].bindings.push('scripts/phone-account-patrol/mirror.mjs');x.auxiliary_paths.push('scripts/phone-account-patrol/test_mirror.mjs');expect(validatePatrolContract(x)).toEqual(x);x.auxiliary_paths.push('scripts/phone-account-patrol/unregistered.test.mjs');expect(()=>validatePatrolContract(x)).toThrow();});
 it('拒绝挂错能力与任意外部代码路径',()=>{expect(()=>validatePatrolContract({...contract,capability_id:'a1000000-0000-4000-8000-000000000001'})).toThrow();const x=structuredClone(contract);x.workflows[0].activities[0].bindings=['packages/brain/src/server.js'];expect(()=>validatePatrolContract(x)).toThrow();});
 it('不能把CI治理代码声明为手机Activity实现',()=>{const x=structuredClone(contract);x.workflows[0].activities[0].bindings=['.github/workflows/pr-review.yml'];expect(()=>validatePatrolContract(x)).toThrow();});
 it('首次base不存在必须有固定Git树不存在证明和真实后继',()=>{expect(()=>validatePatrolBootstrap({base_revision:base,introduced_revision:introduced,actor:'主理人',base_tree_sha:'c'.repeat(40),base_paths:['scripts/phone-account-patrol/runner.py'],introduced_paths:[],compare_status:'ahead'})).toThrow();expect(()=>validatePatrolBootstrap({base_revision:base,introduced_revision:introduced,actor:'主理人',base_tree_sha:'c'.repeat(40),base_paths:[],introduced_paths:[],compare_status:'diverged'})).toThrow();});
 it('冻结Git blob字节，不接受未经核对的内容摘要',()=>{const proof=patrolSourceProof(contract,introduced,p=>Buffer.from(p.endsWith('implementation-contract.json')?JSON.stringify(contract):p));expect(proof.contract_sha256).toMatch(/^[a-f0-9]{64}$/);expect(proof.bindings[0].revision).toBe(introduced);expect(proof.bindings[0].sha256).toMatch(/^[a-f0-9]{64}$/);});
});

it('GitHub blob正文与tree SHA不符在开写事务前拒绝',async()=>{
 const blobSha='d'.repeat(40),treeSha='c'.repeat(40);let connections=0;
 const pool={connect:async()=>{connections++;throw Error('write must not begin');}};
 const fetchFn=async url=>({ok:true,json:async()=>{
  if(url.includes('/compare/'))return {status:'ahead',merge_base_commit:{sha:base}};
  if(url.includes('/git/commits/'))return {sha:url.split('/').at(-1),tree:{sha:treeSha}};
  if(url.includes('/git/trees/'))return {sha:treeSha,truncated:false,tree: url.includes('unused')?[]:[{path:'scripts/phone-account-patrol/implementation-contract.json',mode:'100644',type:'blob',sha:blobSha}]};
  return {sha:blobSha,encoding:'base64',size:3,content:Buffer.from('bad').toString('base64')};
 }});
 // 两棵树分开，base真正没有该scope路径。
 let treeCalls=0;const transport=async url=>url.includes('/git/trees/')&&++treeCalls===1?{ok:true,json:async()=>({sha:treeSha,truncated:false,tree:[]})}:fetchFn(url);
 await expect(bootstrapPatrolScope(pool,{base_revision:base,introduced_revision:introduced,actor:'operator'},{fetchFn:transport,resolveToken:async()=> 'fixture-not-secret'})).rejects.toThrow('PATROL_GIT_BLOB_MISMATCH');expect(connections).toBe(0);
});
