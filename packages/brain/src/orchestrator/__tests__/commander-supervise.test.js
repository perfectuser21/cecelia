import {test,expect} from 'vitest';
import {supervisionState,terminalResult} from '../../../scripts/commander-workflow/supervise.mjs';
const identity={run_id:'run',task_id:'task',definition_sha256:'abc'};
test('监督预算持久保留，不因进程重启归零',()=>{const s=supervisionState(null,identity,3);s.starts=2;expect(supervisionState(s,identity,3).starts).toBe(2);expect(()=>supervisionState(s,{...identity,run_id:'other'},3)).toThrow();expect(()=>supervisionState(s,identity,4)).toThrow();});
test('needs_review与业务failed都是终态，不重复拉起',()=>{for(const status of ['completed','needs_review','failed'])expect(terminalResult({...identity,status},identity)).toBe(true);expect(terminalResult({...identity,status:'running'},identity)).toBe(false);expect(()=>terminalResult({...identity,run_id:'wrong',status:'completed'},identity)).toThrow();});
