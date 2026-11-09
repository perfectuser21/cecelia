import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../../../..');
const sha='a'.repeat(40), old='b'.repeat(40), request='11111111-1111-4111-8111-111111111111';
const valid={settled:true,settlement:{outcome:'success',git_sha:sha,image_id:`sha256:${'c'.repeat(64)}`,deployment_id:request,confirmed_at:'2026-10-21T00:00:00Z'},status:'success',sha,git_sha:sha,request_id:request,isolated:true,image_id:`sha256:${'c'.repeat(64)}`};
const dirs=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture({readyAt=0,status='running',health={status:'healthy',git_sha:sha,version:'1.2.3'}}={}){
 const dir=mkdtempSync(join(tmpdir(),'deploy-budget-'));dirs.push(dir);mkdirSync(join(dir,'bin'));
 const bin=(name,body)=>writeFileSync(join(dir,'bin',name),'#!/bin/bash\n'+body+'\n',{mode:0o755});
 writeFileSync(join(dir,'clock'),'0');writeFileSync(join(dir,'polls'),'0');
 bin('date','cat "$FIXTURE/clock"');
 bin('sleep','n=$(cat "$FIXTURE/clock"); echo $((n + ${1%.*})) > "$FIXTURE/clock"');
 bin('git','if [[ -n "$GIT_DELAY_SECONDS" ]]; then n=$(cat "$FIXTURE/clock"); echo $((n+GIT_DELAY_SECONDS)) > "$FIXTURE/clock"; exit 0; fi; exit 1');
 bin('curl',`printf '%s\\n' \"$@\" > \"$FIXTURE/curlargs\"
n=$(cat "$FIXTURE/polls"); echo $((n+1)) > "$FIXTURE/polls"
clock=$(cat "$FIXTURE/clock"); echo $((clock + \${HTTP_SECONDS:-0})) > "$FIXTURE/clock"
body="$PENDING"; (( n >= READY_AT )) && body="$VALID"
for arg in "$@"; do [[ "$arg" == */health ]] && body="$HEALTH"; [[ "$arg" == POST ]] && echo POST >> "$FIXTURE/posts"; done
out=''; format=''
while (($#)); do case "$1" in -o) out="$2"; shift;; -w) format="$2"; shift;; esac; shift; done
if [[ -n "$out" ]]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
case "$format" in '') :;; '%{http_code}') printf '200';; '\\n%{http_code}') printf '\\n200';; *) exit 64;; esac
exit 0`);
 bin('status','exec curl fixture');bin('trigger','echo 202');
 mkdirSync(join(dir,'packages/brain'),{recursive:true});
 writeFileSync(join(dir,'packages/brain/package.json'),'{"version":"1.2.3"}');
 return {dir,env:{...process.env,PATH:`${dir}/bin:${process.env.PATH}`,FIXTURE:dir,READY_AT:String(readyAt),PENDING:JSON.stringify({status,git_sha:old}),VALID:JSON.stringify(valid),HEALTH:JSON.stringify(health),BRAIN_URL:'http://fixture.invalid',EXPECTED_SHA:sha,GITHUB_SHA:sha,STAGING_REQUEST_ID:request,STATUS_CMD:join(dir,'bin/status'),TRIGGER_CMD:join(dir,'bin/trigger'),REPO_DIR:dir}};
}
function run(script,f,extra={}) {return spawnSync('bash',['-c',script],{cwd:root,env:{...f.env,...extra},encoding:'utf8',timeout:60000});}
describe('deployment-time-budget：正式发布入口的有限预算与状态判定',()=>{
it.each(['gate3','staging'])('%s 默认预算允许35分钟冷构建后同SHA成功',kind=>{
 const f=fixture({readyAt:211});const script=kind==='gate3'?`bash scripts/ci/gate3-wait-deploy.sh "$BRAIN_URL" "$GITHUB_SHA"`:'bash scripts/wait-for-staging.sh';
 const result=run(script,f);expect(result.status,result.stdout+result.stderr).toBe(0);
 expect(Number(readFileSync(join(f.dir,'clock'),'utf8'))).toBeGreaterThanOrEqual(2100);
},60000);
it.each(['gate3','staging'])('%s 95分钟截止仍running必须失败',kind=>{
 const f=fixture({readyAt:10000});const script=kind==='gate3'?`bash scripts/ci/gate3-wait-deploy.sh "$BRAIN_URL" "$GITHUB_SHA"`:'bash scripts/wait-for-staging.sh';
 const result=run(script,f);expect(result.status).toBe(1);
 expect(Number(readFileSync(join(f.dir,'clock'),'utf8'))).toBe(5700);
},60000);
it.each(['gate3','staging'])('%s 截止预算包含HTTP等待时间',kind=>{
 const f=fixture({readyAt:10000});const script=kind==='gate3'?`bash scripts/ci/gate3-wait-deploy.sh "$BRAIN_URL" "$GITHUB_SHA"`:'bash scripts/wait-for-staging.sh';
 const result=run(script,f,{HTTP_SECONDS:'15'});expect(result.status).toBe(1);
 expect(Number(readFileSync(join(f.dir,'clock'),'utf8'))).toBe(5700);
},60000);
it.each(['gate3','staging'])('%s HTTP返回成功但超过总截止时间仍失败',kind=>{
 const f=fixture();const script=kind==='gate3'?`bash scripts/ci/gate3-wait-deploy.sh "$BRAIN_URL" "$GITHUB_SHA"`:'bash scripts/wait-for-staging.sh';
 expect(run(script,f,{HTTP_SECONDS:'5701'}).status).toBe(1);
});

it('祖先查询跨总截止时间不得返回成功',()=>{
 const f=fixture();f.env.VALID=JSON.stringify({...valid,git_sha:old,settlement:{...valid.settlement,git_sha:old}});
 expect(run(`bash scripts/ci/gate3-wait-deploy.sh "$BRAIN_URL" "$GITHUB_SHA"`,f,{GIT_DELAY_SECONDS:'5701'}).status).toBe(1);
});
it('重触发HTTP预算接受本次剩余秒数，原默认仍有限',()=>{
 const f=fixture();const r=run(`bash scripts/ci/gate3-trigger-deploy.sh "$BRAIN_URL" "$GITHUB_SHA" 7`,f);
 expect(r.status).toBe(0);const args=readFileSync(join(f.dir,'curlargs'),'utf8').trim().split('\n');
 expect(args[args.indexOf('--max-time')+1]).toBe('7');expect(JSON.parse(args[args.indexOf('-d')+1]).sha).toBe(sha);
});

it('默认状态请求至多90秒且最后一次请求不超过剩余预算',()=>{
 const f=fixture({readyAt:10000});expect(run(`bash scripts/ci/gate3-wait-deploy.sh "$BRAIN_URL" "$GITHUB_SHA"`,f,{STATUS_CMD:'',HTTP_SECONDS:'15'}).status).toBe(1);
 const args=readFileSync(join(f.dir,'curlargs'),'utf8').trim().split('\n');expect(args[args.indexOf('--max-time')+1]).toBe('25');
 expect(Number(readFileSync(join(f.dir,'clock'),'utf8'))).toBe(5700);
},60000);


});
