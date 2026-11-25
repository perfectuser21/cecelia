import {test,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as tools from '../../../scripts/commander-workflow/checker-evidence.mjs';
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function fixture(){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'checker-facts-'));fs.mkdirSync(path.join(cwd,'evidence'));
 fs.writeFileSync(path.join(cwd,'facts.cjs'),`let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify({status:'available',source:'fixture:rows',facts:{rows:[{value:r.context.authorized_value}],identity:r.identity,args:r.args}}));});`);
 const config={roots:['evidence'],provider:{command:process.execPath,command_sha256:sha(process.execPath),entry:'facts.cjs',timeout_ms:1000}};
 const request={nonce:'nonce',task_id:'task',run_id:'run',context:{authorized_value:42},activity_contract:{key:'test'}};
 return {cwd,config,request,binding(){return tools.prepareCheckerEvidence({config,cwd,request,files:{'facts.cjs':sha(path.join(cwd,'facts.cjs'))},directory:path.join(cwd,'reads'),deadlineMs:Date.now()+2000});},close(){fs.rmSync(cwd,{recursive:true,force:true});}};
}
test('actual read-only fact provider receives trusted context and produces a bound raw-fact receipt',async()=>{
 const f=fixture();try{const b=f.binding();const value=await tools.readCheckerFact(b,{operation:'pg.rows',args:{ids:['id']}});
 expect(value.receipt.status).toBe('available');expect(value.receipt.facts.rows).toEqual([{value:42}]);expect(value.receipt.facts.identity.task_id).toBe('task');expect(tools.checkerEvidenceReceipts(b)).toHaveLength(1);
 }finally{f.close();}
});
test('provider source drift and arbitrary process/config input are rejected before execution',async()=>{
 const f=fixture();try{const b=f.binding();fs.appendFileSync(path.join(f.cwd,'facts.cjs'),'\n// drift');await expect(tools.readCheckerFact(b,{operation:'pg.rows',args:{}})).rejects.toThrow('checker_evidence_source_drift');
 await expect(tools.readCheckerFact(b,{operation:'pg.rows',args:{},command:'other'})).rejects.toThrow('checker_evidence_request_invalid');
 }finally{f.close();}
});
test('a specific verdict is not accepted as raw facts',async()=>{
 const f=fixture();try{fs.writeFileSync(path.join(f.cwd,'facts.cjs'),`console.log(JSON.stringify({status:'available',source:'old-checker',outcome:'passed',checks:[]}));`);
 const value=await tools.readCheckerFact(f.binding(),{operation:'pg.rows',args:{}});expect(value.receipt.status).toBe('unavailable');expect(value.receipt.reason).toBe('provider_response_invalid');
 }finally{f.close();}
});
test('read_file refuses traversal, symlinks, and reading its own privileged receipts',()=>{
 const f=fixture();try{delete f.config.provider;fs.writeFileSync(path.join(f.cwd,'outside.txt'),'not allowed');fs.symlinkSync(path.join(f.cwd,'outside.txt'),path.join(f.cwd,'evidence','link'));const b=f.binding();
 for(const p of ['../outside.txt','outside.txt','evidence/link'])expect(()=>tools.readCheckerEvidence(b,{path:p})).toThrow('checker_evidence_path_invalid');
 expect(()=>tools.prepareCheckerEvidence({config:{roots:['reads']},cwd:f.cwd,request:f.request,directory:path.join(f.cwd,'reads'),deadlineMs:Date.now()+1000})).toThrow('checker_evidence_config_invalid');
 }finally{f.close();}
});

test('an already viewed image receipt can be retrieved without sending the image again',()=>{
 const f=fixture();
 try {
  const imagePath='evidence/observed.png';
  const unreadPath='evidence/not-viewed.png';
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7d8AAAAASUVORK5CYII=','base64');
  for(const p of [imagePath,unreadPath])fs.writeFileSync(path.join(f.cwd,p),png);
  const binding=f.binding();
  expect(()=>tools.readCheckerImageReceipt(binding,{path:unreadPath})).toThrow('checker_evidence_image_receipt_missing');
  const archiveRead=tools.readCheckerEvidence(binding,{path:unreadPath},{includeBytes:true});
  expect(archiveRead.image).toBeUndefined();
  expect(()=>tools.readCheckerImageReceipt(binding,{path:unreadPath})).toThrow('checker_evidence_image_receipt_missing');
  const read=tools.readCheckerEvidence(binding,{path:imagePath});
  expect(read.image?.mimeType).toBe('image/png');
  expect(tools.readCheckerImageReceipt(binding,{path:imagePath})).toEqual(read.receipt);
  expect(tools.checkerEvidenceReceipts(binding)).toHaveLength(2);
  expect(()=>tools.readCheckerImageReceipt({...binding,nonce:'other-session'},{path:imagePath})).toThrow('checker_evidence_unbound');
  fs.appendFileSync(path.join(f.cwd,imagePath),Buffer.from('updated'));
  tools.readCheckerEvidence(binding,{path:imagePath});
  expect(()=>tools.readCheckerImageReceipt(binding,{path:imagePath})).toThrow('checker_evidence_image_receipt_ambiguous');
 } finally { f.close(); }
});
