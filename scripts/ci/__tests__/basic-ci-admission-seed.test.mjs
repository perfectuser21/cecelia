import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authorityFixture} from './fixtures/ci-admission-authority.mjs';
import {loadCiAdmissionSeed,CI_ADMISSION_SEED_PATH} from '../ci-admission-seed.mjs';
const bytes=readFileSync(new URL('../config/ci-admission-registry.json',import.meta.url));
test('CI synthetic声明保全官方登记身份与全部121格/17可执行绑定，不带中央执行事实',async t=>{
 const f=authorityFixture(t,{controlFiles:{[CI_ADMISSION_SEED_PATH]:bytes}}),{seed}=loadCiAdmissionSeed(f.root,f.control);
 assert.equal(seed.origin,'ci_synthetic');assert.equal(seed.tables.activity_cells.length,121);assert.equal(seed.required_assertions.length,17);
 assert.equal(Object.values(seed.scope_cells).flat().filter(a=>a.assertion_ref===null).length,104);
 const rows=seed.tables.activity_cells.filter(a=>a.assertion_ref);
 assert.deepEqual(rows.map(r=>r.id).sort(),seed.required_assertions.map(r=>r.id).sort());
 assert.equal(new Set(seed.required_assertions.map(r=>r.assertion_ref)).size,4);
 assert.equal(seed.tables.workflow_activity_refs.filter(r=>seed.canonical_ids['cecelia-factory'].references.includes(r.id)).length,8);
 for(const table of Object.values(seed.tables))for(const row of table){assert.equal(row.current_definition_version_id??null,null);assert.equal(row.notion_id,undefined);assert.equal(row.created_at,undefined);}
});
test('只读control Git，source同名数据/未提交文件不能缩小分母',async t=>{
 const f=authorityFixture(t,{controlFiles:{[CI_ADMISSION_SEED_PATH]:bytes}});
 const {writeFileSync}=await import('node:fs'),{join}=await import('node:path');
 writeFileSync(join(f.root,CI_ADMISSION_SEED_PATH),JSON.stringify({schema:'cecelia.ci-registry/v1',origin:'ci_synthetic',scopes:[],required_assertions:[]}));
 assert.equal(loadCiAdmissionSeed(f.root,f.control).seed.required_assertions.length,17);
 assert.throws(()=>loadCiAdmissionSeed(f.root,f.source),/CI_ADMISSION_SEED_GIT_REQUIRED/);
});
