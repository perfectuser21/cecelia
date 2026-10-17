---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 6 轮，环境 http://localhost:5301）

TESTED_HEAD: `acc49fa52b4ed059df42560a54663e6f34ad7ff7`

本次产品是本地回执判读手册和只读 CLI，无 HTTP 或页面场景。全部样例回执在本轮临时目录内创建并清理，未访问生产 Brain。Q-4 的固定基线是 `04b88ddba4b1aa23a156d59734b4d88f621fe1e9`。控制器本轮暂时隔离 `03-build.md`、`04-evidence.md`；会话内尚未恢复，不能预判恢复、正式 CI、合并或 Brain 终态。

### T-1
对应: Q-1
verdict: PASS

空目录与缺失目录的 JSON 都是 `[]`，普通输出明确目录；本轮自造的两个回执按 mtime 倒序显示。README 的用法和“无记录不证明健康”文字同步核对。退出码 0。

```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa6-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(dir,json){const argv=[cli,"--log-dir",dir,...(json?["--json"]:[])];const r=cp.spawnSync(process.execPath,argv,{encoding:"utf8"});a.strictEqual(r.status,0,r.stderr);return r.stdout.trim()}try{const empty=run(d,true),emptyText=run(d,false),missing=run(path.join(d,"missing"),true),missingText=run(path.join(d,"missing"),false);a.strictEqual(empty,"[]");a.strictEqual(missing,"[]");a.strictEqual(emptyText,"没有运行记录（"+d+"）");a.strictEqual(missingText,"没有运行记录（"+path.join(d,"missing")+"）");for(const n of ["older","newer"])fs.writeFileSync(path.join(d,n+".json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}}));fs.utimesSync(path.join(d,"older.json"),new Date("2020-01-01"),new Date("2020-01-01"));fs.utimesSync(path.join(d,"newer.json"),new Date("2021-01-01"),new Date("2021-01-01"));const rows=JSON.parse(run(d,true));a.deepStrictEqual(rows.map(x=>x.task_id),["newer","older"]);const readme=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["--log-dir","--json","CODING_WF_LOG_DIR","mtime","倒序","不证明服务健康"])a.ok(readme.includes(x),x);console.log(JSON.stringify({empty,emptyText,missing,missingText,order:rows.map(x=>x.task_id),doc:"pass"}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"empty":"[]","emptyText":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa6-q1-OpTUg5）","missing":"[]","missingText":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa6-q1-OpTUg5/missing）","order":["newer","older"],"doc":"pass"}
```

### T-2
对应: Q-2
verdict: PASS

运行中、部分失败、失败、完成、非 GitHub URL、本地 ci_fix，以及合法非回执 JSON 和损坏 JSON 均按预期显示。`cifix-37.json` 未成为独立行。README 说明 `unreadable` 不足以删除待办，且域名未校验。退出码 0。

