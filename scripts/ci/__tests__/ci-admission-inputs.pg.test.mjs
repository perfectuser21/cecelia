/** 显式隔离PG验证consumer callback；只使用本人UUIDschema，不访问中央。 */
import './ci-admission-verification-lease.pg.test.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {DB_DEFAULTS} from '../../../packages/brain/src/db-config.js';
import {baselineFixture} from './fixtures/ci-admission-pr.mjs';
import {resolvePrBaseline} from '../implementation-pr-baseline.mjs';
import {writeCiAdmissionInputs} from '../ci-admission-handoff.mjs';
import {loadCiAdmissionInputs,withCiAdmissionInputsScratch} from '../ci-admission-inputs.mjs';
test('实际PG callback冻结身份/三scope，异常和legacy逃逸仍finally清理本人schema',async t=>{
 assert.equal(DB_DEFAULTS.database,'cecelia_scratch');
 const f=await baselineFixture(t),parent=mkdtempSync(join(tmpdir(),'ci-admission-consumer-pg-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const result=await resolvePrBaseline(f.options,f.deps),inputDir=writeCiAdmissionInputs({inputDir:parent,result});
 const handle=await loadCiAdmissionInputs({...f.options,inputDir,mode:'pr'},f.deps),schemas=[];
 const callback=async context=>{
  const {db,source,provenance,snapshots,scopes}=context;
  assert.ok(Object.isFrozen(context)&&Object.isFrozen(source)&&Object.isFrozen(provenance)&&Object.isFrozen(scopes));
  assert.ok(!Object.isFrozen(db));assert.ok(snapshots.every(Object.isFrozen));
  assert.throws(()=>{source.base_revision='f'.repeat(40);},TypeError);assert.throws(()=>{provenance.artifact_id=999;},TypeError);
  assert.throws(()=>{snapshots[1].execution_status='verified';},TypeError);
  const identity=(await db.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];
  assert.equal(identity.database,'cecelia_scratch');assert.match(identity.schema,/^ci_admission_[a-f0-9]{32}$/);schemas.push(identity.schema);
  assert.equal((await db.query('SELECT count(*)::int n FROM activity_cells')).rows[0].n,0);
  assert.equal(source.base_revision,f.source);assert.equal(provenance.artifact_id,77);return {checked:3};
 };
 assert.deepEqual(await withCiAdmissionInputsScratch(handle,callback),{checked:3});
 await assert.rejects(withCiAdmissionInputsScratch(handle,async context=>{await callback(context);throw Error('consumer intentional failure');}),/intentional failure/);
 await assert.rejects(withCiAdmissionInputsScratch(handle,async context=>{await callback(context);return context.snapshots;}),/LEGACY_ESCAPE/);
 const admin=new pg.Client(DB_DEFAULTS);try{await admin.connect();assert.equal((await admin.query('SELECT count(*)::int n FROM pg_namespace WHERE nspname=ANY($1::text[])',[schemas])).rows[0].n,0);}finally{await admin.end();}
});
