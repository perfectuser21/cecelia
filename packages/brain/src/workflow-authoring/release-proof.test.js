import {it,expect} from 'vitest';
import {assertAuthoringReleaseProof,prepareAuthoringReleaseProof} from './release-proof.js';
import {definitionDigest} from './contracts.js';

it.each([true,{}, {snapshot_sha256:'a'.repeat(64)}, {verified:true,implementation_source_set:[]}])('序列化声明不能冒充真实固定Git来源证明：%j',proof=>{
 const snapshot={snapshot_sha256:'a'.repeat(64)};
 expect(()=>assertAuthoringReleaseProof(snapshot,proof)).toThrow('authoring发布来源证明不匹配');
});
it('自洽摘要也不能让未正式登记的普通快照取得跨版本豁免',async()=>{
 const body={status:'verified',gaps:[],scope:'unregistered',repo:'perfectuser21/zenithjoy-workspace',revision:'a'.repeat(40),definitions:{workflows:[],activities:[]},map:{repositories:[]}};
 const snapshot={...body,snapshot_sha256:definitionDigest(body)};
 await expect(prepareAuthoringReleaseProof(snapshot)).rejects.toThrow('authoring发布来源证明不匹配');
});
