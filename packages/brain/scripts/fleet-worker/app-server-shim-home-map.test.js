import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url),{loadShimConfig}=require('./app-server-shim.cjs');
const main='/Users/operator/.openclaw/agents/main/agent/codex-home';
const work='/Users/operator/.openclaw/agents/work/agent/codex-home';
const base={brainUrl:'http://127.0.0.1:5221',internalToken:'test-control-'.repeat(4)};
const mappings=[{codexHome:main,homeId:'chat-main'},{codexHome:work,homeId:'chat-work'}];
function configFile(value){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shim-home-map-')),file=path.join(dir,'shim.json');
 fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
 return {file,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
it('保护配置按精确CODEX_HOME选择不同agent，重复同agent稳定且不保留映射权限',()=>{
 const f=configFile({...base,homeMap:mappings});
 try{for(const [codexHome,homeId]of [[main,'chat-main'],[work,'chat-work'],[main,'chat-main']]){
  const selected=loadShimConfig(f.file,{CODEX_HOME:codexHome,HOME:'/elsewhere',CECELIA_HOME_ID:'chat-evil'});
  expect(selected).toEqual({...base,homeId});expect(Object.isFrozen(selected)).toBe(true);
 }}finally{f.close();}
});
it.each([undefined,'',main+'/',main+'/../codex-home',main.replace('/agents/','//agents/'),'relative/codex-home','/unknown',main+'-other',42,null])('未知或非规范运行路径拒绝：%s',value=>{
 const f=configFile({...base,homeMap:mappings});
 try{expect(()=>loadShimConfig(f.file,{CODEX_HOME:value})).toThrow('appserver_shim_home_unmapped');}finally{f.close();}
});
it.each([
 {homeMap:[]},{homeMap:{}},{homeMap:null},{homeMap:'*'},
 {homeId:'chat-main',homeMap:mappings},{homeMap:[...mappings,mappings[0]]},
 {homeMap:[...mappings,{codexHome:'/other',homeId:'chat-main'}]},
 {homeMap:[{...mappings[0],fallback:true}]},{homeMap:[{...mappings[0],codexHome:'relative'}]},
 {homeMap:[{...mappings[0],codexHome:'/a/../b'}]},{homeMap:[{...mappings[0],codexHome:'/a//b'}]},
 {homeMap:[{...mappings[0],codexHome:'/a/./b'}]},{homeMap:[{...mappings[0],codexHome:'/a/'}]},
 {homeMap:[{...mappings[0],codexHome:'/a/*'}]},{homeMap:[{...mappings[0],codexHome:'/a\u0000b'}]},
 {homeMap:[{...mappings[0],codexHome:42}]},{homeMap:[{...mappings[0],homeId:42}]},
 {homeMap:[{...mappings[0],homeId:'chat-main/evil'}]},{homeMap:[null]},
 {homeMap:[{codexHome:main}]},{homeMap:mappings,envKey:'HOME'},
])('不合法或含重复项的白名单配置拒绝 %#',patch=>{
 const f=configFile({...base,...patch});
 try{expect(()=>loadShimConfig(f.file,{CODEX_HOME:main})).toThrow('appserver_shim_config_invalid');}finally{f.close();}
});
it.each([
 JSON.stringify({...base,homeId:'chat-main'}).replace('"homeId":"chat-main"','"homeId":"chat-main","homeId":"chat-work"'),
 JSON.stringify({...base,homeMap:mappings}).replace('"codexHome":','"codexHome":"/bad","codexHome":'),
 JSON.stringify({...base,homeId:'chat-main'}).replace('"homeId":"chat-main"','"homeId":"chat-main","home\\u0049d":"chat-work"'),
])('JSON重复键不能以last-wins改变受信选择 %#',raw=>{
 const f=configFile(raw);try{expect(()=>loadShimConfig(f.file,{CODEX_HOME:main})).toThrow('appserver_shim_config_invalid');}finally{f.close();}
});
it('旧单homeId配置仍兼容，并且不读取CODEX_HOME环境覆盖',()=>{
 const value={...base,homeId:'chat-single'},f=configFile(value);
 try{expect(loadShimConfig(f.file,{CODEX_HOME:main})).toEqual(value);}finally{f.close();}
});
function childShim(file,codexHome){
 return new Promise((resolve,reject)=>{
  const env={...process.env,CECELIA_APP_SERVER_SHIM_CONFIG:file};delete env.CODEX_HOME;if(codexHome!==undefined)env.CODEX_HOME=codexHome;
  const child=spawn(process.execPath,[fileURLToPath(new URL('./app-server-shim.cjs',import.meta.url)),'app-server','--listen','stdio://'],{env,stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='';const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('shim child timeout'));},5000);
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{clearTimeout(timeout);resolve({code,stderr,stdout});});
 });
}
it('真实shim进程从进程环境选择HOME，未知agent在任何HTTP前失败且无fallback',async()=>{
 const seen=[],server=createServer((req,res)=>{
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{seen.push(JSON.parse(body));res.end(JSON.stringify({status:'waiting_resources'}));});
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const f=configFile({...base,brainUrl:`http://127.0.0.1:${server.address().port}`,homeMap:mappings});
 try{
  for(const codexHome of [main,work,main])expect(await childShim(f.file,codexHome)).toMatchObject({code:1,stderr:'appserver_waiting_resources\n',stdout:''});
  expect(seen.map(body=>body.home_id)).toEqual(['chat-main','chat-work','chat-main']);
  expect(new Set(seen.map(body=>body.request_key)).size).toBe(3);
  for(const codexHome of ['/unknown',main+'/',undefined,''])expect(await childShim(f.file,codexHome)).toMatchObject({code:1,stderr:'appserver_shim_home_unmapped\n',stdout:''});
  expect(seen).toHaveLength(3);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));f.close();}
});
it('可选requestKey仍要求字符串，数组不能被正则隐式转成UUID',()=>{
 const f=configFile({...base,homeId:'chat-single',requestKey:['00000000-0000-4000-8000-000000000000']});
 try{expect(()=>loadShimConfig(f.file,{})).toThrow('appserver_shim_config_invalid');}finally{f.close();}
});
it('白名单有界：128项可选择，129项拒绝',()=>{
 const entries=Array.from({length:129},(_,i)=>({codexHome:'/trusted/agent-'+i,homeId:'chat-'+i}));
 const accepted=configFile({...base,homeMap:entries.slice(0,128)}),rejected=configFile({...base,homeMap:entries});
 try{expect(loadShimConfig(accepted.file,{CODEX_HOME:'/trusted/agent-127'}).homeId).toBe('chat-127');
  expect(()=>loadShimConfig(rejected.file,{CODEX_HOME:'/trusted/agent-127'})).toThrow('appserver_shim_config_invalid');
 }finally{accepted.close();rejected.close();}
});
