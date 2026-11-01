import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {baselineFixture} from './fixtures/ci-admission-pr.mjs';
import {resolvePrBaseline} from '../implementation-pr-baseline.mjs';
import {writeCiAdmissionInputs} from '../ci-admission-handoff.mjs';
import {prepareCiAdmissionInfraInputs,prepareInfraInputs} from '../implementation-infra-inputs.mjs';
async function fixture(t){const f=await baselineFixture(t),parent=mkdtempSync(join(tmpdir(),'ci-admission-infra-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const result=await resolvePrBaseline(f.options,f.deps),inputDir=writeCiAdmissionInputs({inputDir:parent,result});
 return {...f,parent,options:{...f.options,inputDir,sourceRepo:'perfectuser21/cecelia',base:f.source,head:result.resolution.head_revision,mode:'pr'}};}
test('typed infra重核原三scope封套，仅返回定位元数据，无旧下载/裸scope文件',async t=>{
 const f=await fixture(t),result=await prepareCiAdmissionInfraInputs(f.options,f.deps);
 assert.equal(result.scope,'cecelia-infra');assert.equal(result.base_revision,f.source);assert.equal(result.input_kind,'ci_admission_only');assert.equal(result.execution_status,'unknown');
 assert.deepEqual(readdirSync(f.parent),['ci-admission']);
});
for(const mode of ['main','release','recovery'])test(`typed infra拒绝 ${mode}，不写diagnostics`,async t=>{
 const f=await fixture(t);await assert.rejects(prepareCiAdmissionInfraInputs({...f.options,mode},f.deps),/CI_ADMISSION_USAGE_FORBIDDEN/);assert.deepEqual(readdirSync(f.parent),['ci-admission']);
 assert.throws(()=>prepareInfraInputs({sourceRepo:f.options.sourceRepo,base:f.source,head:f.options.head,mode:'main',inputDir:f.parent}),/IMPLEMENTATION_INFRA_TYPED_INPUT_REQUIRED/);
});
test('typed infra不接受调用者伪造BASE或HEAD，即使locator有效',async t=>{
 const f=await fixture(t);for(const key of ['base','head'])await assert.rejects(prepareCiAdmissionInfraInputs({...f.options,[key]:'f'.repeat(40)},f.deps),/CI_ADMISSION_INFRA_SOURCE_MISMATCH/);
});
