import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {it,expect} from 'vitest';
it('固定root接入程序实际文件与签名回归：未知不重装、boot绑定、传输secret清理',()=>{
 const output=execFileSync('python3',[fileURLToPath(new URL('./linux-onboarding-remote.test.py',import.meta.url))],{encoding:'utf8',timeout:30000});
 expect(output).not.toContain('execution_key');
});
