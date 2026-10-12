import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {validatePatrolContract,validatePatrolBootstrap,patrolSourceProof} from '../device-patrol-admission.js';
import {validateImplementationSnapshot} from '../implementation-ci-snapshot.js';
const base='a'.repeat(40),introduced='b'.repeat(40);
const contract={schema_version:1,scope:'cecelia-device-patrol',capability_id:'2173a385-a743-41f3-bb7d-d0e4b1d51d4e',workflows:[{id:'66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff',key:'single-phone-account-patrol',activities:[{id:'d51eefa1-0ffd-43d7-94ba-16ff6b4d3800',key:'device-readiness',bindings:['scripts/phone-account-patrol/preflight.py'],assertion_ref:'node --test scripts/phone-account-patrol/implementation-regression.test.mjs'}]},{id:'7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70',key:'phone-account-patrol-batch',activities:[{id:'b33c9f29-5c5f-4fb1-908c-475bb9566085',key:'enabled-phone-list',bindings:['scripts/phone-account-patrol/runner.py'],assertion_ref:'node --test scripts/phone-account-patrol/implementation-regression.test.mjs'}]}],auxiliary_paths:['scripts/phone-account-patrol/implementation-contract.json'],maintenance_owner:'主理人',schedule:{time:'22:00',timezone:'Asia/Shanghai'}};
describe('手机巡查独立来源准入',()=>{
 it('既有snapshot入口正常加载且仍拒绝把窄巡查identity当旧scope合同',()=>expect(()=>validateImplementationSnapshot({scope:'cecelia-device-patrol'})).toThrow());
 it('保持真实系统看护身份与两个已登记Workflow',()=>expect(validatePatrolContract(contract)).toEqual(contract));
 it('后继镜子源码与真实渲染回归允许窄源绑定，未知辅助路径仍拒绝',()=>{const x=structuredClone(contract);x.workflows[0].activities[0].bindings.push('scripts/phone-account-patrol/mirror.mjs');x.auxiliary_paths.push('scripts/phone-account-patrol/test_mirror.mjs');expect(validatePatrolContract(x)).toEqual(x);x.auxiliary_paths.push('scripts/phone-account-patrol/unregistered.test.mjs');expect(()=>validatePatrolContract(x)).toThrow();});
 it('仅登记四个infra领跑辅助路径，重复和未知路径仍拒绝',()=>{
  const paths=['openclaw_commander.py','test_openclaw_commander.py','openclaw_native.py','test_openclaw_native.py'].map(name=>'scripts/phone-account-patrol/'+name);
  const x=structuredClone(contract);x.auxiliary_paths.push(...paths);
  expect(validatePatrolContract(x)).toEqual(x);expect(x.workflows).toEqual(contract.workflows);
  for(const path of ['scripts/phone-account-patrol/openclaw_unknown.py','scripts/phone-account-patrol/test_openclaw_other.py','scripts/phone-account-patrol/openclaw_native.py.extra','scripts/phone-account-patrol/../openclaw_native.py',paths[0]]){
   const unknown=structuredClone(x);unknown.auxiliary_paths.push(path);expect(()=>validatePatrolContract(unknown)).toThrowError('PATROL_AUXILIARY_SCOPE');
  }
  expect(()=>validatePatrolContract({...x,maintenance_owner:'infra'})).toThrowError('PATROL_OWNER_SCHEDULE');
  expect(()=>validatePatrolContract({...x,schedule:{time:'22:45',timezone:'Asia/Shanghai'}})).toThrowError('PATROL_OWNER_SCHEDULE');
 });
 it('四个辅助文件逐一固定字节并进入canonical源摘要，修改任一文件都改变证明',()=>{
  const paths=['openclaw_commander.py','test_openclaw_commander.py','openclaw_native.py','test_openclaw_native.py'].map(name=>'scripts/phone-account-patrol/'+name);
  const x=structuredClone(contract);x.auxiliary_paths.push(...paths);
  const files=new Map([[x.auxiliary_paths[0],JSON.stringify(x)],...paths.map(path=>[path,'fixed helper bytes: '+path])]);
  const read=path=>Buffer.from(files.get(path)||path),proof=patrolSourceProof(x,introduced,read);
  for(const path of paths){
   const contents=files.get(path),digest=createHash('sha256').update(contents).digest('hex');
   expect(proof.auxiliary.find(row=>row.path===path)).toEqual({path,sha256:digest});
   files.set(path,contents+' changed');const modified=patrolSourceProof(x,introduced,read);
   expect(modified.source_sha256).not.toBe(proof.source_sha256);
   expect(modified.contract_sha256).toBe(proof.contract_sha256);expect(modified.bindings).toEqual(proof.bindings);
   expect(modified.auxiliary.filter(row=>row.path!==path)).toEqual(proof.auxiliary.filter(row=>row.path!==path));
   files.set(path,contents);
  }
  const reordered=Object.fromEntries(Object.entries(x).reverse());
  expect(patrolSourceProof(reordered,introduced,read).source_sha256).toBe(proof.source_sha256);
  expect(()=>patrolSourceProof(x,introduced,path=>Buffer.from(path===x.auxiliary_paths[0]?JSON.stringify({...x,maintenance_owner:'other'}):path))).toThrowError('PATROL_CONTRACT_BYTES_MISMATCH');
 });
 it('拒绝挂错能力与任意外部代码路径',()=>{expect(()=>validatePatrolContract({...contract,capability_id:'a1000000-0000-4000-8000-000000000001'})).toThrow();const x=structuredClone(contract);x.workflows[0].activities[0].bindings=['packages/brain/src/server.js'];expect(()=>validatePatrolContract(x)).toThrow();});
 it('不能把CI治理代码声明为手机Activity实现',()=>{const x=structuredClone(contract);x.workflows[0].activities[0].bindings=['.github/workflows/pr-review.yml'];expect(()=>validatePatrolContract(x)).toThrow();});
 it('首次base不存在必须有固定Git树不存在证明和真实后继',()=>{expect(()=>validatePatrolBootstrap({base_revision:base,introduced_revision:introduced,actor:'主理人',base_tree_sha:'c'.repeat(40),base_paths:['scripts/phone-account-patrol/runner.py'],introduced_paths:[],compare_status:'ahead'})).toThrow();expect(()=>validatePatrolBootstrap({base_revision:base,introduced_revision:introduced,actor:'主理人',base_tree_sha:'c'.repeat(40),base_paths:[],introduced_paths:[],compare_status:'diverged'})).toThrow();});
 it('冻结Git blob字节，不接受未经核对的内容摘要',()=>{const proof=patrolSourceProof(contract,introduced,p=>Buffer.from(p.endsWith('implementation-contract.json')?JSON.stringify(contract):p));expect(proof.contract_sha256).toMatch(/^[a-f0-9]{64}$/);expect(proof.bindings[0].revision).toBe(introduced);expect(proof.bindings[0].sha256).toMatch(/^[a-f0-9]{64}$/);});
});
