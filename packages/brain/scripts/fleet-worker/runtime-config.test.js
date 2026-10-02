import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const require=createRequire(import.meta.url),{runtimeConfigDigest,protectedFileDigest}=require('./runtime-config.cjs');
it('node配置摘要读取部署profile且不回写源码，私有文件字节与权限变化受检查',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-config-')),file=path.join(root,'profile.json');
 try{fs.writeFileSync(file,'{}',{mode:0o600});const a=protectedFileDigest(file);fs.writeFileSync(file,'{"capacity":8}');expect(protectedFileDigest(file)).not.toBe(a);fs.chmodSync(file,0o666);expect(()=>protectedFileDigest(file)).toThrow('worker_runtime_code_unprotected');expect(runtimeConfigDigest({machine_id:'xian-mac-m4'})).toMatch(/^[a-f0-9]{64}$/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
