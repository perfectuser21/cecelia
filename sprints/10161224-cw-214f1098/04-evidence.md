---
task_id: 214f1098-a4b8-4c0b-9947-daf49a9bd929
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS

```command
python3 -c 'from pathlib import Path; import subprocess; r=Path("packages/brain/scripts/coding-workflow/runner/README.md").read_text(); s=Path("packages/brain/scripts/coding-workflow/runner/status.mjs").read_text(); assert "--log-dir <回执目录> --json" in r and "--log-dir <回执目录>" in r; assert "CODING_WF_LOG_DIR" in r and "mtime` 倒序" in r; assert "JSON 是 `[]`" in r and "不能证明服务健康" in r; assert "rows.sort((a, b) => b.mtimeMs - a.mtimeMs)" in s and "if (opts.json) console.log(JSON.stringify(rows))" in s; p=subprocess.run(["node","packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir","/tmp/cw-214f1098-verify-absent","--json"],capture_output=True,text=True,check=True); assert p.stdout.strip()=="[]",repr(p.stdout); print("I-1 README参数、默认目录、mtime倒序及空结果说明：PASS"); print("status.mjs不存在目录的--json实际输出："+p.stdout.strip())'
```

```output
I-1 README参数、默认目录、mtime倒序及空结果说明：PASS
status.mjs不存在目录的--json实际输出：[]
```

### E-2
对应: I-2
verdict: PASS

```command
node --input-type=module -e 'import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import {collectStatus} from "./packages/brain/scripts/coding-workflow/runner/status.mjs"; const d=fs.mkdtempSync(path.join(os.tmpdir(),"cw-214f1098-verify-")); try { const put=(n,v,t)=>{const p=path.join(d,n);fs.writeFileSync(p,v);fs.utimesSync(p,t,t)}; put("running.json",JSON.stringify({last_event:"start"}),100);put("completed.json",JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/o/r/pull/7"}}),200);put("partial.json",JSON.stringify({status:"partial",activities:[{key:"qa",status:"failed",attempts:[{reason_code:"qa_red"}]}]}),300);put("failed.json",JSON.stringify({status:"failed",reason_code:"run_failed"}),400);put("qa-1.json",JSON.stringify({qa_state:"PASS"}),500);put("commander-1.json",JSON.stringify({phase:"done"}),600);put("pr-sync-pending.json",JSON.stringify({pending:true}),700);put("cifix-7.json",JSON.stringify({attempts:[{result:"fail"},{result:"pass"}]}),800); const rows=collectStatus(d); const by=Object.fromEntries(rows.map(x=>[x.task_id,x])); const expected=["pr-sync-pending:unreadable","commander-1:unreadable","qa-1:unreadable","failed:failed","partial:partial","completed:completed","running:running"]; const actual=rows.map(x=>x.task_id+":"+x.status); if(JSON.stringify(actual)!==JSON.stringify(expected)||by.partial.failed_activity!=="qa"||by.partial.reason_code!=="qa_red"||by.completed.ci_fix?.attempts!==2||by.completed.ci_fix?.last_result!=="pass") throw Error(JSON.stringify(rows)); const readme=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"); for(const term of ["`running`","`completed`","`partial` / `failed`","`unreadable`","`qa-*.json`","`commander-*.json`","`pr-sync-pending.json`","不是删除现场或待办的依据","`ci_fix.attempts`","`ci_fix.last_result`"]) if(!readme.includes(term)) throw Error("README missing "+term); console.log("I-2 状态顺序："+actual.join(", ")); console.log("I-2 partial原因："+by.partial.failed_activity+"/"+by.partial.reason_code); console.log("I-2 ci_fix："+JSON.stringify(by.completed.ci_fix)); console.log("I-2 README对应说明：PASS") } finally {fs.rmSync(d,{recursive:true,force:true})}'
```

```output
I-2 状态顺序：pr-sync-pending:unreadable, commander-1:unreadable, qa-1:unreadable, failed:failed, partial:partial, completed:completed, running:running
I-2 partial原因：qa/qa_red
I-2 ci_fix：{"attempts":2,"last_result":"pass"}
I-2 README对应说明：PASS
```

### E-3
对应: I-3
verdict: PASS

```command
node --input-type=module -e 'import fs from "node:fs"; import {summarizeReceipt} from "./packages/brain/scripts/coding-workflow/runner/lib/receipt.mjs"; import {formatStatus} from "./packages/brain/scripts/coding-workflow/runner/status.mjs"; const x=summarizeReceipt({status:"completed",outputs:{}}); const line=formatStatus([{task_id:"probe",mtime:"2026-10-16T00:00:00.000Z",...x,ci_fix:null}]); if(x.status!=="completed"||x.reason_code!=="pr_url_missing"||x.pr_url!==null||line.includes("pr_url_missing")) throw Error(JSON.stringify({x,line})); const r=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8"); for(const term of ["completed` 但没有非空字符串 `outputs.pr_url`","`reason_code=pr_url_missing`","文本的 `completed` 行默认不打印这个原因","`pr_url` 和 `reason_code`","最终 head 是否已合并","`runner.phase=merged`","`merge.merged=true`","QA 终态","不手改批准或 FAIL 记录"]) if(!r.includes(term)) throw Error("README missing "+term); console.log("I-3 无PR终态："+JSON.stringify({status:x.status,reason_code:x.reason_code,pr_url:x.pr_url})); console.log("I-3 文本行："+line); console.log("I-3 README最终合并与只读诊断说明：PASS")'
```

```output
I-3 无PR终态：{"status":"completed","reason_code":"pr_url_missing","pr_url":null}
I-3 文本行：probe  completed  2026-10-16T00:00:00.000Z
I-3 README最终合并与只读诊断说明：PASS
```

### E-4
对应: I-4
verdict: PASS

```command
python3 -c 'import re,subprocess; from pathlib import Path; base="1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c"; readme="packages/brain/scripts/coding-workflow/runner/README.md"; manifest=".implementation-source-relations.json"; git=lambda *a: subprocess.check_output(["git",*a],text=True).splitlines(); untracked=git("ls-files","--others","--exclude-standard"); print("全仓未跟踪："+repr(untracked)); allowed=re.compile(r"^sprints/10161224-cw-214f1098/(?:01-intent|01-invariants|02-spec|02-review|02-review-r[1-9][0-9]*|02-response-r[1-9][0-9]*|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md$"); outside=[p for p in untracked if not allowed.fullmatch(p)]; head=git("diff","--name-only",base,"HEAD"); staged=git("diff","--name-only","--cached"); work=git("diff","--name-only"); print("base到HEAD："+repr(head)); print("暂存区："+repr(staged)); print("工作区："+repr(work)); print("范围外未跟踪："+repr(outside)); assert not outside and head==[readme] and not staged and not work; delta=subprocess.check_output(["git","diff","--unified=0",base,"HEAD","--",readme],text=True); removed=[s for s in delta.splitlines() if s.startswith("-") and not s.startswith("---")]; assert not removed,removed; print("基线README删除行："+repr(removed)); old=subprocess.check_output(["git","show",base+":"+manifest]); now=Path(manifest).read_bytes(); assert old==now; print("manifest与基线逐字一致：True"); print("I-4 发布前范围：PASS")'
```

```output
全仓未跟踪：['sprints/10161224-cw-214f1098/01-intent.md', 'sprints/10161224-cw-214f1098/01-invariants.md', 'sprints/10161224-cw-214f1098/02-review-r1.md', 'sprints/10161224-cw-214f1098/02-review.md', 'sprints/10161224-cw-214f1098/02-spec.md']
base到HEAD：['packages/brain/scripts/coding-workflow/runner/README.md']
暂存区：[]
工作区：[]
范围外未跟踪：[]
基线README删除行：[]
manifest与基线逐字一致：True
I-4 发布前范围：PASS
```

