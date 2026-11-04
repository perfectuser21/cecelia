import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script=fileURLToPath(new URL('../../../packages/workflows/scripts/health-check.sh',import.meta.url));
for(const mode of ['healthy','non-ok','network-error','http-error']){
 test(`健康脚本真实入口：${mode}`,t=>{
  const dir=mkdtempSync(join(tmpdir(),'workflow-health-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const bin=join(dir,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'curl'),`#!/bin/bash\ncase "$*" in *"-X POST"*) exit 99;; esac\ncase "$HEALTH_FIXTURE" in healthy) echo '{"status":"ok"}';; non-ok) echo '{"status":"down"}';; network-error) exit 7;; http-error) case "$*" in *--fail*|*"-f "*) exit 22;; *) echo '{"error":"ok endpoint unavailable"}';; esac;; esac\n`,{mode:0o755});
  writeFileSync(join(bin,'ssh'),'#!/bin/bash\necho \'{"status":"ok"}\'\n',{mode:0o755});
  const result=spawnSync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,FEISHU_WEBHOOK_URL:'',HEALTH_FIXTURE:mode}});
  assert.equal(result.status,mode==='healthy'?0:1,result.stdout+result.stderr);
  if(mode!=='healthy')assert.match(result.stdout,/检查失败/);
 });
}
