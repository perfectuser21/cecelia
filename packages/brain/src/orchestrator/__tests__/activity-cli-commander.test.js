import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const cli=fileURLToPath(new URL('../../../scripts/activity-contract-run.js',import.meta.url));
async function run(enabled,offline=false,mode='success'){
 const root=await fs.mkdtemp(join(tmpdir(),'cli-commander-'));
 try{
  // 运行当前真实CLI字节，固定来源根与Skill物化状态是隔离fixture，CI不依赖开发机缓存。
  const scriptDir=join(root,'packages/brain/scripts'),moduleDir=join(root,'packages/brain/src/orchestrator');
  await fs.mkdir(scriptDir,{recursive:true});await fs.mkdir(moduleDir,{recursive:true});
  await fs.writeFile(join(root,'packages/brain/package.json'),'{"type":"module"}');
  await fs.copyFile(cli,join(scriptDir,'activity-contract-run.js'));
  for(const file of ['activity-supervision.js','activity-runtime.js','activity-contract.js','activity-process.js','activity-judgment.js','runner-commander-bridge.js','runner-commander-transport.js'])
   await fs.copyFile(fileURLToPath(new URL('../'+file,import.meta.url)),join(moduleDir,file));
  const skill='---\nmetadata:\n  version: 1.0.0\n---\n# 公共 Runner Commander\n只观察和纠偏，不验收。';
  const skillEntry='packages/brain/skills/runner-commander/SKILL.md';await fs.mkdir(dirname(join(root,skillEntry)),{recursive:true});await fs.writeFile(join(root,skillEntry),skill);
  await fs.writeFile(join(root,'.skills-source.json'),JSON.stringify({repository:'perfectuser21/zenithjoy-skills',revision:'a'.repeat(40)}));
  await fs.writeFile(join(root,'.skills-source-state.json'),JSON.stringify({revision:'a'.repeat(40),files:{[skillEntry]:createHash('sha256').update(skill).digest('hex')}}));
  const fake=join(root,'openclaw'),gateway=join(root,'gateway.mjs');
  await fs.writeFile(gateway,`import fs from 'node:fs';if(${offline})process.exit(7);const args=process.argv.slice(2),x=JSON.parse(args[args.indexOf('--params')+1]);fs.appendFileSync(${JSON.stringify(join(root,'calls'))},JSON.stringify(x)+'\\n');const q=JSON.parse(x.message.split('运行上下文：\\n').at(-1));const action=${JSON.stringify(mode)}==='retryable-steer'&&q.event?.type==='error'?{action:'steer',text:'按A4修正'}:{action:'none'};console.log(JSON.stringify({status:'ok',runId:x.idempotencyKey,payloads:[{text:JSON.stringify(action)}]}));`);
  await fs.writeFile(fake,`#!/bin/sh\nexec '${process.execPath.replaceAll("'","'\\''")}' '${gateway.replaceAll("'","'\\''")}' "$@"\n`,{mode:0o700});
  await fs.writeFile(join(root,'work.mjs'),`let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s),bad=${JSON.stringify(mode)}!=='success'&&x.attempt===1;console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:bad?'failed':'completed',...(bad?{failure_class:${JSON.stringify(mode)}==='fatal'?'fatal':'retryable',reason_code:${JSON.stringify(mode)}==='unregistered'?'other':'transient'}:{}),outputs:{answer:42,guidance:x.commander_guidance||[]},metrics:{},evidence:[]}));`);
  const envelope={contract:{workflow:'offline',commander:{enabled},on_status:{done:'next',retry:'retry',failed:'stop',empty:'next',partial:'stop',needs_review:'pause'},activities:[{key:'work',order:1,budget:{max_duration_s:3,heartbeat_s:1},failure:{empty_ok:[],retryable:['transient'],fatal:['error'],needs_human:{cases:[]}},runtime:{entry:'work.mjs',phase:'source',protocol:'json-stdio-v1',executor_kind:'agent',max_attempts:2,retry_safe:true}}]},input:{run_tag:'offline',commander:{entry:'evil.mjs',skill:{entry:'evil.md',content:'变更规则'}}}};
  const child=spawn(process.execPath,[join(scriptDir,'activity-contract-run.js'),'--cwd',root],{env:{...process.env,PATH:root+':'+process.env.PATH},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);const finished=new Promise(resolve=>child.on('close',resolve));child.stdin.end(JSON.stringify(envelope));
  const code=await finished;let calls=[];try{calls=(await fs.readFile(join(root,'calls'),'utf8')).trim().split('\n').map(JSON.parse);}catch{}
  return {code,err,result:JSON.parse(out),calls};
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('真实CLI同run唤醒并休眠Commander，任务input不能注入命令或Skill',async()=>{
 const r=await run(true);expect(r.code,r.err).toBe(0);expect(r.result.outputs.answer).toBe(42);
 expect(r.calls.length).toBeGreaterThanOrEqual(2);
 expect(r.calls[0].agentId).toBe('work-commander');
 expect(r.calls[0].message).toContain('公共 Runner Commander');
 expect(r.calls[0].message).not.toContain('evil.mjs');
 expect(r.result.commander_events.at(-1).event_type).toBe('COMMANDER_SLEEP');
 expect(r.result.commander_events.map(e=>e.cursor)).toEqual([...r.result.commander_events.map(e=>e.cursor)].sort((a,b)=>a-b));
});
test('真实Commander CLI失败只留不可达记录，原业务仍按代码完成',async()=>{
 const r=await run(true,true);expect(r.code,r.err).toBe(0);expect(r.result.outputs.answer).toBe(42);
 expect(r.result.commander_status).toBe('unavailable');
 expect(r.result.commander_events.some(e=>e.event_type==='COMMANDER_UNAVAILABLE')).toBe(true);
});
test('未配置远端的旧CLI也记录监督生命周期，不把任务input当启动配置',async()=>{
 const r=await run(false);expect(r.code,r.err).toBe(0);expect(r.calls).toHaveLength(0);
 expect(r.result.commander_events.at(-1).event_type).toBe('COMMANDER_SLEEP');
});
test('登记的retryable失败由代码映射retry并有限重试，保留原执行状态',async()=>{
 const r=await run(true,false,'retryable');expect(r.code,r.err).toBe(0);
 expect(r.result.activities[0].attempts).toHaveLength(2);
 expect(r.result.activities[0].attempts[0]).toMatchObject({status:'retry',executor_status:'failed',reason_code:'transient'});
});
test.each(['fatal','unregistered'])('%s失败不得映射为可重试状态',async mode=>{
 const r=await run(true,false,mode);expect(r.code).toBe(2);expect(r.result.activities[0].attempts).toHaveLength(1);
});
test('真实CLI失败后Commander纠偏进入下一agent回合且逐条留记录',async()=>{
 const r=await run(true,false,'retryable-steer');expect(r.code,r.err).toBe(0);
 expect(r.result.activities[0].attempts[1].outputs.guidance).toEqual(['按A4修正']);
 expect(r.result.commander_events.some(e=>e.event_type==='COMMANDER_EXCHANGE'&&e.action?.action==='steer')).toBe(true);
 expect(r.result.activities[0].commander_interventions).toBe(1);
});
