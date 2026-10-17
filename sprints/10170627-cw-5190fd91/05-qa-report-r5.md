---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 5 轮，环境 http://localhost:5301）

TESTED_HEAD: 6f6b6af1ad459f88536235f94a8f585fdead34d5

本合同的产品操作是本地只读 status CLI 与 README 核对，未要求访问预览 API 或 Dashboard。Q-4 的会话后恢复、正式 CI、远端合并及 Brain 终态尚不能在当前会话预判。控制器给出的本轮隔离事实仅用于解释 03-build.md、04-evidence.md 的当前暂缺，不作为恢复完成证据。

### T-1
对应: Q-1
verdict: PASS
退出码: 0
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r5-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const run=(dir,json)=>{const r=cp.spawnSync(process.execPath,[cli,"--log-dir",dir,...(json?["--json"]:[])],{encoding:"utf8"});if(r.status!==0)throw Error(r.stderr||r.status);return r.stdout.trim()};const empty=run(d,true),missing=run(path.join(d,"missing"),true),emptyText=run(d,false),missingText=run(path.join(d,"missing"),false);if(empty!=="[]"||missing!=="[]"||!emptyText.includes("没有运行记录（"+d+"）")||!missingText.includes("没有运行记录（"+path.join(d,"missing")+"）"))throw Error("empty mismatch");const receipt=JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}});for(const name of ["older","newer"])fs.writeFileSync(path.join(d,name+".json"),receipt);fs.utimesSync(path.join(d,"older.json"),1000000000,1000000000);fs.utimesSync(path.join(d,"newer.json"),1100000000,1100000000);const ordered=run(d,true),rows=JSON.parse(ordered);if(rows.length!==2||rows[0].task_id!=="newer"||rows[1].task_id!=="older")throw Error(ordered);console.log(JSON.stringify({empty,missing,emptyText,missingText,ordered,exit_code:0}))'
```
```output
{"empty":"[]","missing":"[]","emptyText":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r5-q1-4vdgqr）","missingText":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r5-q1-4vdgqr/missing）","ordered":"[{\"task_id\":\"newer\",\"mtime\":\"2004-11-09T11:33:20.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null},{\"task_id\":\"older\",\"mtime\":\"2001-09-09T01:46:40.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null}]","exit_code":0}
```

### T-2
对应: Q-2
verdict: PASS
退出码: 0
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r5-q2-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const put=(n,v)=>fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));put("run",{last_event:"start"});put("partial",{status:"partial",activities:[{key:"collect",status:"failed",attempts:[{reason_code:"old"},{reason_code:"collect_timeout"}]}]});put("failed",{status:"failed"});for(const n of ["ok","non-github"])put(n,{status:"completed",outputs:{pr_url:(n==="ok"?"https://github.com/example/repo":"https://example.invalid")+"/pull/37"}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{state:"pending"});put("broken","{bad");const run=json=>{const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});if(r.status!==0)throw Error(r.stderr||r.status);return r.stdout.trim()};const json=run(true),plain=run(false),rows=JSON.parse(json),by=Object.fromEntries(rows.map(x=>[x.task_id,x]));if(rows.length!==9||by.run.status!=="running"||by.partial.status!=="partial"||by.partial.reason_code!=="collect_timeout"||by.failed.status!=="failed"||by.failed.reason_code!=="run_failed")throw Error(json);for(const n of ["ok","non-github"])if(by[n].status!=="completed"||by[n].ci_fix?.attempts!==2||by[n].ci_fix?.last_result!=="passed"||!plain.includes(n+"  completed")||!plain.includes("ci_fix=2次 last=passed"))throw Error(n);for(const n of ["qa","commander","pr-sync-pending","broken"])if(by[n].status!=="unreadable")throw Error(n);if(by["cifix-37"])throw Error("cifix listed");console.log(JSON.stringify({json,plain,exit_code:0}))'
```
```output
{"json":"[{\"task_id\":\"broken\",\"mtime\":\"2026-10-17T03:00:45.093Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"pr-sync-pending\",\"mtime\":\"2026-10-17T03:00:45.093Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"commander\",\"mtime\":\"2026-10-17T03:00:45.093Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"qa\",\"mtime\":\"2026-10-17T03:00:45.093Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"non-github\",\"mtime\":\"2026-10-17T03:00:45.092Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://example.invalid/pull/37\",\"ci_fix\":{\"attempts\":2,\"last_result\":\"passed\"}},{\"task_id\":\"ok\",\"mtime\":\"2026-10-17T03:00:45.092Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/37\",\"ci_fix\":{\"attempts\":2,\"last_result\":\"passed\"}},{\"task_id\":\"failed\",\"mtime\":\"2026-10-17T03:00:45.092Z\",\"status\":\"failed\",\"failed_activity\":null,\"reason_code\":\"run_failed\",\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"partial\",\"mtime\":\"2026-10-17T03:00:45.092Z\",\"status\":\"partial\",\"failed_activity\":\"collect\",\"reason_code\":\"collect_timeout\",\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"run\",\"mtime\":\"2026-10-17T03:00:45.092Z\",\"status\":\"running\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null}]","plain":"broken  unreadable  2026-10-17T03:00:45.093Z  failed_activity=- reason_code=-\npr-sync-pending  unreadable  2026-10-17T03:00:45.093Z  failed_activity=- reason_code=-\ncommander  unreadable  2026-10-17T03:00:45.093Z  failed_activity=- reason_code=-\nqa  unreadable  2026-10-17T03:00:45.093Z  failed_activity=- reason_code=-\nnon-github  completed  2026-10-17T03:00:45.092Z  https://example.invalid/pull/37  ci_fix=2次 last=passed\nok  completed  2026-10-17T03:00:45.092Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed\nfailed  failed  2026-10-17T03:00:45.092Z  failed_activity=- reason_code=run_failed\npartial  partial  2026-10-17T03:00:45.092Z  failed_activity=collect reason_code=collect_timeout\nrun  running  2026-10-17T03:00:45.092Z  failed_activity=- reason_code=-","exit_code":0}
```

