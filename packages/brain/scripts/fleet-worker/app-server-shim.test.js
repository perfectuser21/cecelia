import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);let api;try{api=require('./app-server-shim.cjs');}catch{api={};}
it('shim配置必须受保护，参数只有HOME幂等键，URL内不能携带凭据',()=>{
 expect(api.loadShimConfig).toBeTypeOf('function');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shim-'));const file=path.join(dir,'config.json');
 const value={brainUrl:'http://127.0.0.1:5221',internalToken:'x'.repeat(32),homeId:'chat-test',requestKey:randomUUID()};
 try{fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});expect(api.loadShimConfig(file)).toEqual(value);
 fs.chmodSync(file,0o644);expect(()=>api.loadShimConfig(file)).toThrow('appserver_shim_config_untrusted');fs.chmodSync(file,0o600);
 fs.writeFileSync(file,JSON.stringify({...value,brainUrl:'http://secret@127.0.0.1:5221'}));expect(()=>api.loadShimConfig(file)).toThrow('appserver_shim_config_invalid');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
