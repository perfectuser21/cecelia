import { it, expect, vi } from 'vitest';
import { statusCommander } from '../commander-v2-dispatch.js';
it('status拒绝shell非法运行id，零SSH',async()=>{
 const sshProbe=vi.fn();await expect(statusCommander({run_id:'wfd-1;bad'},{sshProbe})).rejects.toThrow('run_id非法');expect(sshProbe).not.toHaveBeenCalled();
});
