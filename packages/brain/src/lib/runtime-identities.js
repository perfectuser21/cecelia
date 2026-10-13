import {createHash} from 'node:crypto';
import {auditSkillGitSource} from './skill-git-provenance.js';
import {runtimeIdentitiesSql} from '../../scripts/schema/runtime-identities.mjs';
const quote=value=>{
  if(typeof value!=='string'||!/^[a-z][a-z0-9_]{0,62}$/.test(value))throw Error('非法schema');
  return `"${value}"`;
};

// 只装隔离schema，不从server/migrate启动；schema版本相同而包不同必须拒绝。
export async function installScratchIdentities(db,{schema='runtime',sourceSchema='public'}={}) {
  const database=(await db.query('SELECT current_database() AS name')).rows[0].name;
  if(database!=='cecelia_scratch')throw Object.assign(Error('安装只允许cecelia_scratch'),{code:'SCRATCH_REQUIRED'});
  if(typeof db.release!=='function')throw Object.assign(Error('需要pool.connect()签出的专用Client'),{code:'CLIENT_REQUIRED'});
  const catalog=quote(schema),source=quote(sourceSchema);
  if(schema===sourceSchema)throw Error('原件schema与治理schema必须分开');
  const sql=runtimeIdentitiesSql
    .replaceAll('__catalog__',catalog).replaceAll('__source__',source);
  const digest=createHash('sha256').update(sql).digest('hex');
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout='2500ms'");
    await db.query("SET LOCAL statement_timeout='30000ms'");
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,621))',[`runtime-identities:${schema}`]);
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${catalog}`);
    await db.query(`CREATE TABLE IF NOT EXISTS ${catalog}.catalog_versions(module text PRIMARY KEY,digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`);
    const existing=(await db.query(`SELECT digest FROM ${catalog}.catalog_versions WHERE module='identity-v1'`)).rows[0];
    if(existing) {
      if(existing.digest!==digest)throw Object.assign(Error('安装包与已封存schema版本不一致'),{code:'CATALOG_VERSION_CONFLICT'});
      await db.query('COMMIT');return {schema,source_schema:sourceSchema,digest,created:false,production_migration_applied:false};
    }
    await db.query(sql);
    await db.query(`INSERT INTO ${catalog}.catalog_versions(module,digest) VALUES('identity-v1',$1)`,[digest]);
    await db.query('COMMIT');return {schema,source_schema:sourceSchema,digest,created:true,production_migration_applied:false};
  } catch(error){await db.query('ROLLBACK');throw error;}
}

// 将刚核验的本地Git原件登记到隔离目录；来源不完整时不写入版本表。
export async function registerScratchSkillGitSource(db,{schema='runtime',skillId,sourcePath,actor='codex:git-source'}={}) {
  if((await db.query('SELECT current_database() AS name')).rows[0].name!=='cecelia_scratch')throw Object.assign(Error('登记只允许cecelia_scratch'),{code:'SCRATCH_REQUIRED'});
  if(typeof db.release!=='function')throw Object.assign(Error('需要专用Client'),{code:'CLIENT_REQUIRED'});
  const catalog=quote(schema),proof=auditSkillGitSource({skill_id:skillId,source_path:sourcePath});
  if(proof.status!=='verified')return {...proof,registered:false,production_migration_applied:false};
  const values=[skillId,proof.source_repo,proof.source_path,proof.source_commit,JSON.stringify(proof.manifest),actor];
  const inserted=await db.query(`INSERT INTO ${catalog}.skill_source_versions(skill_id,source_repo,source_path,source_commit,manifest,actor)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,values);
  const row=inserted.rows[0]||(await db.query(`SELECT id FROM ${catalog}.skill_source_versions
    WHERE skill_id=$1 AND source_repo=$2 AND source_path=$3 AND source_commit=$4 AND manifest=$5::jsonb`,values.slice(0,5))).rows[0];
  if(!row)throw Object.assign(Error('已核验来源未能唯一登记'),{code:'SOURCE_REGISTRATION_CONFLICT'});
  return {status:'verified',version_id:row.id,registered:true,created:!!inserted.rows.length,verification_scope:'local_git_installation',remote_revision_verified:false,production_migration_applied:false};
}
