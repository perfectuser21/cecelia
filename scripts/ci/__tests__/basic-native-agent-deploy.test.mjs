import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
async function api(){
 let loaded;try{loaded=await import('../../../packages/brain/scripts/native-agent-release.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 assert.equal(typeof loaded?.installNativeBundle,'function','原生Agent发布安装入口必须存在');return loaded.installNativeBundle;
}
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-agent-release-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'releases'),configPath=path.join(dir,'operator.json');
 await fs.writeFile(configPath,JSON.stringify({profiles:{main:{account_ref:'fixed-account'}}}),{mode:0o600});
 const content=Buffer.from('export const workerVersion=1;\n');
 const files=[{path:'scripts/native-agent/cli.mjs',sha256:hash(content),content_base64:content.toString('base64')}];
 return {root,configPath,files,sha256:hash(JSON.stringify(files.map(x=>[x.path,x.sha256])))};
}
test('发布精确字节和私有配置快照，同包重试不改已发布文件',async t=>{
 const install=await api(),f=await fixture(t),first=await install(f);
 assert.equal(first.bundle_sha256,f.sha256);
 assert.equal(await fs.readFile(path.join(first.directory,f.files[0].path),'utf8'),'export const workerVersion=1;\n');
 const snapshot=JSON.parse(await fs.readFile(first.config_path,'utf8'));
 assert.equal(snapshot.profiles.main.account_ref,'fixed-account');assert.equal(snapshot.bundle_sha256,f.sha256);
 assert.equal((await fs.stat(first.directory)).mode&0o777,0o700);assert.equal((await fs.stat(first.config_path)).mode&0o777,0o600);
 const before=(await fs.stat(first.config_path)).mtimeMs;await install(f);assert.equal((await fs.stat(first.config_path)).mtimeMs,before);
});
test('新包保留旧包与旧账号快照，不能覆盖在途执行使用的旧配置',async t=>{
 const install=await api(),f=await fixture(t),old=await install(f);
 await fs.writeFile(f.configPath,JSON.stringify({profiles:{main:{account_ref:'new-account'}}}),{mode:0o600});
 const content=Buffer.from('export const workerVersion=2;\n');f.files[0]={...f.files[0],sha256:hash(content),content_base64:content.toString('base64')};f.sha256=hash(JSON.stringify(f.files.map(x=>[x.path,x.sha256])));
 const newer=await install(f);assert.notEqual(newer.directory,old.directory);
 assert.equal(JSON.parse(await fs.readFile(old.config_path,'utf8')).profiles.main.account_ref,'fixed-account');
 assert.equal(JSON.parse(await fs.readFile(newer.config_path,'utf8')).profiles.main.account_ref,'new-account');
});
test('错误包摘要或路径越界零发布，不在目录外写文件',async t=>{
 const install=await api(),f=await fixture(t);await assert.rejects(install({...f,sha256:'0'.repeat(64)}),/digest|sha|bundle/);
 const evil={...f,files:[{...f.files[0],path:'../outside'}]};evil.sha256=hash(JSON.stringify(evil.files.map(x=>[x.path,x.sha256])));
 await assert.rejects(install(evil),/path|bundle/);await assert.rejects(fs.stat(path.join(path.dirname(f.root),'outside')),/ENOENT/);
});
test('宽权限源配置、漂移的已发布字节或配置均拒绝，不修写历史版本',async t=>{
 const install=await api(),f=await fixture(t);await fs.chmod(f.configPath,0o644);await assert.rejects(install(f),/protect|permission|config/);
 await fs.chmod(f.configPath,0o600);const installed=await install(f);
 await fs.writeFile(path.join(installed.directory,f.files[0].path),'tampered');await assert.rejects(install(f),/drift|conflict|digest/);
 assert.equal(await fs.readFile(path.join(installed.directory,f.files[0].path),'utf8'),'tampered');
});
