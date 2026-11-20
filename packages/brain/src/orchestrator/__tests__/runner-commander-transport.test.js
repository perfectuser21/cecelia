import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCommanderTransport} from '../runner-commander-transport.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
test('固定Commander进程收到版本化Skill全文，来源漂移禁止运行',async()=>{
 const cwd=await fs.mkdtemp(join(tmpdir(),'commander-transport-'));
 try{
  const code=`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify({action:'steer',text:x.skill.content+' '+x.run_id}));`;
  await fs.writeFile(join(cwd,'commander.mjs'),code);await fs.writeFile(join(cwd,'commander.md'),'按验收纠偏');
  const transport=createCommanderTransport({cwd,profile:{entry:'commander.mjs',skill:{entry:'commander.md',version:'1.0.0'}},files:{'commander.mjs':hash(code),'commander.md':hash('按验收纠偏')}});
  expect(await transport({run_id:'run1',phase:'wake'})).toEqual({action:'steer',text:'按验收纠偏 run1'});
  await fs.writeFile(join(cwd,'commander.md'),'弱化规则');
  await expect(transport({run_id:'run1',phase:'event'})).rejects.toThrow(/source_mismatch/);
 }finally{await fs.rm(cwd,{recursive:true,force:true});}
});

test('本地Commander真实进程死亡后桥可启动新观察回合',async()=>{
 const cwd=await fs.mkdtemp(join(tmpdir(),'commander-death-'));
 try{
  const code=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);if(!fs.existsSync('died')){fs.writeFileSync('died',String(process.pid));process.kill(process.pid,'SIGKILL');}console.log(JSON.stringify({action:'answer',text:x.run_id}));`;
  await fs.writeFile(join(cwd,'commander.mjs'),code);await fs.writeFile(join(cwd,'skill.md'),'只观察');
  const transport=createCommanderTransport({cwd,profile:{entry:'commander.mjs',timeout_s:2,skill:{entry:'skill.md',version:'1'}},files:{'commander.mjs':hash(code),'skill.md':hash('只观察')}});
  const {createCommanderBridge}=await import('../runner-commander-bridge.js');
  const c=createCommanderBridge({run_id:'original-run',transport});await c.wake();
  expect(await c.notify('generic-work',{}, {executor_kind:'agent'})).toEqual({action:'answer',text:'original-run'});
  expect(c.status).toBe('available');
 }finally{await fs.rm(cwd,{recursive:true,force:true});}
});
