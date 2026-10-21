import {afterEach,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {versionsDatabase,seedWorkflows} from '../fixtures/definition-versions-db.js';
import {REGISTRATIONS_SQL,storeActivityContracts} from '../../lib/activity-contract-store.js';

let fixture,writer,foreign;
beforeEach(async()=>{
  fixture=await versionsDatabase();await fixture.migrate();
  const {keyword}=await seedWorkflows(fixture.client);
  await fixture.client.query("UPDATE workflows SET source_repo='owner/repo',source_capability='owned' WHERE id=$1",[keyword]);
  writer=await fixture.createPool(1).connect();foreign=await fixture.createPool(1).connect();
  await writer.query("SET lock_timeout='5s'");await foreign.query("SET lock_timeout='5s'");
});
afterEach(async()=>{
  for(const db of [writer,foreign])if(db){await db.query('ROLLBACK');db.release();}
  if(fixture)await fixture.close();fixture=writer=foreign=null;
});

it('不同仓登记并发：共享同步不锁异仓活动，消除全表锁与逐行UPSERT的死锁环',async()=>{
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  await fixture.client.query(`INSERT INTO activities(id,name,capability_key,activity_key,status) VALUES
    ($1,'异仓甲','foreign','a','planned'),($2,'异仓乙','foreign','b','planned'),($3,'自有','owned','c','planned')`,ids);
  const registrations=(await fixture.client.query(REGISTRATIONS_SQL,['owner/repo'])).rows;
  const pid=(await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await foreign.query('BEGIN');await foreign.query('UPDATE activities SET name=name WHERE id=$1',[ids[1]]);
  let finished=false;
  const syncing=storeActivityContracts({connect:async()=>({query:writer.query.bind(writer),release(){}})},[],'a'.repeat(40),'owner/repo',registrations)
    .then(value=>({value}),error=>({error})).finally(()=>{finished=true;});
  // 旧实现先持有异仓甲、再等待异仓乙；使用真实阻塞关系同步，不依赖sleep猜时序。
  let blocked=false;
  for(let n=0;n<300&&!finished;n++){
    blocked=(await fixture.client.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked;
    if(blocked)break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  let otherError;
  try{
    await foreign.query(`INSERT INTO activities(id,name,capability_key,activity_key,status)
      VALUES($1,'异仓已更新','foreign','a','planned')
      ON CONFLICT(capability_key,activity_key) WHERE activity_key IS NOT NULL DO UPDATE SET name=EXCLUDED.name`,[randomUUID()]);
    await foreign.query('COMMIT');
  }catch(error){otherError=error;await foreign.query('ROLLBACK');}
  const result=await syncing;
  expect({store:result.error?.code,other:otherError?.code}).toEqual({store:undefined,other:undefined});
  expect(blocked).toBe(false);
  expect(result.value.deprecated).toEqual(['owned.c']);
  const rows=(await fixture.client.query('SELECT activity_key,name,status FROM activities ORDER BY activity_key')).rows;
  expect(rows).toEqual([{activity_key:'a',name:'异仓已更新',status:'planned'},{activity_key:'b',name:'异仓乙',status:'planned'},{activity_key:'c',name:'自有',status:'deprecated'}]);
},10000);

it('无归属仓库不会碰其他能力的行锁或状态',async()=>{
  const id=randomUUID();await foreign.query('BEGIN');
  await foreign.query("INSERT INTO activities(id,name,capability_key,activity_key,status) VALUES($1,'异仓','foreign','a','planned')",[id]);
  await foreign.query('COMMIT');await foreign.query('BEGIN');await foreign.query('UPDATE activities SET name=name WHERE id=$1',[id]);
  await writer.query("SET lock_timeout='150ms'");
  const result=await storeActivityContracts({connect:async()=>({query:writer.query.bind(writer),release(){}})},[],'a'.repeat(40),'empty/repo',[]);
  expect(result.deprecated).toEqual([]);
  expect((await fixture.client.query('SELECT status FROM activities WHERE id=$1',[id])).rows[0].status).toBe('planned');
});
