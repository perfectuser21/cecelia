---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1","02-spec.md#Q-2","02-spec.md#Q-3","02-spec.md#Q-4"]
---
# QA 报告（第 3 轮，环境 http://localhost:5301）

TESTED_HEAD: 8fa7a1c035bd76335c99fe71ed7450d5832b49e8

本次产品是本地 CLI 与 README，无 HTTP 或页面场景；未访问生产。Q-4 固定 initial base 为 04b88ddba4b1aa23a156d59734b4d88f621fe1e9。当前会话按控制器隔离事实，03-build.md 和 04-evidence.md 临时隐藏；完整恢复尚未发生，由会话后裁判核。来源投影只用于归属，不当作功能证据。

### T-1
对应: Q-1
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),p=require("path"),cp=require("child_process");const d=fs.mkdtempSync(p.join(os.tmpdir(),"qa-r3-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";function run(dir,json){const a=["--log-dir",dir];if(json)a.push("--json");const r=cp.spawnSync(process.execPath,[cli,...a],{encoding:"utf8"});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}try{for(const [name,dir] of [["empty",d],["missing",p.join(d,"missing")]]){const j=run(dir,true),t=run(dir,false);if(j!=="[]"||!t.includes("没有运行记录（"+dir+"）"))throw Error(name+":"+j+":"+t);console.log(name+"_json="+j);console.log(name+"_text="+t)}const v=JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}});for(const [n,t] of [["older",100000],["newer",200000]]){const f=p.join(d,n+".json");fs.writeFileSync(f,v);fs.utimesSync(f,t,t)}const a=JSON.parse(run(d,true));if(a.length!==2||a[0].task_id!=="newer"||a[1].task_id!=="older")throw Error(JSON.stringify(a));console.log("order="+a.map(x=>x.task_id).join(","));console.log("exit_code=0")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
empty_json=[]
empty_text=没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r3-q1-ljzhKk）
missing_json=[]
missing_text=没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r3-q1-ljzhKk/missing）
order=newer,older
exit_code=0
```

### T-2
对应: Q-2
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),p=require("path"),cp=require("child_process");const d=fs.mkdtempSync(p.join(os.tmpdir(),"qa-r3-q2-"));const w=(n,v)=>fs.writeFileSync(p.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));try{w("run",{status:"running",last_event:"start"});w("partial",{status:"partial",activities:[{name:"collect",status:"failed",attempts:[{reason_code:"collect_timeout"}]}]});w("failed",{status:"failed",reason_code:"run_failed"});for(const [n,u] of [["ok","https://github.com/example/repo/pull/37"],["non-github","https://example.invalid/pull/37"]])w(n,{status:"completed",outputs:{pr_url:u}});w("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])w(n,{state:"pending"});w("broken","{bad");const run=j=>{const r=cp.spawnSync(process.execPath,["packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir",d,...(j?["--json"]:[])],{encoding:"utf8"});if(r.status)throw Error(r.stderr);return r.stdout};const a=JSON.parse(run(true)),m=Object.fromEntries(a.map(x=>[x.task_id,x]));const expected={run:"running",partial:"partial",failed:"failed",ok:"completed","non-github":"completed",qa:"unreadable",commander:"unreadable","pr-sync-pending":"unreadable",broken:"unreadable"};if(a.length!==9||a.some(x=>x.task_id==="cifix-37"))throw Error("scan");for(const [n,s] of Object.entries(expected))if(m[n]?.status!==s)throw Error(n);if(m.partial.reason_code!=="collect_timeout"||m.failed.reason_code!=="run_failed")throw Error("reason");for(const n of ["ok","non-github"])if(m[n].ci_fix?.attempts!==2||m[n].ci_fix?.last_result!=="passed")throw Error(n);const t=run(false);for(const n of ["ok","non-github"])if(!t.split("\n").find(x=>x.startsWith(n+"  completed")&&x.includes("ci_fix=2次 last=passed")))throw Error(n+" text");console.log("states="+a.map(x=>x.task_id+":"+x.status).join(","));console.log("reasons="+m.partial.reason_code+","+m.failed.reason_code);console.log("ci_fix=ok:2/passed,non-github:2/passed;text=matched");console.log("exit_code=0")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
states=broken:unreadable,pr-sync-pending:unreadable,commander:unreadable,qa:unreadable,non-github:completed,ok:completed,failed:failed,partial:partial,run:running
reasons=collect_timeout,run_failed
ci_fix=ok:2/passed,non-github:2/passed;text=matched
exit_code=0
```

