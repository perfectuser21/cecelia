---
task_id: 214f1098-a4b8-4c0b-9947-daf49a9bd929
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 2 轮，环境 http://localhost:5303）

TESTED_HEAD: 646c8acf36f170b5ab3c44a72f19e75da65d948d

本合同验收本地只读 CLI、README 和 Git 范围；Q-1 至 Q-4 未要求预览 API 或页面。下列命令均在本轮工作树根目录真实执行，输出中的每次 CLI stdout、stderr、退出码均完整保留。所用回执只在 `mktemp -d` 自建目录中产生。来源事实另据控制器提供的 `SOURCE_PROVENANCE`，只用于已发生阶段的身份，不代替产品测试。

### T-1
对应: Q-1
verdict: PASS
说明: 空目录与不存在目录 JSON 均为 `[]`、退出 0；文本提示无记录；自造两份回执按 mtime 倒序。README 内容另见 T-4。
```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process");const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const d=cp.execFileSync("mktemp",["-d"],{encoding:"utf8"}).trim();const run=(label,args)=>{const r=cp.spawnSync(process.execPath,[cli,"--log-dir",...args],{encoding:"utf8"});process.stdout.write("=== "+label+" stdout ===\n"+r.stdout+"=== "+label+" stderr ===\n"+r.stderr+"=== "+label+" exit === "+r.status+"\n");if(r.status!==0)throw Error(label+" exit");return r.stdout};const j0=run("empty-json",[d,"--json"]);if(j0!=="[]\n")throw Error("empty json");const t0=run("empty-text",[d]);if(!t0.includes("没有运行记录"))throw Error("empty text");const missing=d+"-missing";if(fs.existsSync(missing))throw Error("missing path exists");const jm=run("missing-json",[missing,"--json"]);if(jm!=="[]\n")throw Error("missing json");fs.writeFileSync(path.join(d,"older.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/11"}}));fs.writeFileSync(path.join(d,"newer.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/22"}}));cp.execFileSync("touch",["-t","202001010000",path.join(d,"older.json")]);cp.execFileSync("touch",["-t","202101010000",path.join(d,"newer.json")]);const j1=run("ordered-json",[d,"--json"]);const rows=JSON.parse(j1);if(rows.length!==2||rows[0].task_id!=="newer"||rows[1].task_id!=="older")throw Error("json sort");const t1=run("ordered-text",[d]);if(!(t1.indexOf("newer  completed")>=0&&t1.indexOf("older  completed")>t1.indexOf("newer  completed")))throw Error("text sort");console.log("Q-1 assertions PASS")'
```
```output
=== empty-json stdout ===
[]
=== empty-json stderr ===
=== empty-json exit === 0
=== empty-text stdout ===
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.GjR4TnKMae）
=== empty-text stderr ===
=== empty-text exit === 0
=== missing-json stdout ===
[]
=== missing-json stderr ===
=== missing-json exit === 0
=== ordered-json stdout ===
[{"task_id":"newer","mtime":"2020-12-31T16:00:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/22","ci_fix":null},{"task_id":"older","mtime":"2019-12-31T16:00:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/11","ci_fix":null}]
=== ordered-json stderr ===
=== ordered-json exit === 0
=== ordered-text stdout ===
newer  completed  2020-12-31T16:00:00.000Z  https://github.com/example/repo/pull/22
older  completed  2019-12-31T16:00:00.000Z  https://github.com/example/repo/pull/11
=== ordered-text stderr ===
=== ordered-text exit === 0
Q-1 assertions PASS
```

