---
task_id: 934e5375-aac6-405e-8fad-57ecc9a8349d
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS

```command
node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import {execFileSync} from "node:child_process"; import {collectStatus} from "./packages/brain/scripts/coding-workflow/runner/status.mjs"; const root="packages/brain/scripts/coding-workflow/runner/"; const doc=fs.readFileSync(root+"README.md","utf8"); assert.match(doc,/status\.mjs --log-dir <回执目录>/); assert.match(doc,/status\.mjs --log-dir <回执目录> --json/); assert.match(doc,/mtime）倒序/); assert.match(doc,/\[\].*不能证明服务健康/); const dir=fs.mkdtempSync(path.join(os.tmpdir(),"cw-verify-i1-")); try { fs.writeFileSync(path.join(dir,"old.json"),JSON.stringify({status:"failed"})); fs.writeFileSync(path.join(dir,"new.json"),JSON.stringify({status:"completed"})); fs.utimesSync(path.join(dir,"old.json"),1000,1000); fs.utimesSync(path.join(dir,"new.json"),2000,2000); assert.deepEqual(collectStatus(dir).map(x=>x.task_id),["new","old"]); const cli=JSON.parse(execFileSync(process.execPath,[root+"status.mjs","--log-dir",dir,"--json"],{encoding:"utf8"})); assert.deepEqual(cli.map(x=>x.task_id),["new","old"]); assert.deepEqual(JSON.parse(execFileSync(process.execPath,[root+"status.mjs","--log-dir",path.join(dir,"absent"),"--json"],{encoding:"utf8"})),[]); assert.match(execFileSync(process.execPath,[root+"status.mjs","--log-dir",path.join(dir,"absent")],{encoding:"utf8"}),/没有运行记录/); console.log("I-1 PASS: CLI 参数、mtime 倒序、目录不存在返回 [] 与 README 一致"); } finally {fs.rmSync(dir,{recursive:true,force:true});}'
```

```output
I-1 PASS: CLI 参数、mtime 倒序、目录不存在返回 [] 与 README 一致
```

### E-2
对应: I-2
verdict: PASS

```command
node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import {collectStatus,formatStatus} from "./packages/brain/scripts/coding-workflow/runner/status.mjs"; const doc=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"); for(const word of ["running","completed","partial","failed","unreadable","ci_fix","last_result","pr-sync-pending.json","qa/commander","不能据此删除待办"]) assert.ok(doc.includes(word),word); const dir=fs.mkdtempSync(path.join(os.tmpdir(),"cw-verify-i2-")); try {const put=(name,value)=>fs.writeFileSync(path.join(dir,name),typeof value==="string"?value:JSON.stringify(value)); put("running.json",{last_event:"started"}); put("completed.json",{status:"completed",outputs:{pr_url:"https://github.com/o/r/pull/42"}}); put("partial.json",{status:"partial",activities:[{key:"step",status:"failed",attempts:[{reason_code:"attempt_error"}]}]}); put("failed.json",{status:"failed",reason_code:"run_error"}); put("broken.json","{"); put("qa-state.json",{qa_state:"PASS"}); put("pr-sync-pending.json",{pending:true}); put("cifix-42.json",{attempts:[{result:"fail"},{result:"pass"}]}); const rows=collectStatus(dir); const by=Object.fromEntries(rows.map(x=>[x.task_id,x])); assert.equal(by.running.status,"running"); assert.equal(by.completed.status,"completed"); assert.equal(by.partial.status,"partial"); assert.equal(by.partial.failed_activity,"step"); assert.equal(by.partial.reason_code,"attempt_error"); assert.equal(by.failed.status,"failed"); for(const name of ["broken","qa-state","pr-sync-pending"]) assert.equal(by[name].status,"unreadable"); assert.equal(by.completed.ci_fix.attempts,2); assert.equal(by.completed.ci_fix.last_result,"pass"); assert.ok(!by["cifix-42"]); assert.match(formatStatus([by.completed]),/ci_fix=2次 last=pass/); console.log("I-2 PASS: 五种状态、非回执 JSON、ci_fix 次数和末次结果与 README 一致"); } finally {fs.rmSync(dir,{recursive:true,force:true});}'
```

