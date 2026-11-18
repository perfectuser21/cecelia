import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {runPilotReleaseVerification} from '../pilot-release-verification.mjs';
import {foundationFixture,hash} from './pilot-foundation.fixture.mjs';
const run=(f,s=f.snapshot)=>runPilotReleaseVerification({repoRoot:f.root,snapshot:s,outputDir:join(f.root,'output'),event:'push',ref:'refs/heads/main'});
test('真实Pilot CLI接受完整固定A宿主，B不同字节不代替A，回归实际执行且保留原证明格式',async t=>{
 const f=foundationFixture(t),prior=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
 try{const result=await run(f);assert.equal(result.receipt.verdict,'PASS');assert.equal(readFileSync(join(f.root,'output-regression'),'utf8'),'verified');assert.equal(result.report.implementation_source_set,undefined);assert.equal(result.receipt.snapshot_sha256,f.snapshot.snapshot_sha256);}
 finally{globalThis.fetch=prior;}
});
for(const [label,mutate] of [
 ['非宿主跨版本',s=>{const b=s.definitions.activities[0].payload.implementation_bindings.at(-1);b.revision=s.definitions.activities[0].payload.implementation_bindings[0].revision;}],
 ['宿主缺项',s=>s.definitions.activities[0].payload.implementation_bindings.splice(1,1)],
 ['宿主重复',s=>s.definitions.activities[0].payload.implementation_bindings.push(structuredClone(s.definitions.activities[0].payload.implementation_bindings[0]))],
 ['宿主额外',s=>{const b=structuredClone(s.definitions.activities[0].payload.implementation_bindings[1]);b.path='extra.mjs';s.definitions.activities[0].payload.implementation_bindings.push(b);}],
 ['宿主摘要篡改',s=>s.definitions.activities[0].payload.implementation_bindings[1].digest='sha256:'+'0'.repeat(64)],
 ['profile错摘要',s=>s.definitions.workflows[0].payload.contract.runtime.profile_ref.digest='sha256:'+'0'.repeat(64)],
 ['profile读B冒充A',s=>s.definitions.workflows[0].payload.contract.runtime.profile_ref.revision=s.revision],
 ['标签吞业务Skill',s=>{const b=s.definitions.activities[0].payload.implementation_bindings.at(-1);b.purpose='foundation_host';b.raw.purpose='foundation_host';}],
 ['中央Skill伪造来源',s=>s.definitions.activities[0].payload.implementation_bindings.find(b=>b.purpose&&b.kind==='skill').resolved_source.revision='f'.repeat(40)],
 ['raw声明与normalized不一致',s=>s.definitions.activities[0].payload.implementation_bindings[0].raw.revision=s.revision],
 ['业务Skill错摘要',s=>s.definitions.activities[0].payload.implementation_bindings.at(-1).digest='sha256:'+hash('other')],
 ['未声明workflow宿主',s=>delete s.definitions.workflows[0].payload.contract.runtime],
])test(`真实Pilot拒绝${label}`,async t=>{const f=foundationFixture(t),s=structuredClone(f.snapshot);mutate(s);await assert.rejects(run(f,f.seal(s)));});
