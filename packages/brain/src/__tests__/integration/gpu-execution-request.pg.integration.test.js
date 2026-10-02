import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createIntakeTestDatabase} from '../fixtures/task-intake-db.js';
import {createRoutedTask} from '../../work-routing-store.js';
let database;
beforeAll(async()=>{database=await createIntakeTestDatabase();});
afterAll(async()=>{await database?.close();});
const input=(extra={})=>({source:'api',source_id:randomUUID(),title:`GPU 结构化执行声明验真 ${randomUUID()}`,requested_task_type:'workflow_run',mutation_intent:'none',declared_domain:'operations',metadata:{},task:{priority:'P2'},...extra});
describe('真实建单入口 GPU 请求边界',()=>{
 it.each([{metadata:{gpu:true}},{metadata:{runtime_resources:{gpu:{count:1}}}},{task:{priority:'P2',payload:{gpu:{count:1}}}}])('拒绝显式声明，tasks 和收据均零新增 %j',async extra=>{
  const sql='SELECT (SELECT count(*) FROM tasks)::int AS tasks,(SELECT count(*) FROM work_routing_receipts)::int AS receipts';
  const before=await database.pool.query(sql);
  await expect(createRoutedTask(database.pool,input(extra))).rejects.toMatchObject({code:'gpu_execution_unsupported'});
  expect((await database.pool.query(sql)).rows).toEqual(before.rows);
 });
 it('普通 CPU 工作仍生成真实任务和路由收据',async()=>{
  const created=await createRoutedTask(database.pool,input());
  const rows=await database.pool.query('SELECT t.id FROM tasks t JOIN work_routing_receipts r ON r.task_id=t.id WHERE t.id=$1',[created.task_id]);
  expect(rows.rowCount).toBe(1);
 });
});