### T-3
对应: Q-3
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),p=require("path"),cp=require("child_process");const d=fs.mkdtempSync(p.join(os.tmpdir(),"qa-r3-q3-"));try{fs.writeFileSync(p.join(d,"missing-pr.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(p.join(d,"with-pr.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/38"}}));const run=j=>{const r=cp.spawnSync(process.execPath,["packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir",d,...(j?["--json"]:[])],{encoding:"utf8"});if(r.status)throw Error(r.stderr);return r.stdout};const a=JSON.parse(run(true)),m=Object.fromEntries(a.map(x=>[x.task_id,x]));if(m["missing-pr"]?.status!=="completed"||m["missing-pr"].reason_code!=="pr_url_missing"||m["missing-pr"].pr_url!==null||m["with-pr"]?.ci_fix!==null||m["with-pr"].pr_url!=="https://github.com/example/repo/pull/38")throw Error(JSON.stringify(a));const t=run(false),line=t.split("\n").find(x=>x.startsWith("missing-pr "));if(!line||line.includes("pr_url_missing"))throw Error(t);console.log("missing-pr="+JSON.stringify(m["missing-pr"]));console.log("with-pr="+JSON.stringify(m["with-pr"]));console.log("text="+line);console.log("exit_code=0")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
missing-pr={"task_id":"missing-pr","mtime":"2026-10-17T00:50:34.026Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}
with-pr={"task_id":"with-pr","mtime":"2026-10-17T00:50:34.026Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/38","ci_fix":null}
text=missing-pr  completed  2026-10-17T00:50:34.026Z
exit_code=0
```

### T-4
对应: Q-1,Q-2,Q-3
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["运行回执如何判读","--log-dir","--json","CODING_WF_LOG_DIR","mtime","不证明服务健康","running","completed","partial","failed","unreadable","pr-sync-pending.json","ci_fix","last_result","pr_url_missing","当前 head","GitHub 实际合并","runner.phase=merged","merge.merged=true","QA 终态","不手工更改批准状态"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过；exit_code=0")'
```
```output
README 文本核对通过；exit_code=0
```

### T-5
对应: Q-4
verdict: PASS
```command
set -e
git rev-parse HEAD
git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD
git diff --name-status 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 HEAD
git diff --cached --name-status
git diff --name-status
git ls-files --others --exclude-standard
printf 'exit_code=0\n'
```
```output
8fa7a1c035bd76335c99fe71ed7450d5832b49e8
178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25
53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
f9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb 53cdf746c0c7f446cb7b6987e170d76248999f1d
f3dbd423fab3eddea650ac361d4651f393cfd40f f9460639ab0b5e2cd7b05f4f109db13a51b64f01
200baf82ef92f25d8b10031b52596b1e24fb70a7 f3dbd423fab3eddea650ac361d4651f393cfd40f
ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 200baf82ef92f25d8b10031b52596b1e24fb70a7
8fa7a1c035bd76335c99fe71ed7450d5832b49e8 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21
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
A	sprints/10170627-cw-5190fd91/06-judge-r2.md
A	sprints/10170627-cw-5190fd91/07-commander-r1.md
D	sprints/10170627-cw-5190fd91/03-build.md
D	sprints/10170627-cw-5190fd91/04-evidence.md
exit_code=0
```

### T-6
对应: Q-4
verdict: PASS
```command
node -e 'const cp=require("child_process"),crypto=require("crypto");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const git=a=>cp.execFileSync("git",a,{encoding:"utf8",maxBuffer:10000000}).trimEnd();const lines=git(["rev-list","--reverse","--topo-order","--parents",base+"..HEAD"]).split("\n");let edges=0,paths=0,blobs=0;for(const line of lines){const [child,...parents]=line.split(" ");for(const parent of parents){edges++;console.log("EDGE "+parent+" -> "+child);const raw=git(["diff","--no-ext-diff","--no-renames","--raw","--abbrev=40",parent,child,"--"]);if(!raw){console.log("EMPTY");continue}for(const row of raw.split("\n")){const m=/^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.+)$/.exec(row);if(!m)throw Error("raw:"+row);paths++;const [_,oldMode,newMode,oldId,newId,status,path]=m;const seen=[];for(const id of [oldId,newId]){if(/^0+$/.test(id)){seen.push("-");continue}const buf=cp.execFileSync("git",["cat-file","blob",id],{maxBuffer:10000000});const size=Number(git(["cat-file","-s",id]));const hash=crypto.createHash("sha1").update("blob "+buf.length+"\0").update(buf).digest("hex");if(buf.length!==size||hash!==id)throw Error("blob:"+id);blobs++;seen.push(size+":"+hash)}console.log(status+" "+path+" "+oldMode+"/"+newMode+" "+seen.join(" -> "))}}}console.log("edges="+edges+" paths="+paths+" blobs="+blobs+" exit_code=0")'
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 -> 178f61849d85be5a9370f23c033e48ae006cfe25
M packages/brain/scripts/coding-workflow/runner/README.md 100644/100644 10889:6e6eb65f64c55bdad786b619e2e9a4ef66225297 -> 13572:3e8eea166d021b985bff0c71e1ccbc87d234d248
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 -> 42943dfe5fc3f0680291322a5440bcd46159cbeb
M .implementation-source-relations.json 100644/100644 54286:b4d00c4f7ea1c087ce0511769e1e25299326cbfd -> 56013:24de93e0438b1c2a800654e7e0407b2949ef5233
A sprints/10170627-cw-5190fd91/01-intent.md 000000/100644 - -> 15486:3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c
A sprints/10170627-cw-5190fd91/01-invariants.md 000000/100644 - -> 89736:2276b9f0bca1d5fd3e422ef6e962e1259e266703
A sprints/10170627-cw-5190fd91/02-response-r1.md 000000/100644 - -> 589:f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a
A sprints/10170627-cw-5190fd91/02-response-r2.md 000000/100644 - -> 1084:677402ca401d014befa03669d7b1a1aa04a917b2
A sprints/10170627-cw-5190fd91/02-review-r1.md 000000/100644 - -> 1223:8b068bd99a4c2f5abc189032698f21ad8e267be6
A sprints/10170627-cw-5190fd91/02-review-r2.md 000000/100644 - -> 1436:7c80b836bc8c5469525c21273be83ad0e8dde8fc
A sprints/10170627-cw-5190fd91/02-review-r3.md 000000/100644 - -> 1113:e6922e12ac037d6b2ac8839985f3434b9d4f48e5
A sprints/10170627-cw-5190fd91/02-review.md 000000/100644 - -> 1113:e6922e12ac037d6b2ac8839985f3434b9d4f48e5
A sprints/10170627-cw-5190fd91/02-spec.md 000000/100644 - -> 18898:9827a68e93e8e7d2b0c21dcb517cb6c6848e2093
A sprints/10170627-cw-5190fd91/03-build.md 000000/100644 - -> 5095:0d96f563734111cfdcd2049a91b8d0973da5adff
A sprints/10170627-cw-5190fd91/04-evidence.md 000000/100644 - -> 9894:46a81734ed6702902319dcbe09f211bf692b0f88
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 -> 53cdf746c0c7f446cb7b6987e170d76248999f1d
M .brain-versions 100644/100644 9:765a3cb613f52cc52b92c04158a540cbe7fba43d -> 9:f3d261425e53f40ece495da8192f24c6040c909d
M .implementation-source-relations.json 100644/100644 54286:b4d00c4f7ea1c087ce0511769e1e25299326cbfd -> 54140:ffadfb9335a468ec6b871f54fd9a6db08ae9e09d
M DEFINITION.md 100644/100644 769540:c61152020942f82f1de6315cb58dda302a1e92cc -> 770019:a4b46caf2f7230368a87796071009b8b35fcc44b
D changes/cp-10170325-ci-budget-headroom.md 100644/000000 479:61678453253490efe1e7e647f808ac43965eaac1 -> -
M package-lock.json 100644/100644 698744:f6a79a39a78356e1a59b763567ac45af92e79f5b -> 698744:aaeb525fdffb110004342b8c6b4f96893d362179
M packages/brain/VERSION 100644/100644 9:765a3cb613f52cc52b92c04158a540cbe7fba43d -> 9:f3d261425e53f40ece495da8192f24c6040c909d
M packages/brain/package-lock.json 100644/100644 378833:bd0894471f6609afd0506fb31cabb315e8a97b25 -> 378833:ecb84839f8de085394f8aa50dd5f0100b1e99465
M packages/brain/package.json 100644/100644 1998:5451dac0247ba38ee91ec7441f0ef79426ad37b5 -> 1998:b6a3c1c890593a7bc828afa573a4ccaff05ab2c0
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb -> f9460639ab0b5e2cd7b05f4f109db13a51b64f01
M .brain-versions 100644/100644 9:765a3cb613f52cc52b92c04158a540cbe7fba43d -> 9:f3d261425e53f40ece495da8192f24c6040c909d
M .implementation-source-relations.json 100644/100644 56013:24de93e0438b1c2a800654e7e0407b2949ef5233 -> 55867:c4f2bb176e606551a32bf9a676b77ea69452efc4
M DEFINITION.md 100644/100644 769540:c61152020942f82f1de6315cb58dda302a1e92cc -> 770019:a4b46caf2f7230368a87796071009b8b35fcc44b
D changes/cp-10170325-ci-budget-headroom.md 100644/000000 479:61678453253490efe1e7e647f808ac43965eaac1 -> -
M package-lock.json 100644/100644 698744:f6a79a39a78356e1a59b763567ac45af92e79f5b -> 698744:aaeb525fdffb110004342b8c6b4f96893d362179
M packages/brain/VERSION 100644/100644 9:765a3cb613f52cc52b92c04158a540cbe7fba43d -> 9:f3d261425e53f40ece495da8192f24c6040c909d
M packages/brain/package-lock.json 100644/100644 378833:bd0894471f6609afd0506fb31cabb315e8a97b25 -> 378833:ecb84839f8de085394f8aa50dd5f0100b1e99465
M packages/brain/package.json 100644/100644 1998:5451dac0247ba38ee91ec7441f0ef79426ad37b5 -> 1998:b6a3c1c890593a7bc828afa573a4ccaff05ab2c0
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d -> f9460639ab0b5e2cd7b05f4f109db13a51b64f01
M .implementation-source-relations.json 100644/100644 54140:ffadfb9335a468ec6b871f54fd9a6db08ae9e09d -> 55867:c4f2bb176e606551a32bf9a676b77ea69452efc4
M packages/brain/scripts/coding-workflow/runner/README.md 100644/100644 10889:6e6eb65f64c55bdad786b619e2e9a4ef66225297 -> 13572:3e8eea166d021b985bff0c71e1ccbc87d234d248
A sprints/10170627-cw-5190fd91/01-intent.md 000000/100644 - -> 15486:3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c
A sprints/10170627-cw-5190fd91/01-invariants.md 000000/100644 - -> 89736:2276b9f0bca1d5fd3e422ef6e962e1259e266703
A sprints/10170627-cw-5190fd91/02-response-r1.md 000000/100644 - -> 589:f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a
A sprints/10170627-cw-5190fd91/02-response-r2.md 000000/100644 - -> 1084:677402ca401d014befa03669d7b1a1aa04a917b2
A sprints/10170627-cw-5190fd91/02-review-r1.md 000000/100644 - -> 1223:8b068bd99a4c2f5abc189032698f21ad8e267be6
A sprints/10170627-cw-5190fd91/02-review-r2.md 000000/100644 - -> 1436:7c80b836bc8c5469525c21273be83ad0e8dde8fc
A sprints/10170627-cw-5190fd91/02-review-r3.md 000000/100644 - -> 1113:e6922e12ac037d6b2ac8839985f3434b9d4f48e5
A sprints/10170627-cw-5190fd91/02-review.md 000000/100644 - -> 1113:e6922e12ac037d6b2ac8839985f3434b9d4f48e5
A sprints/10170627-cw-5190fd91/02-spec.md 000000/100644 - -> 18898:9827a68e93e8e7d2b0c21dcb517cb6c6848e2093
A sprints/10170627-cw-5190fd91/03-build.md 000000/100644 - -> 5095:0d96f563734111cfdcd2049a91b8d0973da5adff
A sprints/10170627-cw-5190fd91/04-evidence.md 000000/100644 - -> 9894:46a81734ed6702902319dcbe09f211bf692b0f88
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 -> f3dbd423fab3eddea650ac361d4651f393cfd40f
M .implementation-source-relations.json 100644/100644 55867:c4f2bb176e606551a32bf9a676b77ea69452efc4 -> 56028:f3d532f650f678b481fb7125e80f72231bf50d2e
A sprints/10170627-cw-5190fd91/05-qa-report-r1.md 000000/100644 - -> 19119:766cc68f7f0cb7bd81da2711b7eb920992f04c05
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f -> 200baf82ef92f25d8b10031b52596b1e24fb70a7
M sprints/10170627-cw-5190fd91/02-spec.md 100644/100644 18898:9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 -> 21682:51450ee5ebc6651ffd41d88a24e283dafa5ca9ae
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 -> ea0573f2d1e2a95f5cb7727a70c581d325b1fd21
M .implementation-source-relations.json 100644/100644 56028:f3d532f650f678b481fb7125e80f72231bf50d2e -> 56189:f0d372e0cb26eb55d12f9def947b73c081b8f963
A sprints/10170627-cw-5190fd91/07-commander-r1.md 000000/100644 - -> 876:fc178a6a802a0410e83cdf2c9c03233f8206bb1c
EDGE ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 -> 8fa7a1c035bd76335c99fe71ed7450d5832b49e8
M .implementation-source-relations.json 100644/100644 56189:f0d372e0cb26eb55d12f9def947b73c081b8f963 -> 56507:eab6aa5c1fbf307fe497d8450d3b9837ecb6977b
A sprints/10170627-cw-5190fd91/05-qa-report-r2.md 000000/100644 - -> 49562:05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee
A sprints/10170627-cw-5190fd91/06-judge-r2.md 000000/100644 - -> 2629:51c02fb04eab523db35539b6572f2fd7d5a87fc4
edges=9 paths=50 blobs=72 exit_code=0
```

### T-7
对应: Q-4
verdict: PASS
```command
node -e 'const fs=require("fs"),cp=require("child_process");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9",head=cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),read=rev=>cp.execFileSync("git",["show",rev+":packages/brain/scripts/coding-workflow/runner/README.md"],{encoding:"utf8"});const old=read(base).split(/(?<=\n)/),now=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");let at=0;for(const line of old){const i=now.indexOf(line,at);if(i<0)throw Error("README old line missing at "+at);at=i+line.length}const p=".implementation-source-relations.json",main=JSON.parse(cp.execFileSync("git",["show","53cdf746c0c7f446cb7b6987e170d76248999f1d:"+p],{encoding:"utf8"})),cur=JSON.parse(fs.readFileSync(p,"utf8"));const suffix=cur.relations.slice(cur.relations.length-main.relations.length);if(JSON.stringify(suffix)!==JSON.stringify(main.relations))throw Error("manifest history");const added=cur.relations.slice(0,cur.relations.length-main.relations.length);const allowed=new Set(["01-intent.md","01-invariants.md","02-spec.md","02-review.md","02-review-r1.md","02-review-r2.md","02-review-r3.md","02-response-r1.md","02-response-r2.md","03-build.md","04-evidence.md","05-qa-report-r1.md","05-qa-report-r2.md","06-judge-r2.md","07-commander-r1.md"]);for(const x of added){const tail=x.path.split("/").at(-1);if(!allowed.has(tail)||x.path!=="sprints/10170627-cw-5190fd91/"+tail||x.owner_path!=="packages/brain/scripts/coding-workflow/runner/run-once.mjs"||x.role!=="documentation")throw Error(JSON.stringify(x));allowed.delete(tail)}if(allowed.size)throw Error("missing:"+[...allowed]);console.log("head="+head);console.log("README preserved old_chunks="+old.length+" old_bytes="+Buffer.byteLength(read(base))+" current_bytes="+Buffer.byteLength(now));console.log("manifest main_history="+main.relations.length+" current="+cur.relations.length+" added="+added.map(x=>x.path).join(","));console.log("exit_code=0")'
```
```output
head=8fa7a1c035bd76335c99fe71ed7450d5832b49e8
README preserved old_chunks=81 old_bytes=10889 current_bytes=13572
manifest main_history=306 current=321 added=sprints/10170627-cw-5190fd91/05-qa-report-r2.md,sprints/10170627-cw-5190fd91/06-judge-r2.md,sprints/10170627-cw-5190fd91/07-commander-r1.md,sprints/10170627-cw-5190fd91/05-qa-report-r1.md,sprints/10170627-cw-5190fd91/01-intent.md,sprints/10170627-cw-5190fd91/01-invariants.md,sprints/10170627-cw-5190fd91/02-response-r1.md,sprints/10170627-cw-5190fd91/02-response-r2.md,sprints/10170627-cw-5190fd91/02-review-r1.md,sprints/10170627-cw-5190fd91/02-review-r2.md,sprints/10170627-cw-5190fd91/02-review-r3.md,sprints/10170627-cw-5190fd91/02-review.md,sprints/10170627-cw-5190fd91/02-spec.md,sprints/10170627-cw-5190fd91/03-build.md,sprints/10170627-cw-5190fd91/04-evidence.md
exit_code=0
```

### X-1
对应: Q-2
场景: 用户目录含损坏的 JSON，CLI 继续列出该文件且提示 unreadable。
verdict: PASS
```command
node -e 'const fs=require("fs"),os=require("os"),p=require("path"),cp=require("child_process");const d=fs.mkdtempSync(p.join(os.tmpdir(),"qa-r3-x1-"));try{fs.writeFileSync(p.join(d,"broken.json"),"{bad");const r=cp.spawnSync(process.execPath,["packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir",d,"--json"],{encoding:"utf8"});if(r.status)throw Error(r.stderr);const a=JSON.parse(r.stdout);if(a.length!==1||a[0].task_id!=="broken"||a[0].status!=="unreadable")throw Error(r.stdout);console.log("broken="+a[0].status+";exit_code=0")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
broken=unreadable;exit_code=0
```

## 本轮 Q-4 修正记录

首次检查上游删除路径时误把 Git 的诊断 stderr 与对象身份比较，命令退出码为 1。完整命令、输出见下；下列 T-8 已改用存在性及对象 ID 比较。

```command
node -e 'const cp=require("child_process");const g=a=>cp.execFileSync("git",a,{encoding:"utf8"}).trim();const merge="f9460639ab0b5e2cd7b05f4f109db13a51b64f01",prior="42943dfe5fc3f0680291322a5440bcd46159cbeb",main="53cdf746c0c7f446cb7b6987e170d76248999f1d",base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const parents=g(["rev-list","--parents","-n","1",merge]).split(" ");if(parents.join(" ")!==[merge,prior,main].join(" "))throw Error("parents");const names=g(["diff","--name-only",base,main]).split("\n");for(const p of names){if(p.includes("sprints/10170627-cw-5190fd91/")||p==="packages/brain/scripts/coding-workflow/runner/README.md")throw Error("upstream touches task:"+p);if(p===".implementation-source-relations.json")continue;const a=cp.spawnSync("git",["rev-parse",main+":"+p],{encoding:"utf8"}),b=cp.spawnSync("git",["rev-parse",merge+":"+p],{encoding:"utf8"});if(a.status!==b.status||a.stdout!==b.stdout)throw Error("tree:"+p)}console.log("merge_parents="+parents.join(","));console.log("upstream_paths="+names.join(","));console.log("main_tree_matches="+(names.length-1)+" paths;exit_code=0")'
```
```output
[eval]:1
const cp=require("child_process");const g=a=>cp.execFileSync("git",a,{encoding:"utf8"}).trim();const merge="f9460639ab0b5e2cd7b05f4f109db13a51b64f01",prior="42943dfe5fc3f0680291322a5440bcd46159cbeb",main="53cdf746c0c7f446cb7b6987e170d76248999f1d",base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const parents=g(["rev-list","--parents","-n","1",merge]).split(" ");if(parents.join(" ")!==[merge,prior,main].join(" "))throw Error("parents");const names=g(["diff","--name-only",base,main]).split("\n");for(const p of names){if(p.includes("sprints/10170627-cw-5190fd91/")||p==="packages/brain/scripts/coding-workflow/runner/README.md")throw Error("upstream touches task:"+p);if(p===".implementation-source-relations.json")continue;const a=cp.spawnSync("git",["rev-parse",main+":"+p],{encoding:"utf8"}),b=cp.spawnSync("git",["rev-parse",merge+":"+p],{encoding:"utf8"});if(a.status!==b.status||a.stdout!==b.stdout)throw Error("tree:"+p)}console.log("merge_parents="+parents.join(","));console.log("upstream_paths="+names.join(","));console.log("main_tree_matches="+(names.length-1)+" paths;exit_code=0")
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           ^

Error: tree:changes/cp-10170325-ci-budget-headroom.md
    at [eval]:1:914
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3

Node.js v26.8.2
```

### T-8
对应: Q-4
verdict: PASS
```command
node -e 'const cp=require("child_process");const g=a=>cp.execFileSync("git",a,{encoding:"utf8"}).trim();const merge="f9460639ab0b5e2cd7b05f4f109db13a51b64f01",prior="42943dfe5fc3f0680291322a5440bcd46159cbeb",main="53cdf746c0c7f446cb7b6987e170d76248999f1d",base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const parents=g(["rev-list","--parents","-n","1",merge]).split(" ");if(parents.join(" ")!==[merge,prior,main].join(" "))throw Error("parents");const names=g(["diff","--name-only",base,main]).split("\n");for(const p of names){if(p.includes("sprints/10170627-cw-5190fd91/")||p==="packages/brain/scripts/coding-workflow/runner/README.md")throw Error("upstream touches task:"+p);if(p===".implementation-source-relations.json")continue;const a=cp.spawnSync("git",["rev-parse","--verify",main+":"+p],{encoding:"utf8"}),b=cp.spawnSync("git",["rev-parse","--verify",merge+":"+p],{encoding:"utf8"});if((a.status===0)!==(b.status===0)||(a.status===0&&a.stdout!==b.stdout))throw Error("tree:"+p)}console.log("merge_parents="+parents.join(","));console.log("upstream_paths="+names.join(","));console.log("main_tree_matches="+(names.length-1)+" paths including deletion;exit_code=0")'
```
```output
merge_parents=f9460639ab0b5e2cd7b05f4f109db13a51b64f01,42943dfe5fc3f0680291322a5440bcd46159cbeb,53cdf746c0c7f446cb7b6987e170d76248999f1d
upstream_paths=.brain-versions,.implementation-source-relations.json,DEFINITION.md,changes/cp-10170325-ci-budget-headroom.md,package-lock.json,packages/brain/VERSION,packages/brain/package-lock.json,packages/brain/package.json
main_tree_matches=7 paths including deletion;exit_code=0
```

## 判定与阶段边界

Q-1 至 Q-3 的临时回执均为本轮创建并清理。Q-4 的 9 条父边、50 条路径变化、72 个非零 blob 均按 Git 原始对象大小及规范 Git SHA-1 重算核对；合并提交第二父的上游路径与真实 main 同步投影一致。控制器给出的来源事实含本轮登记和受保护同步事件 c6de1e67-4b53-4d8b-b097-4a711c619c67；该事实不证明产品行为。本轮没有读 03-build.md、04-evidence.md 正文或保护凭证根，也没有预判恢复、正式 CI、远端合并及 Brain 终态。上一轮报告的截断缺口仍保留为历史失败，本轮证据是对当前 TESTED_HEAD 独立重验。

## 首次 raw 解析失败的原生记录

该命令使用 Git 默认缩写对象 ID，解析器要求 40 位，因此退出码 1。T-6 已显式使用 --abbrev=40 重跑成功。以下输出完整保留。

```command
node -e 'const cp=require("child_process"),crypto=require("crypto");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const git=(a,o={})=>cp.execFileSync("git",a,{encoding:"utf8",maxBuffer:10000000,...o}).trimEnd();const lines=git(["rev-list","--reverse","--topo-order","--parents",base+"..HEAD"]).split("\n");let edges=0,paths=0,blobs=0;for(const line of lines){const [child,...parents]=line.split(" ");for(const parent of parents){edges++;console.log("EDGE "+parent+" -> "+child);const raw=git(["diff","--no-ext-diff","--no-renames","--raw","--full-index",parent,child,"--"]);if(!raw){console.log("EMPTY");continue}for(const row of raw.split("\n")){const m=/^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.+)$/.exec(row);if(!m)throw Error("raw:"+row);paths++;const [_,oldMode,newMode,oldId,newId,status,path]=m;const seen=[];for(const id of [oldId,newId]){if(/^0+$/.test(id)){seen.push("-");continue}const buf=cp.execFileSync("git",["cat-file","blob",id],{maxBuffer:10000000});const size=Number(git(["cat-file","-s",id]));const hash=crypto.createHash("sha1").update("blob "+buf.length+"\0").update(buf).digest("hex");if(buf.length!==size||hash!==id)throw Error("blob:"+id);blobs++;seen.push(size+":"+hash)}console.log(status+" "+path+" "+oldMode+"/"+newMode+" "+seen.join(" -> "))}}}console.log("edges="+edges+" paths="+paths+" blobs="+blobs+" exit_code=0")'
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 -> 178f61849d85be5a9370f23c033e48ae006cfe25
[eval]:1
(crypto=>{{const cp=require("child_process"),crypto=require("crypto");const base="04b88ddba4b1aa23a156d59734b4d88f621fe1e9";const git=(a,o={})=>cp.execFileSync("git",a,{encoding:"utf8",maxBuffer:10000000,...o}).trimEnd();const lines=git(["rev-list","--reverse","--topo-order","--parents",base+"..HEAD"]).split("\n");let edges=0,paths=0,blobs=0;for(const line of lines){const [child,...parents]=line.split(" ");for(const parent of parents){edges++;console.log("EDGE "+parent+" -> "+child);const raw=git(["diff","--no-ext-diff","--no-renames","--raw","--full-index",parent,child,"--"]);if(!raw){console.log("EMPTY");continue}for(const row of raw.split("\n")){const m=/^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])\t(.+)$/.exec(row);if(!m)throw Error("raw:"+row);paths++;const [_,oldMode,newMode,oldId,newId,status,path]=m;const seen=[];for(const id of [oldId,newId]){if(/^0+$/.test(id)){seen.push("-");continue}const buf=cp.execFileSync("git",["cat-file","blob",id],{maxBuffer:10000000});const size=Number(git(["cat-file","-s",id]));const hash=crypto.createHash("sha1").update("blob "+buf.length+"\0").update(buf).digest("hex");if(buf.length!==size||hash!==id)throw Error("blob:"+id);blobs++;seen.push(size+":"+hash)}console.log(status+" "+path+" "+oldMode+"/"+newMode+" "+seen.join(" -> "))}}}console.log("edges="+edges+" paths="+paths+" blobs="+blobs+" exit_code=0")}})(require('node:crypto'))
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          ^

Error: raw::100644 100644 6e6eb65f6 3e8eea166 M	packages/brain/scripts/coding-workflow/runner/README.md
    at [eval]:1:753
    at [eval]:1:1380
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:483:60)
    at evalFunction (node:internal/process/execution:317:30)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3

Node.js v26.8.2
```
退出码: 1