### T-3
对应: Q-3
verdict: PASS
退出码: 0
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r5-q3-")),cli="packages/brain/scripts/coding-workflow/runner/status.mjs";fs.writeFileSync(path.join(d,"missing-pr.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(path.join(d,"with-pr.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/38"}}));const run=json=>{const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});if(r.status!==0)throw Error(r.stderr||r.status);return r.stdout.trim()};const json=run(true),plain=run(false),by=Object.fromEntries(JSON.parse(json).map(x=>[x.task_id,x]));if(by["missing-pr"].status!=="completed"||by["missing-pr"].reason_code!=="pr_url_missing"||by["missing-pr"].pr_url!==null||by["with-pr"].pr_url!=="https://github.com/example/repo/pull/38"||by["with-pr"].ci_fix!==null||plain.includes("pr_url_missing"))throw Error(json+"\n"+plain);console.log(JSON.stringify({json,plain,exit_code:0}))'
```
```output
{"json":"[{\"task_id\":\"with-pr\",\"mtime\":\"2026-10-17T03:00:45.091Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/38\",\"ci_fix\":null},{\"task_id\":\"missing-pr\",\"mtime\":\"2026-10-17T03:00:45.091Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":\"pr_url_missing\",\"pr_url\":null,\"ci_fix\":null}]","plain":"with-pr  completed  2026-10-17T03:00:45.091Z  https://github.com/example/repo/pull/38\nmissing-pr  completed  2026-10-17T03:00:45.091Z","exit_code":0}
```

### T-4
对应: Q-1,Q-2,Q-3
verdict: PASS
退出码: 0
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["运行回执如何判读","--log-dir","--json","CODING_WF_LOG_DIR","mtime","不证明服务健康","running","completed","partial","failed","unreadable","pr-sync-pending.json","不能单独证明文件损坏","ci_fix","last_result","不校验 URL 域名","pr_url_missing","pr_url=null","当前 head","GitHub 实际合并","runner.phase=merged","merge.merged=true","QA 终态","不手工更改批准状态"])if(!s.includes(x))throw Error(x);console.log("README 关键语义核对通过；exit_code=0")'
```
```output
README 关键语义核对通过；exit_code=0
```

### T-5
对应: Q-4
verdict: PASS
退出码: 0
```command
node -e 'const fs=require("fs"),cp=require("child_process");const p="packages/brain/scripts/coding-workflow/runner/README.md";const old=cp.execFileSync("git",["show","04b88ddba4b1aa23a156d59734b4d88f621fe1e9:packages/brain/scripts/coding-workflow/runner/README.md"],{encoding:"utf8"}),now=fs.readFileSync(p,"utf8");const start=now.indexOf("## 运行回执如何判读\n"),end=now.indexOf("## 故障时保留现场\n",start);if(start<0||end<0||now.slice(0,start)+now.slice(end)!==old)throw Error("原文未逐字保留");console.log(JSON.stringify({removed_section_bytes:Buffer.byteLength(now.slice(start,end)),baseline_exact:true,exit_code:0}))'
```
```output
{"removed_section_bytes":2683,"baseline_exact":true,"exit_code":0}
```

