import {it,expect} from 'vitest';
import * as targets from './execution-targets.js';
import {directory} from '../../execution-directory/directory.js';
const input={role:'generator',provider:'codex',account:null,model:'gpt-5.4',payload:{},roleAssignment:{},candidateMachine:null,repo:'perfectuser21/cecelia'};
it('默认Codex按M1→M4→MMV展开已授权账号，runtime所在机器不作为用户pin',()=>{
 expect(targets.defaultCodexTargets).toBeTypeOf('function');
 const list=targets.defaultCodexTargets({...input,runtimeMachineId:'us-mac-m4'});
 expect([...new Set(list.map(t=>t.machine))]).toEqual(['xian-mac-m1','xian-mac-m4','us-mac-m4']);
 expect(list).toHaveLength(15);expect(list.every(t=>t.model==='gpt-5.4')).toBe(true);
 expect(targets.defaultCodexTargets({...input,account:'team3'})).toEqual(['xian-mac-m1','xian-mac-m4','us-mac-m4'].map(machine=>({provider:'codex',account:'team3',model:'gpt-5.4',machine})));
});
it.each([
 {role:'commander'},{provider:'claude'},{candidateMachine:'xian-mac-m4'},
 {roleAssignment:{machine:'us-mac-m4'}},{roleAssignment:{strict_affinity:false}},{roleAssignment:{fallback_targets:[]}},
 {payload:{machine:'us-mac-m4'}},{payload:{machineId:'xian-mac-m1'}},{payload:{routing:{machineId:'xian-mac-m1'}}},{payload:{machine_id:'us-mac-m4'}},{payload:{requested_machine_id:'us-mac-m4'}},
 {payload:{executor_machine:'us-mac-m4'}},{payload:{routing:{preferred_machine:'us-mac-m4'}}},
 {payload:{routing:{strict_affinity:true}}},{payload:{routing:{fallback_targets:[]}}},
])('显式机器或策略与commander不进入缺省展开 %#',patch=>{
 expect(targets.defaultCodexTargets).toBeTypeOf('function');expect(targets.defaultCodexTargets({...input,...patch})).toBeNull();
});
it('目录撤销/仓库范围/未知账号不能被默认顺序补回',()=>{
 expect(targets.defaultCodexTargets).toBeTypeOf('function');
 const snapshot=structuredClone(directory.current());
 snapshot.nodes.find(n=>n.canonical_id==='xian-mac-m1').grants.forEach(g=>g.state='revoked');
 snapshot.nodes.find(n=>n.canonical_id==='xian-mac-m4').grants.forEach(g=>g.repo_scope=['other/repo']);
 directory.withSnapshot(snapshot,()=>{
  expect(targets.defaultCodexTargets({...input,account:'team1'}).map(t=>t.machine)).toEqual(['us-mac-m4']);
  expect(targets.defaultCodexTargets({...input,account:'unknown'})).toEqual([]);
 });
});

it.each([null,'0',undefined,NaN])('未知容量值不能伪装成明确资源耗尽：%s',async available=>{
 const {createCapabilityGate}=await import('./capability-gate.js');
 const candidates=targets.defaultCodexTargets({...input,account:'team1'});
 const gate=createCapabilityGate({getMachineHealth:async()=>({ok:true}),getMachineCapacity:async()=>({ok:true,available})});
 const result=await gate.evaluate({preferred_target:candidates[0],candidate_targets:candidates,requirements:{}});
 expect(result.action).toBe('wait:human_review');
});
