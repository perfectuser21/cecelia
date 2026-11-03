import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('真实coding Activity下一回合把Runner指导交给真实模型CLI输入且记录进展',async()=>{
 const root=await fs.mkdtemp(join(tmpdir(),'coding-guidance-'));
 try{
  const protocol=fileURLToPath(new URL('../lib/protocol.mjs',import.meta.url)),claude=fileURLToPath(new URL('../lib/claude.mjs',import.meta.url));
  const model=join(root,'model.mjs'),bin=join(root,'claude');
  await fs.writeFile(model,`import fs from 'node:fs';fs.writeFileSync('args',JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({type:'result',result:'ready',total_cost_usd:0}));`);
  await fs.writeFile(bin,`#!/bin/sh\nexec '${process.execPath}' '${model}' "$@"\n`,{mode:0o700});
  const source=`import {runActivity} from ${JSON.stringify(protocol)};import {runClaude} from ${JSON.stringify(claude)};await runActivity(async()=>{const r=await runClaude({args:['-p','按固定规格实现'],cwd:${JSON.stringify(root)},timeoutMs:3000,tag:'build'});return {status:r.code===0?'completed':'failed',outputs:{},metrics:{},evidence:[]};});`;
  await fs.writeFile(join(root,'activity.mjs'),source);
  const child=spawn(process.execPath,[join(root,'activity.mjs')],{cwd:root,env:{...process.env,CODING_WF_PROVIDER:'claude',CODING_WF_CLAUDE_BIN:bin},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);const done=new Promise(r=>child.on('close',r));
  child.stdin.end(JSON.stringify({run_tag:'r',commander_guidance:['按A4独立读回后再修正']}));
  expect(await done,err).toBe(0);expect(JSON.parse(out).status).toBe('completed');
  const args=JSON.parse(await fs.readFile(join(root,'args'),'utf8'));
  expect(args[args.indexOf('-p')+1]).toContain('按A4独立读回后再修正');
  expect(err.split('\n').some(line=>{try{return JSON.parse(line).protocol==='activity-agent-event/v1';}catch{return false;}})).toBe(true);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
