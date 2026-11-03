import {test,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {validateWorkflow} from '../workflow-validator.js';
test('failed independent validator retains attempted source and actual process failure',async()=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'validator-failure-'));try{const source="process.stdin.resume();process.stdin.on('end',()=>process.exit(7));";fs.writeFileSync(path.join(cwd,'check.mjs'),source);const sha256=createHash('sha256').update(source).digest('hex');
 const profile={cwd,files:{'check.mjs':sha256},contract:{activities:[]},metadata:{},validators:{workflow:{entry:'check.mjs',acceptance:{ref:'dod@1'}}}};
 const v=(await validateWorkflow(profile,{outputs:{}})).workflow;expect(v.verdict).toBe('unknown');expect(v.executor.sha256).toBe(sha256);expect(v.transport.exit_code).toBe(7);expect(v.started_at).toBeTruthy();expect(v.ended_at).toBeTruthy();
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
test('活动判定在下一活动前读取独立证据且final验证不再次调用活动判定',async()=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'validator-activity-'));try{
 const source=`import fs from 'node:fs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);fs.appendFileSync('checks',x.scope+'\\n');const pass=fs.readFileSync('result','utf8')==='42';console.log(JSON.stringify({verdict:pass?'pass':'fail',acceptance_ref:x.acceptance.ref,evidence:[{path:'result',observed:pass}]}));`;
 fs.writeFileSync(path.join(cwd,'check.mjs'),source);fs.writeFileSync(path.join(cwd,'result'),'7');const profile={cwd,files:{'check.mjs':createHash('sha256').update(source).digest('hex')},contract:{activities:[{key:'work'}]},metadata:{work:{questions:{A4:{ref:'work@1'},A2:{ref:'ready@1'}}}},validators:{work:{entry:'check.mjs',acceptance:{ref:'work@1'}}},preconditions:{work:{entry:'check.mjs',acceptance:{ref:'ready@1'}}}};
 const {validateActivity}=await import('../workflow-validator.js');const a={key:'work'};
 const first=await validateActivity(profile,a,{outputs:{}},{receipt:{outputs:{}}});expect(first.verdict).toBe('fail');
 fs.writeFileSync(path.join(cwd,'result'),'42');const second=await validateActivity(profile,a,{outputs:{}},{receipt:{outputs:{}}});expect(second.verdict).toBe('pass');
 const start=await validateActivity(profile,a,null,{phase:'start',receipt:{outputs:{}}});expect(start.verdict).toBe('pass');
 const receipt={outputs:{},activities:[{key:'work',validator_verdict:second}]};const end=await validateWorkflow(profile,receipt,{skipActivities:true});expect(end.activities.work.verdict).toBe('pass');expect(fs.readFileSync(path.join(cwd,'checks'),'utf8').trim().split('\n')).toEqual(['work','work','work']);
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
