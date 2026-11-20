import {spawnSync} from 'node:child_process';
import supervisor from '../../src/orchestrator/activity-supervisor-state.cjs';
const {processBirth,observeProcess}=supervisor;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function groupMembers(pgid,{ps=spawnSync,birthOf=processBirth,observe=observeProcess}={}){
 const p=ps('/bin/ps',['-axo','pid=,pgid=,stat='],{encoding:'utf8',timeout:2000,env:{PATH:'/usr/bin:/bin',LANG:'C'}});
 if(p.status!==0)return null;
 const members=[];for(const line of p.stdout.trim().split('\n')){const [pid,group,status]=line.trim().split(/\s+/);if(Number(group)!==pgid||status?.startsWith('Z'))continue;const birth=birthOf(Number(pid));if(!birth){if(observe(Number(pid),'absence-probe')==='absent')continue;return null;}members.push({pid:Number(pid),birth});}return members;
}
export async function stopGroup(child,grace=300){
 let members=groupMembers(child.pid);if(members===null)return false;if(!members.length)return true;
 const leader=observeProcess(child.pid,child.birth);
 if(leader!=='matching')return false;
 if(members.some(p=>observeProcess(p.pid,p.birth)!=='matching'))return false;
 try{process.kill(-child.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')return false;}
 await sleep(Math.max(50,Math.min(grace,30000)));
 let current=null;for(let n=0;n<10&&current===null;n++){current=groupMembers(child.pid);if(current===null)await sleep(25);}if(current===null)return false;
 if(current.length){
  // 原成员仍在相同独立session；新PID或出生时间未知时不向不明代际发送KILL。
  if(current.some(p=>!members.some(old=>old.pid===p.pid&&old.birth===p.birth)||observeProcess(p.pid,p.birth)!=='matching'))return false;
  try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')return false;}
 }
 for(let n=0;n<40;n++){const left=groupMembers(child.pid);if(left!==null&&!left.length)return true;await sleep(25);}return false;
}
