import {test,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {validateWorkflow} from '../workflow-validator.js';
test('failed independent validator retains attempted source and actual process failure',async()=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'validator-failure-'));try{const source="process.stdin.resume();process.stdin.on('end',()=>process.exit(7));";fs.writeFileSync(path.join(cwd,'check.mjs'),source);const sha256=createHash('sha256').update(source).digest('hex');
 const profile={cwd,files:{'check.mjs':sha256},contract:{activities:[]},metadata:{},validators:{workflow:{entry:'check.mjs',acceptance:{ref:'dod@1'}}}};
 const v=(await validateWorkflow(profile,{outputs:{}})).workflow;expect(v.verdict).toBe('unknown');expect(v.executor.sha256).toBe(sha256);expect(v.transport.exit_code).toBe(7);expect(v.started_at).toBeTruthy();expect(v.ended_at).toBeTruthy();
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
