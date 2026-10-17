---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 7 轮，环境 http://localhost:5301）

TESTED_HEAD: 15c90a4a0021a40170e46aeacf6fddc91d563cf0

本任务产品是本地只读 CLI 与 README，无 HTTP 或页面场景；没有访问生产 Brain。固定基线：`04b88ddba4b1aa23a156d59734b4d88f621fe1e9`。

### T-1
对应: Q-1
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r7-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(p,j){const x=cp.spawnSync(process.execPath,[cli,"--log-dir",p,...(j?["--json"]:[])],{encoding:"utf8"});a.equal(x.status,0);return x.stdout.trim()}try{for(const p of [d,path.join(d,"missing")]){const j=run(p,true),t=run(p,false);a.equal(j,"[]");a(t.includes("没有运行记录（"+p+"）"));console.log(JSON.stringify({case:p===d?"empty":"missing",json:j,text:t,exit:0}))}const v={status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}};for(const n of ["older","newer"])fs.writeFileSync(path.join(d,n+".json"),JSON.stringify(v));fs.utimesSync(path.join(d,"older.json"),1000,1000);fs.utimesSync(path.join(d,"newer.json"),2000,2000);const z=JSON.parse(run(d,true));a.deepEqual(z.map(x=>x.task_id),["newer","older"]);console.log(JSON.stringify({order:z.map(x=>x.task_id),exit:0}));const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["--log-dir","--json","CODING_WF_LOG_DIR","mtime","不证明"])a(s.includes(x),x);console.log("README关键词断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"case":"empty","json":"[]","text":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r7-q1-SqyAcF）","exit":0}
{"case":"missing","json":"[]","text":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r7-q1-SqyAcF/missing）","exit":0}
{"order":["newer","older"],"exit":0}
README关键词断言通过
```

### T-2
对应: Q-2
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r7-q2-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function put(n,v){fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v))}function run(j){const x=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(j?["--json"]:[])],{encoding:"utf8"});a.equal(x.status,0);return x.stdout.trim()}try{put("run",{last_event:"started"});put("partial",{status:"partial",activities:[{key:"collect",status:"failed",attempts:[{reason_code:"first"},{reason_code:"collect_timeout"}]}]});put("failed",{status:"failed"});for(const [n,u] of [["ok","https://github.com/example/repo/pull/37"],["non-github","https://example.invalid/pull/37"]])put(n,{status:"completed",outputs:{pr_url:u}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{state:"pending"});put("broken","{");const rows=JSON.parse(run(true)),by=Object.fromEntries(rows.map(x=>[x.task_id,x]));a.equal(rows.length,9);a.equal(by.run.status,"running");a.equal(by.partial.status,"partial");a.equal(by.partial.failed_activity,"collect");a.equal(by.partial.reason_code,"collect_timeout");a.equal(by.failed.status,"failed");a.equal(by.failed.reason_code,"run_failed");for(const n of ["ok","non-github"]){a.equal(by[n].status,"completed");a.deepEqual(by[n].ci_fix,{attempts:2,last_result:"passed"})}for(const n of ["qa","commander","pr-sync-pending","broken"])a.equal(by[n].status,"unreadable");const t=run(false);for(const n of ["ok","non-github"])a(t.split("\n").some(x=>x.startsWith(n+"  completed")&&x.includes("ci_fix=2次 last=passed")));console.log(JSON.stringify({rows:rows.map(x=>({task_id:x.task_id,status:x.status,failed_activity:x.failed_activity,reason_code:x.reason_code,ci_fix:x.ci_fix})),text:t.split("\n").map(x=>x.replace(/20\d\d-\d\d-\d\dT[^ ]+/,"<mtime>")),exit:0}));const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["running","completed","partial","failed","unreadable","pr-sync-pending.json","last_result","非 GitHub","不能"])a(s.includes(x),x);console.log("README关键词断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"rows":[{"task_id":"broken","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"pr-sync-pending","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"commander","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"qa","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"non-github","status":"completed","failed_activity":null,"reason_code":null,"ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"ok","status":"completed","failed_activity":null,"reason_code":null,"ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"failed","status":"failed","failed_activity":null,"reason_code":"run_failed","ci_fix":null},{"task_id":"partial","status":"partial","failed_activity":"collect","reason_code":"collect_timeout","ci_fix":null},{"task_id":"run","status":"running","failed_activity":null,"reason_code":null,"ci_fix":null}],"text":["broken  unreadable  <mtime>  failed_activity=- reason_code=-","pr-sync-pending  unreadable  <mtime>  failed_activity=- reason_code=-","commander  unreadable  <mtime>  failed_activity=- reason_code=-","qa  unreadable  <mtime>  failed_activity=- reason_code=-","non-github  completed  <mtime>  https://example.invalid/pull/37  ci_fix=2次 last=passed","ok  completed  <mtime>  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed","failed  failed  <mtime>  failed_activity=- reason_code=run_failed","partial  partial  <mtime>  failed_activity=collect reason_code=collect_timeout","run  running  <mtime>  failed_activity=- reason_code=-"],"exit":0}
README关键词断言通过
```

### T-3
对应: Q-3
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r7-q3-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(j){const x=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(j?["--json"]:[])],{encoding:"utf8"});a.equal(x.status,0);return x.stdout.trim()}try{fs.writeFileSync(path.join(d,"missing-pr.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(path.join(d,"with-pr.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/38"}}));const rows=JSON.parse(run(true)),by=Object.fromEntries(rows.map(x=>[x.task_id,x]));a.equal(by["missing-pr"].status,"completed");a.equal(by["missing-pr"].reason_code,"pr_url_missing");a.equal(by["missing-pr"].pr_url,null);a.equal(by["with-pr"].ci_fix,null);const t=run(false);a(t.split("\n").some(x=>x.startsWith("missing-pr  completed")&&!x.includes("pr_url_missing")));console.log(JSON.stringify({rows:rows.map(x=>({task_id:x.task_id,status:x.status,reason_code:x.reason_code,pr_url:x.pr_url,ci_fix:x.ci_fix})),text:t.split("\n").map(x=>x.replace(/20\d\d-\d\d-\d\dT[^ ]+/,"<mtime>")),exit:0}));const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["pr_url_missing","--json","head","runner.phase","merged","merge.merged","QA","FAIL"])a(s.includes(x),x);console.log("README关键词断言通过")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"rows":[{"task_id":"with-pr","status":"completed","reason_code":null,"pr_url":"https://github.com/example/repo/pull/38","ci_fix":null},{"task_id":"missing-pr","status":"completed","reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}],"text":["with-pr  completed  <mtime>  https://github.com/example/repo/pull/38","missing-pr  completed  <mtime>"],"exit":0}
README关键词断言通过
```

### T-4
对应: Q-4
verdict: CANNOT_VERIFY
原因: 已核对固定 HEAD、14 个提交的 15 条父边、65 条变化路径的 93 个非零 blob 哈希与大小、README 原文顺序、两次规格纯追加、逐次自产 manifest 前插及 main 同步。但 Q-4/S-7 还要求逐边检查其它可见自产报告的内容，而本轮输入明令不得读取 sprint 中 01、02 与指定裁决以外的文件；对象完整性不能替代内容规则。两份指定报告此时按本轮控制器隔离事实暂缺，完整恢复尚未发生；会话后的恢复、来源门和终态亦不能在此预判。上轮 J-1 所要求的所有原生命令及完整输出并未全部纳入本报告，因此范围验收不能判 PASS。
```command
node -e 'const cp=require("child_process"),fs=require("fs"),a=require("assert");const g=(...x)=>cp.execFileSync("git",x,{encoding:"utf8"}).trim(),b="04b88ddba4b1aa23a156d59734b4d88f621fe1e9",h=g("rev-parse","HEAD"),rows=g("rev-list","--reverse","--topo-order","--parents",b+"..HEAD").split("\n"),d=g("diff","--name-status",b,h).split("\n"),st=g("diff","--cached","--name-status"),wt=g("diff","--name-status"),un=g("ls-files","--others","--exclude-standard");a.equal(h,"15c90a4a0021a40170e46aeacf6fddc91d563cf0");a.equal(st,"");a.equal(un,"");a.deepEqual(wt.split("\n"),["D\tsprints/10170627-cw-5190fd91/03-build.md","D\tsprints/10170627-cw-5190fd91/04-evidence.md"]);a.equal(fs.existsSync("sprints/10170627-cw-5190fd91/03-build.md"),false);a.equal(fs.existsSync("sprints/10170627-cw-5190fd91/04-evidence.md"),false);console.log(JSON.stringify({head:h,commits:rows.length,parent_edges:rows.reduce((n,x)=>n+x.split(" ").length-1,0),base_to_head_paths:d.length,staged:st||"(empty)",worktree:wt.split("\n"),untracked:un||"(empty)",hidden_03_04:true,restoration:"尚未发生",exit:0}))'
```
```output
{"head":"15c90a4a0021a40170e46aeacf6fddc91d563cf0","commits":14,"parent_edges":15,"base_to_head_paths":33,"staged":"(empty)","worktree":["D\tsprints/10170627-cw-5190fd91/03-build.md","D\tsprints/10170627-cw-5190fd91/04-evidence.md"],"untracked":"(empty)","hidden_03_04":true,"restoration":"尚未发生","exit":0}
```

### X-1
对应: Q-1
场景: 用户在空回执目录调用 CLI 时带未知参数；当前 CLI 忽略该参数，README 未承诺拒绝未知参数。
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r7-x1-"));try{const x=cp.spawnSync(process.execPath,["packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir",d,"--unexpected","--json"],{encoding:"utf8"});a.equal(x.status,0);a.equal(x.stdout.trim(),"[]");console.log(JSON.stringify({case:"unknown_option_on_empty_dir",status:x.status,stdout:x.stdout.trim()}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"case":"unknown_option_on_empty_dir","status":0,"stdout":"[]"}
```

结论：Q-1 至 Q-3 通过；Q-4 不能验收，交独立裁判判断。本轮没有发现明确产品缺陷，也未宣称远端合并、Brain 终态或会话后恢复已完成。
