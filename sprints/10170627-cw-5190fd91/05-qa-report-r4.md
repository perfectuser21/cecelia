---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 4 轮，环境 http://localhost:5301）

TESTED_HEAD: `6e0b4202c1b659de1bf99ad62d42c73d09dca6bc`。本次产品是本地只读 CLI 与手册，合同没有预览 HTTP 或页面场景。本轮未访问生产、未启动浏览器。本轮可信控制器只证明 03-build.md、04-evidence.md 已临时隐藏；完整恢复尚未发生，留待会话后的裁判核验。来源投影的 main 同步事件为 `c6de1e67-4b53-4d8b-b097-4a711c619c67`，不作为功能证据。

### T-1
对应: Q-1
verdict: PASS
场景: 独立创建空目录、缺失子目录和两份修改时间不同的回执，真跑 CLI。首次断言误读 `file` 字段而失败，修正为实际 `task_id` 后重跑通过；这是 QA 断言错误，不是产品失败。
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r4-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const run=(p,json)=>cp.execFileSync("node",[cli,"--log-dir",p,...(json?["--json"]:[])],{encoding:"utf8"}).trim();try{const e=run(d,true),t=run(d,false),m=run(path.join(d,"missing"),true),u=run(path.join(d,"missing"),false);assert.equal(e,"[]");assert.equal(m,"[]");assert(t.includes("没有运行记录"));assert(u.includes("没有运行记录"));for(const n of ["older","newer"])fs.writeFileSync(path.join(d,n+".json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}}));fs.utimesSync(path.join(d,"older.json"),1000000000,1000000000);fs.utimesSync(path.join(d,"newer.json"),1100000000,1100000000);const order=JSON.parse(run(d,true)).map(x=>x.task_id);assert.deepEqual(order,["newer","older"]);console.log(JSON.stringify({empty_json:e,empty_text:t,missing_json:m,missing_text:u,order}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"empty_json":"[]","empty_text":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r4-q1-twoLCg）","missing_json":"[]","missing_text":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r4-q1-twoLCg/missing）","order":["newer","older"]}
```

### T-2
对应: Q-2
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r4-q2-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const put=(n,v)=>fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));try{put("run",{last_event:"start"});put("partial",{status:"partial",activities:[{key:"collect",status:"failed",attempts:[{reason_code:"old"},{reason_code:"collect_timeout"}]}]});put("failed",{status:"failed",reason_code:"run_failed"});put("ok",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/37"}});put("non-github",{status:"completed",outputs:{pr_url:"https://example.invalid/pull/37"}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{kind:n});put("broken","{");const rows=JSON.parse(cp.execFileSync("node",[cli,"--log-dir",d,"--json"],{encoding:"utf8"})),txt=cp.execFileSync("node",[cli,"--log-dir",d],{encoding:"utf8"});const by=Object.fromEntries(rows.map(x=>[x.task_id,x]));a.equal(rows.length,9);a.equal(by.run.status,"running");a.equal(by.partial.status,"partial");a.equal(by.partial.reason_code,"collect_timeout");a.equal(by.partial.failed_activity,"collect");a.equal(by.failed.status,"failed");a.equal(by.failed.reason_code,"run_failed");for(const n of ["ok","non-github"]){a.equal(by[n].status,"completed");a.deepEqual(by[n].ci_fix,{attempts:2,last_result:"passed"});a(txt.includes(n+"  completed")&&txt.includes("ci_fix=2次 last=passed"))}for(const n of ["qa","commander","pr-sync-pending","broken"])a.equal(by[n].status,"unreadable");a(!by["cifix-37"]);console.log(JSON.stringify({rows:rows.map(({task_id,status,failed_activity,reason_code,ci_fix})=>({task_id,status,failed_activity,reason_code,ci_fix})),text:txt.split("\n").map(x=>x.replace(/  20\d\d-\d\d-\d\dT[^ ]+  /,"  <mtime>  "))}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"rows":[{"task_id":"broken","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"pr-sync-pending","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"commander","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"qa","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"non-github","status":"completed","failed_activity":null,"reason_code":null,"ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"ok","status":"completed","failed_activity":null,"reason_code":null,"ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"failed","status":"failed","failed_activity":null,"reason_code":"run_failed","ci_fix":null},{"task_id":"partial","status":"partial","failed_activity":"collect","reason_code":"collect_timeout","ci_fix":null},{"task_id":"run","status":"running","failed_activity":null,"reason_code":null,"ci_fix":null}],"text":["broken  unreadable  <mtime>  failed_activity=- reason_code=-","pr-sync-pending  unreadable  <mtime>  failed_activity=- reason_code=-","commander  unreadable  <mtime>  failed_activity=- reason_code=-","qa  unreadable  <mtime>  failed_activity=- reason_code=-","non-github  completed  <mtime>  https://example.invalid/pull/37  ci_fix=2次 last=passed","ok  completed  <mtime>  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed","failed  failed  <mtime>  failed_activity=- reason_code=run_failed","partial  partial  <mtime>  failed_activity=collect reason_code=collect_timeout","run  running  <mtime>  failed_activity=- reason_code=-",""]}
```

### T-3
对应: Q-3
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r4-q3-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";try{fs.writeFileSync(path.join(d,"missing-pr.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(path.join(d,"with-pr.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/38"}}));const rows=JSON.parse(cp.execFileSync("node",[cli,"--log-dir",d,"--json"],{encoding:"utf8"})),txt=cp.execFileSync("node",[cli,"--log-dir",d],{encoding:"utf8"});const m=rows.find(x=>x.task_id==="missing-pr"),w=rows.find(x=>x.task_id==="with-pr");a.equal(m.status,"completed");a.equal(m.reason_code,"pr_url_missing");a.equal(m.pr_url,null);a.equal(w.pr_url,"https://github.com/example/repo/pull/38");a.equal(w.ci_fix,null);a(txt.split("\n").find(x=>x.startsWith("missing-pr ")).includes("completed"));a(!txt.split("\n").find(x=>x.startsWith("missing-pr ")).includes("pr_url_missing"));console.log(JSON.stringify({missing:m,with_pr:w,normal:txt.trim().split("\n").map(x=>x.replace(/  20\d\d-\d\d-\d\dT[^ ]+  /,"  <mtime>  "))}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"missing":{"task_id":"missing-pr","mtime":"2026-10-17T01:57:55.508Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null},"with_pr":{"task_id":"with-pr","mtime":"2026-10-17T01:57:55.508Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/38","ci_fix":null},"normal":["with-pr  completed  <mtime>  https://github.com/example/repo/pull/38","missing-pr  completed  2026-10-17T01:57:55.508Z"]}
```

### T-4
对应: Q-1,Q-2,Q-3
verdict: PASS
场景: 真读最终 README，并逐项断言用户判读所需的措辞。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["运行回执如何判读","--log-dir","--json","CODING_WF_LOG_DIR","mtime","没有运行记录","不证明服务健康","last_event","running","completed","partial","failed","unreadable","pr-sync-pending.json","不能单独证明文件损坏","不能据此删除","attempts","last_result","非 GitHub 域名","pr_url_missing","pr_url=null","当前 head","实际合并","runner.phase=merged","merge.merged=true","QA 终态","不手工更改批准状态或历史 FAIL"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过：26 项")'
```
```output
README 文本核对通过：26 项
```

### T-5
对应: Q-4
verdict: CANNOT_VERIFY
原因: 已按固定基线完成 DAG、所有 12 条父边及 56 个路径的 raw/blob/mode 核验，并核实 README 原文有序保留、每次自产 manifest 只在前部追加、两次规格修改是纯追加；但 S-7 还要求逐次读取其它可见旧报告的正文并断言内容。本轮更高优先级的输入明确禁止读取 SPRINT_DIR 中 01/02 与指定裁决以外的开发方文件，所以这项不能完整执行。可信来源投影只证明登记和字节身份，不能替代内容核验。03/04 完整恢复亦尚未发生，不能预判。以下是裁判 J-1 指出的两项缺口的本轮直接核验，均非仅看最终 manifest。
```command
node -e 'const cp=require("child_process"),a=require("assert");const p=".implementation-source-relations.json",owner="packages/brain/scripts/coding-workflow/runner/run-once.mjs",prefix="sprints/10170627-cw-5190fd91/",marker="  \"relations\": [\n";const commits=["42943dfe5fc3f0680291322a5440bcd46159cbeb","f3dbd423fab3eddea650ac361d4651f393cfd40f","ea0573f2d1e2a95f5cb7727a70c581d325b1fd21","8fa7a1c035bd76335c99fe71ed7450d5832b49e8","a36edb98dcf000ff653236e7674cac6117e30652","6e0b4202c1b659de1bf99ad62d42c73d09dca6bc"];for(const c of commits){const prev=cp.execFileSync("git",["show",c+"^:"+p],{encoding:"utf8"}),next=cp.execFileSync("git",["show",c+":"+p],{encoding:"utf8"});const o=JSON.parse(prev),n=JSON.parse(next),added=n.relations.slice(0,n.relations.length-o.relations.length);a(added.length>0,c+" no additions");a.deepEqual(n.relations.slice(added.length),o.relations,c+" old relations changed");a.equal(n.schema_version,o.schema_version);a.equal(n.repo,o.repo);for(const r of added){a.equal(r.owner_path,owner);a.equal(r.role,"documentation");a(r.path.startsWith(prefix)&&r.path.endsWith(".md"));cp.execFileSync("git",["cat-file","-e",c+":"+r.path])}const lines=added.map(r=>"    "+JSON.stringify(r).replace(/:/g,":").replace(/,/g,",")+",\n").join("");a.equal(next,prev.replace(marker,marker+lines),c+" historical bytes changed");console.log(c.slice(0,8)+" retained="+o.relations.length+" added="+added.map(r=>r.path.slice(prefix.length)).join(","))}'
```
```output
42943dfe retained=307 added=01-intent.md,01-invariants.md,02-response-r1.md,02-response-r2.md,02-review-r1.md,02-review-r2.md,02-review-r3.md,02-review.md,02-spec.md,03-build.md,04-evidence.md
f3dbd423 retained=317 added=05-qa-report-r1.md
ea0573f2 retained=318 added=07-commander-r1.md
8fa7a1c0 retained=319 added=05-qa-report-r2.md,06-judge-r2.md
a36edb98 retained=321 added=05-qa-report-r3.md,06-judge-r3.md
6e0b4202 retained=323 added=07-commander-r2.md
```

### T-6
对应: Q-4
verdict: PASS
场景: 针对 J-1 指定的 `02-spec.md` 两次中间变更，直接读取每次父子原文并比较完整前缀、新增节标题和文件模式。首次输出表达式错误产生 `NaN`，断言并未失败；下列为重测输出。
```command
node -e 'const cp=require("child_process"),a=require("assert");const p="sprints/10170627-cw-5190fd91/02-spec.md";for(const [c,h] of [["200baf82ef92f25d8b10031b52596b1e24fb70a7","## commander 裁决（第 1 次）"],["eb96ceb14f76a1572145644d5defc1fec6a49f1b","## commander 裁决（第 2 次）"]]){const old=cp.execFileSync("git",["show",c+"^:"+p],{encoding:"utf8"}),now=cp.execFileSync("git",["show",c+":"+p],{encoding:"utf8"});a(now.startsWith(old));a(now.slice(old.length).trimStart().startsWith(h));const before=cp.execFileSync("git",["ls-tree",c+"^",p],{encoding:"utf8"}).split(" ")[0],after=cp.execFileSync("git",["ls-tree",c,p],{encoding:"utf8"}).split(" ")[0];a.equal(before,after);console.log(c.slice(0,8)+" old_bytes="+Buffer.byteLength(old)+" appended_bytes="+(Buffer.byteLength(now)-Buffer.byteLength(old))+" header="+h+" mode="+before)}'
```
```output
200baf82 old_bytes=18898 appended_bytes=2784 header=## commander 裁决（第 1 次） mode=100644
eb96ceb1 old_bytes=21682 appended_bytes=2436 header=## commander 裁决（第 2 次） mode=100644
```

### T-7
对应: Q-4
verdict: PASS
场景: 按固定基线 DAG 对每条父边运行 Git 原生 raw 查询；每个旧/新非零 blob 均由 `cat-file` 读取完整字节并重算规范 Git SHA-1，核对对象大小和该父/子 tree 的路径身份。受隔离报告正文只在进程内计算对象完整性，不输出或打开正文。此条只证明对象完整性，不能代替 T-5 所述的内容归属缺口。
```command
node -e 'const cp=require("child_process"),cr=require("crypto"),a=require("assert");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const git=(...x)=>cp.execFileSync("git",x,{encoding:"utf8"}).trimEnd();const lines=git("rev-list","--reverse","--topo-order","--parents",base+"..HEAD").split("\n");let edges=0,paths=0,blobs=0;for(const line of lines){const [c,...parents]=line.split(" ");for(const p of parents){const raw=git("diff","--no-ext-diff","--no-renames","--raw","--abbrev=40",p,c,"--");const rows=raw?raw.split("\n"):[];edges++;console.log("EDGE "+p.slice(0,8)+"->"+c.slice(0,8)+" paths="+rows.length);for(const row of rows){const m=/^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.+)$/.exec(row);a(m,"bad raw "+row);const [,om,nm,oldid,newid,kind,path]=m;paths++;for(const [id,mode,ref] of [[oldid,om,p],[newid,nm,c]]){if(/^0+$/.test(id)){a.equal(mode,"000000");continue}const body=cp.execFileSync("git",["cat-file","blob",id]);const hash=cr.createHash("sha1").update(Buffer.from("blob "+body.length+"\0")).update(body).digest("hex");a.equal(hash,id);a.equal(+git("cat-file","-s",id),body.length);a.equal(git("rev-parse",ref+":"+path),id);blobs++}console.log(kind+" "+path+" "+om+"/"+nm+" "+oldid.slice(0,8)+"/"+newid.slice(0,8)+" content_hash=ok")}}}console.log("TOTAL edges="+edges+" paths="+paths+" blobs="+blobs)'
```
```output
EDGE 04b88ddb->178f6184 paths=1
M packages/brain/scripts/coding-workflow/runner/README.md 100644/100644 6e6eb65f/3e8eea16 content_hash=ok
EDGE 178f6184->42943dfe paths=12
M .implementation-source-relations.json 100644/100644 b4d00c4f/24de93e0 content_hash=ok
A sprints/10170627-cw-5190fd91/01-intent.md 000000/100644 00000000/3a1529d7 content_hash=ok
A sprints/10170627-cw-5190fd91/01-invariants.md 000000/100644 00000000/2276b9f0 content_hash=ok
A sprints/10170627-cw-5190fd91/02-response-r1.md 000000/100644 00000000/f8999866 content_hash=ok
A sprints/10170627-cw-5190fd91/02-response-r2.md 000000/100644 00000000/677402ca content_hash=ok
A sprints/10170627-cw-5190fd91/02-review-r1.md 000000/100644 00000000/8b068bd9 content_hash=ok
A sprints/10170627-cw-5190fd91/02-review-r2.md 000000/100644 00000000/7c80b836 content_hash=ok
A sprints/10170627-cw-5190fd91/02-review-r3.md 000000/100644 00000000/e6922e12 content_hash=ok
A sprints/10170627-cw-5190fd91/02-review.md 000000/100644 00000000/e6922e12 content_hash=ok
A sprints/10170627-cw-5190fd91/02-spec.md 000000/100644 00000000/9827a68e content_hash=ok
A sprints/10170627-cw-5190fd91/03-build.md 000000/100644 00000000/0d96f563 content_hash=ok
A sprints/10170627-cw-5190fd91/04-evidence.md 000000/100644 00000000/46a81734 content_hash=ok
EDGE 04b88ddb->53cdf746 paths=8
M .brain-versions 100644/100644 765a3cb6/f3d26142 content_hash=ok
M .implementation-source-relations.json 100644/100644 b4d00c4f/ffadfb93 content_hash=ok
M DEFINITION.md 100644/100644 c6115202/a4b46caf content_hash=ok
D changes/cp-10170325-ci-budget-headroom.md 100644/000000 61678453/00000000 content_hash=ok
M package-lock.json 100644/100644 f6a79a39/aaeb525f content_hash=ok
M packages/brain/VERSION 100644/100644 765a3cb6/f3d26142 content_hash=ok
M packages/brain/package-lock.json 100644/100644 bd089447/ecb84839 content_hash=ok
M packages/brain/package.json 100644/100644 5451dac0/b6a3c1c89 content_hash=ok
EDGE 42943dfe->f9460639 paths=8
M .brain-versions 100644/100644 765a3cb6/f3d26142 content_hash=ok
M .implementation-source-relations.json 100644/100644 24de93e0/c4f2bb17 content_hash=ok
M DEFINITION.md 100644/100644 c6115202/a4b46caf content_hash=ok
D changes/cp-10170325-ci-budget-headroom.md 100644/000000 61678453/00000000 content_hash=ok
M package-lock.json 100644/100644 f6a79a39/aaeb525f content_hash=ok
M packages/brain/VERSION 100644/100644 765a3cb6/f3d26142 content_hash=ok
M packages/brain/package-lock.json 100644/100644 bd089447/ecb84839 content_hash=ok
M packages/brain/package.json 100644/100644 5451dac0/b6a3c1c89 content_hash=ok
EDGE 53cdf746->f9460639 paths=13
M .implementation-source-relations.json 100644/100644 ffadfb93/c4f2bb17 content_hash=ok
M packages/brain/scripts/coding-workflow/runner/README.md 100644/100644 6e6eb65f/3e8eea16 content_hash=ok
A sprints/10170627-cw-5190fd91/01-intent.md 000000/100644 00000000/3a1529d7 content_hash=ok
A sprints/10170627-cw-5190fd91/01-invariants.md 000000/100644 00000000/2276b9f0 content_hash=ok
A sprints/10170627-cw-5190fd91/02-response-r1.md 000000/100644 00000000/f8999866 content_hash=ok
A sprints/10170627-cw-5190fd91/02-response-r2.md 000000/100644 00000000/677402ca content_hash=ok
A sprints/10170627-cw-5190fd91/02-review-r1.md 000000/100644 00000000/8b068bd9 content_hash=ok
A sprints/10170627-cw-5190fd91/02-review-r2.md 000000/100644 00000000/7c80b836 content_hash=ok
A sprints/10170627-cw-5190fd91/02-review-r3.md 000000/100644 00000000/e6922e12 content_hash=ok
A sprints/10170627-cw-5190fd91/02-review.md 000000/100644 00000000/e6922e12 content_hash=ok
A sprints/10170627-cw-5190fd91/02-spec.md 000000/100644 00000000/9827a68e content_hash=ok
A sprints/10170627-cw-5190fd91/03-build.md 000000/100644 00000000/0d96f563 content_hash=ok
A sprints/10170627-cw-5190fd91/04-evidence.md 000000/100644 00000000/46a81734 content_hash=ok
EDGE f9460639->f3dbd423 paths=2
M .implementation-source-relations.json 100644/100644 c4f2bb17/f3d532f6 content_hash=ok
A sprints/10170627-cw-5190fd91/05-qa-report-r1.md 000000/100644 00000000/766cc68f content_hash=ok
EDGE f3dbd423->200baf82 paths=1
M sprints/10170627-cw-5190fd91/02-spec.md 100644/100644 9827a68e/51450ee5 content_hash=ok
EDGE 200baf82->ea0573f2 paths=2
M .implementation-source-relations.json 100644/100644 f3d532f6/f0d372e0 content_hash=ok
A sprints/10170627-cw-5190fd91/07-commander-r1.md 000000/100644 00000000/fc178a6a content_hash=ok
EDGE ea0573f2->8fa7a1c0 paths=3
M .implementation-source-relations.json 100644/100644 f0d372e0/eab6aa5c content_hash=ok
A sprints/10170627-cw-5190fd91/05-qa-report-r2.md 000000/100644 00000000/05e0b0b9 content_hash=ok
A sprints/10170627-cw-5190fd91/06-judge-r2.md 000000/100644 00000000/51c02fb0 content_hash=ok
EDGE 8fa7a1c0->a36edb98 paths=3
M .implementation-source-relations.json 100644/100644 eab6aa5c/4d1cf208 content_hash=ok
A sprints/10170627-cw-5190fd91/05-qa-report-r3.md 000000/100644 00000000/80d07eb7 content_hash=ok
A sprints/10170627-cw-5190fd91/06-judge-r3.md 000000/100644 00000000/19cf8a90 content_hash=ok
EDGE a36edb98->eb96ceb1 paths=1
M sprints/10170627-cw-5190fd91/02-spec.md 100644/100644 51450ee5/ac6a959a content_hash=ok
EDGE eb96ceb1->6e0b4202 paths=2
M .implementation-source-relations.json 100644/100644 4d1cf208/c310edb1 content_hash=ok
A sprints/10170627-cw-5190fd91/07-commander-r2.md 000000/100644 00000000/8557e204 content_hash=ok
TOTAL edges=12 paths=56 blobs=81
```

### T-8
对应: Q-4
verdict: PASS
场景: 固定 initial base 的 HEAD、DAG、全仓最终差异、暂存、工作区和全仓未跟踪文件；本报告创建后，未跟踪列表只多出本轮报告。工作区两处删除正是控制器本轮隔离投影指定的文件，不能据此预判恢复。
```command
node -e 'const cp=require("child_process"),a=require("assert");const b="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const run=(...x)=>{const r=cp.spawnSync("git",x,{encoding:"utf8"});a.equal(r.status,0,x.join(" "));return r.stdout.trim()};const head=run("rev-parse","HEAD"),dag=run("rev-list","--reverse","--topo-order","--parents",b+"..HEAD"),diff=run("diff","--name-status",b,"HEAD"),cached=run("diff","--cached","--name-status"),working=run("diff","--name-status"),untracked=run("ls-files","--others","--exclude-standard");a.equal(head,"6e0b4202c1b659de1bf99ad62d42c73d09dca6bc");a.equal(dag.split("\n").length,11);a.equal(cached,"");a.equal(untracked,"sprints/10170627-cw-5190fd91/05-qa-report-r4.md");a.equal(working,"D\tsprints/10170627-cw-5190fd91/03-build.md\nD\tsprints/10170627-cw-5190fd91/04-evidence.md");console.log(JSON.stringify({head,dag:dag.split("\n"),diff:diff.split("\n"),cached,working:working.split("\n"),untracked}))'
```
```output
{"head":"6e0b4202c1b659de1bf99ad62d42c73d09dca6bc","dag":["178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9","42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25","53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9","f9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb 53cdf746c0c7f446cb7b6987e170d76248999f1d","f3dbd423fab3eddea650ac361d4651f393cfd40f f9460639ab0b5e2cd7b05f4f109db13a51b64f01","200baf82ef92f25d8b10031b52596b1e24fb70a7 f3dbd423fab3eddea650ac361d4651f393cfd40f","ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 200baf82ef92f25d8b10031b52596b1e24fb70a7","8fa7a1c035bd76335c99fe71ed7450d5832b49e8 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21","a36edb98dcf000ff653236e7674cac6117e30652 8fa7a1c035bd76335c99fe71ed7450d5832b49e8","eb96ceb14f76a1572145644d5defc1fec6a49f1b a36edb98dcf000ff653236e7674cac6117e30652","6e0b4202c1b659de1bf99ad62d42c73d09dca6bc eb96ceb14f76a1572145644d5defc1fec6a49f1b"],"diff":["M\t.brain-versions","M\t.implementation-source-relations.json","M\tDEFINITION.md","D\tchanges/cp-10170325-ci-budget-headroom.md","M\tpackage-lock.json","M\tpackages/brain/VERSION","M\tpackages/brain/package-lock.json","M\tpackages/brain/package.json","M\tpackages/brain/scripts/coding-workflow/runner/README.md","A\tsprints/10170627-cw-5190fd91/01-intent.md","A\tsprints/10170627-cw-5190fd91/01-invariants.md","A\tsprints/10170627-cw-5190fd91/02-response-r1.md","A\tsprints/10170627-cw-5190fd91/02-response-r2.md","A\tsprints/10170627-cw-5190fd91/02-review-r1.md","A\tsprints/10170627-cw-5190fd91/02-review-r2.md","A\tsprints/10170627-cw-5190fd91/02-review-r3.md","A\tsprints/10170627-cw-5190fd91/02-review.md","A\tsprints/10170627-cw-5190fd91/02-spec.md","A\tsprints/10170627-cw-5190fd91/03-build.md","A\tsprints/10170627-cw-5190fd91/04-evidence.md","A\tsprints/10170627-cw-5190fd91/05-qa-report-r1.md","A\tsprints/10170627-cw-5190fd91/05-qa-report-r2.md","A\tsprints/10170627-cw-5190fd91/05-qa-report-r3.md","A\tsprints/10170627-cw-5190fd91/06-judge-r2.md","A\tsprints/10170627-cw-5190fd91/06-judge-r3.md","A\tsprints/10170627-cw-5190fd91/07-commander-r1.md","A\tsprints/10170627-cw-5190fd91/07-commander-r2.md"],"cached":"","working":["D\tsprints/10170627-cw-5190fd91/03-build.md","D\tsprints/10170627-cw-5190fd91/04-evidence.md"],"untracked":"sprints/10170627-cw-5190fd91/05-qa-report-r4.md"}
```

### T-9
对应: Q-4
verdict: PASS
场景: 读取固定基线与最终 README 原文，逐行按原顺序对照，确认新增小节存在。
```command
node -e 'const cp=require("child_process"),a=require("assert");const p="packages/brain/scripts/coding-workflow/runner/README.md",base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const old=cp.execFileSync("git",["show",base+":"+p],{encoding:"utf8"}),now=cp.execFileSync("git",["show","HEAD:"+p],{encoding:"utf8"});let at=0;for(const line of old.split("\n")){const next=now.indexOf(line,at);a(next>=at,"missing old line: "+line);at=next+line.length}a(now.includes("## 运行回执如何判读"));console.log("README old_lines="+old.split("\n").length+" preserved_in_order=true new_section=true old_bytes="+Buffer.byteLength(old)+" new_bytes="+Buffer.byteLength(now))'
```
```output
README old_lines=82 preserved_in_order=true new_section=true old_bytes=10889 new_bytes=13572
```

### T-10
对应: Q-4
verdict: PASS
场景: 本轮可信投影所指的 main 同步，在实际 merge tree 中对上游可见路径逐字节核验与 main 一致；README 和规格与第一父一致；manifest 原文字节等于上游历史前置本任务已证明的 11 条来源增量。
```command
node -e 'const cp=require("child_process"),a=require("assert");const git=(...x)=>cp.execFileSync("git",x,{encoding:"utf8"});const main="53cdf746c0c7f446cb7b6987e170d76248999f1d",first="42943dfe5fc3f0680291322a5440bcd46159cbeb",merge="f9460639ab0b5e2cd7b05f4f109db13a51b64f01",p=".implementation-source-relations.json";const own=JSON.parse(git("show",first+":"+p)).relations.slice(0,11),up=git("show",main+":"+p),merged=git("show",merge+":"+p),marker="  \"relations\": [\n",lines=own.map(r=>"    "+JSON.stringify(r)+",\n").join("");a.equal(merged,up.replace(marker,marker+lines));console.log("merge manifest exact main history + 11 approved additions; main_relations="+JSON.parse(up).relations.length);const paths=[".brain-versions","DEFINITION.md","changes/cp-10170325-ci-budget-headroom.md","package-lock.json","packages/brain/VERSION","packages/brain/package-lock.json","packages/brain/package.json"];for(const path of paths){const m=git("ls-tree",main,"--",path),z=git("ls-tree",merge,"--",path);a.equal(z,m);if(m){a(git("show",main+":"+path).equals?.(git("show",merge+":"+path))||git("show",main+":"+path)===git("show",merge+":"+path))}console.log(path+" content_and_mode=main")};for(const path of ["packages/brain/scripts/coding-workflow/runner/README.md","sprints/10170627-cw-5190fd91/02-spec.md"]){a.equal(git("show",first+":"+path),git("show",merge+":"+path));console.log(path+" content=first_parent")}'
```
```output
merge manifest exact main history + 11 approved additions; main_relations=306
.brain-versions content_and_mode=main
DEFINITION.md content_and_mode=main
changes/cp-10170325-ci-budget-headroom.md content_and_mode=main
package-lock.json content_and_mode=main
packages/brain/VERSION content_and_mode=main
packages/brain/package-lock.json content_and_mode=main
packages/brain/package.json content_and_mode=main
packages/brain/scripts/coding-workflow/runner/README.md content=first_parent
sprints/10170627-cw-5190fd91/02-spec.md content=first_parent
```

### X-1
对应: Q-1
verdict: PASS
场景: 对空目录连续输入重复 `--json` 和未知参数，程序仍返回空数组且退出码 0；符合规格没有承诺拒绝未知参数的边界。
```command
node -e 'const cp=require("child_process"),fs=require("fs"),os=require("os"),path=require("path"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r4-x1-"));try{const r=cp.spawnSync("node",["packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir",d,"--json","--json","--unknown"],{encoding:"utf8"});a.equal(r.status,0);a.equal(r.stdout.trim(),"[]");a.equal(r.stderr,"");console.log(JSON.stringify({exit:r.status,stdout:r.stdout.trim(),stderr:r.stderr}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"exit":0,"stdout":"[]","stderr":""}
```

## 本轮取证脚本更正记录

Q-1 首次命令把 CLI 返回的 `task_id` 误读为不存在的 `file` 字段，断言失败；其原生输出如下，随后使用 T-1 命令重新执行。
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r4-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const run=(p,json)=>cp.execFileSync("node",[cli,"--log-dir",p,...(json?["--json"]:[])],{encoding:"utf8"}).trim();try{const e=run(d,true),t=run(d,false),m=run(path.join(d,"missing"),true),u=run(path.join(d,"missing"),false);assert.equal(e,"[]");assert.equal(m,"[]");assert(t.includes("没有运行记录"));assert(u.includes("没有运行记录"));for(const n of ["older","newer"])fs.writeFileSync(path.join(d,n+".json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}}));fs.utimesSync(path.join(d,"older.json"),1000000000,1000000000);fs.utimesSync(path.join(d,"newer.json"),1100000000,1100000000);const order=JSON.parse(run(d,true)).map(x=>path.basename(x.file||x.filename||x.path||""));console.log(JSON.stringify({empty_json:e,empty_text:t,missing_json:m,missing_text:u,order,raw:run(d,true)}));assert.deepEqual(order,["newer.json","older.json"])}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"empty_json":"[]","empty_text":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r4-q1-MP1Zc6）","missing_json":"[]","missing_text":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r4-q1-MP1Zc6/missing）","order":["",""],"raw":"[{\"task_id\":\"newer\",\"mtime\":\"2004-11-09T11:33:20.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null},{\"task_id\":\"older\",\"mtime\":\"2001-09-09T01:46:40.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null}]"}
node:internal/assert/utils:146
  throw error;
  ^

AssertionError [ERR_ASSERTION]: Expected values to be loosely deep-equal:

[
  '',
  ''
]

should loosely deep-equal

[
  'newer.json',
  'older.json'
]
    at [eval]:1:1068
    at runScriptInThisContext (node:internal/process/execution:485:12)
    at node:internal/process/execution:483:60
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:479:12)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3 {
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: [ '', '' ],
  expected: [ 'newer.json', 'older.json' ],
  operator: 'deepEqual',
  diff: 'simple'
}

Node.js v26.8.2
```

结论：Q-1 至 Q-3 实测通过；Q-4 已补验裁判 J-1 的 manifest 历史原文和规格纯追加，但因明确读取隔离限制，不能对完整 S-7 范围给 PASS。历史轮 FAIL 不改判。本轮不宣称正式 CI、远端合并、Brain 终态或报告恢复已完成。
