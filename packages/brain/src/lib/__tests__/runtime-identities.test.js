import {afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {installScratchIdentities} from '../runtime-identities.js';
import {scratchOnlyConnection} from '../../__tests__/fixtures/scratch-only-db.js';
let pool,db,source,schema,skill,agent;
let connection;
beforeAll(async()=>{connection=await scratchOnlyConnection();});
beforeEach(async()=>{
  pool=new pg.Pool(connection);
  db=await pool.connect();source=`identity_source_${randomUUID().replaceAll('-','')}`;schema=`identity_catalog_${randomUUID().replaceAll('-','')}`;
  if((await db.query('SELECT current_database() AS name')).rows[0].name!=='cecelia_scratch')throw Error('拒绝非scratch写入');
  await db.query(`CREATE SCHEMA ${source};
    CREATE TABLE ${source}.ops_agents(id bigint PRIMARY KEY,source text,host_alias text,name text,agent_type text);
    CREATE TABLE ${source}.skill_registry(id uuid PRIMARY KEY,name text);
    CREATE TABLE ${source}.ops_skills(id bigint PRIMARY KEY,name text);
    CREATE TABLE ${source}.ops_skill_versions(id bigint PRIMARY KEY,skill_id bigint,generation int);
    INSERT INTO ${source}.ops_agents VALUES(1,'openclaw','m1','sales','openclaw_agent'),(2,'openclaw','m4','sales','openclaw_agent'),(3,'launchd','m4','tick','launchd_job');
    INSERT INTO ${source}.ops_skills VALUES(1,'publish');
    INSERT INTO ${source}.ops_skill_versions VALUES(1,1,1),(2,1,2);`);
  skill=randomUUID();agent=randomUUID();await db.query(`INSERT INTO ${source}.skill_registry VALUES($1,'publish')`,[skill]);
  await installScratchIdentities(db,{schema,sourceSchema:source});
});
afterEach(async()=>{try{if(db){await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${source} CASCADE`);}}
  finally{db?.release();await pool?.end();db=null;}});

it('来源位置可迁移，逻辑UUID不变；同来源和整数采集ID不能映射两个身份',async()=>{
  await db.query(`INSERT INTO ${schema}.agent_identities(id,display_name) VALUES($1,'销售')`,[agent]);
  const first=(await db.query(`INSERT INTO ${schema}.agent_identity_links(identity_id,ops_agent_id,source,host_alias,source_agent_id,evidence,verified_by)
    VALUES($1,1,'openclaw','m1','sales',$2,'codex') RETURNING id`,[agent,{config:'fixture'}])).rows[0].id;
  await expect(db.query(`INSERT INTO ${schema}.agent_identity_links(identity_id,ops_agent_id,source,host_alias,source_agent_id,evidence,verified_by)
    VALUES($1,1,'openclaw','m1','sales',$2,'codex')`,[agent,{config:'duplicate'}])).rejects.toMatchObject({code:'23505'});
  await db.query(`UPDATE ${schema}.agent_identity_links SET active=false WHERE id=$1`,[first]);
  await db.query(`INSERT INTO ${schema}.agent_identity_links(identity_id,ops_agent_id,source,host_alias,source_agent_id,evidence,verified_by)
    VALUES($1,2,'openclaw','m4','sales',$2,'codex')`,[agent,{move:'m1 to m4'}]);
  await db.query(`UPDATE ${schema}.agent_identities SET display_name='销售新版' WHERE id=$1`,[agent]);
  expect((await db.query(`SELECT identity_id FROM ${schema}.agent_identity_links ORDER BY created_at`)).rows.map(r=>r.identity_id)).toEqual([agent,agent]);
  expect((await db.query(`SELECT count(*)::int n FROM ${schema}.identity_link_events`)).rows[0].n).toBe(3);
  await expect(db.query(`INSERT INTO ${schema}.agent_identity_links(identity_id,ops_agent_id,source,host_alias,source_agent_id,evidence,verified_by)
    VALUES($1,3,'launchd','m4','tick',$2,'codex')`,[agent,{bad:'not an Agent'}])).rejects.toMatchObject({code:'23514'});
});

it('Skill源版本有真实FK、固定commit、内容摘要；幂等且不能修改删除',async()=>{
  const manifest=[{path:'SKILL.md',sha256:'a'.repeat(64)},{path:'scripts/run.sh',sha256:'b'.repeat(64)}];
  const insert=`INSERT INTO ${schema}.skill_source_versions(skill_id,source_repo,source_path,source_commit,manifest,actor)
    VALUES($1,'owner/repo','skills/publish','${'c'.repeat(40)}',$2,'codex') ON CONFLICT DO NOTHING RETURNING id`;
  const id=(await db.query(insert,[skill,JSON.stringify(manifest)])).rows[0].id;
  expect((await db.query(insert,[skill,JSON.stringify(manifest)])).rows).toHaveLength(0);
  await expect(db.query(insert,[skill,JSON.stringify([...manifest.slice(0,1),{path:'scripts/run.sh',sha256:'d'.repeat(64)}])])).rejects.toMatchObject({code:'23514'});
  expect((await db.query(insert,[skill,JSON.stringify([...manifest,{path:'assets/icon.png',sha256:'d'.repeat(64)}])])).rows).toHaveLength(1);
  await expect(db.query(insert,[randomUUID(),JSON.stringify(manifest)])).rejects.toMatchObject({code:'23503'});
  await expect(db.query(`UPDATE ${schema}.skill_source_versions SET source_commit='${'f'.repeat(40)}' WHERE id=$1`,[id])).rejects.toMatchObject({code:'P0001'});
  await expect(db.query(`DELETE FROM ${schema}.skill_source_versions WHERE id=$1`,[id])).rejects.toMatchObject({code:'P0001'});
  await expect(db.query(`INSERT INTO ${schema}.skill_source_versions(skill_id,source_repo,source_path,source_commit,manifest,actor)
    VALUES($1,'owner/repo','skills/publish','main',$2,'codex')`,[skill,JSON.stringify(manifest)])).rejects.toMatchObject({code:'23514'});
});

it('同名只是unresolved候选；verified必须有证据，旧generation不变',async()=>{
  await db.query(`INSERT INTO ${schema}.legacy_skill_links(old_ops_skill_id,candidate_skill_ids) VALUES(1,$1)`,[JSON.stringify([skill])]);
  expect((await db.query(`SELECT skill_id,resolution_state FROM ${schema}.legacy_skill_links`)).rows[0]).toEqual({skill_id:null,resolution_state:'unresolved'});
  await expect(db.query(`UPDATE ${schema}.legacy_skill_links SET skill_id=$1,resolution_state='verified' WHERE old_ops_skill_id=1`,[skill])).rejects.toMatchObject({code:'23514'});
  await db.query(`UPDATE ${schema}.legacy_skill_links SET skill_id=$1,resolution_state='verified',evidence=$2,
    verified_by='codex',verified_at=now() WHERE old_ops_skill_id=1`,[skill,{repo:'owner/repo',path:'skills/publish',purpose:'confirmed'}]);
  expect((await db.query(`SELECT count(*)::int n FROM ${source}.ops_skill_versions`)).rows[0].n).toBe(2);
  expect((await db.query(`SELECT count(*)::int n FROM ${schema}.skill_source_versions`)).rows[0].n).toBe(0);
  expect((await db.query(`SELECT count(*)::int n FROM ${schema}.identity_link_events WHERE object_kind='skill'`)).rows[0].n).toBe(2);
  await expect(db.query(`DELETE FROM ${schema}.identity_link_events`)).rejects.toMatchObject({code:'P0001'});
  expect((await installScratchIdentities(db,{schema,sourceSchema:source})).created).toBe(false);
});

it('仅scratch可安装，不存在的源表导致整批回滚',async()=>{
  await expect(installScratchIdentities({query:async()=>({rows:[{name:'cecelia'}]})})).rejects.toMatchObject({code:'SCRATCH_REQUIRED'});
  const bad=`identity_bad_${randomUUID().replaceAll('-','')}`;
  await expect(installScratchIdentities(db,{schema:bad,sourceSchema:'does_not_exist'})).rejects.toBeDefined();
  expect((await db.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[bad])).rows).toHaveLength(0);
});

it('空类型、其他来源和非有效的错误链接也不能冒作Agent；来源和UUID不能改写',async()=>{
  await db.query(`INSERT INTO ${schema}.agent_identities(id,display_name) VALUES($1,'销售')`,[agent]);
  await db.query(`INSERT INTO ${source}.ops_agents VALUES(4,'openclaw','m4','unknown',NULL),(5,'other','m4','external','openclaw_agent')`);
  for(const [id,kind,name,active]of [[4,'openclaw','unknown',true],[5,'other','external',true],[3,'launchd','tick',false]]) {
    await expect(db.query(`INSERT INTO ${schema}.agent_identity_links(identity_id,ops_agent_id,source,host_alias,source_agent_id,evidence,verified_by,active)
      VALUES($1,$2,$3,'m4',$4,'{"fixture":true}','codex',$5)`,[agent,id,kind,name,active])).rejects.toMatchObject({code:'23514'});
  }
  await expect(db.query(`UPDATE ${schema}.agent_identities SET id=$1 WHERE id=$2`,[randomUUID(),agent])).rejects.toMatchObject({code:'23514'});
  await expect(db.query(`DELETE FROM ${schema}.agent_identities WHERE id=$1`,[agent])).rejects.toMatchObject({code:'23514'});
});

it('清单顺序归一，正文、缺SKILL、重复、基路径穿越和文件穿越均拒绝',async()=>{
  const files=[{path:'SKILL.md',sha256:'a'.repeat(64)},{path:'scripts/run.sh',sha256:'b'.repeat(64)}];
  const insert=`INSERT INTO ${schema}.skill_source_versions(skill_id,source_repo,source_path,source_commit,manifest,actor)
    VALUES($1,'owner/repo',$2,'${'c'.repeat(40)}',$3,'codex') ON CONFLICT DO NOTHING RETURNING id`;
  expect((await db.query(insert,[skill,'skills/publish',JSON.stringify(files)])).rows).toHaveLength(1);
  expect((await db.query(insert,[skill,'skills/publish',JSON.stringify([...files].reverse())])).rows).toHaveLength(0);
  for(const root of ['/tmp/a','../outside','a/../outside','C:\\root','a//b']) {
    await expect(db.query(insert,[skill,root,JSON.stringify(files)])).rejects.toMatchObject({code:'23514'});
  }
  for(const manifest of [[...files,files[0]],[files[1]],[{...files[0],content:'plaintext'}],
    [files[0],{path:'../outside',sha256:'b'.repeat(64)}]]) {
    await expect(db.query(insert,[skill,'skills/publish',JSON.stringify(manifest)])).rejects.toMatchObject({code:'23514'});
  }
});

it('映射回滚时事件一起回滚；安装marker冲突不覆盖schema',async()=>{
  await db.query('BEGIN');
  await db.query(`INSERT INTO ${schema}.legacy_skill_links(old_ops_skill_id) VALUES(1)`);
  await db.query('ROLLBACK');
  expect((await db.query(`SELECT count(*)::int n FROM ${schema}.identity_link_events`)).rows[0].n).toBe(0);
  const other=`identity_conflict_${randomUUID().replaceAll('-','')}`;
  try {
    await db.query(`CREATE SCHEMA ${other};CREATE TABLE ${other}.catalog_versions(module text PRIMARY KEY,digest text NOT NULL);
      INSERT INTO ${other}.catalog_versions VALUES('identity-v1','wrong-package')`);
    await expect(installScratchIdentities(db,{schema:other,sourceSchema:source})).rejects.toMatchObject({code:'CATALOG_VERSION_CONFLICT'});
    expect((await db.query('SELECT count(*)::int n FROM pg_tables WHERE schemaname=$1',[other])).rows[0].n).toBe(1);
  } finally {await db.query(`DROP SCHEMA ${other} CASCADE`);}
});


it('两连接旧快照不能登记与已提交固定来源不同的摘要',async()=>{
  const second=await pool.connect();
  const insert=`INSERT INTO ${schema}.skill_source_versions(skill_id,source_repo,source_path,source_commit,manifest,actor)
    VALUES($1,'owner/repo','skills/publish','${'c'.repeat(40)}',$2,'codex')`;
  try {
    await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await second.query(`SELECT count(*) FROM ${schema}.skill_source_versions`);
    await db.query(insert,[skill,JSON.stringify([{path:'SKILL.md',sha256:'a'.repeat(64)}])]);
    await expect(second.query(insert,[skill,JSON.stringify([{path:'SKILL.md',sha256:'b'.repeat(64)}])])).rejects.toMatchObject({code:'25000'});
    await second.query('ROLLBACK');
    expect((await db.query(`SELECT count(*)::int n FROM ${schema}.skill_source_versions`)).rows[0].n).toBe(1);
  } finally {await second.query('ROLLBACK');second.release();}
});
