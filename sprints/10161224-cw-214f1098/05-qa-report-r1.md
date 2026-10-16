---
task_id: 214f1098-a4b8-4c0b-9947-daf49a9bd929
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 1 轮，环境 http://localhost:5303）

TESTED_HEAD: d8b577d83a77d0cc931d863b4ecca65d6d2a615e

本轮合同只验仓库 README、真实 CLI 及发布后来源范围；没有 API 或页面场景。来源登记与阶段提交采用控制器给出的 `SOURCE_PROVENANCE` 固定事实，不充当下面的命令证据；尚未发生的 QA、合并及 Brain 终态不在本轮判定内。

### T-1
对应: Q-1
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["## 运行回执如何判读","--log-dir <回执目录> --json","CODING_WF_LOG_DIR","mtime","没有运行记录","不能证明服务健康"])if(!s.includes(x))throw Error(x);console.log("Q-1 README 文本核对通过")'
```
```output
Q-1 README 文本核对通过
```

### T-2
对应: Q-1
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa1-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(dir,json){const r=cp.spawnSync("node",[cli,"--log-dir",dir,...(json?["--json"]:[])],{encoding:"utf8"});assert.strictEqual(r.status,0,r.stderr);return r.stdout.trim()}try{const empty=run(d,true),plain=run(d,false),missing=run(path.join(d,"missing"),true);assert.strictEqual(empty,"[]");assert(plain.includes("没有运行记录"));assert.strictEqual(missing,"[]");fs.writeFileSync(path.join(d,"old.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/1"}}));fs.writeFileSync(path.join(d,"new.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/2"}}));for(const [name,time] of [["old.json","202001010101"],["new.json","202101010101"]])assert.strictEqual(cp.spawnSync("touch",["-t",time,path.join(d,name)]).status,0);const rows=JSON.parse(run(d,true)),text=run(d,false);assert.deepStrictEqual(rows.map(x=>x.task_id),["new","old"]);assert(text.indexOf("new  completed")<text.indexOf("old  completed"));console.log(JSON.stringify({empty,plain,missing,rows:rows.map(x=>({task_id:x.task_id,status:x.status})),text}));}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"empty":"[]","plain":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa1-0HM0dT）","missing":"[]","rows":[{"task_id":"new","status":"completed"},{"task_id":"old","status":"completed"}],"text":"new  completed  2020-12-31T17:01:00.000Z  https://github.com/example/repo/pull/2\nold  completed  2019-12-31T17:01:00.000Z  https://github.com/example/repo/pull/1"}
```

