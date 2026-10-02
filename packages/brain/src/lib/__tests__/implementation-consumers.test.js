import { expect,it } from 'vitest';
import { validateImplementationQuery } from '../implementation-consumers.js';
const query={scope:'phones',kind:'code',repo:'owner/repo',path:'src/controller.js',revision:'a'.repeat(40)};
it.each([['revision',['a'.repeat(40)]],['digest',['sha256:'+'a'.repeat(64)]],['workflow_version_id',['11111111-1111-4111-8111-111111111111']]])('拒绝正则隐式转字符串的%s数组',(field,value)=>{
  expect(()=>validateImplementationQuery({...query,[field]:value})).toThrow();
});
