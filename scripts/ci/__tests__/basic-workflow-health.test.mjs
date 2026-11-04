import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const script=fileURLToPath(new URL('../../../packages/workflows/scripts/health-check.sh',import.meta.url));
for(const mode of ['healthy','non-ok','not-ok','malformed','error-text','network-error','http-error','remote-error','remote-exit-ok','remote-not-ok','remote-http-error']){
 test(`健康脚本真实入口：${mode}`,t=>{
  const dir=mkdtempSync(join(tmpdir(),'workflow-health-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const bin=join(dir,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'curl'),`#!/bin/bash\ncase "$*" in *"-X POST"*) exit 99;; esac\ncase "$HEALTH_FIXTURE" in healthy|remote-*) echo '{"status":"ok"}';; non-ok) echo '{"status":"down"}';; not-ok) echo '{"status":"not_ok"}';; malformed) echo 'ok';; error-text) echo '{"error":"ok endpoint unavailable"}';; network-error) exit 7;; http-error) case "$*" in *--fail*|*"-f "*) exit 22;; *) echo '{"error":"ok endpoint unavailable"}';; esac;; esac\n`,{mode:0o755});
  writeFileSync(join(bin,'ssh'),`#!/bin/bash\ncase \"$HEALTH_FIXTURE\" in remote-exit-ok) echo '{"status":"ok"}'; exit 22;; remote-error) echo '{"error":"ok endpoint unavailable"}'; exit 22;; remote-not-ok) echo '{"status":"not_ok"}';; remote-http-error) case \"$*\" in *--fail*) exit 22;; *) echo '{"status":"ok"}';; esac;; *) echo '{"status":"ok"}';; esac\n`,{mode:0o755});
  const result=spawnSync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:`${bin}:${process.env.PATH}`,FEISHU_WEBHOOK_URL:'',HEALTH_FIXTURE:mode}});
  assert.equal(result.status,mode==='healthy'?0:1,result.stdout+result.stderr);
  if(mode!=='healthy')assert.match(result.stdout,/检查失败/);
 });
}
