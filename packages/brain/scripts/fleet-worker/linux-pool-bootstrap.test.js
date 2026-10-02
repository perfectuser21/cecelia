import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it,expect } from 'vitest';
it('Python root bootstrap真实文件/归档与命令合同：自动Node24及账号，失败不泄露凭据',()=>{
 const filename=fileURLToPath(new URL('./linux-pool-bootstrap.test.py',import.meta.url));
 const output=execFileSync('python3',[filename],{encoding:'utf8',timeout:30000});
 expect(output).not.toContain('fixture-token');
},35000);
