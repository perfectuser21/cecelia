---
task_id: 214f1098-a4b8-4c0b-9947-daf49a9bd929
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 3 轮，环境 http://localhost:5303）

TESTED_HEAD: 133971d16a7a4b0c23360cd1a38e999337061ce2

本轮按只读文档与本地 CLI 合同验收；Q-1 至 Q-4 均非页面场景，无浏览器截图。控制器提供的来源事实只用于核对已登记的提交文件身份，不充当产品功能证据。

### T-1
对应: Q-1
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r3-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const run=(args)=>{const r=cp.spawnSync("node",[cli,"--log-dir",...args],{encoding:"utf8"});a.equal(r.status,0);a.equal(r.stderr,"");console.log(r.stdout.trim());return r.stdout.trim()};try{a.equal(run([d,"--json"]),"[]");a.match(run([d]),/没有运行记录/);const absent=path.join(d,"absent");a.equal(run([absent,"--json"]),"[]");for(const [n,t] of [["older","2020-01-01T00:00:00Z"],["newer","2020-01-02T00:00:00Z"]]){const p=path.join(d,n+".json");fs.writeFileSync(p,JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/"+(n==="older"?"1":"2")}}));fs.utimesSync(p,new Date(t),new Date(t))}const j=run([d,"--json"]);a.deepEqual(JSON.parse(j).map(x=>x.task_id),["newer","older"]);const plain=run([d]);a.ok(plain.indexOf("newer  completed")<plain.indexOf("older  completed"));console.log("Q-1 断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
[]
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r3-q1-LEnfp4）
[]
[{"task_id":"newer","mtime":"2020-01-02T00:00:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/2","ci_fix":null},{"task_id":"older","mtime":"2020-01-01T00:00:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/1","ci_fix":null}]
newer  completed  2020-01-02T00:00:00.000Z  https://github.com/example/repo/pull/2
older  completed  2020-01-01T00:00:00.000Z  https://github.com/example/repo/pull/1
Q-1 断言通过
```
退出码: 0

### T-2
对应: Q-1
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["## 运行回执如何判读","--log-dir","--json","CODING_WF_LOG_DIR","mtime","[]","不能证明服务健康"])if(!s.includes(x))throw Error(x);console.log("Q-1 文本核对通过")'
```
```output
Q-1 文本核对通过
```
退出码: 0

### T-3
对应: Q-2
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r3-q2-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const put=(n,v)=>fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));const run=(json)=>{const r=cp.spawnSync("node",[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});a.equal(r.status,0);a.equal(r.stderr,"");console.log(r.stdout.trim());return r.stdout.trim()};try{put("progress",{last_event:"started"});put("partial",{status:"partial",activities:[{key:"prepare",status:"completed"},{key:"test",status:"failed",reason_code:"activity_failed",attempts:[{reason_code:"other"},{reason_code:"tests_failed"}]}]});put("failed",{status:"failed",activities:[{key:"build",status:"failed",reason_code:"build_failed"}]});put("qa-check",{verdict:"pass"});put("commander-check",{decision:"wait"});put("pr-sync-pending",{pending:true});put("broken","{invalid");put("completed",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/77"}});put("cifix-77",{attempts:[{result:"push_failed"},{result:"pushed"}]});const rows=JSON.parse(run(true));const by=Object.fromEntries(rows.map(x=>[x.task_id,x]));a.equal(rows.length,8);a.equal(by.progress.status,"running");a.equal(by.partial.status,"partial");a.equal(by.partial.failed_activity,"test");a.equal(by.partial.reason_code,"tests_failed");a.equal(by.failed.status,"failed");a.equal(by.failed.failed_activity,"build");a.equal(by.failed.reason_code,"build_failed");for(const n of ["qa-check","commander-check","pr-sync-pending","broken"])a.equal(by[n].status,"unreadable");a.deepEqual(by.completed.ci_fix,{attempts:2,last_result:"pushed"});a.equal(by["cifix-77"],undefined);const plain=run(false);a.match(plain,/ci_fix=2次 last=pushed/);a.deepEqual(fs.readdirSync(d).sort(),["broken.json","cifix-77.json","commander-check.json","completed.json","failed.json","partial.json","pr-sync-pending.json","progress.json","qa-check.json"]);console.log("文件仍在:"+fs.readdirSync(d).sort().join(","));console.log("Q-2 断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
[{"task_id":"completed","mtime":"2026-10-16T06:40:10.791Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/77","ci_fix":{"attempts":2,"last_result":"pushed"}},{"task_id":"broken","mtime":"2026-10-16T06:40:10.791Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"pr-sync-pending","mtime":"2026-10-16T06:40:10.791Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"commander-check","mtime":"2026-10-16T06:40:10.791Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"qa-check","mtime":"2026-10-16T06:40:10.791Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"failed","mtime":"2026-10-16T06:40:10.791Z","status":"failed","failed_activity":"build","reason_code":"build_failed","pr_url":null,"ci_fix":null},{"task_id":"partial","mtime":"2026-10-16T06:40:10.791Z","status":"partial","failed_activity":"test","reason_code":"tests_failed","pr_url":null,"ci_fix":null},{"task_id":"progress","mtime":"2026-10-16T06:40:10.791Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
completed  completed  2026-10-16T06:40:10.791Z  https://github.com/example/repo/pull/77  ci_fix=2次 last=pushed
broken  unreadable  2026-10-16T06:40:10.791Z  failed_activity=- reason_code=-
pr-sync-pending  unreadable  2026-10-16T06:40:10.791Z  failed_activity=- reason_code=-
commander-check  unreadable  2026-10-16T06:40:10.791Z  failed_activity=- reason_code=-
qa-check  unreadable  2026-10-16T06:40:10.791Z  failed_activity=- reason_code=-
failed  failed  2026-10-16T06:40:10.791Z  failed_activity=build reason_code=build_failed
partial  partial  2026-10-16T06:40:10.791Z  failed_activity=test reason_code=tests_failed
progress  running  2026-10-16T06:40:10.791Z  failed_activity=- reason_code=-
文件仍在:broken.json,cifix-77.json,commander-check.json,completed.json,failed.json,partial.json,pr-sync-pending.json,progress.json,qa-check.json
Q-2 断言通过
```
退出码: 0

### T-4
对应: Q-2
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["running","completed","partial","failed","unreadable","failed_activity","reason_code","qa-*.json","commander-*.json","pr-sync-pending.json","ci_fix.attempts","ci_fix.last_result","不是删除现场或待办的依据"])if(!s.includes(x))throw Error(x);console.log("Q-2 文本核对通过")'
```
```output
Q-2 文本核对通过
```
退出码: 0

### T-5
对应: Q-3
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r3-q3-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const run=(json)=>{const r=cp.spawnSync("node",[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});a.equal(r.status,0);a.equal(r.stderr,"");console.log(r.stdout.trim());return r.stdout.trim()};try{fs.writeFileSync(path.join(d,"missing.json"),JSON.stringify({status:"completed"}));fs.writeFileSync(path.join(d,"example.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/999999"}}));const rows=JSON.parse(run(true));const by=Object.fromEntries(rows.map(x=>[x.task_id,x]));a.equal(by.missing.status,"completed");a.equal(by.missing.reason_code,"pr_url_missing");a.equal(by.missing.pr_url,null);a.equal(by.example.status,"completed");a.equal(by.example.pr_url,"https://github.com/example/repo/pull/999999");const plain=run(false);a.ok(!plain.includes("pr_url_missing"));console.log("示例 PR 未核验，不能判最终合并");console.log("Q-3 断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
[{"task_id":"example","mtime":"2026-10-16T06:40:16.399Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/999999","ci_fix":null},{"task_id":"missing","mtime":"2026-10-16T06:40:16.399Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}]
example  completed  2026-10-16T06:40:16.399Z  https://github.com/example/repo/pull/999999
missing  completed  2026-10-16T06:40:16.399Z
示例 PR 未核验，不能判最终合并
Q-3 断言通过
```
退出码: 0

### T-6
对应: Q-3
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["pr_url_missing","pr_url=null","最终 head","runner.phase=merged","merge.merged=true","QA 终态","不手改批准或 FAIL","尚未证实最终合并"])if(!s.includes(x))throw Error(x);console.log("Q-3 文本核对通过")'
```
```output
Q-3 文本核对通过
```
退出码: 0

### T-7
对应: Q-4
原因: 初次核对误将“原文逐行保留”写成“旧 README 全文是新版的连续子串”；新小节插入中间使断言失败，属于 QA 断言错误，已在 T-8 改用 Git numstat 复核。此处原样保留失败输出。
verdict: CANNOT_VERIFY
```command
node -e 'const fs=require("fs"),cp=require("child_process"),a=require("assert");const base="1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c",head="133971d16a7a4b0c23360cd1a38e999337061ce2",root="sprints/10161224-cw-214f1098/";const git=(...v)=>cp.execFileSync("git",v,{encoding:"utf8"});a.equal(git("rev-parse","HEAD").trim(),head);const names=git("diff","--name-only",base,"HEAD").trim().split("\n");const products=names.filter(x=>!x.startsWith(root)&&x!==".implementation-source-relations.json");a.deepEqual(products,["packages/brain/scripts/coding-workflow/runner/README.md"]);const oldReadme=git("show",base+":packages/brain/scripts/coding-workflow/runner/README.md"),newReadme=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");a.ok(newReadme.includes(oldReadme));const oldManifest=git("show",base+":.implementation-source-relations.json"),newManifest=fs.readFileSync(".implementation-source-relations.json","utf8");a.ok(newManifest.endsWith(oldManifest.slice(oldManifest.indexOf("    {\"owner_path\""))));const oldRows=JSON.parse(oldManifest).relations,newRows=JSON.parse(newManifest).relations,added=newRows.slice(0,newRows.length-oldRows.length);a.equal(added.length,11);a.deepEqual(newRows.slice(added.length),oldRows);for(const x of added){a.equal(x.owner_path,"packages/brain/scripts/coding-workflow/runner/run-once.mjs");a.equal(x.role,"documentation");a.ok(x.path.startsWith(root)&&x.path.endsWith(".md"));a.ok(names.includes(x.path));git("cat-file","-e","HEAD:"+x.path)}const staged=git("diff","--cached","--name-only").trim(),untracked=git("ls-files","--others","--exclude-standard").trim(),working=git("diff","--name-status").trim();a.equal(staged,"");a.equal(untracked,"");a.equal(working,"D\t"+root+"03-build.md\nD\t"+root+"04-evidence.md");console.log("HEAD="+head);console.log("base-to-HEAD="+names.join(","));console.log("README 基线全文保留；manifest 新增="+added.length+"，历史行原样保留");console.log("staged="+JSON.stringify(staged)+" untracked="+JSON.stringify(untracked));console.log("working="+JSON.stringify(working));console.log("隔离操作者与恢复边界：本命令无法证明")'
```
```output
node:internal/assert/utils:146
  throw error;
  ^

AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:

  a.ok(newReadme.includes(oldReadme))

    at [eval]:1:751
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3 {
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '==',
  diff: 'simple'
}

Node.js v26.8.2
```
退出码: 1

### T-8
对应: Q-4
原因: 固定基线至 HEAD 的产品范围、README 旧行保留、manifest 11 条新增及历史行未改均已核实。工作区仅 03-build.md 与 04-evidence.md 呈删除；本轮提示明确 03/04 读取隔离继续生效，且 HEAD 中两文件仍有 blob，但未提供可独立回读的隔离操作者、隔离回执和恢复边界。上一轮裁判 J-1 要求的可信隔离事实仍不足，不能将范围判 PASS。
verdict: CANNOT_VERIFY
```command
node -e 'const fs=require("fs"),cp=require("child_process"),a=require("assert");const base="1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c",head="133971d16a7a4b0c23360cd1a38e999337061ce2",root="sprints/10161224-cw-214f1098/";const git=(...v)=>cp.execFileSync("git",v,{encoding:"utf8"});a.equal(git("rev-parse","HEAD").trim(),head);const names=git("diff","--name-only",base,"HEAD").trim().split("\n");const products=names.filter(x=>!x.startsWith(root)&&x!==".implementation-source-relations.json");a.deepEqual(products,["packages/brain/scripts/coding-workflow/runner/README.md"]);const num=git("diff","--numstat",base,"HEAD","--","packages/brain/scripts/coding-workflow/runner/README.md").trim();a.match(num,/^22\t0\t/);const oldManifest=git("show",base+":.implementation-source-relations.json"),newManifest=fs.readFileSync(".implementation-source-relations.json","utf8");a.ok(newManifest.endsWith(oldManifest.slice(oldManifest.indexOf("    {\"owner_path\""))));const oldRows=JSON.parse(oldManifest).relations,newRows=JSON.parse(newManifest).relations,added=newRows.slice(0,newRows.length-oldRows.length);a.equal(added.length,11);a.deepEqual(newRows.slice(added.length),oldRows);for(const x of added){a.equal(x.owner_path,"packages/brain/scripts/coding-workflow/runner/run-once.mjs");a.equal(x.role,"documentation");a.ok(x.path.startsWith(root)&&x.path.endsWith(".md"));a.ok(names.includes(x.path));git("cat-file","-e","HEAD:"+x.path)}const staged=git("diff","--cached","--name-only").trim(),untracked=git("ls-files","--others","--exclude-standard").trim(),working=git("diff","--name-status").trim();a.equal(staged,"");a.equal(untracked,"");a.equal(working,"D\t"+root+"03-build.md\nD\t"+root+"04-evidence.md");console.log("HEAD="+head);console.log("base-to-HEAD="+names.join(","));console.log("README numstat="+num);console.log("manifest 新增="+added.length+"，历史行原样保留");console.log("staged="+JSON.stringify(staged)+" untracked="+JSON.stringify(untracked));console.log("working="+JSON.stringify(working));console.log("隔离操作者与恢复边界：本命令无法证明")'
```
```output
HEAD=133971d16a7a4b0c23360cd1a38e999337061ce2
base-to-HEAD=.implementation-source-relations.json,packages/brain/scripts/coding-workflow/runner/README.md,sprints/10161224-cw-214f1098/01-intent.md,sprints/10161224-cw-214f1098/01-invariants.md,sprints/10161224-cw-214f1098/02-review-r1.md,sprints/10161224-cw-214f1098/02-review.md,sprints/10161224-cw-214f1098/02-spec.md,sprints/10161224-cw-214f1098/03-build.md,sprints/10161224-cw-214f1098/04-evidence.md,sprints/10161224-cw-214f1098/05-qa-report-r1.md,sprints/10161224-cw-214f1098/05-qa-report-r2.md,sprints/10161224-cw-214f1098/06-judge-r1.md,sprints/10161224-cw-214f1098/06-judge-r2.md
README numstat=22	0	packages/brain/scripts/coding-workflow/runner/README.md
manifest 新增=11，历史行原样保留
staged="" untracked=""
working="D\tsprints/10161224-cw-214f1098/03-build.md\nD\tsprints/10161224-cw-214f1098/04-evidence.md"
隔离操作者与恢复边界：本命令无法证明
```
退出码: 0

### X-1
对应: Q-2
场景: 连续两次读取合法待办 JSON；两次均显示 unreadable，文件哈希保持一致，读取没有消费或删除待办。
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),crypto=require("crypto"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r3-x1-")),p=path.join(d,"pr-sync-pending.json");try{fs.writeFileSync(p,JSON.stringify({pending:true,items:[1]}));const hash=()=>crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");const before=hash();for(let i=1;i<=2;i++){const r=cp.spawnSync("node",["packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir",d,"--json"],{encoding:"utf8"});a.equal(r.status,0);const rows=JSON.parse(r.stdout);a.equal(rows.length,1);a.equal(rows[0].status,"unreadable");console.log("读取"+i+":"+r.stdout.trim())}a.equal(hash(),before);console.log("待办哈希读取前后相同:"+before)}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
读取1:[{"task_id":"pr-sync-pending","mtime":"2026-10-16T06:41:19.618Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
读取2:[{"task_id":"pr-sync-pending","mtime":"2026-10-16T06:41:19.618Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
待办哈希读取前后相同:cb5e073d1ad71a4bda3e8e072966f889218027d08ed7f2dc4d502fd7b0e1600d
```
退出码: 0

### X-2
对应: Q-4
场景: 验证预览 health.git_sha 与本轮 TESTED_HEAD 相同。
verdict: PASS
```command
curl -fsS http://localhost:5303/api/brain/health | jq -e '.git_sha == "133971d16a7a4b0c23360cd1a38e999337061ce2"'
```
```output
true
```
退出码: 0

## 结论

Q-1、Q-2、Q-3 通过。Q-4 为 CANNOT_VERIFY：产品提交范围可核对，但隔离删除的可信来源与恢复边界缺证；不将其误判为产品失败或验收通过。未访问生产 Brain，未修改代码、manifest 或历史报告。

