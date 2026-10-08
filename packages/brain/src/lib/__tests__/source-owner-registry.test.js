import {expect,it} from 'vitest';
import * as owners from '../source-owner-registry.js';
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
