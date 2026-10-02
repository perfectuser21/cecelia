import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { implementationImpactDatabase,IMPACT_REPO } from './implementation-impact-db.js';
import { buildPilotManifest } from '../../../../../scripts/map/register-capability-pilots.mjs';

/** 两个真实连接竞争同一契约版本；屏障仅控制远端读取及提交后的main回读。 */
export async function implementationRefreshDatabase({manifestRevision='a'.repeat(40)}={}){
 const f=await implementationImpactDatabase({scope:'zenithjoy',registryRepo:'zenithjoy-pilot-source',seedIds:{
  valueStream:'afa6abca-53c0-4815-8594-b7fb81ca547f',keywordCapability:'a1000000-0000-4000-8000-000000000001',
  benchmarkCapability:'a1000000-0000-4000-8000-000000000002',keyword:'b1000000-0000-4000-8000-000000000001',benchmark:'b1000000-0000-4000-8000-000000000002'}});
 let pool,releaseWinner;
 try{
  const schema=(await f.db.query('SELECT current_schema() name')).rows[0].name;
  pool=new pg.Pool({...DB_DEFAULTS,max:4,options:`-c search_path=${schema}`});
  for(const table of ['decisions','map_projection_edges','fact_snapshot_headers','graph_edges','journey_features','test_registry','api_registry','db_schema_registry','journey_assertion_receipts'])await pool.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
  const row=(await pool.query('SELECT * FROM map_manifest_versions')).rows[0];
  await pool.query('INSERT INTO decisions(id) VALUES($1)',[row.source_decision_id]);
  await pool.query('UPDATE map_manifest_versions SET manifest=$1',[buildPilotManifest('phones',{revision:manifestRevision,decision:row.source_decision_id})]);
  const revision='b'.repeat(40),query={scope:'zenithjoy',repo:IMPACT_REPO,revision};
  f.contracts.docs.keyword_acquisition.activities[0].implementation_bindings[0].revision=revision;f.contracts.refresh();
  let readers=0,releaseReaders,arrived,mainRevision=revision,readTransactions=0,afterRead;
  const bothReading=new Promise(r=>releaseReaders=r),atWindow=new Promise(r=>arrived=r),resume=new Promise(r=>releaseWinner=r);
  const connect=pool.connect.bind(pool);
  const db={query:pool.query.bind(pool),connect:async()=>{const c=await connect();let readonly=false;return {query:async(sql,...args)=>{
   if(sql==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'){readTransactions++;readonly=true;}
   const result=await c.query(sql,...args);if(readonly&&sql==='COMMIT')afterRead?.();return result;
  },release:()=>c.release()};}};
  // 每次options对应一个HTTP调用，避免同一个闭包把两个请求的main检查混在一起。
  const options=({waitMs=1000,error}={})=>{let heads=0;return {conflictWaitMs:waitMs,resolveToken:async()=>'',readBinding:async()=> 'export const controller=true;\n',fetchFn:async(...args)=>{
   const url=String(args[0]);
   if(url.includes('/commits/main')){if(++heads===4){arrived();await resume;}return {ok:true,text:async()=>mainRevision};}
   if(url.includes('/contents/product-map/generated/contracts.json')){if(error)throw error;if(++readers===2)releaseReaders();await bothReading;}
   return f.contracts.fetchFn(...args);
  }};};
  return {db,query,options,atWindow,release:()=>releaseWinner(),setMain:value=>{mainRevision=value;},
   onRead:callback=>{afterRead=callback;},
   stats:()=>({contractReads:readers,readTransactions}),
   async close(){releaseWinner();await pool.end();await f.close();}};
 }catch(error){releaseWinner?.();await pool?.end();await f.close();throw error;}
}
