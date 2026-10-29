/** 执行真实验证脚本：所有localhost读回必须发生在候选容器内，不能误验宿主生产服务。 */
import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
it('通过 docker exec 读取候选自身 API 和数据库身份，宿主 curl 不得调用',()=>{
 const dir=mkdtempSync(join(tmpdir(),'stage-host-')),sha='a'.repeat(40);
 try{
  writeFileSync(join(dir,'curl'),'#!/bin/sh\nexit 99\n',{mode:0o755});
  writeFileSync(join(dir,'docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
test "$1" = exec && test "$2" = cecelia-admission-brain || exit 98
case "$*" in
 *current_database*) echo '{"database":"cecelia_staging","host":"stage-db","tasks_table":true}';;
 *health*) echo '{"status":"healthy","git_sha":"${sha}","version":"fixture","runtime":{"isolated":true,"background_automation":false}}';;
 *tick/status*) echo '{"enabled":false}';;
 *tasks*) echo '[]';;
 *assertLeadgenStagingProjection*) echo '{"workflows":4,"refs":14,"activities":12}';;
 *) exit 97;;
esac
`,{mode:0o755});
  const result=spawnSync('bash',[resolve(import.meta.dirname,'../../../../scripts/staging-verify.sh')],{encoding:'utf8',env:{...process.env,PATH:`${dir}:${process.env.PATH}`,CALLS:join(dir,'calls'),STAGING_CONTAINER:'cecelia-admission-brain',EXPECTED_SHA:sha,EXPECTED_VERSION:'fixture'}});
  expect(result.status,result.stderr).toBe(0);
  const calls=readFileSync(join(dir,'calls'),'utf8');
  expect(calls).toContain('exec cecelia-admission-brain curl -fsS --max-time 15 http://localhost:5222/api/brain/health');
  expect(calls).toContain('current_database()');expect(calls).not.toContain('host.docker.internal');
  expect(calls).toContain('assertLeadgenStagingProjection');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
