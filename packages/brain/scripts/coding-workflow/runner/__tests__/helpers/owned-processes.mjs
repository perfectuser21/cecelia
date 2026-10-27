// 测试专用实际进程所有权账。无需宿主进程枚举；随机挑战只由当前实例回答。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const random = () => crypto.randomBytes(32).toString('hex');
const mac = (key, value) => crypto.createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function write(file, data) { const temp = file + '.' + random(); fs.writeFileSync(temp,JSON.stringify(data),{mode:0o600});fs.renameSync(temp,file); }
function config(env) {
  const dir=env.CW_TEST_PROCESS_DIR,key=env.CW_TEST_PROCESS_KEY;
  if(!dir || !hex(key)) throw Error('owned_registry_invalid');
  const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('owned_registry_invalid');
  let header;try{header=JSON.parse(fs.readFileSync(path.join(dir,'registry'),'utf8'));}catch{throw Error('owned_registry_invalid');}
  if(header.key_hash!==crypto.createHash('sha256').update(key).digest('hex')||!positive(header.owner))throw Error('owned_registry_credentials');
  return {dir,key,owner:header.owner};
}
export function createOwnedRegistry(root) {
  const dir=fs.mkdtempSync(path.join(root,'owned-processes-'));fs.chmodSync(dir,0o700);const key=random();
  write(path.join(dir,'registry'),{owner:process.pid,key_hash:crypto.createHash('sha256').update(key).digest('hex')});
  return {CW_TEST_PROCESS_DIR:dir,CW_TEST_PROCESS_KEY:key};
}
export function registerOwnedProcess(env=process.env) {
  if(!env.CW_TEST_PROCESS_DIR)return;
  const {dir,key}=config(env);const record={pid:process.pid,ppid:process.ppid,instance:random()};
  write(path.join(dir,record.pid+'.json'),{...record,proof:mac(key,record)});
  const timer=setInterval(()=>{
    try {
      const request=JSON.parse(fs.readFileSync(path.join(dir,record.pid+'.request'),'utf8'));
      if(request.instance!==record.instance||!hex(request.nonce))return;
      write(path.join(dir,record.pid+'.response'),{nonce:request.nonce,proof:mac(record.instance,request.nonce)});
    }catch{/* 尚无挑战或测试已结束 */}
  },5);timer.unref();
}
function records(env) {
  const cfg=config(env);
  const rows=fs.readdirSync(cfg.dir).filter(n=>n.endsWith('.json')).map(name=>{
    let row;try{row=JSON.parse(fs.readFileSync(path.join(cfg.dir,name),'utf8'));}catch{throw Error('owned_record_invalid');}
    const {pid,ppid,instance,proof}=row;
    if(!positive(pid)||!positive(ppid)||!hex(instance)||name!==pid+'.json'||proof!==mac(cfg.key,{pid,ppid,instance}))throw Error('owned_record_invalid');
    return row;
  });return {...cfg,rows};
}
function exists(pid) {try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
function authenticate(row,dir) {
  if(!exists(row.pid))return false;
  const nonce=random();write(path.join(dir,row.pid+'.request'),{instance:row.instance,nonce});
  for(let i=0;i<40;i++) {
    try{const response=JSON.parse(fs.readFileSync(path.join(dir,row.pid+'.response'),'utf8'));if(response.nonce===nonce&&response.proof===mac(row.instance,nonce))return true;}catch{}
    if(!exists(row.pid))return false;pause(5);
  }
  throw Error(`owned_identity_unverified:${row.pid}`);
}
export function ownedChildren(parent,env=process.env) {
  const {dir,owner,rows}=records(env);
  if(!positive(parent)||parent!==owner&&!rows.some(r=>r.pid===parent)&&!rows.some(r=>r.ppid===parent))throw Error('owned_parent_unknown');
  return rows.filter(r=>r.ppid===parent&&authenticate(r,dir)).map(r=>r.pid);
}
export async function cleanupOwnedProcesses(env) {
  const {dir,rows}=records(env);const errors=[];
  for(const row of rows.reverse()) {
    try{if(authenticate(row,dir))process.kill(row.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')errors.push(error);}
  }
  // 让本测试进程收割直接子进程；仅确认，不向未证明身份的PID补发信号。
  for(let i=0;i<100&&rows.some(r=>exists(r.pid));i++)await new Promise(r=>setTimeout(r,10));
  if(errors.length)throw errors[0];
  if(rows.some(r=>exists(r.pid)))throw Error('owned_cleanup_incomplete');
}
export function installOwnedPgrep(root,env) {
  config(env);const bin=fs.mkdtempSync(path.join(root,'owned-bin-'));
  const script=`#!${process.execPath}\nimport {ownedChildren} from ${JSON.stringify(import.meta.url)};\ntry{if(process.argv.length!==4||process.argv[2]!=='-P'||!/^\\d+$/.test(process.argv[3]))throw Error('owned_pgrep_arguments');const rows=ownedChildren(Number(process.argv[3]));if(rows.length)process.stdout.write(rows.join('\\n')+'\\n');process.exitCode=rows.length?0:1;}catch(e){process.stderr.write(e.message+'\\n');process.exitCode=3;}\n`;
  // 无扩展名按Node当前默认模块语法检测；只安装本轮的pgrep命令。
  fs.writeFileSync(path.join(bin,'pgrep'),script,{mode:0o755});
  return {PATH:bin+path.delimiter+process.env.PATH};
}
