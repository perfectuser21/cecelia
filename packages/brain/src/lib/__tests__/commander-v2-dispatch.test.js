import { it, expect, vi } from 'vitest';
import { readyCommander, statusCommander, prepareCommander } from '../commander-v2-dispatch.js';
it('ready仅经stdin传固定定义，自由输入不进入SSH命令',async()=>{
 const sshDispatch=vi.fn(async()=>JSON.stringify({ready:true})),e={workflow_key:'中文\n$(danger)',definition:{release_id:'fixed'},input:'never forwarded'};
 await readyCommander(e,{target:'worker',sshDispatch});
 expect(sshDispatch.mock.calls[0][0].at(-1)).toBe('~/.openclaw/commander/wf-launch.sh --ready');
 expect(JSON.parse(sshDispatch.mock.calls[0][1])).toEqual({workflow_key:e.workflow_key,definition:e.definition});
});
it('status拒绝shell非法运行id，零SSH',async()=>{
 const sshProbe=vi.fn();await expect(statusCommander({run_id:'wfd-1;bad'},{sshProbe})).rejects.toThrow('run_id非法');expect(sshProbe).not.toHaveBeenCalled();
});
it('已经持久准备的任务重入不重建定义或运行',async()=>{
 const c={phase:'running',envelope:{run_id:'stable',deadline_at:'fixed'}};
 const db={query:vi.fn(async sql=>({rows:sql.includes('SELECT * FROM tasks')?[{payload:{commander_protocol:'commander-v2'},result:{workflow_control:c}}]:[]})),release:vi.fn()};
 const frozenContract=vi.fn(),startRun=vi.fn(),ready=vi.fn();
 expect(await prepareCommander({connect:async()=>db},'task',{frozenContract,startRun,ready})).toBe(c);
 expect(frozenContract).not.toHaveBeenCalled();expect(startRun).not.toHaveBeenCalled();expect(ready).not.toHaveBeenCalled();
});

it('方法ready传完整双定义，不把组合验证降成单release echo',async()=>{
 const sshDispatch=vi.fn(async()=>JSON.stringify({ready:true}));
 const e={workflow_key:'report',definition:{release_id:'method'},method_selection:{protocol:'commander-method-v1',supervisor_definition:{release_id:'current'}}};
 await readyCommander(e,{target:'worker',sshDispatch});
 expect(JSON.parse(sshDispatch.mock.calls[0][1])).toEqual(e);
});
