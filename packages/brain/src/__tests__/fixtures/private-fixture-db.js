import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {DB_DEFAULTS} from '../../db-config.js';
export function assertPrivateFixtureTarget() {
 const ci=process.env.CI==='true';
 if(DB_DEFAULTS.database!=='cecelia_scratch'&&!(ci&&DB_DEFAULTS.database==='cecelia_test'))throw Error('仅允许scratch/CI测试库');
 if(!ci&&DB_DEFAULTS.host!=='/tmp')throw Error('本地fixture只允许/tmp PostgreSQL');
}
export async function privateFixtureDatabase(prefix,setup) {
 assertPrivateFixtureTarget();if(!/^[a-z]+$/.test(prefix))throw Error('fixture_prefix_invalid');
 const schema=`${prefix}_${randomUUID().replaceAll('-','')}`;
 const admin=new pg.Client(DB_DEFAULTS);let client,created=false,closed=false;const pools=[];
 async function close(){
  if(closed)return;closed=true;
  try{if(client)await client.query('ROLLBACK');}
  finally{try{for(const pool of pools)await pool.end();if(client)await client.end();}
   finally{try{if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}}
 }
 try{
  await admin.connect();
  if((await admin.query('SELECT current_database() AS name')).rows[0]?.name!==DB_DEFAULTS.database)throw Error('数据库身份不匹配');
  await admin.query(`CREATE SCHEMA ${schema}`);created=true;
  client=new pg.Client({...DB_DEFAULTS,options:`-c search_path=${schema}`});await client.connect();
  await client.query(`SET search_path TO ${schema}`);
  const identity=(await client.query('SELECT current_database() AS name,current_schema() AS schema')).rows[0];
  if(identity?.name!==DB_DEFAULTS.database||identity?.schema!==schema)throw Error('私有schema身份不匹配');
  await setup(client);
  const db={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release(){}})};
  return {schema,client,db,close,createPool(max){const pool=new pg.Pool({...DB_DEFAULTS,max,options:`-c search_path=${schema}`});pools.push(pool);return pool;}};
 }catch(error){try{await close();}catch(cleanup){error.cleanup=cleanup;}throw error;}
}