### T-2
对应: Q-2
verdict: PASS
说明: 各状态、失败原因优先级、CI 修复摘要符合预期；非法 JSON 不影响其他回执；9 个原文件仍在。README 关于不可据 `unreadable` 清理待办的说明见 T-4。
```command
node -e 'const fs=require("fs"),path=require("path"),cp=require("child_process");const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const d=cp.execFileSync("mktemp",["-d"],{encoding:"utf8"}).trim();const put=(n,v)=>fs.writeFileSync(path.join(d,n),typeof v==="string"?v:JSON.stringify(v));put("progress.json",{last_event:{activity:"build"}});put("partial.json",{status:"partial",activities:[{key:"prepare",status:"completed"},{key:"verify",status:"failed",reason_code:"activity_reason",attempts:[{reason_code:"first_failure"},{reason_code:"tests_failed"}]}]});put("failed.json",{status:"failed",reason_code:"runner_failed",activities:[{key:"publish",status:"failed"}]});put("qa-check.json",{qa_state:"pass"});put("commander-check.json",{decision:"pending"});put("pr-sync-pending.json",{pending:true});put("broken.json","{not-json");put("complete.json",{status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/77"}});put("cifix-77.json",{attempts:[{result:"push_failed"},{result:"pushed"}]});const run=(label,json)=>{const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});process.stdout.write("=== "+label+" stdout ===\n"+r.stdout+"=== "+label+" stderr ===\n"+r.stderr+"=== "+label+" exit === "+r.status+"\n");if(r.status!==0)throw Error(label+" exit");return r.stdout};const rows=JSON.parse(run("states-json",true));const by=Object.fromEntries(rows.map(r=>[r.task_id,r]));if(rows.length!==8||by.progress.status!=="running"||by.partial.status!=="partial"||by.partial.failed_activity!=="verify"||by.partial.reason_code!=="tests_failed"||by.failed.status!=="failed"||by.failed.failed_activity!=="publish"||by.failed.reason_code!=="runner_failed"||["qa-check","commander-check","pr-sync-pending","broken"].some(k=>by[k].status!=="unreadable")||by.complete.status!=="completed"||by.complete.ci_fix?.attempts!==2||by.complete.ci_fix?.last_result!=="pushed"||by["cifix-77"])throw Error("state assertions");const t=run("states-text",false);if(!t.includes("complete  completed")||!t.includes("ci_fix=2次 last=pushed")||!t.includes("partial  partial")||!t.includes("reason_code=tests_failed")||t.includes("cifix-77  "))throw Error("text assertions");const names=fs.readdirSync(d).sort();console.log("files after="+JSON.stringify(names));if(names.length!==9||!names.includes("pr-sync-pending.json")||!names.includes("cifix-77.json"))throw Error("file preservation");console.log("Q-2 assertions PASS")'
```
```output
=== states-json stdout ===
[{"task_id":"complete","mtime":"2026-10-16T06:02:42.279Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/77","ci_fix":{"attempts":2,"last_result":"pushed"}},{"task_id":"broken","mtime":"2026-10-16T06:02:42.278Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"pr-sync-pending","mtime":"2026-10-16T06:02:42.278Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"commander-check","mtime":"2026-10-16T06:02:42.278Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"qa-check","mtime":"2026-10-16T06:02:42.278Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"failed","mtime":"2026-10-16T06:02:42.278Z","status":"failed","failed_activity":"publish","reason_code":"runner_failed","pr_url":null,"ci_fix":null},{"task_id":"partial","mtime":"2026-10-16T06:02:42.278Z","status":"partial","failed_activity":"verify","reason_code":"tests_failed","pr_url":null,"ci_fix":null},{"task_id":"progress","mtime":"2026-10-16T06:02:42.278Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
=== states-json stderr ===
=== states-json exit === 0
=== states-text stdout ===
complete  completed  2026-10-16T06:02:42.279Z  https://github.com/example/repo/pull/77  ci_fix=2次 last=pushed
broken  unreadable  2026-10-16T06:02:42.278Z  failed_activity=- reason_code=-
pr-sync-pending  unreadable  2026-10-16T06:02:42.278Z  failed_activity=- reason_code=-
commander-check  unreadable  2026-10-16T06:02:42.278Z  failed_activity=- reason_code=-
qa-check  unreadable  2026-10-16T06:02:42.278Z  failed_activity=- reason_code=-
failed  failed  2026-10-16T06:02:42.278Z  failed_activity=publish reason_code=runner_failed
partial  partial  2026-10-16T06:02:42.278Z  failed_activity=verify reason_code=tests_failed
progress  running  2026-10-16T06:02:42.278Z  failed_activity=- reason_code=-
=== states-text stderr ===
=== states-text exit === 0
files after=["broken.json","cifix-77.json","commander-check.json","complete.json","failed.json","partial.json","pr-sync-pending.json","progress.json","qa-check.json"]
Q-2 assertions PASS
```

### T-3
对应: Q-3
verdict: PASS
说明: 缺 URL 的回执仍是 `completed`，JSON 明示 `pr_url_missing` 和 `null`；普通行未显示该原因。示例 PR URL 未经真实合并核实，结论仅为“尚未证实”。
```command
node -e 'const fs=require("fs"),path=require("path"),cp=require("child_process");const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const d=cp.execFileSync("mktemp",["-d"],{encoding:"utf8"}).trim();fs.writeFileSync(path.join(d,"no-pr.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(path.join(d,"example-pr.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/999999"}}));const run=(label,json)=>{const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"});process.stdout.write("=== "+label+" stdout ===\n"+r.stdout+"=== "+label+" stderr ===\n"+r.stderr+"=== "+label+" exit === "+r.status+"\n");if(r.status!==0)throw Error(label+" exit");return r.stdout};const j=run("completed-json",true);const rows=JSON.parse(j);const no=rows.find(x=>x.task_id==="no-pr"),ex=rows.find(x=>x.task_id==="example-pr");if(rows.length!==2||no.status!=="completed"||no.reason_code!=="pr_url_missing"||no.pr_url!==null||ex.status!=="completed"||ex.pr_url!=="https://github.com/example/repo/pull/999999")throw Error("completed json");const t=run("completed-text",false);if(!t.includes("no-pr  completed")||t.includes("pr_url_missing")||!t.includes("example-pr  completed"))throw Error("completed text");console.log("Q-3 assertions PASS; example PR was not verified as merged")'
```
```output
=== completed-json stdout ===
[{"task_id":"example-pr","mtime":"2026-10-16T06:02:50.765Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/999999","ci_fix":null},{"task_id":"no-pr","mtime":"2026-10-16T06:02:50.764Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}]
=== completed-json stderr ===
=== completed-json exit === 0
=== completed-text stdout ===
example-pr  completed  2026-10-16T06:02:50.765Z  https://github.com/example/repo/pull/999999
no-pr  completed  2026-10-16T06:02:50.764Z
=== completed-text stderr ===
=== completed-text exit === 0
Q-3 assertions PASS; example PR was not verified as merged
```

