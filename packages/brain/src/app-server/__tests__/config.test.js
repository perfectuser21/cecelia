import {it,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {loadAppServerHomes} from '../config.js';
const home={homeId:'chat-test',homeKey:'a'.repeat(64),provider:'codex',account:'team1',repo:'perfectuser21/cecelia',profile:'chat',configDigest:'b'.repeat(64)};
it('默认无HOME；配置必须受保护且仓库不扩权、HOME不可重复映射',()=>{
 expect(loadAppServerHomes()).toEqual({});const dir=fs.mkdtempSync(path.join(os.tmpdir(),'appserver-config-')),file=path.join(dir,'homes.json');
 try{
  fs.writeFileSync(file,JSON.stringify({homes:[home]}),{mode:0o600});expect(loadAppServerHomes(file)['chat-test']).toEqual(home);
  fs.chmodSync(file,0o644);expect(()=>loadAppServerHomes(file)).toThrow('appserver_home_configuration_untrusted');fs.chmodSync(file,0o600);
  fs.writeFileSync(file,JSON.stringify({homes:[home,{...home,homeId:'chat-other'}]}));expect(()=>loadAppServerHomes(file)).toThrow('appserver_home_configuration_duplicate');
  fs.writeFileSync(file,JSON.stringify({homes:[{...home,repo:'someone/other'}]}));expect(()=>loadAppServerHomes(file)).toThrow('appserver_home_configuration_invalid');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
