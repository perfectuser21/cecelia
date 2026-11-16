import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {createCommanderActionStore} from '../commander-action-store.js';
import {digest} from '../../orchestrator/commander-decision.js';

const url=process.env.TEST_DB_URL;
const enabled=Boolean(url);
if(enabled){const parsed=new URL(url);if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/cecelia_scratch')throw Error('action_store_test_requires_loopback_scratch');}
const client=enabled?new pg.Client({connectionString:url}):null;
const schema='checker_attempt_'+randomUUID().replaceAll('-','');
let store,created=false;
const identity=(run_id,attempt)=>({task_id:randomUUID(),run_id,activity_key:'generate',definition_sha256:'a'.repeat(64),
  action_id:digest({run_id,activity_key:'generate',...(attempt===undefined?{}:{attempt})}),input_sha256:'b'.repeat(64),...(attempt===undefined?{}:{attempt})});
const deadline_ms=Date.now()+60000;

beforeAll(async()=>{
  if(!enabled)return;
  await client.connect();
  const {rows}=await client.query('SELECT current_database() AS name,inet_server_addr() AS address');
  expect(rows[0]).toEqual({name:'cecelia_scratch',address:expect.stringMatching(/^(127\.0\.0\.1|::1)$/)});
  await client.query(`CREATE SCHEMA ${schema}`);created=true;
  await client.query(`SET search_path TO ${schema}`);
  await client.query(fs.readFileSync(new URL('../../../migrations/558_commander_activity_actions.sql',import.meta.url),'utf8'));
  const legacy=identity(randomUUID());
  await client.query("INSERT INTO commander_activity_actions(action_id,run_id,activity_key,identity,state,result,deadline_ms) VALUES($1,$2,$3,$4,'settled',$5,$6)",[legacy.action_id,legacy.run_id,legacy.activity_key,JSON.stringify(legacy),JSON.stringify({status:'completed'}),deadline_ms]);
  const migration=fs.readFileSync(new URL('../../../migrations/559_commander_activity_attempts.sql',import.meta.url),'utf8');
  await client.query(migration);await client.query(migration);
  const migrated=(await client.query('SELECT attempt,identity,result FROM commander_activity_actions WHERE action_id=$1',[legacy.action_id])).rows[0];
  expect(migrated).toEqual({attempt:1,identity:legacy,result:{status:'completed'}});
  store=createCommanderActionStore(client);
});
afterAll(async()=>{
  if(!client)return;
  try{if(created)await client.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await client.end();}
});

test.skipIf(!enabled)('同一 Activity 的两轮动作独立预留、重复预留复用、结算不串轮',async()=>{
  const first=identity(randomUUID()),second={...first,attempt:2,action_id:digest({first:first.action_id,attempt:2})};
  expect((await store.reserve(first,{deadline_ms})).created).toBe(true);
  expect((await store.reserve(second,{deadline_ms})).created).toBe(true);
  const repeated=await store.reserve(second,{deadline_ms:deadline_ms+10000});
  expect(repeated.created).toBe(false);expect(repeated.record.deadline_ms).toBe(deadline_ms);
  const failed={status:'needs_review',evidence:['first']},passed={status:'completed',evidence:['second']};
  await store.settle(first,failed);
  expect((await store.reserve(second,{deadline_ms})).record.state).toBe('reserved');
  await store.settle(second,passed);
  expect((await store.reserve(first,{deadline_ms})).record.result).toEqual(failed);
  expect((await store.reserve(second,{deadline_ms})).record.result).toEqual(passed);
  await expect(store.settle(second,failed)).rejects.toThrow('commander_action_settlement_conflict');
  const rows=(await client.query('SELECT identity,state,result FROM commander_activity_actions WHERE run_id=$1 ORDER BY action_id',[first.run_id])).rows;
  expect(rows).toHaveLength(2);expect(rows.every(row=>row.state==='settled')).toBe(true);
});

test.skipIf(!enabled)('旧身份没有 attempt 字段仍保持原摘要和幂等恢复',async()=>{
  const old=identity(randomUUID());await store.reserve(old,{deadline_ms});
  const result={status:'completed',evidence:['legacy']};await store.settle(old,result);
  const resumed=await store.reserve(old,{deadline_ms:deadline_ms+10000});
  expect(resumed.created).toBe(false);expect(resumed.record.identity).toEqual(old);expect(resumed.record.result).toEqual(result);
  await expect(store.reserve({...old,attempt:1},{deadline_ms})).rejects.toThrow('commander_action_identity_conflict');
});
