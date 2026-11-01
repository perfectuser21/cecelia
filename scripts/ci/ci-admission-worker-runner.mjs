/** 无发布凭据的Node worker；固定Git离线读取，唯一DB能力是本次synthetic scratch。 */
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,lstatSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
export async function runCiAdmissionWorker({sourceRoot,controlRoot,sourceRevision,controlRevision},{observe=()=>{}}={}){
 need([sourceRevision,controlRevision].every(r=>/^[a-f0-9]{40}$/.test(r||'')),'CI_ADMISSION_WORKER_INPUT');
 need(process.versions.node.split('.')[0]==='22','CI_ADMISSION_WORKER_NODE_VERSION');
 const directory=mkdtempSync(join(tmpdir(),'ci-admission-offline-')),home=join(directory,'home'),output=join(directory,'draft.json');mkdirSync(home,{mode:0o700});
 const env={PATH:`${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,CI:'true',NODE_ENV:'test',LANG:'C.UTF-8',HOME:home,TMPDIR:directory};
 for(const key of ['DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'])if(process.env[key]!==undefined)env[key]=process.env[key];
 let result;
 try{
  result=spawnSync(process.execPath,[join(resolve(controlRoot),'scripts/ci/ci-admission-worker.mjs'),resolve(sourceRoot),resolve(controlRoot),sourceRevision,controlRevision,output],
   {cwd:resolve(controlRoot),env,detached:true,encoding:'utf8',timeout:1500000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
  if(result.error||result.status!==0||result.signal)throw Object.assign(Error(`CI_ADMISSION_WORKER_FAILED exit=${result.status} signal=${result.signal||'null'} error=${result.error?.code||'null'}\n${(result.stderr||'').slice(-8000)}`),{code:'CI_ADMISSION_WORKER_FAILED'});
  const stat=lstatSync(output);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=16*1024*1024,'CI_ADMISSION_WORKER_OUTPUT');const receipt=JSON.parse(readFileSync(output,'utf8'));
  need(receipt.ci_worker_format==='cecelia.ci-worker/v1'&&/^ci_admission_[a-f0-9]{32}$/.test(receipt.readback?.schema||''),'CI_ADMISSION_WORKER_RECEIPT');observe(receipt.readback);return receipt.draft;
 }finally{
  // 只收尾本人新建进程组；worker异常/超时时不留下其测试子孙。
  try{if(result?.pid>0)process.kill(-result.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  finally{rmSync(directory,{recursive:true,force:true});}
 }
}
