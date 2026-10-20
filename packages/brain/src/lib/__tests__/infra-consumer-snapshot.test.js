import {expect,it} from 'vitest';
import {validateInfraSnapshot} from '../infra-consumer-snapshot.js';
it('验证入口拒绝foreign scope与把infra证据改成执行结果',()=>{
 for(const value of [{scope:'cecelia-factory'},{scope:'cecelia-infra',repo:'foreign/repo',revision:'a'.repeat(40)},{scope:'cecelia-infra',repo:'perfectuser21/cecelia',revision:'a'.repeat(40),snapshot_scope:'executable',execution_status:'completed'}])expect(()=>validateInfraSnapshot(value)).toThrow();
});