### T-6
对应: Q-4
verdict: CANNOT_VERIFY
原因: 已完成本条列出的当前范围枚举，但本轮禁止读取 sprint 内 01、02 和指定裁决以外的报告，无法执行 S-7 要求的其它可见历史报告逐次内容断言；也未完成逐父边完整内容归属核验，因此 Q-4 不可判 PASS。
退出码: 0
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
```

### T-7
对应: Q-4
verdict: CANNOT_VERIFY
原因: 已完成本条列出的当前范围枚举，但本轮禁止读取 sprint 内 01、02 和指定裁决以外的报告，无法执行 S-7 要求的其它可见历史报告逐次内容断言；也未完成逐父边完整内容归属核验，因此 Q-4 不可判 PASS。
退出码: 0
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
A	sprints/10170627-cw-5190fd91/06-judge-r2.md
A	sprints/10170627-cw-5190fd91/06-judge-r3.md
A	sprints/10170627-cw-5190fd91/06-judge-r4.md
A	sprints/10170627-cw-5190fd91/07-commander-r1.md
A	sprints/10170627-cw-5190fd91/07-commander-r2.md
```

### T-8
对应: Q-4
verdict: CANNOT_VERIFY
原因: 已完成本条列出的当前范围枚举，但本轮禁止读取 sprint 内 01、02 和指定裁决以外的报告，无法执行 S-7 要求的其它可见历史报告逐次内容断言；也未完成逐父边完整内容归属核验，因此 Q-4 不可判 PASS。
退出码: 0
```command
git diff --name-status
```
```output
D	sprints/10170627-cw-5190fd91/03-build.md
D	sprints/10170627-cw-5190fd91/04-evidence.md
```

### T-9
对应: Q-4
verdict: CANNOT_VERIFY
原因: 已完成本条列出的当前范围枚举，但本轮禁止读取 sprint 内 01、02 和指定裁决以外的报告，无法执行 S-7 要求的其它可见历史报告逐次内容断言；也未完成逐父边完整内容归属核验，因此 Q-4 不可判 PASS。
退出码: 0
```command
node -e 'const cp=require("child_process");const r=cp.spawnSync("git",["ls-files","--others","--exclude-standard"],{encoding:"utf8"});if(r.status!==0)throw Error(r.stderr);console.log(JSON.stringify({command:"git ls-files --others --exclude-standard",stdout:r.stdout,exit_code:r.status}))'
```
```output
{"command":"git ls-files --others --exclude-standard","stdout":"sprints/10170627-cw-5190fd91/05-qa-report-r5.md\n","exit_code":0}
```

### T-10
对应: Q-4
verdict: CANNOT_VERIFY
原因: 已完成本条列出的当前范围枚举，但本轮禁止读取 sprint 内 01、02 和指定裁决以外的报告，无法执行 S-7 要求的其它可见历史报告逐次内容断言；也未完成逐父边完整内容归属核验，因此 Q-4 不可判 PASS。
退出码: 0
```command
node -e 'const cp=require("child_process");const r=cp.spawnSync("git",["diff","--cached","--name-status"],{encoding:"utf8"});if(r.status!==0)throw Error(r.stderr);console.log(JSON.stringify({command:"git diff --cached --name-status",stdout:r.stdout,exit_code:r.status}))'
```
```output
{"command":"git diff --cached --name-status","stdout":"","exit_code":0}
```

## 裁判缺口与探索记录

J-1：上一轮缺少其它可见历史报告逐次内容断言。本轮权限明确禁止读取这些 sprint 报告；T-6 至 T-10 仅证明固定基线 DAG 与当前差异的枚举，不能替代内容核验，故 Q-4 为 CANNOT_VERIFY。J-2：本轮条目记录完整实际命令、原样输出和退出码，不替换时间戳。第一次 Q-1 试验将输出字段误认作 file，断言以退出码 1 失败；随后用真实字段 task_id 修正并重跑 T-1，该失败是验收脚本错误，不是产品缺陷。当前会话内恢复尚未发生，历史结论不予改写。

探索：Q-2 的 broken.json 返回 unreadable，非回执的 pr-sync-pending.json 也返回 unreadable；二者不应被同等当作文件损坏或删除依据。未发现新的阻断或重要产品缺陷。