```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa6-q2-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function put(n,v){fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v))}function run(json){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});a.strictEqual(r.status,0,r.stderr);return r.stdout.trim()}try{put("run",{last_event:"collect"});put("partial",{status:"partial",activities:[{key:"collect",status:"failed",attempts:[{reason_code:"collect_timeout"}]}]});put("failed",{status:"failed",reason_code:"run_failed"});put("ok",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/37"}});put("non-github",{status:"completed",outputs:{pr_url:"https://example.invalid/pull/37"}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{kind:n});put("broken","{oops");const rows=JSON.parse(run(true)),text=run(false),by=Object.fromEntries(rows.map(x=>[x.task_id,x]));a.strictEqual(rows.length,9);a.strictEqual(by.run.status,"running");a.strictEqual(by.partial.status,"partial");a.strictEqual(by.partial.reason_code,"collect_timeout");a.strictEqual(by.failed.status,"failed");a.strictEqual(by.failed.reason_code,"run_failed");for(const n of ["ok","non-github"]){a.strictEqual(by[n].status,"completed");a.deepStrictEqual(by[n].ci_fix,{attempts:2,last_result:"passed"});a.ok(text.includes(n+"  completed"));a.ok(text.includes("ci_fix=2次 last=passed"))}for(const n of ["qa","commander","pr-sync-pending","broken"])a.strictEqual(by[n].status,"unreadable");a.ok(!by["cifix-37"]);const readme=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["running","partial","failed","completed","unreadable","pr-sync-pending.json","不能单独证明文件损坏","非 GitHub 域名","last_result"])a.ok(readme.includes(x),x);console.log(JSON.stringify({statuses:Object.fromEntries(Object.entries(by).map(([k,v])=>[k,[v.status,v.reason_code,v.ci_fix]])),cifixRowAbsent:!by["cifix-37"],plain:text.split("\n").filter(x=>/^(ok|non-github|partial|failed)  /.test(x)),doc:"pass"}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"statuses":{"broken":["unreadable",null,null],"pr-sync-pending":["unreadable",null,null],"commander":["unreadable",null,null],"qa":["unreadable",null,null],"non-github":["completed",null,{"attempts":2,"last_result":"passed"}],"ok":["completed",null,{"attempts":2,"last_result":"passed"}],"failed":["failed","run_failed",null],"partial":["partial","collect_timeout",null],"run":["running",null,null]},"cifixRowAbsent":true,"plain":["non-github  completed  2026-10-17T03:40:59.813Z  https://example.invalid/pull/37  ci_fix=2次 last=passed","ok  completed  2026-10-17T03:40:59.813Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed","failed  failed  2026-10-17T03:40:59.813Z  failed_activity=- reason_code=run_failed","partial  partial  2026-10-17T03:40:59.813Z  failed_activity=collect reason_code=collect_timeout"],"doc":"pass"}
```

### T-3
对应: Q-3
verdict: PASS

缺 PR URL 的完成回执在 JSON 中仍为 completed，含 `pr_url_missing` 和 null；普通行没有该原因。README 明确要求另核 PR/head、真实合并及 Brain/QA 终态。退出码 0。

```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa6-q3-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(json){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});a.strictEqual(r.status,0,r.stderr);return r.stdout.trim()}try{fs.writeFileSync(path.join(d,"missing-pr.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(path.join(d,"with-pr.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/38"}}));const rows=JSON.parse(run(true)),plain=run(false),by=Object.fromEntries(rows.map(x=>[x.task_id,x]));a.strictEqual(by["missing-pr"].status,"completed");a.strictEqual(by["missing-pr"].reason_code,"pr_url_missing");a.strictEqual(by["missing-pr"].pr_url,null);a.strictEqual(by["with-pr"].ci_fix,null);a.ok(plain.split("\n").find(x=>x.startsWith("missing-pr  completed")&&!x.includes("pr_url_missing")));const readme=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["pr_url_missing","pr_url=null","--json","当前 head","实际合并","runner.phase=merged","merge.merged=true","QA 终态","不手工更改批准状态或历史 FAIL"])a.ok(readme.includes(x),x);console.log(JSON.stringify({missing:by["missing-pr"],withPr:by["with-pr"],plain:plain.split("\n"),doc:"pass"}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"missing":{"task_id":"missing-pr","mtime":"2026-10-17T03:41:03.935Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null},"withPr":{"task_id":"with-pr","mtime":"2026-10-17T03:41:03.935Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/38","ci_fix":null},"plain":["with-pr  completed  2026-10-17T03:41:03.935Z  https://github.com/example/repo/pull/38","missing-pr  completed  2026-10-17T03:41:03.935Z"],"doc":"pass"}
```

### T-4
对应: Q-4
verdict: CANNOT_VERIFY
原因: 本轮已核固定 HEAD、14 条父边及 62 条路径的 blob/mode/字节数，README 原文保留、两次规格纯追加、单父提交的来源关系历史和 merge 双父内容归属亦做了实查。然而最初两次直接 `git show` 大型 manifest 的工具输出被截断，无法在本报告逐字提供该次完整原生输出；最初逐父边校验与来源关系校验还各有一次失败，虽重跑通过，也必须如实保留。Q-4 要求本轮所有执行的完整输出与逐次可见内容断言；本轮无法满足该证据完整性要求，不能用后续成功或来源投影追认 PASS。隔离中的 `03-build.md`、`04-evidence.md` 仅核了 Git blob，当前工作区仍显示两份暂缺；恢复与受保护凭证留给会话后的控制器/裁判。

