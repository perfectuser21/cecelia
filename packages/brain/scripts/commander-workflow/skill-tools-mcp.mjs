// 受信宿主stdio适配器；不是任意命令接口。response_paths只投影操作者审阅字段，不能识别任意脚本中的所有秘密。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {durableWrite} from '../../src/orchestrator/activity-supervisor.js';
import {isolatedCodexArgs} from './checker-evidence.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=p=>sha(fs.readFileSync(p));
const json=v=>JSON.stringify(v);
const fail=reason=>{throw Error(reason);};
const safeName=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const active=new Set();
const atomic=durableWrite;
function sourceFile(cwd,entry){
 if(typeof entry!=='string'||path.isAbsolute(entry)||entry.split(/[\\/]/).includes('..'))fail('host_tool_config_invalid');
 const file=fs.realpathSync(path.resolve(cwd,entry));if(!file.startsWith(cwd+path.sep)||!fs.statSync(file).isFile())fail('host_tool_config_invalid');return file;
}
export function prepareHostTools({config,cwd,files,identity,activityKey,inputFile,directory,deadlineMs}){
 if(!config)return null;
 const keys=['command','command_sha256','entry','timeout_ms','response_paths','kinds'];
 if(Object.keys(config).some(k=>!keys.includes(k))||!path.isAbsolute(config.command??'')||hash(config.command)!==config.command_sha256
  ||!Array.isArray(config.kinds)||!config.kinds.length||config.kinds.some(k=>!safeName(k))
  ||!Number.isInteger(config.timeout_ms)||config.timeout_ms<1||config.timeout_ms>420000
  ||!Array.isArray(config.response_paths)||config.response_paths.length>32
  ||config.response_paths.some(p=>typeof p!=='string'||!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(p)||p.split('.').some(k=>['__proto__','constructor','prototype'].includes(k))))fail('host_tool_config_invalid');
 const root=fs.realpathSync(cwd);sourceFile(root,config.entry);if(!files?.[config.entry])fail('host_tool_source_unfrozen');
 if(!identity||!safeName(activityKey)||!path.isAbsolute(inputFile)||!path.isAbsolute(directory)||!Number.isFinite(deadlineMs))fail('host_tool_config_invalid');
 const binding={...config,cwd:root,files:{...files},identity:{...identity},activity_key:activityKey,input_file:inputFile,input_sha256:hash(inputFile),directory:path.join(fs.realpathSync(path.dirname(directory)),path.basename(directory)),deadline_ms:deadlineMs};
 verify(binding);return binding;
}
function verify(b){
 if(Date.now()>=b.deadline_ms)fail('host_tool_deadline');
 let input;try{if(hash(b.input_file)!==b.input_sha256)fail('host_tool_identity_drift');input=JSON.parse(fs.readFileSync(b.input_file));}catch{fail('host_tool_identity_drift');}
 if(json(input.identity)!==json(b.identity)||input.activity_key!==b.activity_key)fail('host_tool_identity_drift');
 try{
  if(hash(b.command)!==b.command_sha256)fail('host_tool_source_drift');
  for(const [entry,expected] of Object.entries(b.files))if(hash(sourceFile(b.cwd,entry))!==expected)fail('host_tool_source_drift');
 }catch{fail('host_tool_source_drift');}
}
function requestCheck(b,r){
 if(!r||Object.keys(r).sort().join(',')!=='action_name,args,kind'||!b.kinds.includes(r.kind)||!safeName(r.action_name)
  ||!Array.isArray(r.args)||r.args.length>64||r.args.some(a=>typeof a!=='string'||a.includes('\0')||Buffer.byteLength(a)>65536)||Buffer.byteLength(json(r))>262144)fail('host_tool_request_invalid');
}
function killGroup(child){if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
async function execute(b,r){
 return new Promise((resolve,reject)=>{
  let child,stdout='',stderr='',reason,closed=false;
  const stop=code=>{reason??=code;if(child)killGroup(child);};
  const timer=setTimeout(()=>stop('timeout'),Math.min(b.timeout_ms,b.deadline_ms-Date.now()));
  try{child=spawn(b.command,[sourceFile(b.cwd,b.entry),r.kind,r.action_name,...r.args],{cwd:b.cwd,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,
    COMMANDER_ACTIVITY_KEY:b.activity_key,COMMANDER_ACTIVITY_INPUT_FILE:b.input_file},detached:true,stdio:['ignore','pipe','pipe']});active.add(child);}catch{clearTimeout(timer);reject(Error('host_tool_spawn_failed'));return;}
  const collect=(key,data)=>{if(key==='stdout')stdout+=data;else stderr+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>1024*1024)stop('output_limit');};
  child.stdout.on('data',d=>collect('stdout',d));child.stderr.on('data',d=>collect('stderr',d));child.once('error',()=>{reason='spawn_failed';});
  child.once('close',(code,signal)=>{if(closed)return;closed=true;clearTimeout(timer);active.delete(child);killGroup(child);resolve({code,signal,reason,stdout,stderr});});
 });
}
function project(value,paths){
 const output={};for(const p of paths){let v=value;for(const key of p.split('.')){if(!v||typeof v!=='object'||!Object.hasOwn(v,key)){v=undefined;break;}v=v[key];}
  if(v!==undefined)output[p]=v;
 }
 if(Buffer.byteLength(json(output))>32768)fail('host_tool_response_limit');return output;
}
export function createHostToolCaller(binding,{isStopping=()=>false}={}){
 if(!binding)fail('host_tool_config_invalid');
 return {async call(r){
  if(isStopping())fail('host_tool_stopping');requestCheck(binding,r);verify(binding);fs.mkdirSync(binding.directory,{recursive:true,mode:0o700});
  const file=path.join(binding.directory,r.action_name+'.json'),bindingHash=sha(json(binding)),requestHash=sha(json({kind:r.kind,action_name:r.action_name,args:r.args}));
  const prior=()=>{if(!fs.existsSync(file))return null;const old=JSON.parse(fs.readFileSync(file));if(old.binding_sha256!==bindingHash||old.request_sha256!==requestHash)fail('host_tool_action_conflict');if(old.state!=='terminal')fail('host_tool_unknown');return old.response;};
  const old=prior();if(old)return old;
  const lock=file+'.lock';let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch{fail('host_tool_busy');}
  try{
   const again=prior();if(again)return again;verify(binding);
   const record={binding_sha256:bindingHash,request_sha256:requestHash,state:'unknown'};atomic(file,record);
   if(isStopping())fail('host_tool_stopping');
   const result=await execute(binding,r);fs.writeFileSync(file+'.stdout',result.stdout,{mode:0o600});fs.writeFileSync(file+'.stderr',result.stderr,{mode:0o600});
   if(result.reason||result.signal||result.code===null)fail('host_tool_unknown');
   let parsed;try{parsed=JSON.parse(result.stdout);}catch{fail('host_tool_unknown');}
   const response={state:'terminal',exit_code:result.code,output:project(parsed,binding.response_paths),evidence_ref:file,stdout_sha256:sha(result.stdout)};
   atomic(file,{...record,state:'terminal',response});return response;
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
 }};
}
// Only an empty journal or the frozen adapter's explicit pre-dispatch refusals
// establish that another invocation cannot repeat a previous effect.
export function hostToolsDidNotDispatch(workDir,identity){
 try{
  const root=fs.realpathSync(workDir),bindingPath=path.join(root,'host-tools-binding.json'),directory=path.join(root,'host-tools');
  const binding=JSON.parse(fs.readFileSync(bindingPath,'utf8'));
  if(binding.directory!==directory||json(binding.identity)!==json(identity)||fs.realpathSync(directory)!==directory)return false;
  verify(binding);
  const names=fs.readdirSync(directory);
  const files=names.filter(name=>name.endsWith('.json'));
  if(names.length!==files.length*3)return false;
  const bindingHash=hash(bindingPath);
  return files.every(name=>{
   if(!safeName(name.slice(0,-5)))return false;
   const file=path.join(directory,name);
   for(const p of [file,file+'.stdout',file+'.stderr']){
    const stat=fs.lstatSync(p);
    if(!stat.isFile()||stat.nlink!==1||stat.size>1024*1024)return false;
   }
   const record=JSON.parse(fs.readFileSync(file,'utf8')),stdout=fs.readFileSync(file+'.stdout');
   const parsed=JSON.parse(stdout.toString('utf8')),result=parsed.result;
   return record.binding_sha256===bindingHash&&/^[a-f0-9]{64}$/.test(record.request_sha256??'')&&
    record.state==='terminal'&&record.response?.evidence_ref===file&&record.response.exit_code===2&&
    record.response.stdout_sha256===sha(stdout)&&parsed.state==='terminal'&&result?.exit_code===2&&
    result.data?.phase==='pre_dispatch'&&result.data.dispatched===false&&result.data.external_effect==='none';
  });
 }catch{return false;}
}
// 核对宿主调用是否已收束。外部业务结果仍由本轮独立探针核验。
export function hostToolsAreQuiescent(workDir,identity,deadlineMs){
 try{
  const root=fs.realpathSync(workDir),directory=path.join(root,'host-tools');
  const bindingFile=path.join(root,'host-tools-binding.json'),inputFile=path.join(root,'activity-input.json');
  const privateDirectory=file=>{
   const s=fs.lstatSync(file);return s.isDirectory()&&s.uid===process.getuid()&&!(s.mode&0o077);
  };
  if(!privateDirectory(root)||!privateDirectory(directory))return false;
  const read=file=>{
   const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   try{
    const s=fs.fstatSync(fd);
    if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077)||s.size>1024*1024)fail('host_tool_receipt_unprotected');
    return fs.readFileSync(fd);
   }finally{fs.closeSync(fd);}
  };
  const bindingBytes=read(bindingFile),binding=JSON.parse(bindingBytes),inputBytes=read(inputFile),input=JSON.parse(inputBytes);
  if(binding.directory!==directory||fs.realpathSync(binding.input_file)!==inputFile||binding.input_sha256!==sha(inputBytes)
    ||binding.deadline_ms!==deadlineMs||binding.activity_key!==input.activity_key
    ||json(binding.identity)!==json(identity)||json(input.identity)!==json(identity))return false;
  const names=fs.readdirSync(directory).sort(),records=names.filter(name=>name.endsWith('.json'));
  if(names.length!==records.length*3)return false;
  const bindingHash=sha(bindingBytes);
  const terminal=records.every(name=>{
   if(!safeName(name.slice(0,-5)))return false;
   const file=path.join(directory,name),record=JSON.parse(read(file)),stdout=read(file+'.stdout');
   read(file+'.stderr');
   const state=JSON.parse(stdout).state;
   return record.binding_sha256===bindingHash&&/^[a-f0-9]{64}$/.test(record.request_sha256??'')
    &&record.state==='terminal'&&record.response?.state==='terminal'&&record.response.evidence_ref===file
    &&Number.isInteger(record.response.exit_code)&&record.response.stdout_sha256===sha(stdout)
    &&(state===undefined||state==='terminal');
  });
  return terminal&&json(names)===json(fs.readdirSync(directory).sort());
 }catch{return false;}
}
export function hostToolsArgs(bindingFile,bindingHash,directory,authHome,{mediated=false}={}){
 if(!path.isAbsolute(authHome??''))fail('host_tool_auth_required');
 const toml=v=>v&&typeof v==='object'&&!Array.isArray(v)?`{${Object.entries(v).map(([k,x])=>`${json(k)}=${toml(x)}`).join(',')}}`:json(v);
 // 与prepareCodexAuth相同的权限基线，只额外deny宿主回执；完整对象避免CLI把路径中的点拆成键。
 const permissions={commander_activity:{extends:mediated?':read-only':':workspace',
  filesystem:{[authHome]:'deny',[path.join(process.env.HOME,'.credentials')]:'deny',[directory]:'deny'},network:{enabled:!mediated}}};
 const server=fileURLToPath(import.meta.url),prefix='mcp_servers.commander_host_tools';
 return [...(mediated?isolatedCodexArgs():[]),'-c',`${prefix}.command=${json(process.execPath)}`,'-c',`${prefix}.args=${json([server,bindingFile,bindingHash])}`,
  '-c',`${prefix}.enabled_tools=["invoke"]`,'-c',`${prefix}.tool_timeout_sec=430`,'-c',`${prefix}.tools.invoke.approval_mode="approve"`,
  '-c',`permissions=${toml(permissions)}`];
}
async function serve(file,expected){
 if(!/^[a-f0-9]{64}$/.test(expected)||hash(file)!==expected)fail('host_tool_binding_drift');
 let stopping=false;
 const binding=JSON.parse(fs.readFileSync(file));const caller=createHostToolCaller(binding,{isStopping:()=>stopping});
 let chain=Promise.resolve();const lines=readline.createInterface({input:process.stdin});
 const shutdown=()=>{stopping=true;for(const child of active)killGroup(child);lines.close();};
 process.once('SIGTERM',()=>{shutdown();process.exitCode=143;});process.once('SIGINT',shutdown);process.stdin.once('end',shutdown);
 for await(const line of lines){
  if(Buffer.byteLength(line)>300000){shutdown();break;}
  chain=chain.then(async()=>{let r;try{
   r=JSON.parse(line);if(r.id===undefined)return;if(stopping)fail('host_tool_stopping');let result;
   if(r.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'commander-host-tools',version:'1'}};
   else if(r.method==='ping')result={};
   else if(r.method==='tools/list')result={tools:[{name:'invoke',description:'调用本Activity冻结的宿主业务工具；原Task、范围和幂等约束仍生效，回执由独立Checker验收。',inputSchema:{type:'object',properties:{kind:{type:'string',enum:binding.kinds},action_name:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},args:{type:'array',items:{type:'string'},maxItems:64}},required:['kind','action_name','args'],additionalProperties:false}}]};
   else if(r.method==='tools/call'&&r.params?.name==='invoke'){if(hash(file)!==expected)fail('host_tool_binding_drift');result={content:[{type:'text',text:json(await caller.call(r.params.arguments))}]};}
   else fail('host_tool_method_invalid');
   process.stdout.write(json({jsonrpc:'2.0',id:r.id,result})+'\n');
  }catch(e){const message=/^host_tool_[a-z_]+$/.test(e.message)?e.message:'host_tool_failed';process.stdout.write(json({jsonrpc:'2.0',id:r?.id??null,error:{code:-32602,message}})+'\n');}});
 }
 await chain;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))serve(process.argv[2],process.argv[3]).catch(()=>{process.stderr.write('host_tool_start_failed\n');process.exitCode=1;});
