import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
let dir;afterEach(()=>{if(dir)rmSync(dir,{recursive:true,force:true});});
const sha='a'.repeat(40),request='11111111-1111-4111-8111-111111111111';
const valid={status:'success',sha,request_id:request,isolated:true,image_id:`sha256:${'b'.repeat(64)}`};
function wait(receipt){
 dir=mkdtempSync(join(tmpdir(),'stage-receipt-'));
 writeFileSync(join(dir,'curl'),'#!/bin/sh\nprintf "%s" "$RECEIPT"\n',{mode:0o755});
 return spawnSync('bash',[resolve(import.meta.dirname,'../../../../scripts/wait-for-staging.sh')],{
  encoding:'utf8',timeout:5000,env:{...process.env,PATH:`${dir}:${process.env.PATH}`,BRAIN_URL:'http://fixture.invalid',EXPECTED_SHA:sha,STAGING_REQUEST_ID:request,RECEIPT:JSON.stringify(receipt)},
 });
}
it.each([{...valid,request_id:'22222222-2222-4222-8222-222222222222'},{...valid,sha:'c'.repeat(40)},
 {...valid,isolated:false},{...valid,image_id:'latest'}, {status:'skipped_no_docker'},{status:'idle'},{status:'failed'}])('旧回执或未验证状态失败关闭 %#',receipt=>{
 expect(wait(receipt).status).not.toBe(0);
});
it('本次请求、同SHA、不可变镜像且隔离验收均匹配才通过',()=>{expect(wait(valid).status).toBe(0);});