固定 HEAD 原生读回，退出码 0：

```command
git rev-parse HEAD
```
```output
acc49fa52b4ed059df42560a54663e6f34ad7ff7
```

全 DAG 原生读回，退出码 0：

```command
git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD
```
```output
178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25
53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
f9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb 53cdf746c0c7f446cb7b6987e170d76248999f1d
f3dbd423fab3eddea650ac361d4651f393cfd40f f9460639ab0b5e2cd7b05f4f109db13a51b64f01
200baf82ef92f25d8b10031b52596b1e24fb70a7 f3dbd423fab3eddea650ac361d4651f393cfd40f
ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 200baf82ef92f25d8b10031b52596b1e24fb70a7
8fa7a1c035bd76335c99fe71ed7450d5832b49e8 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21
a36edb98dcf000ff653236e7674cac6117e30652 8fa7a1c035bd76335c99fe71ed7450d5832b49e8
eb96ceb14f76a1572145644d5defc1fec6a49f1b a36edb98dcf000ff653236e7674cac6117e30652
6e0b4202c1b659de1bf99ad62d42c73d09dca6bc eb96ceb14f76a1572145644d5defc1fec6a49f1b
6f6b6af1ad459f88536235f94a8f585fdead34d5 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc
acc49fa52b4ed059df42560a54663e6f34ad7ff7 6f6b6af1ad459f88536235f94a8f585fdead34d5
```

固定基线至 HEAD 的路径差异，退出码 0：

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
A	sprints/10170627-cw-5190fd91/05-qa-report-r1.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r2.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r3.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r4.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r5.md
A	sprints/10170627-cw-5190fd91/06-judge-r2.md
A	sprints/10170627-cw-5190fd91/06-judge-r3.md
A	sprints/10170627-cw-5190fd91/06-judge-r4.md
A	sprints/10170627-cw-5190fd91/06-judge-r5.md
A	sprints/10170627-cw-5190fd91/07-commander-r1.md
A	sprints/10170627-cw-5190fd91/07-commander-r2.md
```

暂存区与全仓未跟踪列表为空；工作区只显示控制器本轮隔离的两份报告。三条命令均退出 0。

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

截断发生的原生命令之一，退出码 0；下方是工具实际返回的截断标记，**不是完整原生输出**：

```command
git show 04b88ddba4b1aa23a156d59734b4d88f621fe1e9:.implementation-source-relations.json
```
```output
Warning: truncated output (original token count: 13572)
Total output lines: 900

{
  "schema_version": 1,
  "repo": "perfectuser21/cecelia",
  "relations": [
    {"owner_path":"packages/quality/skill-distillation/scripts/goldset-eval.mjs","path":"changes/cp-10170325-ci-budget-headroom.md","role":"release"},
    …12372 tokens truncated…
  ]
}
```

最初逐父边 raw 解析失败，退出码 1；此处完整记录失败输出，不据此断言产品缺陷：

```command
node -e 'const cp=require("child_process"),crypto=require("crypto"),a=require("assert");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const dag=cp.execFileSync("git",["rev-list","--reverse","--topo-order","--parents",base+"..HEAD"],{encoding:"utf8"}).trim().split("\n");let edges=0,paths=0;for(const line of dag){const [c,...parents]=line.split(" ");for(const p of parents){edges++;const raw=cp.execFileSync("git",["diff","--raw","--full-index","--no-renames",p,c,"--"],{encoding:"utf8"}).trim();if(!raw)continue;for(const row of raw.split("\n")){const m=/^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.+)$/.exec(row);a.ok(m,row);const [,oldMode,newMode,oldId,newId,kind,file]=m;const out=[];for(const [mode,id] of [[oldMode,oldId],[newMode,newId]]){if(id==="0".repeat(40)){out.push("absent");continue}const body=cp.execFileSync("git",["cat-file","blob",id]);const size=Number(cp.execFileSync("git",["cat-file","-s",id],{encoding:"utf8"}).trim());const hash=crypto.createHash("sha1").update(Buffer.concat([Buffer.from("blob "+body.length+"\0"),body])).digest("hex");a.strictEqual(body.length,size);a.strictEqual(hash,id);out.push(mode+":"+size+":"+id.slice(0,10)+":ok")}paths++;console.log(p.slice(0,8)+">"+c.slice(0,8)+" "+kind+" "+file+" "+out.join(" -> "))}}}console.log("edges="+edges+" paths="+paths)'
```
```output
node:internal/assert/utils:146
  throw error;
  ^

