import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import serverModule from '../../scripts/fleet-worker/linux-pool-server.cjs';
import {UUID,HEX,error} from './deployment.js';
const unavailable=()=>error('linux_pool_credentials_unconfirmed');
/** 不source环境文件，不把token放argv，子进程输出与错误只在私有控制面内使用。 */
export function createPrivateOp({credentialFile='/root/.credentials/1password.env',configRoot='/root/.credentials/fleet-control/op',read=serverModule.readInstalledFile}={}){
 return async(args,input='')=>{
  const text=read(credentialFile,{mode:0o600,owner:0,maxBytes:16384});
  const entries=text.split('\n').filter(line=>/^\s*(?:export\s+)?OP_SERVICE_ACCOUNT_TOKEN=/.test(line));
  if(entries.length!==1)throw unavailable();
  const match=entries[0].match(/^\s*(?:export\s+)?OP_SERVICE_ACCOUNT_TOKEN=(?:'([A-Za-z0-9_.-]+)'|"([A-Za-z0-9_.-]+)"|([A-Za-z0-9_.-]+))\s*$/);
  const token=match&&(match[1]||match[2]||match[3]);if(!token)throw unavailable();
  return new Promise((resolve,reject)=>{
   const child=execFile('/usr/local/bin/op',args,{timeout:20000,maxBuffer:1024*1024,killSignal:'SIGKILL',
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/root',OP_CONFIG_DIR:configRoot,OP_SERVICE_ACCOUNT_TOKEN:token,LC_ALL:'C'}},
   (err,stdout)=>err?reject(unavailable()):resolve(stdout));
   child.stdin.on('error',()=>{});child.stdin.end(input);
  });
 };
}
/** 调用方持每机器DB会话锁，save先提交创建意图再允许外部副作用；未知结果仅重读CS，不重复create。 */
export function createOnboardingCredentials({root='/root/.credentials/fleet-control',run=createPrivateOp(),pathRoot='/',owner=process.getuid?.()??0}={}){
 function directory(p){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==(pathRoot==='/'?0:owner)||(s.mode&0o777)!==0o700)throw unavailable();}
 function parents(){let p=root;for(;;){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==(pathRoot==='/'?0:owner)||(s.mode&0o022))throw unavailable();if(p===pathRoot)break;const up=path.dirname(p);if(up===p)throw unavailable();p=up;}}
 function cache(file,value){
  try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.uid!==owner||(s.mode&0o777)!==0o600)throw unavailable();}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const tmp=file+'.'+randomUUID();let fd;
  try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,value);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);}
  finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}
 }
 return async(machineId,state,save)=>{
  try{
   if(!UUID.test(machineId??'')||!path.isAbsolute(root)||typeof save!=='function'||(state&&!['creating','ready'].includes(state.phase)))throw unavailable();
   parents();directory(root);const dir=path.join(root,machineId);try{fs.mkdirSync(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}directory(dir);
   let item=state?.phase==='ready'?state.item_id:null,created;
   if(!item){
    const title='Cecelia Linux '+machineId,tag='cecelia-linux:'+machineId;
    const found=JSON.parse(await run(['item','list','--vault','CS','--tags',tag,'--format','json']));
    if(!Array.isArray(found))throw unavailable();const matches=found.filter(x=>x.title===title&&x.tags?.includes(tag));
    if(matches.length>1)throw unavailable();item=matches[0]?.id;
    if(!item){
     if(state)throw unavailable();if(await save({phase:'creating'})===false)throw unavailable();
     const worker=randomBytes(32).toString('hex'),key=randomBytes(32).toString('hex');created=[worker,key];
     const template={title,category:'API_CREDENTIAL',tags:[tag],fields:[{id:'machine_registry_id',label:'machine_registry_id',type:'STRING',value:machineId},
      {id:'worker_token',label:'worker_token',type:'CONCEALED',value:worker},{id:'execution_key',label:'execution_key',type:'CONCEALED',value:key}]};
     // 即使create已生效但响应丢失，也保留creating；下一次只按唯一UUID标签找回。
     item=JSON.parse(await run(['item','create','-','--vault','CS','--format','json'],JSON.stringify(template))).id;
    }
   }
   if(!/^[a-z2-7]{26}$/.test(item??''))throw unavailable();
   const refs={worker_token:`op://CS/${item}/worker_token`,execution_key:`op://CS/${item}/execution_key`};
   const [worker,key]=await Promise.all(Object.values(refs).map(ref=>run(['read',ref]).then(v=>v.trim())));
   if(!HEX.test(worker)||!HEX.test(key)||worker===key||(created&&(worker!==created[0]||key!==created[1])))throw unavailable();
   const result={item_id:item,credential_refs:refs,worker_credential_file:path.join(dir,'worker_token'),execution_credential_file:path.join(dir,'execution_key')};
   directory(dir);cache(result.worker_credential_file,worker);cache(result.execution_credential_file,key);
   const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   if(await save({phase:'ready',item_id:item})===false)throw unavailable();return result;
  }catch{throw unavailable();}
 };
}
