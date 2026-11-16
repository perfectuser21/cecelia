import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const fail=code=>{throw Error(code);};
export function identity(input){
 const source=input?._readiness;
 if(!source||!path.isAbsolute(source.root??'')||!['task_id','run_id'].every(k=>/^[a-f0-9-]{36}$/.test(source[k]??''))||input.run_tag!==source.run_id
  ||!/^[a-f0-9]{40}$/.test(input.expected_brain_sha??'')||!/^\d+\.\d+\.\d+$/.test(input.expected_brain_version??'')||!/^[a-f0-9]{64}$/.test(input.action_id??''))fail('readiness_identity_invalid');
 if(!fs.lstatSync(source.root).isDirectory()||fs.lstatSync(source.root).isSymbolicLink())fail('readiness_evidence_invalid');
 return {task_id:source.task_id,run_id:source.run_id,run_tag:input.run_tag,expected_brain_sha:input.expected_brain_sha,expected_brain_version:input.expected_brain_version,action_id:input.action_id};
}
export function directory(input,create=false){
 identity(input);const dir=path.join(input._readiness.root,'readiness-evidence');
 if(create&&!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});
 if(fs.existsSync(dir)&&(!fs.lstatSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink()))fail('readiness_evidence_invalid');
 return dir;
}
export function bytes(dir,name){
 const file=path.join(dir,name);let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>1024*1024)fail('readiness_evidence_invalid');return fs.readFileSync(fd);}
 catch(error){if(error.code==='ENOENT')return null;fail('readiness_evidence_invalid');}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function read(dir,name,required=true){const data=bytes(dir,name);if(data===null){if(required)fail('readiness_evidence_missing');return null;}try{return JSON.parse(data);}catch{fail('readiness_evidence_invalid');}}
export function writeOnce(dir,name,value){
 const data=JSON.stringify(value,null,2)+'\n';let fd;
 try{fd=fs.openSync(path.join(dir,name),'wx',0o600);fs.writeFileSync(fd,data);fs.fsyncSync(fd);}
 finally{if(fd!==undefined)fs.closeSync(fd);}
 return hash(data);
}
export function owner(actual,expected,action=true){
 if(!actual||Object.keys(expected).some(k=>(action||k!=='action_id')&&actual[k]!==expected[k]))fail('readiness_owner_conflict');
}
export function ownedResources(dir,expected,action=false){
 for(const name of ['reservation.json','lease.json']){const value=read(dir,name,false);if(value)owner(value,expected,action);}
}
export const result=(input,outputs,evidence)=>({schema_version:1,run_tag:input.run_tag,status:'completed',outputs,metrics:{},evidence:evidence.map(name=>'readiness-evidence/'+name),execution_stopped:true});
export function cli(meta,fn,{stoppedActivity=false}={}){
 if(process.argv[1]&&meta===pathToFileURL(process.argv[1]).href){
  let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{data+=chunk;if(data.length>1024*1024){process.stderr.write('readiness_input_limit\n');process.exit(1);}});
  process.stdin.on('end',async()=>{
   let input;
   try{input=JSON.parse(data);process.stdout.write(JSON.stringify(await fn(input))+'\n');}
   catch(error){
    const reason=/^readiness_[a-z_]+$/.test(error.message)?error.message:'readiness_execution_failed';
    // 仅本包只读/同步文件Activity使用：await已退出，没有后台子任务或未决外部写入。
    // checker保持非0拒绝；异常终止/信号不会经过此catch，不能冒充已停止。
    if(stoppedActivity&&typeof input?.run_tag==='string')process.stdout.write(JSON.stringify({...result(input,{},[]),status:'failed',failure_class:'fatal',reason_code:reason})+'\n');
    process.stderr.write(reason+'\n');process.exitCode=1;
   }
  });
 }
}
