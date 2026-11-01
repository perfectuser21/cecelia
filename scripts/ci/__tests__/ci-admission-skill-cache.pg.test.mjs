import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import pg from 'pg';
import {baselineFixture} from './fixtures/ci-admission-pr.mjs';
import {resolvePrBaseline} from '../implementation-pr-baseline.mjs';
import {writeCiAdmissionInputs} from '../ci-admission-handoff.mjs';
import {loadCiAdmissionInputs,withCiAdmissionInputsScratch} from '../ci-admission-inputs.mjs';
import {prepareCiAdmissionSkillCache} from '../implementation-skill-source.mjs';
import {DB_DEFAULTS} from '../../../packages/brain/src/db-config.js';
test('实际typed artifact helper与私有PG能力准备Skill cache，GitHub API仅在边界使用官方形态fixture',async t=>{
 assert.equal(DB_DEFAULTS.database,'cecelia_scratch');assert.ok(['localhost','127.0.0.1','::1'].includes(DB_DEFAULTS.host));assert.equal(DB_DEFAULTS.user,'ci');
 const f=await baselineFixture(t),parent=mkdtempSync(join(tmpdir(),'ci-admission-root-cache-pg-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const result=await resolvePrBaseline(f.options,f.deps),inputDir=writeCiAdmissionInputs({inputDir:parent,result}),schemas=[];let cache;
 try{
  cache=await prepareCiAdmissionSkillCache({...f.options,repo:'perfectuser21/cecelia',revisions:[f.source,f.options.event.pull_request.head.sha],inputDir,mode:'pr'},
   {loadCiAdmissionInputs:options=>loadCiAdmissionInputs(options,f.deps),withCiAdmissionInputsScratch:(handle,consume)=>withCiAdmissionInputsScratch(handle,async context=>{
    const identity=(await context.db.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];
    assert.equal(identity.database,'cecelia_scratch');assert.match(identity.schema,/^ci_admission_[a-f0-9]{32}$/);schemas.push(identity.schema);
    assert.ok(context.snapshots.every(Object.isFrozen));return consume(context);
   })});
  assert.equal(typeof cache,'string');assert.ok(existsSync(cache));assert.ok(!cache.startsWith(f.candidate+'/'));
  assert.deepEqual(readdirSync(inputDir).sort(),['artifact.zip','handoff.json']);assert.equal(existsSync(join(parent,'base/base.json')),false);
  const admin=new pg.Client(DB_DEFAULTS);try{await admin.connect();assert.equal((await admin.query('SELECT count(*)::int n FROM pg_namespace WHERE nspname=ANY($1::text[])',[schemas])).rows[0].n,0);}finally{await admin.end();}
 }finally{if(cache)rmSync(dirname(cache),{recursive:true,force:true});}
});
