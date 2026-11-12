import {describe,it,expect,vi} from 'vitest';
import * as leases from '../task-lease.js';
const taskId='10000000-0000-4000-8000-000000000001',claimer='common-runner',claimedAt='2026-11-12 03:23:23.333456+00';
const input={taskId,claimer,claimedAt};
function fixture({owned=true,lease,conflict=false}={}){
 const statements=[];let saved=lease;
 const query=vi.fn(async(sql,params)=>{statements.push({sql,params});
  if(sql.includes('FROM tasks'))return {rows:owned?[{id:taskId,claimed_by:claimer,claimed_at:claimedAt}]:[]};
  if(sql.includes('FROM task_leases'))return {rows:saved?[saved]:[]};
  if(sql.includes('INSERT INTO task_leases')){if(conflict)return {rows:[]};saved={task_id:taskId,claimer,source:'claim',claimed_at:claimedAt,lease_seconds:params[3],lease_until:'2026-11-12T04:23:23.333456Z'};return {rows:[saved]};}
  return {rows:[],rowCount:1};
 });return {db:{query},statements,get lease(){return saved;}};
}
const ensure=(f,args=input)=>leases.ensureClaimedTaskLease(args,{transactionClient:f.db});
describe('服务端真实认领衔接有限租约',()=>{
 it('仅为锁定原Task真实claim创建租约，保留微秒认领时间并同步设备TTL',async()=>{
  const f=fixture();expect(await ensure(f)).toMatchObject({claimer,claimed_at:claimedAt,lease_seconds:3600});
  const insert=f.statements.find(x=>x.sql.includes('INSERT INTO task_leases'));expect(insert.params).toEqual([taskId,claimer,claimedAt,3600]);expect(insert.sql).toContain('ON CONFLICT (task_id) DO NOTHING');
  expect(f.statements.some(x=>x.sql.includes('FOR UPDATE')&&x.sql.includes('claimed_at = $3::timestamptz'))).toBe(true);
  expect(f.statements.some(x=>x.sql.includes('UPDATE tasks'))).toBe(false);expect(f.statements.some(x=>x.sql.includes('UPDATE device_locks'))).toBe(true);
 });
 it('官方非事务claim租约稍晚于Task.claimed_at仍属同epoch，幂等读取不续期',async()=>{
  const lease={task_id:taskId,claimer,source:'claim',claim_matches:true,active:true,released_at:null,lease_until:'2026-11-12T04:23:24Z',claimed_at:'2026-11-12T03:23:24Z'};
  const f=fixture({lease});expect(await ensure(f)).toEqual(lease);expect(f.statements.some(x=>/INSERT|UPDATE/.test(x.sql)&&!x.sql.includes('FOR UPDATE'))).toBe(false);
 });
 it.each(['foreign','released','expired','old_epoch','brain'])('拒绝%s已有租约，不夺取不复活',async fault=>{
  const lease={task_id:taskId,claimer,source:'claim',claim_matches:true,active:true,released_at:null};
  if(fault==='foreign')lease.claimer='other';if(fault==='released')lease.released_at='2026-11-12T03:30:00Z';if(fault==='expired')lease.active=false;if(fault==='old_epoch')lease.claim_matches=false;if(fault==='brain'){lease.source='brain';lease.claimer=null;}
  const f=fixture({lease});await expect(ensure(f)).rejects.toThrow('task_claim_lease_conflict');expect(f.statements.some(x=>x.sql.includes('INSERT INTO')||x.sql.includes('UPDATE task_leases'))).toBe(false);
 });
 it('事务先BEGIN后等claim锁时，以实时时钟而非事务NOW判定租约',async()=>{
  const f=fixture();await ensure(f);const read=f.statements.find(x=>x.sql.includes('FROM task_leases')).sql;expect(read).toContain('claimed_at <= clock_timestamp()');expect(read).toContain('lease_until > clock_timestamp()');expect(f.statements.find(x=>x.sql.includes('INSERT INTO task_leases')).sql).toContain('clock_timestamp()+');
 });
 it('Task换owner/claimed_at或终态均拒绝，租约不能反向授权',async()=>{const f=fixture({owned:false});await expect(ensure(f)).rejects.toThrow('task_claim_lease_identity_conflict');expect(f.statements).toHaveLength(1);});
 it('并发租约已出现则失败，不通过UPSERT接管',async()=>{const f=fixture({conflict:true});await expect(ensure(f)).rejects.toThrow('task_claim_lease_conflict');});
});
