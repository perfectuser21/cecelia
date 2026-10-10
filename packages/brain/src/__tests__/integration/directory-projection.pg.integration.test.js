import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { projectDirectoryPage, runDirectoryProjection } from '../../projection/directory-projector.js';
import { loadDirectorySource, buildDirectoryRows } from '../../projection/directory-source.js';
import { configureDirectoryProjection } from '../../projection/directory-config.js';
import { runtimeFixture,fixtureEntityId } from '../../projection/__tests__/directory-runtime.fixture.js';

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
    CREATE TABLE value_streams(id uuid,name text,kind text,area_id uuid,parent_journey_id uuid);
    CREATE TABLE capabilities(id uuid,name text,kind text,area_id uuid,parent_journey_id uuid);
    CREATE TABLE workflows(id uuid,name text,key text,capability_id uuid);
    CREATE TABLE ops_schedule_entries(workflow_id uuid,label text,schedule_desc text,enabled boolean,last_status text,last_run_at timestamptz,source text);
    CREATE TABLE v_workflow_run_stats(workflow_id uuid,time_window text,runs int,failed int,success_rate numeric,avg_duration_ms int,last_started_at timestamptz);
    CREATE TABLE workflow_definition_versions(id uuid,workflow_id uuid,payload jsonb,source_repo text,source_path text,source_commit text,created_at timestamptz);
    CREATE TABLE activity_definition_versions(id uuid,activity_id uuid,payload jsonb,source_repo text,source_path text,source_commit text);
    CREATE TABLE activities(id uuid,name text,workflow_id uuid);
    CREATE TABLE steps(id uuid,key text,activity_id uuid,active boolean,step_order int);
    CREATE TABLE workflow_activity_refs(workflow_id uuid,activity_id uuid,slot_key text,sequence_no int,active boolean);
    CREATE TABLE activity_cells(step_id uuid,cell_key text,cell_status text,parent_cell_key text);
    CREATE TABLE warehouse_items(id uuid,name text);
    CREATE TABLE activity_uses(activity_id uuid,item_id uuid,role text);
    CREATE TABLE activity_judgments(id bigint GENERATED ALWAYS AS IDENTITY,activity_id uuid,verdict text,consecutive_green int,required_green int,judged_at timestamptz);
    CREATE TABLE notion_map_node_pages(scope text,node_key text,notion_id text,archived_at timestamptz);
    CREATE TABLE map_projection_runs(id uuid,scope_key text,status text);
    CREATE TABLE map_projection_nodes(run_id uuid,node_key text,node_type text,name text,attributes jsonb);
    CREATE TABLE projection_targets(target text PRIMARY KEY,enabled boolean,config jsonb,last_success_at timestamptz,last_error text,updated_at timestamptz);
    CREATE TABLE notion_projection_map(notion_db_id text,title text,face text,brain_table text,direction text,vessel text,status text,space text);`);
});
afterEach(async () => { if (client) { await client.query('ROLLBACK'); if (schema) await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); } });
describe('六层目录真实PG边界', () => {
  it('目录源载入 Activity 的 8 格状态与用料，供 Notion 卡片列使用', async () => {
    const activity=fixtureEntityId(860),item=fixtureEntityId(861),workflow=fixtureEntityId(862);
    await client.query('ALTER TABLE activities ADD COLUMN current_definition_version_id uuid, ADD COLUMN capability_key text, ADD COLUMN activity_key text');
    await client.query("INSERT INTO activities(id,name,workflow_id,capability_key,activity_key) VALUES($1,'采集',$2,'cap','act')",[activity,workflow]);
    await client.query("INSERT INTO activity_cells VALUES($1,'promise','green',NULL),($1,'readback.net','red','readback')",[activity]);
    await client.query("INSERT INTO warehouse_items VALUES($1,'设备锁')",[item]);
    await client.query("INSERT INTO activity_uses VALUES($1,$2,'uses')",[activity,item]);
    const source=await loadDirectorySource(client);
    expect(source.cells).toEqual([{step_id:activity,cell_key:'promise',cell_status:'green',parent_cell_key:null},{step_id:activity,cell_key:'readback.net',cell_status:'red',parent_cell_key:'readback'}]);
    expect(source.uses).toEqual([{activity_id:activity,item_name:'设备锁',role:'uses'}]);
  });
  it('目录源每个 Activity 只带最新一条裁判，Activity 行写出「裁判结论」（任务 f6ad056e）', async () => {
    const activity=fixtureEntityId(870),workflow=fixtureEntityId(871);
    await client.query('ALTER TABLE activities ADD COLUMN current_definition_version_id uuid, ADD COLUMN capability_key text, ADD COLUMN activity_key text');
    await client.query("INSERT INTO activities(id,name,workflow_id,capability_key,activity_key) VALUES($1,'判定',$2,'cap','judge')",[activity,workflow]);
    await client.query(`INSERT INTO activity_judgments(activity_id,verdict,consecutive_green,required_green,judged_at) VALUES
      ($1,'diverged',0,3,'2026-10-09T00:00:00Z'),($1,'converging',2,3,'2026-10-10T00:00:00Z')`,[activity]);
    const source=await loadDirectorySource(client);
    expect(source.judgments).toHaveLength(1);
    expect(source.judgments[0]).toMatchObject({activity_id:activity,verdict:'converging',consecutive_green:2,required_green:3});
    const row=buildDirectoryRows(source).find(r=>r.id===activity);
    expect(row.properties['裁判结论'].rich_text[0].text.content).toBe('收敛中 · 连续绿 2/3');
  });
  it('真PG精确current Activity/Step登记读取声明；历史、错step、注册漂移拒映射，未登记仅父gap', async () => {
    const activity=fixtureEntityId(850),step=fixtureEntityId(851),version=fixtureEntityId(852),history=fixtureEntityId(853),workflow=fixtureEntityId(854);
    await client.query('ALTER TABLE activities ADD COLUMN current_definition_version_id uuid');
    await client.query('ALTER TABLE steps ADD COLUMN source_sha256 text, ADD COLUMN mode text, ADD COLUMN readback jsonb');
    const readback={type:'metric',expect:{op:'==',value:1}},sha='b'.repeat(64);
    await client.query("INSERT INTO activities VALUES($1,'共享',$2,$3)",[activity,workflow,version]);
    await client.query("INSERT INTO workflow_activity_refs VALUES($1,$2,'read',1,true)",[workflow,activity]);
    await client.query("INSERT INTO steps VALUES($1,'cap.stage.read',$2,true,1,$3,'checkpoint',$4)",[step,activity,sha,readback]);
    const declared={key:'read',reads:['Device.serial'],writes:['Device.ready'],check:'设备应已就绪',implementation:{status:'implemented',ref:'runner.sh read'},
      dod:{mode:'checkpoint',readback:{type:'metric',expect:{op:'==',value:1}}}};
    const entry={step_id:step,locator:{activity_id:activity,step_key:'read'},contract:declared,
      registration:{id:step,key:'cap.stage.read',step_order:1,mode:'checkpoint',readback,source_sha256:sha}};
    const payload={activity_id:activity,contract:{},steps:[entry,{step_id:null,locator:{activity_id:activity,step_key:'unregistered'},contract:{key:'unregistered'},registration:null}],
      implementation_bindings:[{scope:'activity',status:'verified'},{scope:'step',step_key:'read',kind:'raw',status:'unresolved'}]};
    await client.query('INSERT INTO activity_definition_versions(id,activity_id,payload) VALUES($1,$2,$3),($4,$2,$5)',
      [version,activity,payload,history,{...payload,steps:[{...entry,contract:{...declared,implementation:'历史实现'}}]}]);
    const rows=buildDirectoryRows(await loadDirectorySource(client)),row=rows.find(r=>r.id===step);
    const txt=(r,k)=>r.properties[k].rich_text.map(x=>x.text.content).join('');
    expect(txt(row,'输入')).toBe('Device.serial');
    expect(txt(row,'还缺什么')).toContain('实现未核验');expect(row.definitionVersion.id).toBe(version);
    expect(txt(rows.find(r=>r.id===activity),'还缺什么')).toContain('Step 登记对不上：unregistered');
    expect(rows.filter(r=>r.layer==='steps')).toHaveLength(1);
    const page=fixtureEntityId(855),dbId=fixtureEntityId(856);let properties;
    const notionReq=async(_token,path,method,body)=>{
      if(path.endsWith('/query'))return{results:[],has_more:false};
      if(path==='/pages'||method==='PATCH')properties=structuredClone(body.properties);
      return{id:page,parent:{database_id:dbId},properties:structuredClone(properties)};
    };
    await projectDirectoryPage(client,{token:'test',dbId,row,properties:row.properties,notionReq});
    expect((await client.query('SELECT external_id FROM projection_links WHERE entity_id=$1',[step])).rows).toEqual([{external_id:page}]);
    await client.query('UPDATE steps SET source_sha256=$2 WHERE id=$1',[step,'c'.repeat(64)]);
    const stale=buildDirectoryRows(await loadDirectorySource(client));
    expect(txt(stale.find(r=>r.id===step),'还缺什么')).toContain('实现没登记');
    expect(txt(stale.find(r=>r.id===activity),'还缺什么')).toContain('Step 登记对不上：read');
    await client.query('UPDATE steps SET source_sha256=$2 WHERE id=$1',[step,sha]);
    for(const change of [{...payload,steps:[{...entry,step_id:fixtureEntityId(999)}]}, {...payload,activity_id:fixtureEntityId(999)}]) {
      await client.query('UPDATE activity_definition_versions SET payload=$2 WHERE id=$1',[version,change]);
      expect(txt(buildDirectoryRows(await loadDirectorySource(client)).find(r=>r.id===step),'还缺什么')).toContain('实现没登记');
    }
  });
  it('单SQL只读当前复合身份版本与 runs 7 天统计并写读回落receipt；较新历史/错对象不能冒充当前', async () => {
    const current=fixtureEntityId(801),historical=fixtureEntityId(802),wrong=fixtureEntityId(803);
    const workflows=[fixtureEntityId(811),fixtureEntityId(812)];
    await client.query('ALTER TABLE workflows ADD COLUMN current_definition_version_id uuid');
    await client.query("INSERT INTO workflows VALUES($1,'关键词','keyword',NULL,$3),($2,'错指针','wrong',NULL,$4)",[...workflows,current,wrong]);
    const insertVersion=async(id,workflowId,time)=>client.query('INSERT INTO workflow_definition_versions VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id,workflowId,{workflow_id:workflowId,contract:{}},'perfectuser21/zenithjoy-workspace','product-map/contracts/keyword_acquisition.yaml','a'.repeat(40),time]);
    await insertVersion(current,workflows[0],'2026-10-01');
    await insertVersion(historical,workflows[0],'2026-10-02');
    await insertVersion(wrong,workflows[0],'2026-10-03');
    await client.query("INSERT INTO v_workflow_run_stats VALUES($1,'7d',137,3,0.9781,12345,'2026-10-06T09:40:10Z'),($1,'24h',20,0,1,1000,'2026-10-06T09:40:10Z')",[workflows[0]]);
    let queries=0;
    const source=await loadDirectorySource({query:async(...args)=>{queries++;return client.query(...args);}});
    expect(queries).toBe(1);
    const rows=buildDirectoryRows(source),row=rows.find(r=>r.id===workflows[0]);
    expect(row.definitionVersion.id).toBe(current);
    expect(rows.find(r=>r.id===workflows[1]).definitionVersion).toBeNull();
    expect(row.properties['7天次数']).toEqual({number:137});
    expect(row.properties['7天成功率']).toEqual({number:0.9781});
    expect(row.properties['平均时长']).toEqual({rich_text:[{text:{content:'12.3 秒'}}]});
    expect(row.properties['运行情况']).toEqual({select:{name:'在跑'}});
    const page=fixtureEntityId(820),dbId=fixtureEntityId(821);let properties;
    const notionReq=async(_token,path,method,body)=>{
      if(path.endsWith('/query'))return{results:[],has_more:false};
      if(path==='/pages'||method==='PATCH')properties=structuredClone(body.properties);
      return{id:page,parent:{database_id:dbId},properties:structuredClone(properties)};
    };
    await projectDirectoryPage(client,{token:'test',dbId,row,properties:row.properties,notionReq});
    expect(properties['7天次数']).toEqual({number:137});
    expect((await client.query("SELECT entity_id,external_id FROM projection_links WHERE target='notion-directory'")).rows)
      .toEqual([{entity_id:workflows[0],external_id:page}]);
  });
  it('真运行落PG成功receipt；正文同步出错只记在结果里，不算目录失败', async () => {
    const f = runtimeFixture();
    const config = { ...f.config, value_stream_bindings: [] };
    await client.query('CREATE TABLE working_memory(key text PRIMARY KEY,value_json jsonb,updated_at timestamptz)');
    await client.query('INSERT INTO areas VALUES($1,$2,$3)', [fixtureEntityId(21), '组织', fixtureEntityId(41)]);
    await client.query("INSERT INTO projection_targets(target,enabled,config) VALUES('notion-directory',true,$1)", [config]);
    const pool = { connect: async () => ({ query: client.query.bind(client), release() {} }) };
    const result = await runDirectoryProjection(pool, { token: 'test', notionReq: f.notionReq, force: true, bodies: async () => { throw new Error('正文失败'); } });
    const receipts = (await client.query("SELECT entity_id,external_id FROM projection_links WHERE target='notion-directory'")).rows;
    const target = (await client.query("SELECT last_success_at,last_error FROM projection_targets WHERE target='notion-directory'")).rows[0];
    expect(result).toMatchObject({ failed: 0, synced: 1, body: { error: '正文失败' } });
    expect(receipts).toEqual([{ entity_id: fixtureEntityId(21), external_id: fixtureEntityId(41) }]);
    expect(target.last_success_at).not.toBeNull();
    expect(target.last_error).toBeNull();
  });
  it('真SQL反序persist同一共享refs后页面不重PATCH，成功receipt hash保持', async () => {
    const w1=fixtureEntityId(701),w2=fixtureEntityId(702),activity=fixtureEntityId(703),page=fixtureEntityId(704),dbId=fixtureEntityId(705);
    await client.query("INSERT INTO workflows VALUES($1,'A','a',NULL),($2,'B','b',NULL)", [w1,w2]);
    await client.query("INSERT INTO activities VALUES($1,'共享',$2)", [activity,w1]);
    const persist = async ids => {
      await client.query('DELETE FROM workflow_activity_refs');
      for (const id of ids) await client.query("INSERT INTO workflow_activity_refs VALUES($1,$2,'same',1,true)", [id,activity]);
    };
    let props, writes=0;
    const notionReq = async (_token,path,method,body) => {
      if (path.endsWith('/query')) return { results: [], has_more: false };
      if (path === '/pages' || method === 'PATCH') { writes++; props=structuredClone(body.properties); }
      return { id: page, parent: { database_id: dbId }, properties: structuredClone(props) };
    };
    await persist([w2,w1]);
    const firstSource=await loadDirectorySource(client);
    expect(firstSource.refs.map(r=>r.workflow_id)).toEqual([w2,w1]);
    const first=buildDirectoryRows(firstSource).find(r=>r.id===activity);
    await projectDirectoryPage(client,{token:'test',dbId,row:first,properties:first.properties,notionReq});
    const receipt=(await client.query('SELECT entity_id,external_id,content_hash FROM projection_links')).rows;
    expect(receipt).toHaveLength(1);expect(writes).toBe(1);
    await persist([w1,w2]);
    const secondSource=await loadDirectorySource(client);
    expect(secondSource.refs.map(r=>r.workflow_id)).toEqual([w1,w2]);
    const second=buildDirectoryRows(secondSource).find(r=>r.id===activity);
    await projectDirectoryPage(client,{token:'test',dbId,row:second,properties:second.properties,notionReq});
    expect(writes).toBe(1);
    expect(second.properties).toEqual(first.properties);
    expect((await client.query('SELECT entity_id,external_id,content_hash FROM projection_links')).rows).toEqual(receipt);
  });
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
    const f=runtimeFixture(),parent=fixtureEntityId(600);let created=0,badDiscovery=true;
    const tables={areas:'areas',value_streams:'notion_map_node_pages',activities:'activities',workflows:'workflows',steps:'steps'};
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
  it('单快照读取真实refs，两流程共享同活动和step，旧行无current版本列也能读取', async () => {
    const w1=randomUUID(),w2=randomUUID(),a=randomUUID(),s=randomUUID();
    await client.query(`INSERT INTO workflows VALUES($1,'A','a',NULL),($2,'B','b',NULL);
      `,[w1,w2]);
    await client.query('INSERT INTO activities VALUES($1,\'共享\',$2)',[a,w1]);
    await client.query('INSERT INTO steps VALUES($1,\'one\',$2,true,1)',[s,a]);
    await client.query('INSERT INTO workflow_activity_refs VALUES($1,$3,\'first\',1,true),($2,$3,\'second\',2,true)',[w1,w2,a]);
    const rows=buildDirectoryRows(await loadDirectorySource(client));
    expect(rows.find(r=>r.id===a).relations['所属流程'].map(x=>x.id).sort()).toEqual([w1,w2].sort());
    expect(rows.find(r=>r.id===s).relations['所属Activity'].map(x=>x.id)).toEqual([a]);
    expect((await client.query('SELECT count(*)::int AS n FROM activities')).rows[0].n).toBe(1);
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
