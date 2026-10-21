import {afterEach,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {privateFixtureDatabase} from '../fixtures/private-fixture-db.js';
import {PUSH_TASKS_QUERY} from '../../notion-push-sync.js';
let fixture;
beforeEach(async()=>{fixture=await privateFixtureDatabase('taskprogress',async db=>{
 await db.query(`CREATE TABLE projects(id uuid PRIMARY KEY,notion_props jsonb);
 CREATE TABLE tasks(id uuid PRIMARY KEY,title text,status text,priority text,task_type text,kind text,description text,result jsonb,
 project_id uuid,parent_task_id uuid,notion_id text,notion_props jsonb,updated_at timestamptz DEFAULT now());
 CREATE TABLE task_dependencies(from_task_id uuid,to_task_id uuid,edge_type text,gap_id uuid);`);
});});
afterEach(async()=>{if(fixture)await fixture.close();fixture=null;});
const read=async()=> (await fixture.client.query(PUSH_TASKS_QUERY,[true])).rows;
it('Project真身关联与原始目标/结果入投影；状态不变的进度更新仍选中',async()=>{
 const id=randomUUID(),project=randomUUID();
 await fixture.client.query("INSERT INTO projects VALUES($1,'{\"notion_id\":\"project-page\"}')",[project]);
 await fixture.client.query(`INSERT INTO tasks(id,title,status,task_type,description,result,project_id,notion_id,notion_props)
 VALUES($1,'任务','in_progress','dev','目标','{"phase":"初验"}',$2,'page','{"pushed_status":"in_progress"}')`,[id,project]);
 const first=(await read())[0];expect(first).toMatchObject({project_notion_id:'project-page',description:'目标',result:{phase:'初验'}});
 expect(first.content_hash).toMatch(/^[0-9a-f]{32}$/);
 await fixture.client.query("UPDATE tasks SET notion_props=jsonb_build_object('pushed_status',status,'pushed_project','project-page','pushed_content',$2::text) WHERE id=$1",[id,first.content_hash]);
 expect(await read()).toHaveLength(0);
 await fixture.client.query("UPDATE tasks SET result='{\"phase\":\"读回完成\"}' WHERE id=$1",[id]);
 expect((await read())[0].result.phase).toBe('读回完成');
 await fixture.client.query('UPDATE tasks SET project_id=NULL WHERE id=$1',[id]);expect((await read())[0].project_notion_id).toBeNull();
});
it('保留旧task project根关联，现代Project晚建页后自动补挂',async()=>{
 const id=randomUUID(),root=randomUUID(),project=randomUUID();
 await fixture.client.query("INSERT INTO tasks(id,title,status,task_type,notion_id) VALUES($1,'旧根','in_progress','project','legacy-page')",[root]);
 await fixture.client.query("INSERT INTO tasks(id,title,status,task_type,parent_task_id,notion_props) VALUES($1,'子任务','queued','dev',$2,'{}')",[id,root]);
 expect((await read())[0].project_notion_id).toBe('legacy-page');
 await fixture.client.query("INSERT INTO projects VALUES($1,'{}')",[project]);await fixture.client.query('UPDATE tasks SET project_id=$2 WHERE id=$1',[id,project]);
 await fixture.client.query("UPDATE projects SET notion_props='{\"notion_id\":\"modern-page\"}' WHERE id=$1",[project]);
 expect((await read())[0].project_notion_id).toBe('modern-page');
});
