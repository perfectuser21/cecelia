import {expect,it} from 'vitest';
import * as snapshot from '../implementation-ci-snapshot.js';
it('仅本机scratch或GitHub Actions隔离test库可创建CI schema，任意生产/其它本机库拒绝',()=>{
 expect(snapshot.isImplementationScratchDatabase,'必须同时识别正式CI隔离库与本机scratch').toBeTypeOf('function');
 const allowed=snapshot.isImplementationScratchDatabase;
 expect(allowed('cecelia_scratch',{})).toBe(true);
 expect(allowed('cecelia_test',{CI:'true',GITHUB_ACTIONS:'true'})).toBe(true);
 for(const env of [{},{CI:'true'},{GITHUB_ACTIONS:'true'},{CI:'false',GITHUB_ACTIONS:'true'}])expect(allowed('cecelia_test',env)).toBe(false);
 for(const name of ['cecelia','cecelia_staging','postgres','zenithjoy','cecelia_test_copy'])expect(allowed(name,{CI:'true',GITHUB_ACTIONS:'true'})).toBe(false);
});

import * as owners from '../source-owner-registry.js';
import {stepSha256} from '../../../scripts/sync-steps-from-workspace.mjs';
import {lintImplementationRegistry} from '../../../../../scripts/ci/registry-lint.mjs';
const repo='perfectuser21/zenithjoy-workspace',cap='a1000000-0000-4000-8000-000000000001';
const old={id:'b1000000-0000-4000-8000-000000000001',key:'douyin_keyword_leadgen',capability_id:cap,source_repo:repo,source_capability:'keyword_acquisition',source_path:'product-map/contracts/keyword_acquisition.yaml',source_workflow:'social-keyword-leadgen',status:'retired'};
const current={...old,id:'b1000000-0000-4000-8000-000000000101',key:'douyin_video_discovery',source_capability:'douyin_video_discovery',source_path:'product-map/contracts/douyin_video_discovery.yaml',source_workflow:'douyin-video-discovery',status:'paused'};
const plan={workflow:current,contract:{capability:'keyword_acquisition',contract_key:'douyin_video_discovery'},activities:[{activity:{from:'douyin_video_discovery',key:'preflight'}}]};
it('真实技术key与旧retired业务owner闭包合法；缺owner、跨repo和业务能力错配一律拒绝',()=>{
 expect(owners.validateContractOwners).toBeTypeOf('function');
 expect(()=>owners.validateContractOwners([plan],[old,current],repo)).not.toThrow();
 expect(()=>owners.validateContractOwners([plan],[current],repo)).toThrow(/OWNER/);
 expect(()=>owners.validateContractOwners([plan],[{...old,source_repo:'evil/repo'},current],repo)).toThrow(/OWNER/);
 expect(()=>owners.validateContractOwners([plan],[{...old,capability_id:'a1000000-0000-4000-8000-000000000002'},current],repo)).toThrow(/OWNER/);
});
it('独立来源摘要和owner闭包须准确；完整owner不能掩盖缺Activity/回归的实际UNKNOWN',()=>{
 const root='a1000000-0000-4000-8000-000000000099';
 const body={schema_version:1,repo,scope:'phones',source_basis:'current_registration',canonical:{areas:[],journeys:[{id:root,parent_journey_id:null},{id:cap,parent_journey_id:root}],workflows:[old,current]}};
 const registry={...body,registry_sha256:stepSha256(body)};
 expect(owners.validateSourceOwnerRegistry(registry,repo)).toBe(registry);
 const changed=structuredClone(registry);changed.canonical.workflows[0].source_repo='evil/repo';
 expect(()=>owners.validateSourceOwnerRegistry(changed,repo)).toThrow(/SOURCE_OWNER/);
 const broken=structuredClone(registry);broken.canonical.journeys[1].parent_journey_id='a1000000-0000-4000-8000-000000000088';
 const {registry_sha256,...brokenBody}=broken;broken.registry_sha256=stepSha256(brokenBody);
 expect(()=>owners.validateSourceOwnerRegistry(broken,repo)).toThrow(/闭包/);
 const snapshot={repo,source_registry:registry,canonical:{workflows:[current],activities:[],references:[],steps:[]},assertions:[]};
 const lint=lintImplementationRegistry(snapshot,[plan],{capabilities:{keyword_acquisition:{},douyin_video_discovery:{}}});
 expect(lint.status).toBe('unknown');
 expect(lint.gaps).toContainEqual(expect.objectContaining({code:'activity_registration_missing'}));
 expect(lint.gaps.some(g=>g.code==='workflow_registration_missing')).toBe(false);
});

it('既有公司KR来源没有source_workflow时以真实key身份冻结，错误native身份及workspace缺workflow仍拒绝',async()=>{
 const {readFileSync}=await import('node:fs');
 const spec=JSON.parse(readFileSync(new URL('../../../config/company-kr-workflow.json',import.meta.url),'utf8'));
 const nativeRepo='perfectuser21/cecelia',root='c5cb480f-f7f7-4b4e-8871-bd65ff65b668';
 const native={id:'efb0474d-6abe-426b-824a-33cfd0860331',key:spec.key,capability_id:spec.capability_id,source_repo:nativeRepo,source_path:'packages/brain/config/company-kr-workflow.json',source_capability:spec.capability,source_workflow:null};
 const frozen=(w,r=nativeRepo)=>{
  const body={schema_version:1,repo:r,scope:'cecelia-kr',source_basis:'current_registration',canonical:{areas:[],journeys:[{id:root,parent_journey_id:null},{id:w.capability_id,parent_journey_id:root}],workflows:[w]}};
  return {...body,registry_sha256:stepSha256(body)};
 };
 expect(()=>owners.validateSourceOwnerRegistry(frozen(native),nativeRepo)).not.toThrow();
 for(const patch of [{source_repo:'evil/repo'},{source_path:'packages/brain/config/not-native.json'},{key:'other_native'},{source_capability:'other_native'},{source_workflow:''}]){
  expect(()=>owners.validateSourceOwnerRegistry(frozen({...native,...patch}),nativeRepo)).toThrow(/SOURCE_OWNER/);
 }
 expect(()=>owners.validateSourceOwnerRegistry(frozen({...old,source_workflow:null},repo),repo)).toThrow(/SOURCE_OWNER/);
});
