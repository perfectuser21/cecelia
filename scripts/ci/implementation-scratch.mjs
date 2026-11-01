/** 窄scratch租约；不加载生产pool、注册器或投影器。 */
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DB_DEFAULTS} from '../../packages/brain/src/db-config.js';
import {ciFailure,isImplementationScratchDatabase} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
// journeys 只给旧迁移 511 重放用（它按旧形状读 journeys）；读者读的是 value_streams / capabilities
const TABLES=['areas','schema_version','journeys','value_streams','capabilities','workflows','activities','steps','spans',
  'map_scope_repositories','map_manifest_versions','map_projection_runs','map_projection_nodes','map_projection_edges',
  'skill_registry','graph_edges','graph_snapshot_versions','graph_edge_snapshots','fact_snapshot_headers','activity_cells'];
export async function createImplementationScratch(){
  if(!isImplementationScratchDatabase(DB_DEFAULTS.database))throw ciFailure('SCRATCH_REQUIRED','只允许本机scratch或GitHub Actions隔离test库');
  const client=new pg.Client(DB_DEFAULTS);await client.connect();
  const schema=`implementation_ci_${randomUUID().replaceAll('-','')}`;let schemaCreated=false;
  const db={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release(){}})};
  const close=async()=>{try{if(schemaCreated){await client.query('ROLLBACK');await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}}finally{await client.end();}};
  try{
    const actual=(await client.query('SELECT current_database() name')).rows[0].name;
    if(actual!==DB_DEFAULTS.database||!isImplementationScratchDatabase(actual))throw ciFailure('SCRATCH_REQUIRED');
    await client.query(`CREATE SCHEMA ${schema}`);schemaCreated=true;
    for(const table of TABLES)await client.query(`CREATE TABLE ${schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
    await client.query(`SET search_path TO ${schema}`);
    // 511 回填引用要读迁移 528 已删的 journey_id / step_number（快照来源若是旧形状库，行里还带 enabler_id）：只补在这个隔离 schema 里（511 建的旧指标视图依赖它们，不删），不影响生产库。
    await client.query('ALTER TABLE activities ADD COLUMN journey_id uuid,ADD COLUMN step_number integer,ADD COLUMN enabler_id uuid');
    // 511/513 是旧迁移，按旧名 journey_steps 建外键：重放期间把 activities 临时叫回旧名，之后改回（外键按对象 id 跟随）。
    await client.query('ALTER TABLE activities RENAME TO journey_steps');
    for(const file of ['511_shared_activity_refs.sql','513_definition_versions.sql'])await client.query(readFileSync(new URL(`../../packages/brain/migrations/${file}`,import.meta.url),'utf8'));
    await client.query('ALTER TABLE journey_steps RENAME TO activities');
    return {db,close,schema};
  }catch(error){await close();throw error;}
}
