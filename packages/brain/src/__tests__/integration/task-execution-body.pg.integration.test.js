import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import {DB_DEFAULTS} from '../../db-config.js';
import {syncTaskExecutionBodies,queueTaskExecutionBodies} from '../../projection/task-execution-body.js';
let admin,pool,writer,schema;
const DB='44444444-4444-4444-8444-444444444444',W='22222222-2222-4222-8222-222222222222',WP='55555555-5555-4555-8555-555555555555';
const tasks=new Map(),blocks=new Map();let n;
beforeEach(async()=>{
 if(!(DB_DEFAULTS.database==='cecelia_scratch'||process.env.CI==='true'&&DB_DEFAULTS.database==='cecelia_test'))throw Error('仅scratch/CI隔离库');
 admin=new pg.Client(DB_DEFAULTS);await admin.connect();schema='taskbody_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 pool=new pg.Pool({...DB_DEFAULTS,max:1,options:`-c search_path=${schema} -c jit=off`});writer=new pg.Pool({...DB_DEFAULTS,max:1,options:`-c search_path=${schema} -c jit=off`});
 await pool.query(`CREATE TABLE tasks(id uuid PRIMARY KEY,title text,notion_id text,payload jsonb);
 CREATE TABLE workflows(id uuid PRIMARY KEY,name text);
 CREATE TABLE task_runs(task_id uuid,run_id text,workflow_id uuid,context jsonb,status text,notion_id text,started_at timestamptz);
 CREATE TABLE projection_links(target text,entity_type text,entity_id uuid,external_id text);
 CREATE TABLE working_memory(key text PRIMARY KEY,value_json jsonb,updated_at timestamptz);`);
 await pool.query("INSERT INTO workflows VALUES($1,'正式流程')",[W]);tasks.clear();blocks.clear();n=0;
});
afterEach(async()=>{await pool?.end();await writer?.end();if(admin){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}});
async function task(){const id=randomUUID(),page=randomUUID();await pool.query('INSERT INTO tasks VALUES($1,$2,$3,$4)',[id,'Task',page,{workflow_id:W}]);tasks.set(page,id);return{id,page};}
async function workflowPage(){await pool.query("INSERT INTO projection_links VALUES('notion-directory','workflows',$1,$2)",[W,WP]);}
function request(onPage=async()=>{}){return async(token,path,method='GET',body)=>{
 if(path.startsWith('/pages/')){const page=path.split('/')[2];await onPage(page);return{id:page,parent:{database_id:DB},properties:{Description:{rich_text:[{plain_text:'script_run · brain:'+tasks.get(page)}]}}};}
 const m=path.match(/^\/blocks\/([^/?]+)\/children/);if(m&&method==='GET')return{results:blocks.get(m[1])||[],has_more:false};
 if(m&&method==='PATCH'){const kids=body.children.map(b=>{const id='block-'+(++n);blocks.set(id,b[b.type].children||[]);return{...b,id};});blocks.set(m[1],[...(blocks.get(m[1])||[]),...kids]);return{results:kids};}
 if(method==='DELETE'){for(const [id,kids]of blocks)blocks.set(id,kids.filter(b=>b.id!==path.split('/').at(-1)));return{};}
 throw Error('unexpected '+method+' '+path);
};}
const opts=(req,ids=[])=>({token:'fixture',notionReq:req,taskIds:ids,taskDbId:DB,deadline:Date.now()+8000});
const pending=async()=>Number((await pool.query("SELECT count(*) FROM working_memory WHERE key LIKE 'task_execution_body_pending:%'")).rows[0].count);
describe('Task正文真实PG元数据与完整attempt源',()=>{
 it('Run页晚到从持久待办恢复全部attempt，不改Task',async()=>{const t=await task();await workflowPage();for(let i=1;i<=2;i++)await pool.query("INSERT INTO task_runs VALUES($1,$2,$3,'{}','failed',NULL,now())",[t.id,'actual-a'+i,W]);const req=request();expect(await syncTaskExecutionBodies(pool,opts(req,[t.id]))).toMatchObject({synced:1,pending:1});for(let i=1;i<=2;i++)await pool.query('UPDATE task_runs SET notion_id=$1 WHERE run_id=$2',[randomUUID(),'actual-a'+i]);expect(await syncTaskExecutionBodies(pool,opts(req))).toMatchObject({synced:1,pending:0});expect(await pending()).toBe(0);expect(JSON.stringify([...blocks.values()])).toContain('actual-a1');expect(JSON.stringify([...blocks.values()])).toContain('actual-a2');});
 it('零Run的WF页晚到无需Task更新而恢复',async()=>{const t=await task(),req=request();await syncTaskExecutionBodies(pool,opts(req,[t.id]));expect(await pending()).toBe(1);await workflowPage();expect(await syncTaskExecutionBodies(pool,opts(req))).toMatchObject({synced:1,pending:0});expect(await pending()).toBe(0);});
 it('独立连接并发换nonce，旧成功CAS不能删新待办',async()=>{const t=await task();await workflowPage();let once=true;const req=request(async()=>{if(once){once=false;await queueTaskExecutionBodies(writer,[t.id],Date.now()+2000);}});expect(await syncTaskExecutionBodies(pool,opts(req,[t.id]))).toMatchObject({synced:1});expect(await pending()).toBe(1);await syncTaskExecutionBodies(pool,opts(request()));expect(await pending()).toBe(0);});
 it('连续同批12项不会被新enqueue重置年龄饿死后2项',async()=>{const rows=[];for(let i=0;i<12;i++)rows.push(await task());const seen=[];const req=request(async page=>seen.push(tasks.get(page)));await syncTaskExecutionBodies(pool,opts(req,rows.map(t=>t.id)));expect(new Set(seen).size).toBe(10);await syncTaskExecutionBodies(pool,opts(req,rows.map(t=>t.id)));expect(new Set(seen).size).toBe(12);expect(await pending()).toBe(12);});
 it('102条真实attempt只展示最近100条，明确另2条且Notion块有界',async()=>{const t=await task();await workflowPage();await pool.query("INSERT INTO task_runs SELECT $1,'run-'||n,$2,'{}','failed',gen_random_uuid()::text,now()-n*interval '1 second' FROM generate_series(1,102)n",[t.id,W]);await syncTaskExecutionBodies(pool,opts(request(),[t.id]));const toggle=blocks.get(t.page)[0],body=blocks.get(toggle.id),text=JSON.stringify(body);expect(text).toContain('展示最近 100 次');expect(text).toContain('另 2 次未展示');expect(text).toContain('run-100');expect(text).not.toContain('run-101');expect(body.length).toBeLessThan(100);expect(body.every(b=>b[b.type].rich_text.length<=100)).toBe(true);});
 it('相似前缀不属于本模块，不消费或轮转其待办',async()=>{const key='taskXexecutionXbodyXpending:'+randomUUID(),stamp='2020-01-01T00:00:00.000Z';await pool.query('INSERT INTO working_memory(key,value_json,updated_at) VALUES($1,$2,$3)',[key,JSON.stringify({task_id:randomUUID(),nonce:'foreign'}),stamp]);const req=request();expect(await syncTaskExecutionBodies(pool,opts(req))).toMatchObject({failed:0,synced:0});const row=(await pool.query('SELECT updated_at FROM working_memory WHERE key=$1',[key])).rows[0];expect(row.updated_at.toISOString()).toBe(stamp);});

});
