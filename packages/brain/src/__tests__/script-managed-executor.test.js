import {describe,expect,it,vi} from 'vitest';
import {usesManagedScript,prepareManagedScript,triggerManagedScript} from '../script-managed-executor.js';
import {randomUUID} from 'node:crypto';
const host='us-mac-m4';
describe('受管模式显式启用边界',()=>{
  it.each(['version','boot','policy','profile'])('Linux能力与fresh预约快照混%s代时零数据库预约',async kind=>{
    const capability={execution_version_id:randomUUID(),worker_id:host,worker_boot_id:randomUUID(),policy_digest:'a'.repeat(64),profiles:{safe:'b'.repeat(64)}};
    const snapshot={execution_version_id:capability.execution_version_id,worker_boot_id:capability.worker_boot_id,policy_digest:capability.policy_digest,profile_digest:capability.profiles.safe};
    if(kind==='version')snapshot.execution_version_id=randomUUID();if(kind==='boot')snapshot.worker_boot_id=randomUUID();if(kind==='policy')snapshot.policy_digest='c'.repeat(64);if(kind==='profile')snapshot.profile_digest='d'.repeat(64);
    const pool={connect:vi.fn(()=>{throw Error('must not reserve');})},deps={env:{SCRIPT_MANAGED_MACHINES:host},managed:{client:{capabilities:async()=>capability},collectSnapshot:async()=>snapshot}};
    expect(await prepareManagedScript({id:randomUUID(),payload:{managed_script:{profile:'safe'}}},{host,artifact_paths:[],cmd:'printf ok',timeout_sec:20,env:{}},pool,deps)).toMatchObject({outcome:'wait',reason:'script_admission_changed'});
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it('启用机上所有脚本进入共同入口，未声明profile不得退回SSH',async()=>{
    const task={payload:{}},deps={env:{SCRIPT_MANAGED_MACHINES:host}};
    expect(usesManagedScript(task,{host},deps)).toBe(true);
    await expect(prepareManagedScript(task,{host},null,deps)).resolves.toMatchObject({outcome:'blocked',reason:'script_managed_spec_required'});
  });
  it('显式profile但部署未启用时也明确阻断',async()=>{
    const task={payload:{managed_script:{profile:'p'}}},deps={env:{}};
    expect(usesManagedScript(task,{host},deps)).toBe(true);
    await expect(prepareManagedScript(task,{host},null,deps)).resolves.toMatchObject({outcome:'blocked',reason:'script_managed_not_enabled'});
  });
  it('未切换机器保留宿主脚本语义，不冒称受管',()=>{
    expect(usesManagedScript({payload:{}},{host},{env:{}})).toBe(false);
  });
});

describe('准入结果只写非终态',()=>{
  it.each(['blocked','queued'])('%s 分支保留终态统一收口',async(status)=>{
    const pool={query:vi.fn().mockResolvedValue({rowCount:1,rows:[{id:'task'}]})};
    const task={id:'task',payload:status==='blocked'?{}:{managed_script:{profile:'p'}}};
    const deps={env:{SCRIPT_MANAGED_MACHINES:host},managed:{
      client:{capabilities:vi.fn().mockRejectedValue(new Error('unavailable'))},
      collectSnapshot:vi.fn(),
    }};
    await triggerManagedScript(task,{host,artifact_paths:[]},pool,deps);
    const writes=pool.query.mock.calls.filter(([sql])=>sql.includes('UPDATE tasks SET status=$2'));
    expect(writes).toHaveLength(1);
    expect(writes[0][1][1]).toBe(status);
  });
});
