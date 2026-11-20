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
 const dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'native-agent-release-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
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
test('默认SSH stdin路径实际运行安装程序，传输不把包源码拼进命令参数',async t=>{
 const module=await import('../../../packages/brain/scripts/native-agent-release.mjs'),f=await fixture(t),{spawn}=await import('node:child_process');
 const result=await module.publishNativeAgentRelease({brainRoot:path.resolve('packages/brain'),env:{BRAIN_NATIVE_AGENT_MACHINE_ID:'us-mac-m4',BRAIN_NATIVE_AGENT_RELEASE_ROOT:f.root,BRAIN_NATIVE_AGENT_CONFIG_PATH:f.configPath},spawnFn:(_command,_args,options)=>spawn(process.execPath,['--input-type=module','-'],options)});
 const snapshot=JSON.parse(await fs.readFile(result.config_path,'utf8'));
 assert.equal(snapshot.profiles.main?.account_ref,'fixed-account','必须使用本次fixture配置，不能落回真实operator');
 assert.equal(snapshot.bundle_sha256,result.bundle_sha256);
 assert.equal(await fs.readFile(path.join(result.directory,'scripts/native-agent/cli.mjs'),'utf8'),await fs.readFile('packages/brain/scripts/native-agent/cli.mjs','utf8'));
});
test('共享可写目录中的配置不能成为原生账号权限真身',async t=>{
 const install=await api(),f=await fixture(t);await fs.chmod(path.dirname(f.configPath),0o777);await assert.rejects(install(f),/protect|permission|config/);
});

test('旧未知配置覆盖项明确拒绝，不静默使用宿主默认operator',async t=>{
 const module=await import('../../../packages/brain/scripts/native-agent-release.mjs'),f=await fixture(t);
 await assert.rejects(module.publishNativeAgentRelease({brainRoot:path.resolve('packages/brain'),env:{BRAIN_NATIVE_AGENT_MACHINE_ID:'us-mac-m4',BRAIN_NATIVE_AGENT_RELEASE_ROOT:f.root,BRAIN_NATIVE_AGENT_CONFIG_PATH:f.configPath},transport:async()=>{throw Error('must_not_transport');}}),/native_agent_config_override_unknown/);
});