### T-3
对应: Q-2
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa2-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function put(n,v){fs.writeFileSync(path.join(d,n),typeof v==="string"?v:JSON.stringify(v))}function run(json){const r=cp.spawnSync("node",[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});assert.strictEqual(r.status,0,r.stderr);return r.stdout.trim()}try{put("progress.json",{last_event:"step"});put("partial.json",{status:"partial",activities:[{key:"done",status:"completed"},{key:"test",status:"failed",attempts:[{reason_code:"old"},{reason_code:"tests_failed"}]}]});put("failed.json",{status:"failed",activities:[{key:"build",status:"failed",reason_code:"build_failed"}]});for(const n of ["qa-check.json","commander-check.json","pr-sync-pending.json"])put(n,{kind:"pending"});put("broken.json","{");put("complete.json",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/77"}});put("cifix-77.json",{attempts:[{result:"push_failed"},{result:"pushed"}]});const rows=JSON.parse(run(true)),m=Object.fromEntries(rows.map(x=>[x.task_id,x])),plain=run(false),files=fs.readdirSync(d).sort();assert.strictEqual(m.progress.status,"running");assert.deepStrictEqual([m.partial.status,m.partial.failed_activity,m.partial.reason_code],["partial","test","tests_failed"]);assert.deepStrictEqual([m.failed.status,m.failed.failed_activity,m.failed.reason_code],["failed","build","build_failed"]);for(const n of ["qa-check","commander-check","pr-sync-pending","broken"])assert.strictEqual(m[n].status,"unreadable");assert.deepStrictEqual(m.complete.ci_fix,{attempts:2,last_result:"pushed"});assert(!m["cifix-77"]);assert(plain.includes("ci_fix=2次 last=pushed"));assert.strictEqual(files.length,9);console.log(JSON.stringify({rows:rows.map(x=>({task_id:x.task_id,status:x.status,failed_activity:x.failed_activity,reason_code:x.reason_code,ci_fix:x.ci_fix})),plain,files}));}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"rows":[{"task_id":"complete","status":"completed","failed_activity":null,"reason_code":null,"ci_fix":{"attempts":2,"last_result":"pushed"}},{"task_id":"broken","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"pr-sync-pending","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"commander-check","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"qa-check","status":"unreadable","failed_activity":null,"reason_code":null,"ci_fix":null},{"task_id":"failed","status":"failed","failed_activity":"build","reason_code":"build_failed","ci_fix":null},{"task_id":"partial","status":"partial","failed_activity":"test","reason_code":"tests_failed","ci_fix":null},{"task_id":"progress","status":"running","failed_activity":null,"reason_code":null,"ci_fix":null}],"plain":"complete  completed  2026-10-16T05:12:43.427Z  https://github.com/example/repo/pull/77  ci_fix=2次 last=pushed\nbroken  unreadable  2026-10-16T05:12:43.427Z  failed_activity=- reason_code=-\npr-sync-pending  unreadable  2026-10-16T05:12:43.427Z  failed_activity=- reason_code=-\ncommander-check  unreadable  2026-10-16T05:12:43.427Z  failed_activity=- reason_code=-\nqa-check  unreadable  2026-10-16T05:12:43.427Z  failed_activity=- reason_code=-\nfailed  failed  2026-10-16T05:12:43.427Z  failed_activity=build reason_code=build_failed\npartial  partial  2026-10-16T05:12:43.427Z  failed_activity=test reason_code=tests_failed\nprogress  running  2026-10-16T05:12:43.427Z  failed_activity=- reason_code=-","files":["broken.json","cifix-77.json","commander-check.json","complete.json","failed.json","partial.json","pr-sync-pending.json","progress.json","qa-check.json"]}
```

### T-4
对应: Q-2
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["`running`","`completed`","`partial` / `failed`","`unreadable`","pr-sync-pending.json","不能断定文件损坏","不是删除现场或待办的依据","ci_fix.attempts","ci_fix.last_result"])if(!s.includes(x))throw Error(x);console.log("Q-2 README 文本核对通过")'
```
```output
Q-2 README 文本核对通过
```

