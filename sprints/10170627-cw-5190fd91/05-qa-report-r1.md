---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 1 轮，环境 http://localhost:5301）

TESTED_HEAD: f9460639ab0b5e2cd7b05f4f109db13a51b64f01

本任务交付的是本地 CLI 手册，合同 Q-1 至 Q-3 均以独立临时目录调用真实 CLI；没有 HTTP 或页面场景。来源投影的同步事件为 c6de1e67-4b53-4d8b-b097-4a711c619c67，仅作为控制器事实，不作产品执行证据。

### T-1
对应: Q-1
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(args){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",...args],{encoding:"utf8"});assert.equal(r.status,0,r.stderr);console.log(JSON.stringify({args,exit:r.status,stdout:r.stdout.trim()}));return r.stdout.trim()}try{assert.equal(run([d,"--json"]),"[]");assert(run([d]).includes("没有运行记录（"+d+"）"));assert.equal(run([path.join(d,"missing"),"--json"]),"[]");assert(run([path.join(d,"missing")]).includes("没有运行记录（"+path.join(d,"missing")+"）"));for(const n of ["older","newer"])fs.writeFileSync(path.join(d,n+".json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}}));fs.utimesSync(path.join(d,"older.json"),1000000000,1000000000);fs.utimesSync(path.join(d,"newer.json"),1000000100,1000000100);const a=JSON.parse(run([d,"--json"]));assert.equal(a.length,2);assert.equal(a[0].task_id,"newer");assert.equal(a[1].task_id,"older");console.log("Q-1 断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-w1SJIx","--json"],"exit":0,"stdout":"[]"}
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-w1SJIx"],"exit":0,"stdout":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-w1SJIx）"}
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-w1SJIx/missing","--json"],"exit":0,"stdout":"[]"}
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-w1SJIx/missing"],"exit":0,"stdout":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-w1SJIx/missing）"}
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-w1SJIx","--json"],"exit":0,"stdout":"[{\"task_id\":\"newer\",\"mtime\":\"2001-09-09T01:48:20.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null},{\"task_id\":\"older\",\"mtime\":\"2001-09-09T01:46:40.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null}]"}
Q-1 断言通过
```
退出码: 0

### T-2
对应: Q-1
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["运行回执如何判读","--log-dir","--json","CODING_WF_LOG_DIR","mtime","不证明服务健康"])if(!s.includes(x))throw Error(x);console.log("Q-1 文本核对通过")'
```
```output
Q-1 文本核对通过
```
退出码: 0

### T-3
对应: Q-2
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q2-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const put=(n,v)=>fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));function run(json){const a=[cli,"--log-dir",d,...(json?["--json"]:[])],r=cp.spawnSync(process.execPath,a,{encoding:"utf8"});assert.equal(r.status,0,r.stderr);console.log(JSON.stringify({args:a.slice(1),exit:r.status,stdout:r.stdout.trim()}));return r.stdout.trim()}try{put("run",{last_event:"start"});put("partial",{status:"partial",activities:[{key:"build",status:"failed",attempts:[{reason_code:"old"},{reason_code:"new"}]}]});put("failed",{status:"failed",reason_code:"failed_reason"});for(const [n,u] of [["ok","https://github.com/example/repo/pull/37"],["non-github","https://example.invalid/pull/37"]])put(n,{status:"completed",outputs:{pr_url:u}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{state:"valid"});put("broken","{broken");const a=JSON.parse(run(true)),m=Object.fromEntries(a.map(x=>[x.task_id,x]));assert.equal(a.length,9);assert.equal(m.run.status,"running");assert.equal(m.partial.status,"partial");assert.equal(m.partial.failed_activity,"build");assert.equal(m.partial.reason_code,"new");assert.equal(m.failed.status,"failed");for(const n of ["ok","non-github"]){assert.equal(m[n].status,"completed");assert.deepEqual(m[n].ci_fix,{attempts:2,last_result:"passed"})}for(const n of ["qa","commander","pr-sync-pending","broken"])assert.equal(m[n].status,"unreadable");const t=run(false);assert(t.includes("ci_fix=2次 last=passed"));console.log("Q-2 断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"args":["--log-dir","/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q2-RUc5G5","--json"],"exit":0,"stdout":"[{\"task_id\":\"broken\",\"mtime\":\"2026-10-16T23:16:02.619Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},…{\"task_id\":\"non-github\",\"mtime\":\"2026-10-16T23:16:02.618Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://example.invalid/pull/37\",\"ci_fix\":{\"attempts\":2,\"last_result\":\"passed\"}},…{\"task_id\":\"partial\",\"mtime\":\"2026-10-16T23:16:02.618Z\",\"status\":\"partial\",\"failed_activity\":\"build\",\"reason_code\":\"new\",\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"run\",\"mtime\":\"2026-10-16T23:16:02.618Z\",\"status\":\"running\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null}]"}
{"args":["--log-dir","/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q2-RUc5G5"],"exit":0,"stdout":"broken  unreadable  2026-10-16T23:16:02.619Z  failed_activity=- reason_code=-\npr-sync-pending  unreadable  2026-10-16T23:16:02.618Z  failed_activity=- reason_code=-\ncommander  unreadable  2026-10-16T23:16:02.618Z  failed_activity=- reason_code=-\nqa  unreadable  2026-10-16T23:16:02.618Z  failed_activity=- reason_code=-\nnon-github  completed  2026-10-16T23:16:02.618Z  https://example.invalid/pull/37  ci_fix=2次 last=passed\nok  completed  2026-10-16T23:16:02.618Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed\nfailed  failed  2026-10-16T23:16:02.618Z  failed_activity=- reason_code=failed_reason\npartial  partial  2026-10-16T23:16:02.618Z  failed_activity=build reason_code=new\nrun  running  2026-10-16T23:16:02.618Z  failed_activity=- reason_code=-"}
Q-2 断言通过
```
退出码: 0

### T-4
对应: Q-2
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["running","completed","partial","failed","unreadable","pr-sync-pending.json","cifix-<编号>.json","last_result","非 GitHub 域名","不能据此删除"])if(!s.includes(x))throw Error(x);console.log("Q-2 文本核对通过")'
```
```output
Q-2 文本核对通过
```
退出码: 0

### T-5
对应: Q-3
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q3-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(json){const a=[cli,"--log-dir",d,...(json?["--json"]:[])],r=cp.spawnSync(process.execPath,a,{encoding:"utf8"});assert.equal(r.status,0,r.stderr);console.log(JSON.stringify({args:a.slice(1),exit:r.status,stdout:r.stdout.trim()}));return r.stdout.trim()}try{fs.writeFileSync(path.join(d,"missing-pr.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(path.join(d,"with-pr.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/38"}}));const a=JSON.parse(run(true)),m=Object.fromEntries(a.map(x=>[x.task_id,x]));assert.equal(m["missing-pr"].status,"completed");assert.equal(m["missing-pr"].reason_code,"pr_url_missing");assert.equal(m["missing-pr"].pr_url,null);assert.equal(m["with-pr"].ci_fix,null);const t=run(false);assert(t.includes("missing-pr  completed"));assert(!t.includes("pr_url_missing"));console.log("Q-3 断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"args":["--log-dir","/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q3-X2rnY9","--json"],"exit":0,"stdout":"[{\"task_id\":\"with-pr\",\"mtime\":\"2026-10-16T23:16:06.050Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/38\",\"ci_fix\":null},{\"task_id\":\"missing-pr\",\"mtime\":\"2026-10-16T23:16:06.050Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":\"pr_url_missing\",\"pr_url\":null,\"ci_fix\":null}]"}
{"args":["--log-dir","/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q3-X2rnY9"],"exit":0,"stdout":"with-pr  completed  2026-10-16T23:16:06.050Z  https://github.com/example/repo/pull/38\nmissing-pr  completed  2026-10-16T23:16:06.050Z"}
Q-3 断言通过
```
退出码: 0

### T-6
对应: Q-3
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["pr_url_missing","pr_url=null","当前 head","实际合并","runner.phase=merged","merge.merged=true","QA 终态","不手工更改批准状态或历史 FAIL"])if(!s.includes(x))throw Error(x);console.log("Q-3 文本核对通过")'
```
```output
Q-3 文本核对通过
```
退出码: 0

### T-7
对应: Q-4
verdict: CANNOT_VERIFY
原因: 固定基线到 HEAD 的完整 DAG、路径清单与工作区已实查；但逐父边完整 `--binary` 输出包含本轮禁止读取的 03-build.md 与 04-evidence.md 正文，且一次输出在工具中被截断，无法逐字留存、核对所有 blob/mode。故不能把路径清单或可信来源投影冒充 Q-4 所要求的完整独立核验。本轮控制器确认这两份文件暂时隐藏；完整恢复尚未发生，留给会话后裁判核验。
```command
git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD
```
```output
178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25
53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
f9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb 53cdf746c0c7f446cb7b6987e170d76248999f1d
```
退出码: 0

### X-1
对应: Q-1
场景: 探索未知参数；当前 CLI 忽略它并仍展示回执，手册没有承诺拒绝未知参数。
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-x1-"));try{fs.writeFileSync(path.join(d,"unknown.json"),JSON.stringify({status:"completed",outputs:{}}));const r=cp.spawnSync(process.execPath,["packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir",d,"--json","--unexpected"],{encoding:"utf8"});console.log(JSON.stringify({exit:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()}));assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout)[0].reason_code,"pr_url_missing");console.log("未知参数当前被忽略，手册未承诺拒绝")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"exit":0,"stdout":"[{\"task_id\":\"unknown\",\"mtime\":\"2026-10-16T23:16:49.263Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":\"pr_url_missing\",\"pr_url\":null,\"ci_fix\":null}]","stderr":""}
未知参数当前被忽略，手册未承诺拒绝
```
退出码: 0

## 本轮范围命令补充

以下原生命令均退出 0。它们确认目前可见范围，但不消除 T-7 的缺口。

```command
git rev-parse HEAD
```
```output
f9460639ab0b5e2cd7b05f4f109db13a51b64f01
```

```command
git diff --name-status 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 HEAD
```
```output
M	.brain-versions
M	.implementation-source-relations.json
M	DEFINITION.md
D	changes/cp-10170325-ci-budget-headroom.md
M	package-lock.json
M	packages/brain/VERSION
M	packages/brain/package-lock.json
M	packages/brain/package.json
M	packages/brain/scripts/coding-workflow/runner/README.md
A	sprints/10170627-cw-5190fd91/01-intent.md
A	sprints/10170627-cw-5190fd91/01-invariants.md
A	sprints/10170627-cw-5190fd91/02-response-r1.md
A	sprints/10170627-cw-5190fd91/02-response-r2.md
A	sprints/10170627-cw-5190fd91/02-review-r1.md
A	sprints/10170627-cw-5190fd91/02-review-r2.md
A	sprints/10170627-cw-5190fd91/02-review-r3.md
A	sprints/10170627-cw-5190fd91/02-review.md
A	sprints/10170627-cw-5190fd91/02-spec.md
A	sprints/10170627-cw-5190fd91/03-build.md
A	sprints/10170627-cw-5190fd91/04-evidence.md
```

```command
git diff --cached --name-status
```
```output
```

```command
git diff --name-status
```
```output
D	sprints/10170627-cw-5190fd91/03-build.md
D	sprints/10170627-cw-5190fd91/04-evidence.md
```

```command
git ls-files --others --exclude-standard
```
```output
```

一次 Q-1 断言脚本错误使用了不存在的 `file` 字段，退出码 1；实际 CLI 输出的 `task_id` 为 newer、older。修正为对 `task_id` 断言后重测见 T-1。该失败属于 QA 脚本错误，不是产品错误。原生命令及完整输出如下：

```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(args){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",...args],{encoding:"utf8"});assert.equal(r.status,0,r.stderr);console.log(JSON.stringify({args,exit:r.status,stdout:r.stdout.trim()}));return r.stdout.trim()}try{assert.equal(run([d,"--json"]),"[]");assert(run([d]).includes("没有运行记录（"+d+"）"));assert.equal(run([path.join(d,"missing"),"--json"]),"[]");assert(run([path.join(d,"missing")]).includes("没有运行记录（"+path.join(d,"missing")+"）"));for(const n of ["older","newer"])fs.writeFileSync(path.join(d,n+".json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}}));fs.utimesSync(path.join(d,"older.json"),1000000000,1000000000);fs.utimesSync(path.join(d,"newer.json"),1000000100,1000000100);const a=JSON.parse(run([d,"--json"]));assert.equal(a.length,2);assert(a[0].file.includes("newer")&&a[1].file.includes("older"));console.log("Q-1 断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-nFBq7V","--json"],"exit":0,"stdout":"[]"}
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-nFBq7V"],"exit":0,"stdout":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-nFBq7V）"}
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-nFBq7V/missing","--json"],"exit":0,"stdout":"[]"}
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-nFBq7V/missing"],"exit":0,"stdout":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-nFBq7V/missing）"}
{"args":["/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-nFBq7V","--json"],"exit":0,"stdout":"[{\"task_id\":\"newer\",\"mtime\":\"2001-09-09T01:48:20.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null},{\"task_id\":\"older\",\"mtime\":\"2001-09-09T01:46:40.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null}]"}
[eval]:1
const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(args){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",...args],{encoding:"utf8"});assert.equal(r.status,0,r.stderr);console.log(JSON.stringify({args,exit:r.status,stdout:r.stdout.trim()}));return r.stdout.trim()}try{assert.equal(run([d,"--json"]),"[]");assert(run([d]).includes("没有运行记录（"+d+"）"));assert.equal(run([path.join(d,"missing"),"--json"]),"[]");assert(run([path.join(d,"missing")]).includes("没有运行记录（"+path.join(d,"missing")+"）"));for(const n of ["older","newer"])fs.writeFileSync(path.join(d,n+".json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}}));fs.utimesSync(path.join(d,"older.json"),1000000000,1000000000);fs.utimesSync(path.join(d,"newer.json"),1000000100,1000000100);const a=JSON.parse(run([d,"--json"]));assert.equal(a.length,2);assert(a[0].file.includes("newer")&&a[1].file.includes("older"));console.log("Q-1 断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            
TypeError: Cannot read properties of undefined (reading 'includes')
    at [eval]:1:1075
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:329:3)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3

Node.js v26.8.2
```
退出码: 1
