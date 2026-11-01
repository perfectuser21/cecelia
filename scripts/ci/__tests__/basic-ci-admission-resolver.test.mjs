import {test} from 'node:test';
import assert from 'node:assert/strict';
import {baselineFixture as fixture} from './fixtures/ci-admission-pr.mjs';
import {resolvePrBaseline} from '../implementation-pr-baseline.mjs';
const prefix='repos/perfectuser21/cecelia/actions';
test('同一first-parent依次查新CI/旧official，最近官方CI基线保3scope和完整累计diff',async t=>{
 const f=await fixture(t),result=await resolvePrBaseline(f.options,f.deps);
 assert.equal(result.body.ci_format,'cecelia.ci-admission/v1');assert.equal(result.resolution.effective_base_revision,f.source);assert.equal(result.resolution.tooling_revision,f.control);
 assert.deepEqual(Object.keys(result.resolution.scope_hashes),['cecelia-kr','cecelia-factory','cecelia-infra']);
 assert.ok(result.resolution.changed_files.includes('pr-input'));assert.ok(result.resolution.changed_files.includes('scripts/ci/config/ci-admission-registry.json'));
 const probes=f.calls.filter(p=>p.includes('/artifacts?name='));
 assert.deepEqual(probes.slice(0,3),[`${prefix}/artifacts?name=implementation-ci-admission-baseline-${f.control}&per_page=100`,`${prefix}/artifacts?name=implementation-snapshot-${f.control}&per_page=100`,`${prefix}/artifacts?name=implementation-ci-admission-baseline-${f.source}&per_page=100`]);
 assert.equal(probes.some(p=>p.includes('implementation-snapshot-'+f.source)),false);
});
test('新purpose存在但坏，不能换同SHA旧证据或更老祖先',async t=>{
 const f=await fixture(t);f.data.get(`${prefix}/artifacts/77/zip`)[0]^=1;
 await assert.rejects(resolvePrBaseline(f.options,f.deps),/CI_ADMISSION_/);
 assert.equal(f.calls.some(p=>p.includes('implementation-snapshot-'+f.source)),false);
});