### T-5
对应: Q-3
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa3-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(json){const r=cp.spawnSync("node",[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});assert.strictEqual(r.status,0,r.stderr);return r.stdout.trim()}try{fs.writeFileSync(path.join(d,"no-url.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(path.join(d,"example-url.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/999999"}}));const rows=JSON.parse(run(true)),m=Object.fromEntries(rows.map(x=>[x.task_id,x])),plain=run(false);assert.deepStrictEqual([m["no-url"].status,m["no-url"].reason_code,m["no-url"].pr_url],["completed","pr_url_missing",null]);assert.deepStrictEqual([m["example-url"].status,m["example-url"].reason_code],["completed",null]);assert(!plain.includes("pr_url_missing"));console.log(JSON.stringify({rows:rows.map(x=>({task_id:x.task_id,status:x.status,reason_code:x.reason_code,pr_url:x.pr_url})),plain,conclusion:"未证实最终合并"}));}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"rows":[{"task_id":"example-url","status":"completed","reason_code":null,"pr_url":"https://github.com/example/repo/pull/999999"},{"task_id":"no-url","status":"completed","reason_code":"pr_url_missing","pr_url":null}],"plain":"example-url  completed  2026-10-16T05:12:55.237Z  https://github.com/example/repo/pull/999999\nno-url  completed  2026-10-16T05:12:55.237Z","conclusion":"未证实最终合并"}
```

### T-6
对应: Q-3
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["pr_url_missing","pr_url=null","最终 head 是否已合并","runner.phase=merged","merge.merged=true","QA 终态","尚未证实最终合并","不手改批准或 FAIL 记录"])if(!s.includes(x))throw Error(x);console.log("Q-3 README 文本核对通过")'
```
```output
Q-3 README 文本核对通过
```

### T-7
对应: Q-4
verdict: PASS
```command
node -e 'const fs=require("fs"),cp=require("child_process"),assert=require("assert");const base="1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c",head="d8b577d83a77d0cc931d863b4ecca65d6d2a615e",readme="packages/brain/scripts/coding-workflow/runner/README.md",manifest=".implementation-source-relations.json",sprint="sprints/10161224-cw-214f1098/";function git(...a){return cp.execFileSync("git",a,{encoding:"utf8"}).trimEnd()}assert.strictEqual(git("rev-parse","HEAD"),head);const changed=git("diff","--name-only",base,"HEAD").split("\n"),staged=git("diff","--name-only","--cached").split("\n").filter(Boolean),working=git("diff","--name-only").split("\n").filter(Boolean),untracked=git("ls-files","--others","--exclude-standard").split("\n").filter(Boolean);assert(changed.includes(readme)&&changed.includes(manifest));for(const p of changed)assert(p===readme||p===manifest||p.startsWith(sprint),p);assert.deepStrictEqual(staged,[]);for(const p of working)assert(p.startsWith(sprint),p);for(const p of untracked)assert(p.startsWith(sprint),p);const old=git("show",base+":"+readme).split("\n"),now=fs.readFileSync(readme,"utf8").trimEnd().split("\n");let i=0;for(const line of now)if(line===old[i])i++;assert.strictEqual(i,old.length,"README 原行缺失或乱序");const a=git("show",base+":"+manifest),b=fs.readFileSync(manifest,"utf8").trimEnd(),added=b.split("\n").filter(x=>x.includes("\"path\":\""+sprint)),allowed=["01-intent.md","01-invariants.md","02-review-r1.md","02-review.md","02-spec.md","03-build.md","04-evidence.md"];assert.deepStrictEqual(added.map(x=>JSON.parse(x.trim().replace(/,$/,"")).path),allowed.map(x=>sprint+x));for(const line of added){const x=JSON.parse(line.trim().replace(/,$/,""));assert.strictEqual(x.owner_path,"packages/brain/scripts/coding-workflow/runner/run-once.mjs");assert.strictEqual(x.role,"documentation")}assert.strictEqual(b.split("\n").filter(x=>!added.includes(x)).join("\n"),a,"manifest 历史行被更改");console.log(JSON.stringify({head,changed,staged,working,untracked,readme_original_lines:old.length,manifest_added:added.length,manifest_history_unchanged:true}));'
```
```output
{"head":"d8b577d83a77d0cc931d863b4ecca65d6d2a615e","changed":[".implementation-source-relations.json","packages/brain/scripts/coding-workflow/runner/README.md","sprints/10161224-cw-214f1098/01-intent.md","sprints/10161224-cw-214f1098/01-invariants.md","sprints/10161224-cw-214f1098/02-review-r1.md","sprints/10161224-cw-214f1098/02-review.md","sprints/10161224-cw-214f1098/02-spec.md","sprints/10161224-cw-214f1098/03-build.md","sprints/10161224-cw-214f1098/04-evidence.md"],"staged":[],"working":["sprints/10161224-cw-214f1098/03-build.md","sprints/10161224-cw-214f1098/04-evidence.md"],"untracked":[],"readme_original_lines":81,"manifest_added":7,"manifest_history_unchanged":true}
```

### X-1
对应: Q-3
场景: 用户把 PR URL 留成空字符串并连续读三次，结果一致，原回执未被修改。
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-x1-")),f=path.join(d,"receipt.json"),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";try{fs.writeFileSync(f,JSON.stringify({status:"completed",outputs:{pr_url:""}}));const before=fs.readFileSync(f,"utf8"),runs=[];for(let i=0;i<3;i++){const r=cp.spawnSync("node",[cli,"--log-dir",d,"--json"],{encoding:"utf8"});assert.strictEqual(r.status,0,r.stderr);runs.push(JSON.parse(r.stdout))}assert.deepStrictEqual(runs[0],runs[1]);assert.deepStrictEqual(runs[1],runs[2]);assert.strictEqual(fs.readFileSync(f,"utf8"),before);assert.deepStrictEqual([runs[0][0].status,runs[0][0].reason_code,runs[0][0].pr_url],["completed","pr_url_missing",null]);console.log(JSON.stringify({runs:runs.length,row:runs[0][0],file_unchanged:true}));}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"runs":3,"row":{"task_id":"receipt","mtime":"2026-10-16T05:13:17.796Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null},"file_unchanged":true}
```
