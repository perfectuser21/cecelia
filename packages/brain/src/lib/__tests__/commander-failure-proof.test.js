import { describe, it, expect } from 'vitest';
import { validateFailureProof } from '../commander-failure-proof.js';
import { failureFixture } from './fixtures/commander-failure-fixture.js';
describe('无delivery的原过期尝试只能由主动证据失败收口',()=>{
 it('接受真实原失败/预算内cleanup/独立签收，保unknown且不造delivery',()=>{const f=failureFixture();const p=validateFailureProof(f.task,f.verifier,f.observation,f.now);expect(p.effects).toBe('unknown');expect(p.retry_safe).toBe(false);expect(p.runtime_files).toEqual(f.observation.runtime_files);expect(p).not.toHaveProperty('delivery');});
 const cases={
  'runtime闭包缺项':f=>{f.observation.runtime_files={};},
  'runtime闭包字节被篡改':f=>{f.observation.runtime_files['wf-v2.py']='f'.repeat(64);},
  '原input文件与冻结信封不符':f=>f.observation.original_input={title:'changed'},
  '原contract文件与冻结信封不符':f=>f.observation.original_contract={different:true},
  '原child不符':f=>f.observation.terminal.output.details.runs[0].runId='other',
  '原session不符':f=>f.observation.terminal.output.details.runs[0].sessionKey='other',
  '终态失读':f=>f.observation.terminal.output.details.reason='timeout',
  '成功不是失败收口':f=>f.observation.terminal.output.details.runs[0].outcome.status='ok',
  '当前有活跃run':f=>f.observation.session.activeRunIds=['later'],
  'worker占锁':f=>f.observation.worker_exclusive=false,
  'controller占锁':f=>f.observation.controller.owner='other',
  'controllerguard忙':f=>f.observation.controller.guard_exclusive=false,
  'nonce未闭':f=>f.observation.nonce_closed=false,
  'cleanup过期':f=>f.observation.cleanup._shell.ended_at='2026-01-01T00:07:00Z',
  'cleanup未完成':f=>f.observation.cleanup.completed=false,
  'hash改动':f=>f.observation.files[1]={...f.observation.files[1],sha256:'4'.repeat(64)},
  '原件越界':f=>f.observation.files[1]={...f.observation.files[1],path:'/tmp/caller-file'},
  'root换代':f=>f.observation.current_roots={...f.observation.roots,run:{...f.observation.roots.run,st_ino:99}},
  '信封input换代':f=>f.observation.envelope={...f.observation.envelope,input:{title:'changed'}},
  '未独立完成':f=>f.verifier.status='in_progress',
  '核验任务错parent':f=>f.verifier.parent_task_id='other',
  '核验伪装业务成功':f=>f.verifier.result.commander_failure_verification.scope='business',
  '核验授予重试':f=>f.verifier.result.commander_failure_verification.retry_safe=true,
  '过预算之前禁止运维收口':f=>f.now=Date.parse('2026-01-01T00:05:00Z'),
 };
 for(const [name,mutate] of Object.entries(cases))it(name,()=>{const f=structuredClone(failureFixture());mutate(f);expect(()=>validateFailureProof(f.task,f.verifier,f.observation,f.now)).toThrow();});
});
it('提前失败清理可在execution截止前完成，仍只在原总清理预算结束后对账',()=>{
 const f=failureFixture(),s=f.observation.cleanup._shell;
 s.started_at='2026-01-01T00:00:51Z';s.ended_at='2026-01-01T00:00:59Z';
 f.observation.root_start.observed_at=s.started_at;f.observation.root_end.observed_at=s.ended_at;
 expect(validateFailureProof(f.task,f.verifier,f.observation,f.now).verdict).toBe('FAIL');
});