```output
I-2 PASS: 五种状态、非回执 JSON、ci_fix 次数和末次结果与 README 一致
```

### E-3
对应: I-3
verdict: PASS

```command
node --input-type=module -e 'import assert from "node:assert/strict"; import fs from "node:fs"; import {summarizeReceipt} from "./packages/brain/scripts/coding-workflow/runner/lib/receipt.mjs"; import {formatStatus} from "./packages/brain/scripts/coding-workflow/runner/status.mjs"; const doc=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"); for(const phrase of ["`completed` 只表示本地回执的状态","不能从文本表格的 completed 推断已有有效 PR","核对其最终 head 和 merged 事实","runner.phase=merged","merge.merged=true","`qa_state` 的 QA 终态","只读查询","不手工改批准或 FAIL 记录"]) assert.ok(doc.includes(phrase),phrase); const missing=summarizeReceipt({status:"completed"}); assert.deepEqual({status:missing.status,reason_code:missing.reason_code,pr_url:missing.pr_url},{status:"completed",reason_code:"pr_url_missing",pr_url:null}); const text=formatStatus([{task_id:"demo",status:"completed",mtime:"2026-01-01",...missing,ci_fix:null}]); assert.ok(text.includes("completed")); assert.ok(!text.includes("pr_url_missing")); const present=summarizeReceipt({status:"completed",outputs:{pr_url:"https://github.com/o/r/pull/42"}}); assert.equal(present.reason_code,null); assert.equal(present.pr_url,"https://github.com/o/r/pull/42"); console.log("I-3 PASS: README 区分 completed 与最终合并，缺 PR URL 的 JSON 原因不在文本行显示");'
```

```output
I-3 PASS: README 区分 completed 与最终合并，缺 PR URL 的 JSON 原因不在文本行显示
```

### E-4
对应: I-4
verdict: PASS

```command
python3 -c 'import pathlib,re,subprocess; base="23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd"; readme="packages/brain/scripts/coding-workflow/runner/README.md"; manifest=".implementation-source-relations.json"; git=lambda *args: subprocess.check_output(["git",*args]); changed=git("diff","--name-only",base,"HEAD").decode().splitlines(); staged=git("diff","--name-only","--cached").decode().splitlines(); working=git("diff","--name-only").decode().splitlines(); untracked=git("ls-files","--others","--exclude-standard").decode().splitlines(); old=git("show",base+":"+readme).splitlines(keepends=True); new=pathlib.Path(readme).read_bytes().splitlines(keepends=True); iterator=iter(new); assert all(any(line==candidate for candidate in iterator) for line in old),"基线 README 原文或顺序改变"; assert changed==[readme],changed; assert not staged and not working,(staged,working); assert pathlib.Path(manifest).read_bytes()==git("show",base+":"+manifest),"manifest 已变"; allowed=re.compile(r"^sprints/10241101-cw-934e5375/(?:01-intent|01-invariants|02-spec|02-review(?:-r[1-9][0-9]*)?|02-response-r[1-9][0-9]*)\.md$"); assert all(allowed.fullmatch(name) for name in untracked),untracked; print("I-4 PASS: 固定基线至 HEAD 仅 README 变更；暂存区/工作区无改动；全仓未跟踪文件均为本次 sprint 记录；基线 README 字节按序保留；manifest 字节未变"); print("HEAD:",git("rev-parse","HEAD").decode().strip()); print("未跟踪文件数:",len(untracked))'
```

```output
I-4 PASS: 固定基线至 HEAD 仅 README 变更；暂存区/工作区无改动；全仓未跟踪文件均为本次 sprint 记录；基线 README 字节按序保留；manifest 字节未变
HEAD: d2f5441c6aa0aeca00a0b879cffa90fcad60ceef
未跟踪文件数: 9
```
