import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(new URL('../../../../..',import.meta.url).pathname);
test('无现役producer的旧autoblock SQL smoke明确退休且零外部效果',()=>{
 const dir=mkdtempSync(join(tmpdir(),'retired-autoblock-'));const log=join(dir,'calls');
 try{
  for(const name of ['node','psql','curl','docker'])writeFileSync(join(dir,name),`#!/bin/sh\nprintf '${name}\\n' >> "$CALL_LOG"\nexit 0\n`,{mode:0o755});
  const r=spawnSync('bash',[join(root,'packages/brain/scripts/smoke/autoblock-sql-param-fix-smoke.sh')],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,CALL_LOG:log,SMOKE_ALLOW_WRITE:'1',DATABASE_URL:'postgresql://127.0.0.1:1/cecelia_scratch'}});
  assert.notEqual(r.status,0);assert.match(r.stderr,/retired/);assert.doesNotMatch(r.stdout,/DONE|PASS/);
  let calls='';try{calls=readFileSync(log,'utf8');}catch{}assert.equal(calls,'');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
