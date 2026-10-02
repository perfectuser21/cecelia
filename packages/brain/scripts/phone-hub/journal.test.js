import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
it('真实Python跨进程journal活动回归永久进入brain-unit',()=>{
 const cwd=fileURLToPath(new URL('.',import.meta.url));
 const out=execFileSync('python3',['-B','-m','unittest','test_journal_activity','-v'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000});
 expect(out).toBe('');
});
