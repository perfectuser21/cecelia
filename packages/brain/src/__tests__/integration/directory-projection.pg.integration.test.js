import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { projectDirectoryPage } from '../../projection/directory-projector.js';
import { loadDirectorySource, buildDirectoryRows } from '../../projection/directory-source.js';
import { configureDirectoryProjection } from '../../projection/directory-config.js';
import { runtimeFixture,uid } from '../../projection/__tests__/directory-runtime.fixture.js';

let client, schema;
beforeEach(async () => {
  if (!(DB_DEFAULTS.database === 'cecelia_scratch' || process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw new Error('仅允许scratch/CI隔离库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  expect((await client.query('SELECT current_database() AS name')).rows[0].name).toBe(DB_DEFAULTS.database);
  schema = `directory_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
  await client.query(`CREATE TABLE projection_links(target text,entity_type text,entity_id uuid,external_id text,content_hash text,
    last_synced_at timestamptz,updated_at timestamptz DEFAULT now(),UNIQUE(target,entity_type,entity_id),UNIQUE(target,external_id));
    CREATE TABLE areas(id uuid,name text,notion_id text);
    CREATE TABLE journeys(id uuid,name text,kind text,area_id uuid,parent_journey_id uuid);
    CREATE TABLE workflows(id uuid,name text,key text,capability_id uuid);
    CREATE TABLE journey_steps(id uuid,name text,workflow_id uuid);
    CREATE TABLE steps(id uuid,key text,activity_id uuid,active boolean,step_order int);
    CREATE TABLE workflow_activity_refs(workflow_id uuid,activity_id uuid,slot_key text,sequence_no int,active boolean);
    CREATE TABLE notion_map_node_pages(scope text,node_key text,notion_id text,archived_at timestamptz);
    CREATE TABLE map_projection_runs(id uuid,scope_key text,status text);
    CREATE TABLE map_projection_nodes(run_id uuid,node_key text,node_type text,name text,attributes jsonb);
    CREATE TABLE projection_targets(target text PRIMARY KEY,enabled boolean,config jsonb,last_success_at timestamptz,last_error text,updated_at timestamptz);
    CREATE TABLE notion_projection_map(notion_db_id text,title text,face text,brain_table text,direction text,vessel text,status text,space text);`);
});
afterEach(async () => { if (client) { await client.query('ROLLBACK'); if (schema) await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); } });
describe('六层目录真实PG边界', () => {
  it('26关系完整分页才写真receipt；坏分页不刷新上次成功hash',async()=>{
    const id=randomUUID(),page=randomUUID(),dbId=randomUUID(),propertyId='relation';
    const relations=Array.from({length:26},()=>({id:randomUUID()}));let current=[],invalid=false;
    const notionReq=async(_t,path,method,body)=>{
      if(path.endsWith('/query'))return{results:[],has_more:false};
      if(path.includes('/properties/')){
        const last=path.includes('start_cursor=next');
        return{object:'list',type:'property_item',property_item:{id:propertyId,type:'relation'},
          results:(last?current.slice(25):current.slice(0,25)).map(relation=>({object:'property_item',id:propertyId,type:'relation',relation})),
          has_more:invalid?undefined:!last,next_cursor:last?null:'next'};
      }
      if(method==='PATCH'||path==='/pages')current=structuredClone(body.properties.Activities.relation);
      return{id:page,parent:{database_id:dbId},properties:{'Brain ID':{rich_text:[{text:{content:id}}]},
        Activities:{id:propertyId,type:'relation',relation:current.slice(0,25),has_more:current.length>25}}};
    };
    const options={token:'test',dbId,row:{id,table:'workflows',allowCreate:true},notionReq,
      properties:{'Brain ID':{rich_text:[{text:{content:id}}]},Activities:{relation:relations}}};
    await projectDirectoryPage(client,options);
    const first=(await client.query('SELECT content_hash,last_synced_at FROM projection_links')).rows;
    expect(first).toHaveLength(1);invalid=true;
    await expect(projectDirectoryPage(client,options)).rejects.toThrow(/分页/);
    expect((await client.query('SELECT content_hash,last_synced_at FROM projection_links')).rows).toEqual(first);
  });
  it('唯一缺库bootstrap读回后原子登记，重复相同请求不新增库',async()=>{
    const f=runtimeFixture(),parent=uid(600);let created=0,badDiscovery=true;
    const tables={areas:'areas',value_streams:'notion_map_node_pages',activities:'journey_steps',workflows:'workflows',steps:'steps'};
    for(const [layer,table] of Object.entries(tables)){
      await client.query("INSERT INTO notion_projection_map(notion_db_id,brain_table,status) VALUES($1,$2,'active')",[f.dbs[layer],table]);
      f.databases.get(f.dbs[layer]).properties={};
    }
    await client.query("INSERT INTO notion_projection_map(notion_db_id,brain_table,status,direction) VALUES('unmapped:capabilities','capabilities','archived','none')");
    const notionReq=async(token,path,method,body)=>{
      if(path.startsWith(`/blocks/${parent}/children`))return{results:created?[{id:f.dbs.capabilities,type:'child_database',child_database:{title:'Capabilities'}}]:[],...(badDiscovery?{}:{has_more:false})};
      if(path==='/databases'){
        created++;f.databases.set(f.dbs.capabilities,{id:f.dbs.capabilities,parent:body.parent,description:body.description,properties:body.properties});
        return{id:f.dbs.capabilities};
      }
      return f.notionReq(token,path,method,body);
    };
    const pool={connect:async()=>({query:client.query.bind(client),release(){}})};
    const input={dbs:{...f.dbs,capabilities:null},parent_page_id:parent};
    await expect(configureDirectoryProjection(pool,input,{token:'test',notionReq})).rejects.toThrow(/分页/);
    expect(created).toBe(0);expect((await client.query('SELECT * FROM projection_targets')).rows).toHaveLength(0);
    badDiscovery=false;
    await configureDirectoryProjection(pool,input,{token:'test',notionReq});
    await configureDirectoryProjection(pool,input,{token:'test',notionReq});
    expect(created).toBe(1);
    expect((await client.query("SELECT * FROM notion_projection_map WHERE brain_table='capabilities' AND status='active'")).rows).toHaveLength(1);
    expect((await client.query("SELECT config FROM projection_targets WHERE target='notion-directory'")).rows[0].config.dbs.capabilities).toBe(f.dbs.capabilities);
  });
  it('认领旧writer链接只新增目录收据，不改其hash/标题',async()=>{
    const id=randomUUID(),page=randomUUID(),dbId=randomUUID();
    await client.query("INSERT INTO projection_links(target,entity_type,entity_id,external_id,content_hash) VALUES('notion','steps',$1,$2,'legacy-hash')",[id,page]);
    let props={'步骤':{title:[{text:{content:'KR · 人工保留'}}]}};
    const notionReq=async(_t,_p,method,body)=>{if(method==='PATCH')Object.assign(props,body.properties);return{id:page,parent:{database_id:dbId},properties:structuredClone(props)};};
    const row={id,table:'steps',allowCreate:true,createProperties:{'步骤':{title:[{text:{content:'新标题'}}]}}};
    await projectDirectoryPage(client,{token:'test',dbId,row,properties:{'Brain ID':{rich_text:[{text:{content:id}}]}},notionReq});
    expect(props['步骤'].title[0].text.content).toBe('KR · 人工保留');
    expect((await client.query("SELECT content_hash FROM projection_links WHERE target='notion'")).rows[0].content_hash).toBe('legacy-hash');
    expect((await client.query("SELECT * FROM projection_links WHERE target='notion-directory'")).rows).toHaveLength(1);
  });
  it('单快照读取真实refs，两流程共享同活动和step，未部署版本schema也能读取', async () => {
    const w1=randomUUID(),w2=randomUUID(),a=randomUUID(),s=randomUUID();
    await client.query(`INSERT INTO workflows VALUES($1,'A','a',NULL),($2,'B','b',NULL);
      `,[w1,w2]);
    await client.query('INSERT INTO journey_steps VALUES($1,\'共享\',$2)',[a,w1]);
    await client.query('INSERT INTO steps VALUES($1,\'one\',$2,true,1)',[s,a]);
    await client.query('INSERT INTO workflow_activity_refs VALUES($1,$3,\'first\',1,true),($2,$3,\'second\',2,true)',[w1,w2,a]);
    const rows=buildDirectoryRows(await loadDirectorySource(client));
    expect(rows.find(r=>r.id===s).relations['所属Workflows'].map(x=>x.id).sort()).toEqual([w1,w2].sort());
    expect((await client.query('SELECT count(*)::int AS n FROM journey_steps')).rows[0].n).toBe(1);
  });
  it('读回失败不写真实成功receipt；第二次成功认领同页且不重建', async () => {
    const id=randomUUID(),page=randomUUID(),dbId=randomUUID(); let broken=true,created=0,props;
    const notionReq=async (_t,path,method,body)=>{
      if(path.endsWith('/query'))return {results:props?[{id:page,parent:{database_id:dbId},properties:props}]:[],has_more:false};
      if(path==='/pages'){created++;props=body.properties;return{id:page};}
      if(method==='PATCH')props=body.properties;
      return {id:page,parent:{database_id:dbId},properties:broken?{...props,Activities:{relation:[]}}:props};
    };
    const row={id,table:'workflows',allowCreate:true};
    const properties={'Brain ID':{rich_text:[{text:{content:id}}]},Activities:{relation:[{id:randomUUID()}]}};
    await expect(projectDirectoryPage(client,{token:'test',dbId,row,properties,notionReq})).rejects.toThrow(/读回/);
    expect((await client.query('SELECT * FROM projection_links')).rows).toHaveLength(0);
    broken=false; await projectDirectoryPage(client,{token:'test',dbId,row,properties,notionReq});
    const links=(await client.query('SELECT * FROM projection_links')).rows;
    expect(links).toHaveLength(1);expect(links[0].external_id).toBe(page);expect(created).toBe(1);
  });
});
