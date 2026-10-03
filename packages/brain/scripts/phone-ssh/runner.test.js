import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {it,expect} from 'vitest';
import {fileURLToPath} from 'node:url';
it('Python永久回归真实子进程、fcntl及持久故障窗口',async()=>{
 const result=await promisify(execFile)('python3',['-B','-m','unittest','discover','-s','.','-p','test_*.py','-v'],{cwd:fileURLToPath(new URL('.',import.meta.url)),timeout:40000,maxBuffer:131072}).catch(error=>({code:error.code,stdout:error.stdout,stderr:error.stderr}));
 expect(result.code??0,result.stderr).toBe(0);expect(result.stderr).toMatch(/Ran \d+ tests/);
},45000);
