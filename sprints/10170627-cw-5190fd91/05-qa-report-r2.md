---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 2 轮，环境 http://localhost:5301）

TESTED_HEAD: ea0573f2d1e2a95f5cb7727a70c581d325b1fd21

本次是 README 与本地 status CLI 产品，合同不要求预览 HTTP 或页面操作。所有临时回执均在本轮创建并清理。可信来源投影记录同步事件 c6de1e67-4b53-4d8b-b097-4a711c619c67；它只作同步归属事实，产品结论以下列实际操作为准。

### T-1
对应: Q-1
verdict: PASS
说明: 空目录、不存在目录和 mtime 倒序通过。
退出码: 0
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(dir,json){const a=[cli,"--log-dir",dir,...(json?["--json"]:[])],r=cp.spawnSync(process.execPath,a,{encoding:"utf8"});console.log(JSON.stringify({args:a.slice(1),code:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()}));if(r.status!==0)throw Error("exit");return r.stdout.trim()}try{if(run(d,true)!=="[]")throw Error("empty");if(!run(d,false).includes("没有运行记录（"+d+"）"))throw Error("empty plain");if(run(path.join(d,"missing"),true)!=="[]")throw Error("missing");if(!run(path.join(d,"missing"),false).includes("没有运行记录（"+path.join(d,"missing")+"）"))throw Error("missing plain");const body=JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}});for(const n of ["older","newer"])fs.writeFileSync(path.join(d,n+".json"),body);fs.utimesSync(path.join(d,"older.json"),new Date("2020-01-01"),new Date("2020-01-01"));fs.utimesSync(path.join(d,"newer.json"),new Date("2020-01-02"),new Date("2020-01-02"));const a=JSON.parse(run(d,true));if(a.length!==2||a[0].task_id!=="newer"||a[1].task_id!=="older")throw Error("order");console.log("assertions=PASS")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"args":["--log-dir","/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-R5Xc76","--json"],"code":0,"stdout":"[]","stderr":""}
{"args":["--log-dir","/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-R5Xc76"],"code":0,"stdout":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-R5Xc76）","stderr":""}
{"args":["--log-dir","/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-R5Xc76/missing","--json"],"code":0,"stdout":"[]","stderr":""}
{"args":["--log-dir","/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-R5Xc76/missing"],"code":0,"stdout":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-R5Xc76/missing）","stderr":""}
{"args":["--log-dir","/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-q1-R5Xc76","--json"],"code":0,"stdout":"[{\"task_id\":\"newer\",\"mtime\":\"2020-01-02T00:00:00.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null},{\"task_id\":\"older\",\"mtime\":\"2020-01-01T00:00:00.000Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/12\",\"ci_fix\":null}]","stderr":""}
assertions=PASS
```

### T-2
对应: Q-1,Q-2,Q-3
verdict: PASS
说明: README 的关键判读文字存在。
退出码: 0
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["--log-dir","--json","CODING_WF_LOG_DIR","mtime","[]","不证明服务健康","last_event","running","partial","failed","unreadable","pr-sync-pending.json","不能据此删除","ci_fix","pr_url_missing","runner.phase=merged","merge.merged=true","QA 终态","当前 head","GitHub 实际合并","不手工更改批准状态"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
```
```output
README 文本核对通过
```

### T-3
对应: Q-2
verdict: PASS
说明: 九份合成文件的 JSON 与普通模式一致；合法状态文件可显示 unreadable，非 GitHub URL 也只匹配本地 ci_fix。
退出码: 0
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q2-"));const put=(n,v)=>fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";try{put("run",{last_event:{type:"activity_started"}});put("partial",{status:"partial",activities:[{key:"collect",status:"failed",attempts:[{reason_code:"collect_timeout"}]}]});put("failed",{status:"failed",reason_code:"run_failed"});put("ok",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/37"}});put("non-github",{status:"completed",outputs:{pr_url:"https://example.invalid/pull/37"}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{kind:n});put("broken","{broken");function run(json){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});console.log(JSON.stringify({mode:json?"json":"plain",code:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()}));if(r.status!==0)throw Error("cli exit");return r.stdout.trim()}const a=JSON.parse(run(true));const m=Object.fromEntries(a.map(x=>[x.task_id,x]));if(a.length!==9||m.run.status!=="running"||m.partial.status!=="partial"||m.partial.failed_activity!=="collect"||m.partial.reason_code!=="collect_timeout"||m.failed.status!=="failed"||m.ok.ci_fix?.attempts!==2||m.ok.ci_fix?.last_result!=="passed"||m["non-github"].ci_fix?.attempts!==2||["qa","commander","pr-sync-pending","broken"].some(n=>m[n].status!=="unreadable"))throw Error("Q2 assertion");const p=run(false);if(!p.includes("ci_fix=2次 last=passed"))throw Error("plain ci_fix");console.log("assertions=PASS")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"mode":"json","code":0,"stdout":"[{\"task_id\":\"broken\",\"mtime\":\"2026-10-17T00:03:55.079Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"pr-sync-pending\",\"mtime\":\"2026-10-17T00:03:55.079Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"commander\",\"mtime\":\"2026-10-17T00:03:55.079Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"qa\",\"mtime\":\"2026-10-17T00:03:55.079Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"non-github\",\"mtime\":\"2026-10-17T00:03:55.078Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://example.invalid/pull/37\",\"ci_fix\":{\"attempts\":2,\"last_result\":\"passed\"}},{\"task_id\":\"ok\",\"mtime\":\"2026-10-17T00:03:55.076Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/37\",\"ci_fix\":{\"attempts\":2,\"last_result\":\"passed\"}},{\"task_id\":\"failed\",\"mtime\":\"2026-10-17T00:03:55.076Z\",\"status\":\"failed\",\"failed_activity\":null,\"reason_code\":\"run_failed\",\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"partial\",\"mtime\":\"2026-10-17T00:03:55.076Z\",\"status\":\"partial\",\"failed_activity\":\"collect\",\"reason_code\":\"collect_timeout\",\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"run\",\"mtime\":\"2026-10-17T00:03:55.076Z\",\"status\":\"running\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null}]","stderr":""}
{"mode":"plain","code":0,"stdout":"broken  unreadable  2026-10-17T00:03:55.079Z  failed_activity=- reason_code=-\npr-sync-pending  unreadable  2026-10-17T00:03:55.079Z  failed_activity=- reason_code=-\ncommander  unreadable  2026-10-17T00:03:55.079Z  failed_activity=- reason_code=-\nqa  unreadable  2026-10-17T00:03:55.079Z  failed_activity=- reason_code=-\nnon-github  completed  2026-10-17T00:03:55.078Z  https://example.invalid/pull/37  ci_fix=2次 last=passed\nok  completed  2026-10-17T00:03:55.076Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed\nfailed  failed  2026-10-17T00:03:55.076Z  failed_activity=- reason_code=run_failed\npartial  partial  2026-10-17T00:03:55.076Z  failed_activity=collect reason_code=collect_timeout\nrun  running  2026-10-17T00:03:55.076Z  failed_activity=- reason_code=-","stderr":""}
assertions=PASS
```

### T-4
对应: Q-3
verdict: PASS
说明: 缺 PR URL 的 completed 仍为 completed，JSON 给出 pr_url_missing；普通行不显示该原因。
退出码: 0
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q3-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";try{fs.writeFileSync(path.join(d,"missing-pr.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(path.join(d,"with-pr.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/38"}}));function run(json){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});console.log(JSON.stringify({mode:json?"json":"plain",code:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()}));if(r.status!==0)throw Error("cli exit");return r.stdout.trim()}const a=JSON.parse(run(true)),m=Object.fromEntries(a.map(x=>[x.task_id,x]));if(a.length!==2||m["missing-pr"].status!=="completed"||m["missing-pr"].reason_code!=="pr_url_missing"||m["missing-pr"].pr_url!==null||m["with-pr"].pr_url!=="https://github.com/example/repo/pull/38"||m["with-pr"].ci_fix!==null)throw Error("json");const p=run(false),line=p.split("\n").find(x=>x.startsWith("missing-pr  "));if(!line||line.includes("pr_url_missing"))throw Error("plain");console.log("assertions=PASS")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"mode":"json","code":0,"stdout":"[{\"task_id\":\"with-pr\",\"mtime\":\"2026-10-17T00:03:59.151Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/38\",\"ci_fix\":null},{\"task_id\":\"missing-pr\",\"mtime\":\"2026-10-17T00:03:59.151Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":\"pr_url_missing\",\"pr_url\":null,\"ci_fix\":null}]","stderr":""}
{"mode":"plain","code":0,"stdout":"with-pr  completed  2026-10-17T00:03:59.151Z  https://github.com/example/repo/pull/38\nmissing-pr  completed  2026-10-17T00:03:59.151Z","stderr":""}
assertions=PASS
```

### T-5
对应: Q-4
verdict: PASS
说明: 固定基线全 DAG、全仓差异、暂存、工作区和未跟踪文件已核。工作区两项删除与本轮控制器隐藏事实一致，完整恢复尚未发生。
退出码: 0
```command
node -e 'const cp=require("child_process");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9",head="ea0573f2d1e2a95f5cb7727a70c581d325b1fd21";function run(a){const r=cp.spawnSync("git",a,{encoding:"utf8"});console.log(JSON.stringify({command:"git "+a.join(" "),exit:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()}));if(r.status!==0)throw Error("git failed");return r.stdout.trim()}if(run(["rev-parse","HEAD"])!==head)throw Error("HEAD changed");const dag=run(["rev-list","--reverse","--topo-order","--parents",base+"..HEAD"]);if(dag.split("\n").length!==7)throw Error("DAG");const diff=run(["diff","--name-status",base,"HEAD"]);if(!diff.includes("packages/brain/scripts/coding-workflow/runner/README.md"))throw Error("README missing");if(run(["diff","--cached","--name-status"])!=="")throw Error("staged");const work=run(["diff","--name-status"]);if(work!=="D\tsprints/10170627-cw-5190fd91/03-build.md\nD\tsprints/10170627-cw-5190fd91/04-evidence.md")throw Error("unexpected worktree");if(run(["ls-files","--others","--exclude-standard"])!=="")throw Error("untracked");console.log("assertions=PASS")'
```
```output
{"command":"git rev-parse HEAD","exit":0,"stdout":"ea0573f2d1e2a95f5cb7727a70c581d325b1fd21","stderr":""}
{"command":"git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD","exit":0,"stdout":"178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9\n42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25\n53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9\nf9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb 53cdf746c0c7f446cb7b6987e170d76248999f1d\nf3dbd423fab3eddea650ac361d4651f393cfd40f f9460639ab0b5e2cd7b05f4f109db13a51b64f01\n200baf82ef92f25d8b10031b52596b1e24fb70a7 f3dbd423fab3eddea650ac361d4651f393cfd40f\nea0573f2d1e2a95f5cb7727a70c581d325b1fd21 200baf82ef92f25d8b10031b52596b1e24fb70a7","stderr":""}
{"command":"git diff --name-status 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 HEAD","exit":0,"stdout":"M\t.brain-versions\nM\t.implementation-source-relations.json\nM\tDEFINITION.md\nD\tchanges/cp-10170325-ci-budget-headroom.md\nM\tpackage-lock.json\nM\tpackages/brain/VERSION\nM\tpackages/brain/package-lock.json\nM\tpackages/brain/package.json\nM\tpackages/brain/scripts/coding-workflow/runner/README.md\nA\tsprints/10170627-cw-5190fd91/01-intent.md\nA\tsprints/10170627-cw-5190fd91/01-invariants.md\nA\tsprints/10170627-cw-5190fd91/02-response-r1.md\nA\tsprints/10170627-cw-5190fd91/02-response-r2.md\nA\tsprints/10170627-cw-5190fd91/02-review-r1.md\nA\tsprints/10170627-cw-5190fd91/02-review-r2.md\nA\tsprints/10170627-cw-5190fd91/02-review-r3.md\nA\tsprints/10170627-cw-5190fd91/02-review.md\nA\tsprints/10170627-cw-5190fd91/02-spec.md\nA\tsprints/10170627-cw-5190fd91/03-build.md\nA\tsprints/10170627-cw-5190fd91/04-evidence.md\nA\tsprints/10170627-cw-5190fd91/05-qa-report-r1.md\nA\tsprints/10170627-cw-5190fd91/07-commander-r1.md","stderr":""}
{"command":"git diff --cached --name-status","exit":0,"stdout":"","stderr":""}
{"command":"git diff --name-status","exit":0,"stdout":"D\tsprints/10170627-cw-5190fd91/03-build.md\nD\tsprints/10170627-cw-5190fd91/04-evidence.md","stderr":""}
{"command":"git ls-files --others --exclude-standard","exit":0,"stdout":"","stderr":""}
assertions=PASS
```

### T-6
对应: Q-4
verdict: PASS
说明: 七个提交的八条父边、47 条路径和 68 个非零 blob 均逐项校验；输出列出每一路径、模式、对象 ID、字节数及重算哈希。
退出码: 0
```command
node -e 'const cp=require("child_process"),crypto=require("crypto");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const git=(a,enc="utf8")=>{const r=cp.spawnSync("git",a,{encoding:enc,maxBuffer:100000000});if(r.status!==0)throw Error(a.join(" ")+"\n"+r.stderr);return r.stdout};const rows=git(["rev-list","--reverse","--topo-order","--parents",base+"..HEAD"]).trim().split("\n");let edges=0,paths=0,blobs=0;for(const row of rows){const [commit,...parents]=row.split(" ");for(const parent of parents){edges++;const raw=git(["diff","--no-ext-diff","--no-renames","--raw","--abbrev=40","--full-index",parent,commit,"--"]).trim();const lines=raw?raw.split("\n"):[];console.log("EDGE "+parent+" "+commit+" paths="+lines.length);for(const line of lines){const m=/^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.+)$/.exec(line);if(!m)throw Error("raw parse "+line);paths++;const checks=[];for(const oid of [m[3],m[4]]){if(/^0+$/.test(oid))continue;const data=git(["cat-file","blob",oid],null),size=Number(git(["cat-file","-s",oid]).trim()),hash=crypto.createHash("sha1").update(Buffer.from("blob "+data.length+"\0")).update(data).digest("hex");if(hash!==oid||size!==data.length)throw Error("blob mismatch "+oid);blobs++;checks.push(size+":"+hash)}console.log("PATH "+m[5]+" "+m[6]+" "+m[1]+" "+m[2]+" "+m[3]+" "+m[4]+" blobs="+checks.join(","))}}}console.log("TOTAL edges="+edges+" paths="+paths+" blob_checks="+blobs)'
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 paths=1
PATH M packages/brain/scripts/coding-workflow/runner/README.md 100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 blobs=10889:6e6eb65f64c55bdad786b619e2e9a4ef66225297,13572:3e8eea166d021b985bff0c71e1ccbc87d234d248
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb paths=12
PATH M .implementation-source-relations.json 100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 blobs=54286:b4d00c4f7ea1c087ce0511769e1e25299326cbfd,56013:24de93e0438b1c2a800654e7e0407b2949ef5233
PATH A sprints/10170627-cw-5190fd91/01-intent.md 000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c blobs=15486:3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c
PATH A sprints/10170627-cw-5190fd91/01-invariants.md 000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 blobs=89736:2276b9f0bca1d5fd3e422ef6e962e1259e266703
PATH A sprints/10170627-cw-5190fd91/02-response-r1.md 000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a blobs=589:f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a
PATH A sprints/10170627-cw-5190fd91/02-response-r2.md 000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 blobs=1084:677402ca401d014befa03669d7b1a1aa04a917b2
PATH A sprints/10170627-cw-5190fd91/02-review-r1.md 000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 blobs=1223:8b068bd99a4c2f5abc189032698f21ad8e267be6
PATH A sprints/10170627-cw-5190fd91/02-review-r2.md 000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc blobs=1436:7c80b836bc8c5469525c21273be83ad0e8dde8fc
PATH A sprints/10170627-cw-5190fd91/02-review-r3.md 000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 blobs=1113:e6922e12ac037d6b2ac8839985f3434b9d4f48e5
PATH A sprints/10170627-cw-5190fd91/02-review.md 000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 blobs=1113:e6922e12ac037d6b2ac8839985f3434b9d4f48e5
PATH A sprints/10170627-cw-5190fd91/02-spec.md 000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 blobs=18898:9827a68e93e8e7d2b0c21dcb517cb6c6848e2093
PATH A sprints/10170627-cw-5190fd91/03-build.md 000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff blobs=5095:0d96f563734111cfdcd2049a91b8d0973da5adff
PATH A sprints/10170627-cw-5190fd91/04-evidence.md 000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 blobs=9894:46a81734ed6702902319dcbe09f211bf692b0f88
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 53cdf746c0c7f446cb7b6987e170d76248999f1d paths=8
PATH M .brain-versions 100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d blobs=9:765a3cb613f52cc52b92c04158a540cbe7fba43d,9:f3d261425e53f40ece495da8192f24c6040c909d
PATH M .implementation-source-relations.json 100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd ffadfb9335a468ec6b871f54fd9a6db08ae9e09d blobs=54286:b4d00c4f7ea1c087ce0511769e1e25299326cbfd,54140:ffadfb9335a468ec6b871f54fd9a6db08ae9e09d
PATH M DEFINITION.md 100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b blobs=769540:c61152020942f82f1de6315cb58dda302a1e92cc,770019:a4b46caf2f7230368a87796071009b8b35fcc44b
PATH D changes/cp-10170325-ci-budget-headroom.md 100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 blobs=479:61678453253490efe1e7e647f808ac43965eaac1
PATH M package-lock.json 100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 blobs=698744:f6a79a39a78356e1a59b763567ac45af92e79f5b,698744:aaeb525fdffb110004342b8c6b4f96893d362179
PATH M packages/brain/VERSION 100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d blobs=9:765a3cb613f52cc52b92c04158a540cbe7fba43d,9:f3d261425e53f40ece495da8192f24c6040c909d
PATH M packages/brain/package-lock.json 100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 blobs=378833:bd0894471f6609afd0506fb31cabb315e8a97b25,378833:ecb84839f8de085394f8aa50dd5f0100b1e99465
PATH M packages/brain/package.json 100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 blobs=1998:5451dac0247ba38ee91ec7441f0ef79426ad37b5,1998:b6a3c1c890593a7bc828afa573a4ccaff05ab2c0
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb f9460639ab0b5e2cd7b05f4f109db13a51b64f01 paths=8
PATH M .brain-versions 100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d blobs=9:765a3cb613f52cc52b92c04158a540cbe7fba43d,9:f3d261425e53f40ece495da8192f24c6040c909d
PATH M .implementation-source-relations.json 100644 100644 24de93e0438b1c2a800654e7e0407b2949ef5233 c4f2bb176e606551a32bf9a676b77ea69452efc4 blobs=56013:24de93e0438b1c2a800654e7e0407b2949ef5233,55867:c4f2bb176e606551a32bf9a676b77ea69452efc4
PATH M DEFINITION.md 100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b blobs=769540:c61152020942f82f1de6315cb58dda302a1e92cc,770019:a4b46caf2f7230368a87796071009b8b35fcc44b
PATH D changes/cp-10170325-ci-budget-headroom.md 100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 blobs=479:61678453253490efe1e7e647f808ac43965eaac1
PATH M package-lock.json 100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 blobs=698744:f6a79a39a78356e1a59b763567ac45af92e79f5b,698744:aaeb525fdffb110004342b8c6b4f96893d362179
PATH M packages/brain/VERSION 100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d blobs=9:765a3cb613f52cc52b92c04158a540cbe7fba43d,9:f3d261425e53f40ece495da8192f24c6040c909d
PATH M packages/brain/package-lock.json 100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 blobs=378833:bd0894471f6609afd0506fb31cabb315e8a97b25,378833:ecb84839f8de085394f8aa50dd5f0100b1e99465
PATH M packages/brain/package.json 100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 blobs=1998:5451dac0247ba38ee91ec7441f0ef79426ad37b5,1998:b6a3c1c890593a7bc828afa573a4ccaff05ab2c0
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d f9460639ab0b5e2cd7b05f4f109db13a51b64f01 paths=13
PATH M .implementation-source-relations.json 100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d c4f2bb176e606551a32bf9a676b77ea69452efc4 blobs=54140:ffadfb9335a468ec6b871f54fd9a6db08ae9e09d,55867:c4f2bb176e606551a32bf9a676b77ea69452efc4
PATH M packages/brain/scripts/coding-workflow/runner/README.md 100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 blobs=10889:6e6eb65f64c55bdad786b619e2e9a4ef66225297,13572:3e8eea166d021b985bff0c71e1ccbc87d234d248
PATH A sprints/10170627-cw-5190fd91/01-intent.md 000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c blobs=15486:3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c
PATH A sprints/10170627-cw-5190fd91/01-invariants.md 000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 blobs=89736:2276b9f0bca1d5fd3e422ef6e962e1259e266703
PATH A sprints/10170627-cw-5190fd91/02-response-r1.md 000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a blobs=589:f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a
PATH A sprints/10170627-cw-5190fd91/02-response-r2.md 000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 blobs=1084:677402ca401d014befa03669d7b1a1aa04a917b2
PATH A sprints/10170627-cw-5190fd91/02-review-r1.md 000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 blobs=1223:8b068bd99a4c2f5abc189032698f21ad8e267be6
PATH A sprints/10170627-cw-5190fd91/02-review-r2.md 000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc blobs=1436:7c80b836bc8c5469525c21273be83ad0e8dde8fc
PATH A sprints/10170627-cw-5190fd91/02-review-r3.md 000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 blobs=1113:e6922e12ac037d6b2ac8839985f3434b9d4f48e5
PATH A sprints/10170627-cw-5190fd91/02-review.md 000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 blobs=1113:e6922e12ac037d6b2ac8839985f3434b9d4f48e5
PATH A sprints/10170627-cw-5190fd91/02-spec.md 000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 blobs=18898:9827a68e93e8e7d2b0c21dcb517cb6c6848e2093
PATH A sprints/10170627-cw-5190fd91/03-build.md 000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff blobs=5095:0d96f563734111cfdcd2049a91b8d0973da5adff
PATH A sprints/10170627-cw-5190fd91/04-evidence.md 000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 blobs=9894:46a81734ed6702902319dcbe09f211bf692b0f88
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 f3dbd423fab3eddea650ac361d4651f393cfd40f paths=2
PATH M .implementation-source-relations.json 100644 100644 c4f2bb176e606551a32bf9a676b77ea69452efc4 f3d532f650f678b481fb7125e80f72231bf50d2e blobs=55867:c4f2bb176e606551a32bf9a676b77ea69452efc4,56028:f3d532f650f678b481fb7125e80f72231bf50d2e
PATH A sprints/10170627-cw-5190fd91/05-qa-report-r1.md 000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 blobs=19119:766cc68f7f0cb7bd81da2711b7eb920992f04c05
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f 200baf82ef92f25d8b10031b52596b1e24fb70a7 paths=1
PATH M sprints/10170627-cw-5190fd91/02-spec.md 100644 100644 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae blobs=18898:9827a68e93e8e7d2b0c21dcb517cb6c6848e2093,21682:51450ee5ebc6651ffd41d88a24e283dafa5ca9ae
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 paths=2
PATH M .implementation-source-relations.json 100644 100644 f3d532f650f678b481fb7125e80f72231bf50d2e f0d372e0cb26eb55d12f9def947b73c081b8f963 blobs=56028:f3d532f650f678b481fb7125e80f72231bf50d2e,56189:f0d372e0cb26eb55d12f9def947b73c081b8f963
PATH A sprints/10170627-cw-5190fd91/07-commander-r1.md 000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c blobs=876:fc178a6a802a0410e83cdf2c9c03233f8206bb1c
TOTAL edges=8 paths=47 blob_checks=68
```

### T-7
对应: Q-4
verdict: PASS
说明: 固定基线 README 的旧行原字节按原顺序保留。
退出码: 0
```command
node -e 'const fs=require("fs"),cp=require("child_process");const p="packages/brain/scripts/coding-workflow/runner/README.md";const before=cp.execFileSync("git",["show","04b88ddba4b1aa23a156d59734b4d88f621fe1e9:"+p],{encoding:"utf8"});const after=fs.readFileSync(p,"utf8");let at=0;for(const line of before.match(/.*(?:\n|$)/g).filter(Boolean)){const found=after.indexOf(line,at);if(found<0)throw Error("原文缺失: "+line);at=found+line.length}const m=JSON.parse(fs.readFileSync(".implementation-source-relations.json","utf8"));console.log(JSON.stringify({baseline_bytes:Buffer.byteLength(before),current_bytes:Buffer.byteLength(after),baseline_lines:before.split("\n").length,ordered_original_bytes:true,manifest_type:Array.isArray(m)?"array":typeof m,manifest_keys:Object.keys(m).slice(0,8)}))'
```
```output
{"baseline_bytes":10889,"current_bytes":13572,"baseline_lines":82,"ordered_original_bytes":true,"manifest_type":"object","manifest_keys":["schema_version","repo","relations"]}
```

### T-8
对应: Q-4
verdict: PASS
说明: 以可信 main 同步提交为基准，历史来源行原样保留；新增 13 行均绑定本任务合法 Markdown、固定 owner 与 documentation role。
退出码: 0
```command
node -e 'const fs=require("fs"),cp=require("child_process");const p=".implementation-source-relations.json",base=JSON.parse(cp.execFileSync("git",["show","04b88ddba4b1aa23a156d59734b4d88f621fe1e9:"+p],{encoding:"utf8"})),main=JSON.parse(cp.execFileSync("git",["show","53cdf746c0c7f446cb7b6987e170d76248999f1d:"+p],{encoding:"utf8"})),head=JSON.parse(fs.readFileSync(p,"utf8"));if(base.schema_version!==head.schema_version||base.repo!==head.repo)throw Error("header");const old=main.relations,newr=head.relations;if(JSON.stringify(newr.slice(-old.length))!==JSON.stringify(old))throw Error("historical order/content");const added=newr.slice(0,newr.length-old.length);for(const x of added){if(!x.path?.startsWith("sprints/10170627-cw-5190fd91/")||!x.path.endsWith(".md")||x.owner_path!=="packages/brain/scripts/coding-workflow/runner/run-once.mjs"||x.role!=="documentation")throw Error("invalid addition "+JSON.stringify(x))}console.log(JSON.stringify({base_rows:base.relations.length,main_rows:old.length,head_rows:newr.length,added:added.map(x=>x.path),historical_rows_unchanged:true}))'
```
```output
{"base_rows":307,"main_rows":306,"head_rows":319,"added":["sprints/10170627-cw-5190fd91/07-commander-r1.md","sprints/10170627-cw-5190fd91/05-qa-report-r1.md","sprints/10170627-cw-5190fd91/01-intent.md","sprints/10170627-cw-5190fd91/01-invariants.md","sprints/10170627-cw-5190fd91/02-response-r1.md","sprints/10170627-cw-5190fd91/02-response-r2.md","sprints/10170627-cw-5190fd91/02-review-r1.md","sprints/10170627-cw-5190fd91/02-review-r2.md","sprints/10170627-cw-5190fd91/02-review-r3.md","sprints/10170627-cw-5190fd91/02-review.md","sprints/10170627-cw-5190fd91/02-spec.md","sprints/10170627-cw-5190fd91/03-build.md","sprints/10170627-cw-5190fd91/04-evidence.md"],"historical_rows_unchanged":true}
```

### X-1
对应: Q-2
场景: 用户把合法的 QA、Commander 和终态待办 JSON 放进同一目录，再放入损坏的 JSON，CLI 均标 unreadable；README 告知不能凭该标签删待办。
verdict: PASS
退出码: 0
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q2-"));const put=(n,v)=>fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";try{put("run",{last_event:{type:"activity_started"}});put("partial",{status:"partial",activities:[{key:"collect",status:"failed",attempts:[{reason_code:"collect_timeout"}]}]});put("failed",{status:"failed",reason_code:"run_failed"});put("ok",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/37"}});put("non-github",{status:"completed",outputs:{pr_url:"https://example.invalid/pull/37"}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{kind:n});put("broken","{broken");function run(json){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});console.log(JSON.stringify({mode:json?"json":"plain",code:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()}));if(r.status!==0)throw Error("cli exit");return r.stdout.trim()}const a=JSON.parse(run(true));const m=Object.fromEntries(a.map(x=>[x.task_id,x]));if(a.length!==9||m.run.status!=="running"||m.partial.status!=="partial"||m.partial.failed_activity!=="collect"||m.partial.reason_code!=="collect_timeout"||m.failed.status!=="failed"||m.ok.ci_fix?.attempts!==2||m.ok.ci_fix?.last_result!=="passed"||m["non-github"].ci_fix?.attempts!==2||["qa","commander","pr-sync-pending","broken"].some(n=>m[n].status!=="unreadable"))throw Error("Q2 assertion");const p=run(false);if(!p.includes("ci_fix=2次 last=passed"))throw Error("plain ci_fix");console.log("assertions=PASS")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"mode":"json","code":0,"stdout":"[{\"task_id\":\"broken\",\"mtime\":\"2026-10-17T00:03:55.079Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"pr-sync-pending\",\"mtime\":\"2026-10-17T00:03:55.079Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"commander\",\"mtime\":\"2026-10-17T00:03:55.079Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"qa\",\"mtime\":\"2026-10-17T00:03:55.079Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"non-github\",\"mtime\":\"2026-10-17T00:03:55.078Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://example.invalid/pull/37\",\"ci_fix\":{\"attempts\":2,\"last_result\":\"passed\"}},{\"task_id\":\"ok\",\"mtime\":\"2026-10-17T00:03:55.076Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/37\",\"ci_fix\":{\"attempts\":2,\"last_result\":\"passed\"}},{\"task_id\":\"failed\",\"mtime\":\"2026-10-17T00:03:55.076Z\",\"status\":\"failed\",\"failed_activity\":null,\"reason_code\":\"run_failed\",\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"partial\",\"mtime\":\"2026-10-17T00:03:55.076Z\",\"status\":\"partial\",\"failed_activity\":\"collect\",\"reason_code\":\"collect_timeout\",\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"run\",\"mtime\":\"2026-10-17T00:03:55.076Z\",\"status\":\"running\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null}]","stderr":""}
{"mode":"plain","code":0,"stdout":"broken  unreadable  2026-10-17T00:03:55.079Z  failed_activity=- reason_code=-\npr-sync-pending  unreadable  2026-10-17T00:03:55.079Z  failed_activity=- reason_code=-\ncommander  unreadable  2026-10-17T00:03:55.079Z  failed_activity=- reason_code=-\nqa  unreadable  2026-10-17T00:03:55.079Z  failed_activity=- reason_code=-\nnon-github  completed  2026-10-17T00:03:55.078Z  https://example.invalid/pull/37  ci_fix=2次 last=passed\nok  completed  2026-10-17T00:03:55.076Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed\nfailed  failed  2026-10-17T00:03:55.076Z  failed_activity=- reason_code=run_failed\npartial  partial  2026-10-17T00:03:55.076Z  failed_activity=collect reason_code=collect_timeout\nrun  running  2026-10-17T00:03:55.076Z  failed_activity=- reason_code=-","stderr":""}
assertions=PASS
```

## 阶段边界

当前 QA 会话中 03-build.md 和 04-evidence.md 按本轮控制器事实暂时隐藏；本报告只核其 Git 对象、路径与模式，未读取正文，亦不预判会话后的恢复、裁判、正式 CI、远端合并或 Brain 终态。

## 本轮失败尝试（测试脚本断言修正后重跑）

Q-2 初次断言误写普通行格式；CLI 输出显示实际格式 `ci_fix=2次 last=passed`。

退出码: 1
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q2-"));const put=(n,v)=>fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";try{put("run",{last_event:{type:"activity_started"}});put("partial",{status:"partial",activities:[{name:"collect",status:"failed",attempts:[{reason_code:"collect_timeout"}]}]});put("failed",{status:"failed",reason_code:"run_failed"});put("ok",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/37"}});put("non-github",{status:"completed",outputs:{pr_url:"https://example.invalid/pull/37"}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{kind:n});put("broken","{broken");function run(json){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});console.log(JSON.stringify({mode:json?"json":"plain",code:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()}));if(r.status!==0)throw Error("cli exit");return r.stdout.trim()}const a=JSON.parse(run(true));const m=Object.fromEntries(a.map(x=>[x.task_id,x]));if(a.length!==9||m.run.status!=="running"||m.partial.status!=="partial"||m.partial.reason_code!=="collect_timeout"||m.failed.status!=="failed"||m.ok.ci_fix?.attempts!==2||m.ok.ci_fix?.last_result!=="passed"||m["non-github"].ci_fix?.attempts!==2||["qa","commander","pr-sync-pending","broken"].some(n=>m[n].status!=="unreadable"))throw Error("Q2 assertion");const p=run(false);if(!p.includes("ci_fix=2/passed"))throw Error("plain ci_fix");console.log("assertions=PASS")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"mode":"json","code":0,"stdout":"[{\"task_id\":\"broken\",\"mtime\":\"2026-10-17T00:03:50.510Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"pr-sync-pending\",\"mtime\":\"2026-10-17T00:03:50.510Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"commander\",\"mtime\":\"2026-10-17T00:03:50.510Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"qa\",\"mtime\":\"2026-10-17T00:03:50.510Z\",\"status\":\"unreadable\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"non-github\",\"mtime\":\"2026-10-17T00:03:50.509Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://example.invalid/pull/37\",\"ci_fix\":{\"attempts\":2,\"last_result\":\"passed\"}},{\"task_id\":\"ok\",\"mtime\":\"2026-10-17T00:03:50.509Z\",\"status\":\"completed\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":\"https://github.com/example/repo/pull/37\",\"ci_fix\":{\"attempts\":2,\"last_result\":\"passed\"}},{\"task_id\":\"failed\",\"mtime\":\"2026-10-17T00:03:50.509Z\",\"status\":\"failed\",\"failed_activity\":null,\"reason_code\":\"run_failed\",\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"partial\",\"mtime\":\"2026-10-17T00:03:50.509Z\",\"status\":\"partial\",\"failed_activity\":null,\"reason_code\":\"collect_timeout\",\"pr_url\":null,\"ci_fix\":null},{\"task_id\":\"run\",\"mtime\":\"2026-10-17T00:03:50.509Z\",\"status\":\"running\",\"failed_activity\":null,\"reason_code\":null,\"pr_url\":null,\"ci_fix\":null}]","stderr":""}
{"mode":"plain","code":0,"stdout":"broken  unreadable  2026-10-17T00:03:50.510Z  failed_activity=- reason_code=-\npr-sync-pending  unreadable  2026-10-17T00:03:50.510Z  failed_activity=- reason_code=-\ncommander  unreadable  2026-10-17T00:03:50.510Z  failed_activity=- reason_code=-\nqa  unreadable  2026-10-17T00:03:50.510Z  failed_activity=- reason_code=-\nnon-github  completed  2026-10-17T00:03:50.509Z  https://example.invalid/pull/37  ci_fix=2次 last=passed\nok  completed  2026-10-17T00:03:50.509Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed\nfailed  failed  2026-10-17T00:03:50.509Z  failed_activity=- reason_code=run_failed\npartial  partial  2026-10-17T00:03:50.509Z  failed_activity=- reason_code=collect_timeout\nrun  running  2026-10-17T00:03:50.509Z  failed_activity=- reason_code=-","stderr":""}
[eval]:1
const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-q2-"));const put=(n,v)=>fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";try{put("run",{last_event:{type:"activity_started"}});put("partial",{status:"partial",activities:[{name:"collect",status:"failed",attempts:[{reason_code:"collect_timeout"}]}]});put("failed",{status:"failed",reason_code:"run_failed"});put("ok",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/37"}});put("non-github",{status:"completed",outputs:{pr_url:"https://example.invalid/pull/37"}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{kind:n});put("broken","{broken");function run(json){const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});console.log(JSON.stringify({mode:json?"json":"plain",code:r.status,stdout:r.stdout.trim(),stderr:r.stderr.trim()}));if(r.status!==0)throw Error("cli exit");return r.stdout.trim()}const a=JSON.parse(run(true));const m=Object.fromEntries(a.map(x=>[x.task_id,x]));if(a.length!==9||m.run.status!=="running"||m.partial.status!=="partial"||m.partial.reason_code!=="collect_timeout"||m.failed.status!=="failed"||m.ok.ci_fix?.attempts!==2||m.ok.ci_fix?.last_result!=="passed"||m["non-github"].ci_fix?.attempts!==2||["qa","commander","pr-sync-pending","broken"].some(n=>m[n].status!=="unreadable"))throw Error("Q2 assertion");const p=run(false);if(!p.includes("ci_fix=2/passed"))throw Error("plain ci_fix");console.log("assertions=PASS")}finally{fs.rmSync(d,{recursive:true,force:true})}
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            

Error: plain ci_fix
    at [eval]:1:1680
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3

Node.js v26.8.2
```

Q-4 初次 raw 查询未设置 `--abbrev=40`，Git 默认缩写对象 ID 导致校验脚本退出。

退出码: 1
```command
node -e 'const cp=require("child_process"),crypto=require("crypto");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const git=(a,enc="utf8")=>{const r=cp.spawnSync("git",a,{encoding:enc,maxBuffer:100000000});if(r.status!==0)throw Error(a.join(" ")+"\n"+r.stderr);return r.stdout};const rows=git(["rev-list","--reverse","--topo-order","--parents",base+"..HEAD"]).trim().split("\n");let edges=0,paths=0,blobs=0;for(const row of rows){const [commit,...parents]=row.split(" ");for(const parent of parents){edges++;const raw=git(["diff","--no-ext-diff","--no-renames","--raw","--full-index",parent,commit,"--"]).trim();const lines=raw?raw.split("\n"):[];console.log("EDGE "+parent+" "+commit+" paths="+lines.length);for(const line of lines){const m=/^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.+)$/.exec(line);if(!m)throw Error("raw parse "+line);paths++;const checks=[];for(const oid of [m[3],m[4]]){if(/^0+$/.test(oid))continue;const data=git(["cat-file","blob",oid],null),size=Number(git(["cat-file","-s",oid]).trim()),hash=crypto.createHash("sha1").update(Buffer.from("blob "+data.length+"\0")).update(data).digest("hex");if(hash!==oid||size!==data.length)throw Error("blob mismatch "+oid);blobs++;checks.push(size+":"+hash)}console.log("PATH "+m[5]+" "+m[6]+" "+m[1]+" "+m[2]+" "+m[3]+" "+m[4]+" blobs="+checks.join(","))}}}console.log("TOTAL edges="+edges+" paths="+paths+" blob_checks="+blobs)'
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 paths=1
[eval]:1
(crypto=>{{const cp=require("child_process"),crypto=require("crypto");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const git=(a,enc="utf8")=>{const r=cp.spawnSync("git",a,{encoding:enc,maxBuffer:100000000});if(r.status!==0)throw Error(a.join(" ")+"\n"+r.stderr);return r.stdout};const rows=git(["rev-list","--reverse","--topo-order","--parents",base+"..HEAD"]).trim().split("\n");let edges=0,paths=0,blobs=0;for(const row of rows){const [commit,...parents]=row.split(" ");for(const parent of parents){edges++;const raw=git(["diff","--no-ext-diff","--no-renames","--raw","--full-index",parent,commit,"--"]).trim();const lines=raw?raw.split("\n"):[];console.log("EDGE "+parent+" "+commit+" paths="+lines.length);for(const line of lines){const m=/^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.+)$/.exec(line);if(!m)throw Error("raw parse "+line);paths++;const checks=[];for(const oid of [m[3],m[4]]){if(/^0+$/.test(oid))continue;const data=git(["cat-file","blob",oid],null),size=Number(git(["cat-file","-s",oid]).trim()),hash=crypto.createHash("sha1").update(Buffer.from("blob "+data.length+"\0")).update(data).digest("hex");if(hash!==oid||size!==data.length)throw Error("blob mismatch "+oid);blobs++;checks.push(size+":"+hash)}console.log("PATH "+m[5]+" "+m[6]+" "+m[1]+" "+m[2]+" "+m[3]+" "+m[4]+" blobs="+checks.join(","))}}}console.log("TOTAL edges="+edges+" paths="+paths+" blob_checks="+blobs)}})(require('node:crypto'))
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        ^

Error: raw parse :100644 100644 6e6eb65f6 3e8eea166 M	packages/brain/scripts/coding-workflow/runner/README.md
    at [eval]:1:847
    at [eval]:1:1428
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3

Node.js v26.8.2
```

README 初次文本核对误把合成 URL 字面量列为文档必需词；合同要求的是非 GitHub URL 语义。

退出码: 1
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["--log-dir","--json","CODING_WF_LOG_DIR","mtime","[]","不证明服务健康","last_event","running","partial","failed","unreadable","pr-sync-pending.json","不能据此删除","ci_fix","example.invalid","pr_url_missing","runner.phase=merged","merge.merged=true","QA 终态","当前 head","GitHub 实际合并","不手工更改批准状态"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
```
```output
[eval]:1
const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["--log-dir","--json","CODING_WF_LOG_DIR","mtime","[]","不证明服务健康","last_event","running","partial","failed","unreadable","pr-sync-pending.json","不能据此删除","ci_fix","example.invalid","pr_url_missing","runner.phase=merged","merge.merged=true","QA 终态","当前 head","GitHub 实际合并","不手工更改批准状态"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")
                                                                                                                                                                                                                                                                                                                                                                                                                                                       ^

Error: example.invalid
    at [eval]:1:446
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3

Node.js v26.8.2
```



