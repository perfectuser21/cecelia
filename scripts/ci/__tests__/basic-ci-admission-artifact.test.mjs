import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readCiAdmissionBaseline} from '../ci-admission-artifact.mjs';
import {admissionFixture} from './fixtures/ci-admission-envelope.mjs';
const prefix='repos/perfectuser21/cecelia/actions';
async function fixture(t){
 const f=await admissionFixture(t),artifact=f.data.get(`${prefix}/artifacts/77`);
 const name=`implementation-ci-admission-baseline-${f.source}`,endpoint=`${prefix}/artifacts?name=${name}&per_page=100`;
 f.data.set(endpoint,{total_count:1,artifacts:[structuredClone(artifact)]});
 return {...f,artifact,endpoint,options:{revision:f.source,repoRoot:f.root,controlRoot:f.root},deps:{api:f.api,download:async path=>Buffer.from(f.data.get(path))}};
}
test('官方ZIP与API完整身份一起给三scope消费能力，publisher控制SHA可晚于source',async t=>{
 const f=await fixture(t),result=await readCiAdmissionBaseline(f.options,f.deps);
 assert.equal(result.envelope.ci_source_revision,f.source);assert.equal(result.envelope.ci_control_revision,f.control);
 assert.deepEqual(result.scopeHashes,Object.fromEntries(result.envelope.ci_scopes.map(s=>[s.ci_scope_key,s.ci_document_sha256])));
 assert.equal(result.artifact.id,77);assert.equal(JSON.stringify(result.capability),'{}');
});
test('只有实际缺失或过期才返回missing，不把错误变fallback',async t=>{
 const f=await fixture(t);f.data.set(f.endpoint,{total_count:0,artifacts:[]});assert.equal(await readCiAdmissionBaseline(f.options,f.deps),null);
 f.data.set(f.endpoint,{total_count:1,artifacts:[{...f.artifact,expired:true}]});assert.equal(await readCiAdmissionBaseline(f.options,f.deps),null);
});
for(const kind of ['pagination','duplicate-id','digest','size','run','app','list-changed','statement','provider','api'])test('现存坏官方证据不得降级：'+kind,async t=>{
 const f=await fixture(t),list=f.data.get(f.endpoint);
 if(kind==='pagination')list.total_count=2;
 if(kind==='duplicate-id')list.artifacts.push({...list.artifacts[0]}),list.total_count=2;
 if(kind==='digest')f.data.get(`${prefix}/artifacts/77/zip`)[0]^=1;
 if(kind==='size')f.artifact.size_in_bytes++;
 if(kind==='run')f.artifact.workflow_run.id=11;
 if(kind==='app')f.data.get('repos/perfectuser21/cecelia/check-runs/44').app.id=7;
 if(kind==='list-changed')f.artifact.digest='sha256:'+'0'.repeat(64);
 if(kind==='statement'){const {ciArchive}=await import('./fixtures/ci-admission-archive.mjs');const bytes=ciArchive({...f.body,ci_assertions:{different:true}});f.data.set(`${prefix}/artifacts/77/zip`,bytes);}
 if(kind==='provider')f.data.get(`${prefix}/runs/22/attempts/1/jobs?per_page=100`).jobs[0].conclusion='failure';
 if(kind==='api')f.deps.api=async()=>{throw Error('403');};
 await assert.rejects(readCiAdmissionBaseline(f.options,f.deps),/CI_ADMISSION_/);
});
