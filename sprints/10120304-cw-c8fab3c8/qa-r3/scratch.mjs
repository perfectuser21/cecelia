import { createRequire } from 'node:module';
import { readFileSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../../packages/brain/package.json',import.meta.url));
const {Client}=require('pg');
const db=new Client({host:'/tmp',database:'cecelia_scratch',user:'administrator'});
const migration=readFileSync(new URL('../../../packages/brain/migrations/552_decisions_made_by_allow_ai.sql',import.meta.url),'utf8').split('\n').filter(x=>!/^\s*(BEGIN|COMMIT);\s*$/.test(x)).join('\n');
const out={started_at:new Date().toISOString(),tests:[]};
const rows=async(sql,args)=>(await db.query(sql,args)).rows;
const checks=()=>rows(`SELECT c.conname,pg_get_constraintdef(c.oid) AS def,c.convalidated FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) WHERE c.conrelid='decisions'::regclass AND c.contype='c' AND a.attname='made_by' ORDER BY c.conname`);
const version=()=>rows("SELECT version FROM schema_version WHERE version='552'");
const snapshot=async()=>({checks:await checks(),version:await version(),data:await rows('SELECT count(*)::int AS n,md5(string_agg(row_to_json(d)::text, chr(10) ORDER BY id)) AS hash FROM decisions d')});
const lit=x=>"'"+x.replaceAll("'","''")+"'";
const drop=async()=>{for(const x of await checks())await db.query(`ALTER TABLE decisions DROP CONSTRAINT "${x.conname.replaceAll('"','""')}"`);await db.query("DELETE FROM schema_version WHERE version='552'");};
const add=sql=>db.query('ALTER TABLE decisions ADD CONSTRAINT qa_old CHECK ('+sql+') NOT VALID');
const write=async(v)=>rows('INSERT INTO decisions(topic,decision,category,made_by) VALUES($1,$2,$3,$4) RETURNING made_by',['qa-r3-scratch-'+v,'验收','judgment',v]);
async function positive(name,definitions,values){
 await db.query('SAVEPOINT scenario');
 try{
  await drop();for(let i=0;i<definitions.length;i++)await db.query(`ALTER TABLE decisions ADD CONSTRAINT qa_old_${i} CHECK (${definitions[i]}) NOT VALID`);
  const before=await checks();const dataBefore=(await snapshot()).data;
  await db.query(migration);const once=await checks();assert.equal(once.length,1);assert.equal(once[0].conname,'decisions_made_by_check');assert.equal(once[0].convalidated,false);assert.deepEqual((await snapshot()).data,dataBefore);
  for(const value of values)assert.deepEqual(await write(value),[{made_by:value}]);
  await db.query(migration);assert.deepEqual(await checks(),once);assert.equal((await version()).length,1);
  await db.query('SAVEPOINT illegal');let error;try{await write('bogus_maker')}catch(e){error=e.code}await db.query('ROLLBACK TO SAVEPOINT illegal');assert.equal(error,'23514');
  out.tests.push({name,verdict:'PASS',before,after:once,inserted_values:values,rerun_identical:true,schema_552_count:1,existing_rows_unchanged:true,bogus_sqlstate:error});
 }finally{await db.query('ROLLBACK TO SAVEPOINT scenario')}
}
async function negative(name,expression,expected){
 await db.query('SAVEPOINT scenario');
 try{
  await drop();await add(expression);const before=await snapshot();await db.query('SAVEPOINT execution');let error;
  try{await db.query(migration)}catch(e){error={code:e.code,message:e.message}}
  assert.ok(error);assert.match(error.message,expected);await db.query('ROLLBACK TO SAVEPOINT execution');assert.deepEqual(await snapshot(),before);assert.equal((await version()).length,0);
  out.tests.push({name,verdict:'PASS',input:expression,error,unchanged_after_failed_migration:true,schema_552_count:0});
 }finally{await db.query('ROLLBACK TO SAVEPOINT scenario')}
}
await db.connect();
try{
 const [identity]=await rows('SELECT current_database() AS db,current_user AS actor');assert.equal(identity.db,'cecelia_scratch');out.identity=identity;
 const original=await snapshot();await db.query('BEGIN');
 try{
  const base=['user','cecelia','system'];const inList=vs=>'made_by IN ('+vs.map(lit).join(',')+')';
  await positive('Q-5 迁移外加宽/幂等',[inList([...base,'qa_extra'])],[...base,'qa_extra','ai']);
  await positive('Q-8 空串及单引号',[inList([...base,'qa_extra','',"owner'x"])],[...base,'qa_extra','',"owner'x",'ai']);
  await positive('无 CHECK 恢复旧三值',[],[...base,'ai']);
  await positive('改名及多 CHECK 并集',[inList([...base,'owner_y']),inList(['user','owner_z'])],[...base,'owner_y','owner_z','ai']);
  for(const extra of [[],["owner'x"]]){const values=[...base,...extra];await positive('cast 显式 varchar→text '+(extra.length?'含转义':'克隆原三值'),['made_by::text = ANY (ARRAY['+values.map(v=>'('+lit(v)+'::character varying)::text').join(',')+'])'],[...values,'ai']);}
  await negative('NULL 不静默收窄',"made_by IN ('user','cecelia','system',NULL)",/无法解析/);
  await negative('多列 CHECK 拒绝',"made_by <> 'ai' OR category IS NOT NULL",/多列/);
  await negative('非白名单 CHECK 拒绝','length(made_by)>0',/无法解析/);
  const [column]=await rows("SELECT data_type,character_maximum_length,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='decisions' AND column_name='made_by'");
  assert.deepEqual(column,{data_type:'character varying',character_maximum_length:20,column_default:"'system'::character varying"});
  const defaults=await rows("INSERT INTO decisions(topic,decision,category) VALUES('qa-r3-default','验收','judgment') RETURNING made_by");assert.deepEqual(defaults,[{made_by:'system'}]);out.tests.push({name:'Q-6 类型和默认值',verdict:'PASS',column,default_insert:defaults});
 }finally{await db.query('ROLLBACK')}
 assert.deepEqual(await snapshot(),original);out.rollback_verified=true;
 writeFileSync(new URL('scratch-evidence.json',import.meta.url),JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({identity:out.identity,tests:out.tests.map(({name,verdict})=>({name,verdict})),rollback_verified:out.rollback_verified}));
}finally{await db.end()}
