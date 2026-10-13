import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { auditVersionIdentity, applyScratchIdentityConstraints } from '../../lib/version-identity-preflight.js';

let pool, db, schema, a, b, va, vb, ca, cb;
const connection={host:process.env.DB_HOST||'/tmp',port:Number(process.env.DB_PORT||5432),
  user:process.env.DB_USER||'administrator',password:process.env.DB_PASSWORD};
beforeAll(async()=>{
  const requested=process.env.DB_NAME||'cecelia_scratch';
  if(requested==='cecelia_scratch')return;
  if(requested!=='cecelia_test'||process.env.CI!=='true')throw Error('仅隔离CI可从cecelia_test创建scratch');
  const admin=new pg.Pool({...connection,database:'cecelia_test'});
  try {
    if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='cecelia_scratch'")).rows.length) {
      try {await admin.query('CREATE DATABASE cecelia_scratch');}catch(error){if(error.code!=='42P04')throw error;}
    }
  } finally {await admin.end();}
});
beforeEach(async () => {
  pool = new pg.Pool({...connection,database:'cecelia_scratch'});
  db = await pool.connect();
  const name = (await db.query('SELECT current_database() AS name')).rows[0].name;
  if (name!=='cecelia_scratch') throw Error('测试拒绝修改非隔离数据库');
  schema = `version_identity_${randomUUID().replaceAll('-', '')}`;
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET search_path TO ${schema}`);
  await db.query(`
    CREATE TABLE activities(id uuid PRIMARY KEY);
    CREATE TABLE activity_definition_versions(id uuid PRIMARY KEY, activity_id uuid REFERENCES activities, payload jsonb,
      UNIQUE(activity_id,id));
    CREATE TABLE activity_versions(id uuid PRIMARY KEY,activity_id uuid NOT NULL REFERENCES activities,first_build_id uuid REFERENCES activity_definition_versions,
      UNIQUE(activity_id,id));
    CREATE TABLE activity_version_builds(build_id uuid PRIMARY KEY REFERENCES activity_definition_versions,
      activity_id uuid NOT NULL,activity_version_id uuid,FOREIGN KEY(activity_id,activity_version_id) REFERENCES activity_versions(activity_id,id));
    CREATE TABLE activity_release_events(id uuid PRIMARY KEY,activity_id uuid NOT NULL,from_version_id uuid REFERENCES activity_versions,
      to_version_id uuid REFERENCES activity_versions);
  `);
  [a,b,va,vb,ca,cb] = Array.from({length:6}, randomUUID);
  await db.query('INSERT INTO activities VALUES($1),($2)',[a,b]);
  await db.query('INSERT INTO activity_definition_versions VALUES($1,$2,$3),($4,$5,$3)',[va,a,{contract:'frozen'},vb,b]);
  await db.query('INSERT INTO activity_versions VALUES($1,$2,$3),($4,$5,$6)',[ca,a,va,cb,b,vb]);
  await db.query(`CREATE FUNCTION reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'immutable history'; END $$`);
  for(const table of ['activity_definition_versions','activity_versions','activity_version_builds','activity_release_events']) {
    await db.query(`CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION reject_history_change()`);
  }
});
afterEach(async () => {
  try {if(schema)await db.query(`DROP SCHEMA ${schema} CASCADE`);}
  finally {db?.release();await pool?.end();schema=null;}
});

it('真实PG预检报告四处身份约束缺口，只输出摘要，不改原件', async () => {
  const audit = await auditVersionIdentity(db,{schema});
  expect(audit.constraints).toHaveLength(4);
  expect(audit.constraints.every(x=>!x.enforced && x.mismatches===0)).toBe(true);
  expect(audit.baseline.tables.activity_definition_versions.rows).toBe(2);
  expect(JSON.stringify(audit)).not.toContain('frozen');
  expect((await auditVersionIdentity(db,{schema})).baseline.sha256).toBe(audit.baseline.sha256);
});

it('迁移后拒跨对象构建/首构建/from/to；合法initial事件保留，原摘要不变且幂等', async () => {
  const before = await auditVersionIdentity(db,{schema});
  const result = await applyScratchIdentityConstraints(db,{schema,expectedDigest:before.baseline.sha256});
  expect(result.baseline.sha256).toBe(before.baseline.sha256);
  expect(result.constraints.every(x=>x.enforced && x.validated)).toBe(true);
  await expect(db.query('INSERT INTO activity_version_builds VALUES($1,$2,$3)',[va,b,cb])).rejects.toMatchObject({code:'23503'});
  await expect(db.query('INSERT INTO activity_versions VALUES($1,$2,$3)',[randomUUID(),b,va])).rejects.toMatchObject({code:'23503'});
  for (const [from,to] of [[cb,ca],[ca,cb]]) {
    await expect(db.query('INSERT INTO activity_release_events VALUES($1,$2,$3,$4)',[randomUUID(),a,from,to])).rejects.toMatchObject({code:'23503'});
  }
  await db.query('INSERT INTO activity_release_events VALUES($1,$2,NULL,$3)',[randomUUID(),a,ca]);
  const current = await auditVersionIdentity(db,{schema});
  const repeat = await applyScratchIdentityConstraints(db,{schema,expectedDigest:current.baseline.sha256});
  expect(repeat.added).toEqual([]);
  for(const sql of ['UPDATE activity_definition_versions SET payload=payload','DELETE FROM activity_versions','TRUNCATE activity_release_events']) {
    await expect(db.query(sql)).rejects.toMatchObject({code:'P0001'});
  }
});

it('已有不可变错误数据阻止迁移并保留旧记录，不通过改历史消除缺口', async () => {
  await db.query('INSERT INTO activity_version_builds VALUES($1,$2,$3)',[va,b,cb]);
  const before = await auditVersionIdentity(db,{schema});
  expect(before.constraints.find(x=>x.key==='build_owner').mismatches).toBe(1);
  await expect(applyScratchIdentityConstraints(db,{schema,expectedDigest:before.baseline.sha256})).rejects.toMatchObject({code:'HISTORICAL_IDENTITY_MISMATCH'});
  const after = await auditVersionIdentity(db,{schema});
  expect(after.baseline.sha256).toBe(before.baseline.sha256);
  expect(after.constraints.every(x=>!x.enforced)).toBe(true);
});

it('基线漂移先拒绝，零DDL；schema参数注入拒绝', async () => {
  await expect(applyScratchIdentityConstraints(db,{schema,expectedDigest:'0'.repeat(64)})).rejects.toMatchObject({code:'BASELINE_CHANGED'});
  expect((await auditVersionIdentity(db,{schema})).constraints.every(x=>!x.enforced)).toBe(true);
  await expect(auditVersionIdentity(db,{schema:'public;DROP TABLE activities'})).rejects.toThrow('schema');
});

it('生产库身份拒绝在BEGIN或DDL之前；不能靠调用参数伪装库名', async () => {
  const calls=[];
  const production={query:async sql=>{calls.push(sql);return {rows:[{name:'cecelia'}]};}};
  await expect(applyScratchIdentityConstraints(production,{schema:'public',expectedDigest:'0'.repeat(64)})).rejects.toMatchObject({code:'SCRATCH_REQUIRED'});
  expect(calls).toEqual(['SELECT current_database() AS name']);
});

it('第二处DDL失败时第一处也回滚，不改变历史摘要或禁改触发器', async()=>{
  await db.query('ALTER TABLE activity_versions ADD CONSTRAINT runtime_identity_first_build_owner CHECK(true)');
  const before=await auditVersionIdentity(db,{schema});
  await expect(applyScratchIdentityConstraints(db,{schema,expectedDigest:before.baseline.sha256})).rejects.toMatchObject({code:'42710'});
  const after=await auditVersionIdentity(db,{schema});
  expect(after.constraints.every(x=>!x.enforced)).toBe(true);
  expect(after.baseline.sha256).toBe(before.baseline.sha256);
});

it('真实新增历史导致基线漂移；缺列报告而非SQL中断',async()=>{
  const before=await auditVersionIdentity(db,{schema});
  await db.query('INSERT INTO activity_definition_versions VALUES($1,$2,$3)',[randomUUID(),a,{new:true}]);
  await expect(applyScratchIdentityConstraints(db,{schema,expectedDigest:before.baseline.sha256})).rejects.toMatchObject({code:'BASELINE_CHANGED'});
  await db.query('ALTER TABLE activity_versions DROP COLUMN first_build_id');
  const after=await auditVersionIdentity(db,{schema});
  expect(after.constraints.find(x=>x.key==='first_build_owner').missing_columns).toContain('activity_versions.first_build_id');
  expect(after.ready_for_identity_constraints).toBe(false);
});

it('第二连接占锁时限时退出，零DDL并释放事务；随后可成功迁移',async()=>{
  const before=await auditVersionIdentity(db,{schema});
  const writer=await pool.connect();
  try {
    await writer.query('BEGIN');
    await writer.query(`LOCK TABLE ${schema}.activity_version_builds IN ROW EXCLUSIVE MODE`);
    await expect(applyScratchIdentityConstraints(db,{schema,expectedDigest:before.baseline.sha256})).rejects.toMatchObject({code:'55P03'});
    expect((await auditVersionIdentity(db,{schema})).constraints.every(x=>!x.enforced)).toBe(true);
  } finally {await writer.query('ROLLBACK');writer.release();}
  expect((await applyScratchIdentityConstraints(db,{schema,expectedDigest:before.baseline.sha256})).constraints.every(x=>x.enforced)).toBe(true);
});