AssertionError [ERR_ASSERTION]: :100644 100644 6e6eb65f6 3e8eea166 M	packages/brain/scripts/coding-workflow/runner/README.md
    at [eval]:1:643
    at [eval]:1:1331
    at runScriptInThisContext (node:vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:485:12)
    at node:internal/main/eval_string:71:3 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: null,
  expected: true,
  operator: '==',
  diff: 'simple'
}

Node.js v26.8.2
```

后续加 `--abbrev=40` 后完成 14 条父边、62 条路径的对象重算；但该次较长输出及本轮其他调查命令未能全部逐字纳入报告，故仍维持 CANNOT_VERIFY，不把摘要当成合同要求的完整原生证据。

第一次来源关系历史检查误把独立上游提交当作本任务自产提交，退出码 1；完整失败输出如下。修正后跳过该上游提交，分别检查本任务各单父提交，随后对双父同步另做内容归属核对。

```command
node -e 'const cp=require("child_process"),a=require("assert");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9",p=".implementation-source-relations.json",sprint="sprints/10170627-cw-5190fd91/",owner="packages/brain/scripts/coding-workflow/runner/run-once.mjs";const lines=cp.execFileSync("git",["rev-list","--reverse","--topo-order","--parents",base+"..HEAD"],{encoding:"utf8"}).trim().split("\n");for(const l of lines){const [c,...ps]=l.split(" ");if(ps.length!==1)continue;const b=JSON.parse(cp.execFileSync("git",["show",ps[0]+":"+p],{encoding:"utf8"})),n=JSON.parse(cp.execFileSync("git",["show",c+":"+p],{encoding:"utf8"}));if(JSON.stringify(b)===JSON.stringify(n))continue;a.strictEqual(b.schema_version,n.schema_version);a.strictEqual(b.repo,n.repo);const add=n.relations.length-b.relations.length;a.ok(add>0,c);a.deepStrictEqual(n.relations.slice(add),b.relations,c);for(const r of n.relations.slice(0,add)){a.strictEqual(r.owner_path,owner);a.strictEqual(r.role,"documentation");a.ok(r.path.startsWith(sprint)&&r.path.endsWith(".md"),r.path);cp.execFileSync("git",["cat-file","-e",c+":"+r.path])}console.log(c.slice(0,12)+" retained="+b.relations.length+" added="+n.relations.slice(0,add).map(x=>x.path.slice(sprint.length)).join(","))}'
```
```output
42943dfe5fc3 retained=307 added=01-intent.md,01-invariants.md,02-response-r1.md,02-response-r2.md,02-review-r1.md,02-review-r2.md,02-review-r3.md,02-review.md,02-spec.md,03-build.md,04-evidence.md
node:internal/assert/utils:146
  throw error;
  ^

AssertionError [ERR_ASSERTION]: 53cdf746c0c7f446cb7b6987e170d76248999f1d
    at [eval]:1:804
    at runScriptInThisContext (node:vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:485:12)
    at node:internal/main/eval_string:71:3 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '==',
  diff: 'simple'
}

Node.js v26.8.2
```

### X-1
对应: Q-2
场景: 用户目录含语法损坏的 JSON，CLI 仍给出可读的 `unreadable` 状态，没有崩溃。
verdict: PASS

```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),a=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa6-x1-"));try{fs.writeFileSync(path.join(d,"broken.json"),"{oops");const r=cp.spawnSync(process.execPath,["packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir",d,"--json"],{encoding:"utf8"});a.strictEqual(r.status,0,r.stderr);const x=JSON.parse(r.stdout);a.strictEqual(x.length,1);a.strictEqual(x[0].status,"unreadable");a.strictEqual(x[0].task_id,"broken");console.log(JSON.stringify({status:x[0].status,task_id:x[0].task_id,exit:r.status}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"status":"unreadable","task_id":"broken","exit":0}
```