### T-4
对应: Q-1,Q-2,Q-3
verdict: PASS
说明: 只读检查最终 README 的操作参数、分类、非回执 JSON、完成与合并的区别和终态核对说明；CLI 行为由 T-1 至 T-3 独立验证。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["## 运行回执如何判读","--log-dir <回执目录> --json","--log-dir <回执目录>","CODING_WF_LOG_DIR","mtime","没有运行记录","不能证明服务健康","running","partial","failed","unreadable","qa-*.json","commander-*.json","pr-sync-pending.json","ci_fix.attempts","ci_fix.last_result","pr_url_missing","runner.phase=merged","merge.merged=true","QA 终态","最终 head","不手改批准或 FAIL"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过；22 项关键词齐全")'
```
```output
README 文本核对通过；22 项关键词齐全
```

### T-5
对应: Q-4
verdict: PASS
说明: 固定 base 到本轮 HEAD 的 README 为 22 行纯新增，原文没有删除；manifest 为 9 条纯新增且均符合当前任务白名单、owner、role，历史行没有删除。全仓未跟踪为空，暂存区为空。裁判 J-2 所指的两份历史报告，当前工作区差异是 03-build.md 整文件删除 37 行、04-evidence.md 整文件删除 67 行，**各自新增 0 行**，不是改写；本轮文件隔离不读取两份正文。控制器来源事实分别给出 03-build 的 stage_event_id `214b83cb-3847-4b01-819d-b9e53a6e0b4a`、04-evidence 的 `5f901c95-5b6f-4919-9145-032c255fe521`，两者均在已验证提交 `d8b577d83a77d0cc931d863b4ecca65d6d2a615e`。这些固定来源事实只证明提交中的身份，不证明工作区删除的操作者；工作区现象与本轮隔离相符。
```command
node -e 'const cp=require("child_process");const base="1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c",want="646c8acf36f170b5ab3c44a72f19e75da65d948d",sp="sprints/10161224-cw-214f1098/";const g=(...a)=>cp.execFileSync("git",a,{encoding:"utf8"});const head=g("rev-parse","HEAD").trim();const changed=g("diff","--name-only",base,"HEAD").trim().split("\n");const staged=g("diff","--cached","--name-only").trim();const working=g("diff","--name-status").trim();const worknum=g("diff","--numstat","HEAD","--",sp+"03-build.md",sp+"04-evidence.md").trim();const untracked=g("ls-files","--others","--exclude-standard").trim();const readme=g("diff","--numstat",base,"HEAD","--","packages/brain/scripts/coding-workflow/runner/README.md").trim();const manifest=g("diff","--numstat",base,"HEAD","--",".implementation-source-relations.json").trim();const diff=g("diff","--unified=0",base,"HEAD","--",".implementation-source-relations.json");const added=diff.split("\n").filter(x=>x.startsWith("+")&&!x.startsWith("+++")).map(x=>JSON.parse(x.slice(1).replace(/,$/,"")));const allowed=/^sprints\/10161224-cw-214f1098\/(?:01-intent|01-invariants|02-spec|02-review(?:-r[1-9][0-9]*)?|02-response-r[1-9][0-9]*|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md$/;console.log("HEAD="+head);console.log("base-to-HEAD="+JSON.stringify(changed));console.log("staged="+JSON.stringify(staged));console.log("working="+JSON.stringify(working));console.log("working-numstat="+JSON.stringify(worknum));console.log("untracked="+JSON.stringify(untracked));console.log("README-numstat="+readme);console.log("manifest-numstat="+manifest);console.log("manifest-added="+JSON.stringify(added));if(head!==want||changed.length!==11||changed.filter(p=>p!==".implementation-source-relations.json"&&p!=="packages/brain/scripts/coding-workflow/runner/README.md"&&!p.startsWith(sp)).length||staged||working!==["D\t"+sp+"03-build.md","D\t"+sp+"04-evidence.md"].join("\n")||!/^0\t[1-9][0-9]*\t/.test(worknum.split("\n")[0])||!/^0\t[1-9][0-9]*\t/.test(worknum.split("\n")[1])||untracked||!/^22\t0\t/.test(readme)||!/^9\t0\t/.test(manifest)||added.length!==9||added.some(x=>x.owner_path!=="packages/brain/scripts/coding-workflow/runner/run-once.mjs"||x.role!=="documentation"||!allowed.test(x.path)))throw Error("Q-4 scope assertions");console.log("Q-4 assertions PASS; working copies of 03/04 are deleted, not rewritten")'
```
```output
HEAD=646c8acf36f170b5ab3c44a72f19e75da65d948d
base-to-HEAD=[".implementation-source-relations.json","packages/brain/scripts/coding-workflow/runner/README.md","sprints/10161224-cw-214f1098/01-intent.md","sprints/10161224-cw-214f1098/01-invariants.md","sprints/10161224-cw-214f1098/02-review-r1.md","sprints/10161224-cw-214f1098/02-review.md","sprints/10161224-cw-214f1098/02-spec.md","sprints/10161224-cw-214f1098/03-build.md","sprints/10161224-cw-214f1098/04-evidence.md","sprints/10161224-cw-214f1098/05-qa-report-r1.md","sprints/10161224-cw-214f1098/06-judge-r1.md"]
staged=""
working="D\tsprints/10161224-cw-214f1098/03-build.md\nD\tsprints/10161224-cw-214f1098/04-evidence.md"
working-numstat="0\t37\tsprints/10161224-cw-214f1098/03-build.md\n0\t67\tsprints/10161224-cw-214f1098/04-evidence.md"
untracked=""
README-numstat=22	0	packages/brain/scripts/coding-workflow/runner/README.md
manifest-numstat=9	0	.implementation-source-relations.json
manifest-added=[{"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10161224-cw-214f1098/05-qa-report-r1.md","role":"documentation"},{"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10161224-cw-214f1098/06-judge-r1.md","role":"documentation"},{"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10161224-cw-214f1098/01-intent.md","role":"documentation"},{"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10161224-cw-214f1098/01-invariants.md","role":"documentation"},{"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10161224-cw-214f1098/02-review-r1.md","role":"documentation"},{"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10161224-cw-214f1098/02-review.md","role":"documentation"},{"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10161224-cw-214f1098/02-spec.md","role":"documentation"},{"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10161224-cw-214f1098/03-build.md","role":"documentation"},{"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10161224-cw-214f1098/04-evidence.md","role":"documentation"}]
Q-4 assertions PASS; working copies of 03/04 are deleted, not rewritten
```

### X-1
对应: Q-2
场景: 用户对被归类为 `unreadable` 的合法终态回写待办连续查看两次；两次输出一致，原文件哈希不变，待办未被消费或删除。
verdict: PASS
```command
node -e 'const fs=require("fs"),path=require("path"),cp=require("child_process"),crypto=require("crypto");const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const d=cp.execFileSync("mktemp",["-d"],{encoding:"utf8"}).trim();const f=path.join(d,"pr-sync-pending.json");fs.writeFileSync(f,JSON.stringify({pending:true}));const hash=()=>crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");const before=hash();const run=n=>{const r=cp.spawnSync(process.execPath,[cli,"--log-dir",d,"--json"],{encoding:"utf8"});process.stdout.write("=== read-"+n+" stdout ===\n"+r.stdout+"=== read-"+n+" stderr ===\n"+r.stderr+"=== read-"+n+" exit === "+r.status+"\n");if(r.status!==0)throw Error("read exit");return r.stdout};const a=run(1),b=run(2),after=hash();if(a!==b||JSON.parse(a)[0]?.status!=="unreadable"||before!==after||!fs.existsSync(f))throw Error("idempotent read");console.log("before_sha256="+before);console.log("after_sha256="+after);console.log("X-1 assertions PASS")'
```
```output
=== read-1 stdout ===
[{"task_id":"pr-sync-pending","mtime":"2026-10-16T06:03:38.292Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
=== read-1 stderr ===
=== read-1 exit === 0
=== read-2 stdout ===
[{"task_id":"pr-sync-pending","mtime":"2026-10-16T06:03:38.292Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
=== read-2 stderr ===
=== read-2 exit === 0
before_sha256=253d931793d95d2439bad1611bcbcb0685f97f6597a16f1d992d1ad118a7f10a
after_sha256=253d931793d95d2439bad1611bcbcb0685f97f6597a16f1d992d1ad118a7f10a
X-1 assertions PASS
```
