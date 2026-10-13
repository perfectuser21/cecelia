import {createHash} from 'node:crypto';
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
