import { describe, it, expect } from 'vitest';
import { createExecutionDirectory } from './directory.js';
import { legacyRecords } from './legacy-policy.js';
const env = { FLEET_WORKER_US_MAC_M4_URL:'http://mmv:5231', FLEET_WORKER_XIAN_MAC_M1_URL:'http://m1:5231', FLEET_WORKER_XIAN_MAC_M4_URL:'http://m4:5231' };
const rows = () => legacyRecords({ env });
const db = (value) => ({ query: async () => ({ rows: value }) });
describe('执行目录', () => {
  it('无初始化和过期拒绝新增执行', async () => {
    let now=100; const d=createExecutionDirectory({now:()=>now,ttlMs:50});
    expect(d.current()).toBeNull(); await d.refresh({pool:db(rows())});
    expect(d.current().nodes).toHaveLength(3); now=150; expect(d.current()).toBeNull();
  });
  it('保持精确18 Harness及2 legacy组合，不从角色或账号推权限', async () => {
    const d=createExecutionDirectory(); await d.refresh({pool:db(rows())});
    expect(d.targets()).toHaveLength(18);
    expect(d.current().nodes.flatMap(n=>n.grants).filter(g=>g.surface==='legacy_executor')).toHaveLength(2);
    expect(d.matches({machineId:'xian-mac-m1',surface:'legacy_executor',provider:'codex',account:''})).toBeNull();
    expect(d.matches({machineId:'us-mac-m4',surface:'harness',provider:'codex',account:'team1',repo:'evil/repo'})).toBeNull();
  });
  it('原子刷新，不重启更新；一次操作保留同一只读快照', async () => {
    const d=createExecutionDirectory(); await d.refresh({pool:db(rows())}); const first=d.current();
    const next=rows(); next[0].grants=[];
    await d.withSnapshot(first,async()=>{await d.refresh({pool:db(next)});expect(d.current()).toBe(first);});
    expect(d.current()).not.toBe(first); expect(d.targets().length).toBe(10);
    expect(()=>first.nodes.push({})).toThrow();
    await expect(d.refresh({pool:{query:async()=>{throw Error('db down');}}})).rejects.toThrow('db down');
    expect(d.targets().length).toBe(10);
  });
  it('缺失endpoint拒绝；未知节点active也没有grant', async()=>{
    const d=createExecutionDirectory();const value=rows();value[0].endpoints={};
    value.push({...value[1],canonical_id:'unknown',grants:[]});await d.refresh({pool:db(value)});
    expect(d.targets()).toHaveLength(10);expect(d.matches({machineId:'unknown',surface:'harness',provider:'codex',account:'team1'})).toBeNull();
  });
});
