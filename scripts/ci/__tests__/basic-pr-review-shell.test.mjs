import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=new URL('../../../',import.meta.url).pathname;
const workflow=readFileSync(join(root,'.github/workflows/pr-review.yml'),'utf8');
const apiName='调用 OpenRouter API 进行代码审查（含重试，fail-closed）';
function block(name){
  const value=workflow.split('- name: '+name)[1]?.split('\n      - name:')[0].split('        run: |\n')[1];
  assert.ok(value,`真实workflow步骤缺失：${name}`);
  return value.split('\n').map(line=>line.slice(10)).join('\n');
}
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'pr-review-shell-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const stub=(name,code)=>{const path=join(directory,name);writeFileSync(path,'#!/bin/sh\n'+code+'\n');chmodSync(path,0o755);};
  stub('sleep','exit 0');
  stub('gh','if [ "$GH_FAIL" = 1 ]; then exit 23; fi; printf "https://fixture.invalid/comment/1\\n"');
  stub('curl',`printf 'request\\n' >> "$RUNNER_TEMP/requests"
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--data-binary' ]; then shift; cp "${1#@}" "$RUNNER_TEMP/captured.json"; fi
  shift
done
case "$CURL_MODE" in
  transport) exit 22;;
  rate) printf '%s' '{"error":{"code":429}}';;
  empty) printf '%s' '{"choices":[{"message":{"content":""}}]}';;
  *) printf '%s' '{"choices":[{"message":{"content":"未发现严重问题"}}]}';;
esac`);
  writeFileSync(join(directory,'pr-review.diff'),'diff --git a/file.js b/file.js\n+const value=1;\n');
  const env={...process.env,PATH:directory+':'+process.env.PATH,RUNNER_TEMP:directory,
    OPENROUTER_API_KEY:'isolated-not-a-real-key',PR_NUMBER:'42',GH_FAIL:'0',CURL_MODE:'success'};
  return {directory,env,run:(code,extra={})=>spawnSync('bash',['-e','-o','pipefail','-c',code],{cwd:root,encoding:'utf8',env:{...env,...extra},timeout:10000})};
}
for(const mode of ['rate','transport','empty']) test(`真实review shell ${mode}必须失败，不将未审查当作通过`,t=>{
  const f=fixture(t),result=f.run(block(apiName),{CURL_MODE:mode});
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.equal(result.error,undefined);
  assert.equal(existsSync(join(f.directory,'review-result.txt')),false);
});
test('缺模型key在任何请求前失败',t=>{
  const f=fixture(t),result=f.run(block(apiName),{OPENROUTER_API_KEY:''});
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.equal(existsSync(join(f.directory,'requests')),false);
});
test('真实请求保持已成功运行的DeepSeek schema，评论失败不能冒充已发布',t=>{
  const f=fixture(t),result=f.run(block(apiName));
  assert.equal(result.status,0,result.stdout+result.stderr);
  const body=JSON.parse(readFileSync(join(f.directory,'captured.json'),'utf8'));
  assert.equal(body.model,'deepseek/deepseek-chat');assert.equal(body.max_tokens,2000);assert.equal(body.temperature,0.1);
  assert.deepEqual(body.messages.map(x=>x.role),['system','user']);assert.ok(body.messages[1].content.includes('+const value=1;'));
  assert.equal(body.thinking,undefined);
  const comment=f.run(block('将审查结果发布为 PR 评论'),{GH_FAIL:'1'});
  assert.notEqual(comment.status,0,comment.stdout+comment.stderr);
});
test('真实评论成功仍通过，严重问题检测保留真实红绿',t=>{
  const f=fixture(t);writeFileSync(join(f.directory,'review-result.txt'),'未发现严重问题');
  assert.equal(f.run(block('将审查结果发布为 PR 评论')).status,0);
  for(const [text,ok] of [['未发现严重问题',true],['🔴 严重问题：存在SQL注入漏洞',false]]){
    writeFileSync(join(f.directory,'review-result.txt'),text);
    const result=f.run(block('检测严重问题（🔴 则 job 失败）'));
    assert.equal(result.status===0,ok,result.stdout+result.stderr);
  }
});
