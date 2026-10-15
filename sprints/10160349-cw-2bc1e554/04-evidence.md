---
task_id: 2bc1e554-43fa-47f9-9ef4-8ab8b6c5baf3
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS
```command
node --input-type=module -e 'import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import {execFileSync} from "node:child_process"; const readme=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"); const cli="packages/brain/scripts/coding-workflow/runner/status.mjs"; for(const s of ["--log-dir <回执目录>","--json","mtime（修改时间）倒序","不能证明服务健康"]) assert(readme.includes(s),s); const dir=fs.mkdtempSync(path.join(os.tmpdir(),"cw-verify-i1-")); try { const missing=execFileSync("node",[cli,"--log-dir",path.join(dir,"missing"),"--json"],{encoding:"utf8"}).trim(); assert.equal(missing,"[]"); fs.writeFileSync(path.join(dir,"older.json"),JSON.stringify({status:"completed"})); fs.writeFileSync(path.join(dir,"newer.json"),JSON.stringify({status:"failed"})); fs.utimesSync(path.join(dir,"older.json"),1000,1000); fs.utimesSync(path.join(dir,"newer.json"),2000,2000); const rows=JSON.parse(execFileSync("node",[cli,"--log-dir",dir,"--json"],{encoding:"utf8"})); assert.deepEqual(rows.map(r=>r.task_id),["newer","older"]); console.log("README 参数/空结果断言通过；缺失目录="+missing+"；mtime 倒序="+rows.map(r=>r.task_id).join(",")); } finally { fs.rmSync(dir,{recursive:true,force:true}); }'
```
```output
README 参数/空结果断言通过；缺失目录=[]；mtime 倒序=newer,older
```

### E-2
对应: I-2
verdict: PASS
```command
node --input-type=module -e 'import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import {collectStatus,formatStatus} from "./packages/brain/scripts/coding-workflow/runner/status.mjs"; const readme=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"); for(const s of ["running","completed","partial","failed","unreadable","ci_fix","last_result","pr-sync-pending.json","不能单独作为文件损坏或删除现场的依据"]) assert(readme.includes(s),s); const dir=fs.mkdtempSync(path.join(os.tmpdir(),"cw-verify-i2-")); try { const put=(n,v)=>fs.writeFileSync(path.join(dir,n),typeof v==="string"?v:JSON.stringify(v)); put("running.json",{last_event:"x",status:"failed"}); put("completed.json",{status:"completed",outputs:{pr_url:"https://github.com/a/b/pull/42"}}); put("partial.json",{status:"partial",activities:[{key:"x",status:"failed",attempts:[{reason_code:"retry_end"}]}]}); put("failed.json",{status:"failed"}); put("qa-state.json",{qa_state:"passed"}); put("commander-state.json",{phase:"done"}); put("pr-sync-pending.json",{pending:true}); put("broken.json","{"); put("cifix-42.json",{attempts:[{result:"fail"},{result:"pass"}]}); const rows=collectStatus(dir); const by=Object.fromEntries(rows.map(r=>[r.task_id,r])); for(const [k,v] of Object.entries({running:"running",completed:"completed",partial:"partial",failed:"failed","qa-state":"unreadable","commander-state":"unreadable","pr-sync-pending":"unreadable",broken:"unreadable"})) assert.equal(by[k]?.status,v,k); assert.equal(by.partial.reason_code,"retry_end"); assert.equal(by.completed.ci_fix.attempts,2); assert.equal(by.completed.ci_fix.last_result,"pass"); assert(!by["cifix-42"]); assert(formatStatus(rows).includes("ci_fix=2次 last=pass")); console.log("状态="+["running","completed","partial","failed","qa-state","commander-state","pr-sync-pending","broken"].map(k=>k+":"+by[k].status).join(",")+"；partial原因="+by.partial.reason_code+"；ci_fix="+JSON.stringify(by.completed.ci_fix)+"；cifix文件未列出"); } finally { fs.rmSync(dir,{recursive:true,force:true}); }'
```
```output
状态=running:running,completed:completed,partial:partial,failed:failed,qa-state:unreadable,commander-state:unreadable,pr-sync-pending:unreadable,broken:unreadable；partial原因=retry_end；ci_fix={"attempts":2,"last_result":"pass"}；cifix文件未列出
```

### E-3
对应: I-3
verdict: PASS
```command
node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; import {summarizeReceipt} from "./packages/brain/scripts/coding-workflow/runner/lib/receipt.mjs"; import {formatStatus} from "./packages/brain/scripts/coding-workflow/runner/status.mjs"; const readme=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"); for(const s of ["不等于 PR 已合并","reason_code=pr_url_missing","pr_url=null","最终 head SHA 与合并状态","runner.phase=merged","merge.merged=true","QA 终态","不要手工改批准或 FAIL 记录"]) assert(readme.includes(s),s); const r=summarizeReceipt({status:"completed",outputs:{}}); assert.deepEqual({status:r.status,reason_code:r.reason_code,pr_url:r.pr_url},{status:"completed",reason_code:"pr_url_missing",pr_url:null}); const line=formatStatus([{task_id:"sample",status:r.status,mtime:"t",...r,ci_fix:null}]); assert(!line.includes("pr_url_missing")); console.log("无 PR URL 摘要="+JSON.stringify(r)+"；文本行="+line+"；README 合并/Brain/QA/只读断言通过");'
```
```output
无 PR URL 摘要={"status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null}；文本行=sample  completed  t；README 合并/Brain/QA/只读断言通过
```

### E-4
对应: I-4
verdict: PASS
```command
python3 -c 'import subprocess,pathlib; base="52a9476e014f540d418014e7062ca66a72f38709"; readme="packages/brain/scripts/coding-workflow/runner/README.md"; manifest=".implementation-source-relations.json"; run=lambda *a:subprocess.check_output(["git",*a],text=True); head=set(filter(None,run("diff","--name-only",base,"HEAD").splitlines())); staged=set(filter(None,run("diff","--name-only","--cached").splitlines())); work=set(filter(None,run("diff","--name-only").splitlines())); untracked=run("ls-files","--others","--exclude-standard").splitlines(); prefix="sprints/10160349-cw-2bc1e554/"; excluded=[p for p in untracked if p.startswith(prefix) and pathlib.PurePosixPath(p).name in {"01-intent.md","01-invariants.md","02-spec.md","02-review.md","02-review-r1.md","02-review-r2.md","02-response-r1.md","03-build.md","04-evidence.md"}]; extra=[p for p in untracked if p not in excluded]; assert head=={readme},head; assert not staged and not work and not extra,(staged,work,extra); old=subprocess.check_output(["git","show",base+":"+readme]); new=pathlib.Path(readme).read_bytes(); assert new.startswith(old),"基线README不是完整前缀"; assert subprocess.check_output(["git","show",base+":"+manifest])==pathlib.Path(manifest).read_bytes(),"manifest已变"; print("HEAD改动="+",".join(sorted(head))); print("暂存区改动="+str(len(staged))+"；工作区改动="+str(len(work))); print("全仓未跟踪="+str(len(untracked))+"；本任务流水线记录="+str(len(excluded))+"；越界未跟踪="+str(len(extra))); print("基线README全文保留=是；manifest相对基线相同=是")'
```
```output
HEAD改动=packages/brain/scripts/coding-workflow/runner/README.md
暂存区改动=0；工作区改动=0
全仓未跟踪=7；本任务流水线记录=7；越界未跟踪=0
基线README全文保留=是；manifest相对基线相同=是
```
