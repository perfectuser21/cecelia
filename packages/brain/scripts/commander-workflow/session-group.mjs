import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// 缺省组保留旧运行路径；显式组不归一化，避免名字合并或大小写文件系统串组。
export function sessionGroup(value,executorKind='agent'){
 if(value===undefined)return undefined;
 if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value))throw Error('skill_session_group_invalid');
 if(executorKind!=='agent')throw Error('skill_session_group_requires_agent');
 return value;
}
export function sessionThreadFile(root,group){
 return group===undefined?path.join(root,'thread.json'):
  path.join(root,'sessions',createHash('sha256').update(group).digest('hex'),'thread.json');
}
export function readSessionThread(file,{run_id,auth_identity,session_group}){
 if(!fs.existsSync(file))return null;
 const previous=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!previous||typeof previous!=='object'||Array.isArray(previous)
   ||previous.run_id!==run_id||previous.auth_identity!==auth_identity||previous.session_group!==session_group
   ||typeof previous.thread_id!=='string'||!previous.thread_id.trim())throw Error('skill_thread_identity_conflict');
 return previous;
}
