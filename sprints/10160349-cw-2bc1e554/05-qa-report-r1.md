---
task_id: 2bc1e554-43fa-47f9-9ef4-8ab8b6c5baf3
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7"]
---
# QA 报告（第 1 轮，环境 http://localhost:5301）

本轮合同为本地只读 CLI 与文档验收，无页面或 API 场景；没有访问生产 Brain，也没有把虚构 PR 当作真实合并证据。以下命令均在本 PR 检出目录真实执行。

### T-1
对应: Q-1
verdict: PASS
```command
set -e
d=$(mktemp -d)
printf '%s\n' '{"status":"completed","outputs":{}}' > "$d/older.json"
printf '%s\n' '{"status":"completed","outputs":{}}' > "$d/newer.json"
touch -t 202610161200 "$d/older.json"
touch -t 202610161201 "$d/newer.json"
plain=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d")
json=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n%s\n' "$plain" "$json"
PLAIN="$plain" JSON="$json" node -e 'const p=process.env.PLAIN,j=JSON.parse(process.env.JSON);if(!Array.isArray(j)||j.length!==2||j[0].task_id!=="newer"||j[1].task_id!=="older"||p.indexOf("newer")>=p.indexOf("older")||j[0].mtime<=j[1].mtime)throw Error("排序或格式错误");console.log("断言通过")'
```
```output
newer  completed  2026-10-16T04:01:00.000Z
older  completed  2026-10-16T04:00:00.000Z
[{"task_id":"newer","mtime":"2026-10-16T04:01:00.000Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null},{"task_id":"older","mtime":"2026-10-16T04:00:00.000Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}]
断言通过
```

### T-2
对应: Q-2
verdict: PASS
```command
set -e
d=$(mktemp -d)
empty=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
missing=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d/absent" --json)
plain=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d/absent")
printf '空目录=%s\n不存在目录=%s\n文本=%s\n' "$empty" "$missing" "$plain"
test "$empty" = '[]'
test "$missing" = '[]'
case "$plain" in "没有运行记录（$d/absent）") ;; *) exit 1;; esac
printf '断言通过\n'
```
```output
空目录=[]
不存在目录=[]
文本=没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.vVz7u3Mdcc/absent）
断言通过
```

### T-3
对应: Q-3
verdict: PASS
```command
set -e
d=$(mktemp -d)
printf '%s\n' '{"last_event":{"type":"tick"},"status":"failed"}' > "$d/running.json"
printf '%s\n' '{"status":"completed","outputs":{"pr_url":"https://example.invalid/pull/731"}}' > "$d/completed.json"
printf '%s\n' '{"status":"partial","activities":[{"key":"first","status":"completed"},{"key":"build","status":"failed","attempts":[{"reason_code":"old"},{"reason_code":"partial_last"}]}]}' > "$d/partial.json"
printf '%s\n' '{"status":"failed","activities":[{"key":"test","status":"failed","attempts":[{"reason_code":"old"},{"reason_code":"failed_last"}]}]}' > "$d/failed.json"
printf '%s\n' '{"attempts":[{"result":"failed"},{"result":"passed"}]}' > "$d/cifix-731.json"
json=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n' "$json"
JSON="$json" node -e 'const a=JSON.parse(process.env.JSON),m=Object.fromEntries(a.map(x=>[x.task_id,x]));if(a.length!==4||m.running.status!=="running"||m.completed.status!=="completed"||m.partial.status!=="partial"||m.partial.failed_activity!=="build"||m.partial.reason_code!=="partial_last"||m.failed.status!=="failed"||m.failed.failed_activity!=="test"||m.failed.reason_code!=="failed_last"||m.completed.ci_fix?.attempts!==2||m.completed.ci_fix?.last_result!=="passed"||m["cifix-731"])throw Error("状态/CI摘要错误");console.log("断言通过")'
```
```output
[{"task_id":"failed","mtime":"2026-10-15T20:33:21.166Z","status":"failed","failed_activity":"test","reason_code":"failed_last","pr_url":null,"ci_fix":null},{"task_id":"partial","mtime":"2026-10-15T20:33:21.166Z","status":"partial","failed_activity":"build","reason_code":"partial_last","pr_url":null,"ci_fix":null},{"task_id":"completed","mtime":"2026-10-15T20:33:21.166Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.invalid/pull/731","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"running","mtime":"2026-10-15T20:33:21.166Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
断言通过
```

### T-4
对应: Q-4
verdict: PASS
```command
set -e
d=$(mktemp -d)
printf '%s\n' '{"status":"completed","outputs":{"pr_url":"https://example.invalid/pull/44"}}' > "$d/valid.json"
printf '%s\n' '{broken' > "$d/bad.json"
printf '%s\n' '{"qa_state":"pending"}' > "$d/qa-state.json"
printf '%s\n' '{"phase":"review"}' > "$d/commander-state.json"
printf '%s\n' '{"pending":true}' > "$d/pr-sync-pending.json"
printf '%s\n' '{"status":"completed","outputs":{}}' > "$d/minimal.json"
json=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n' "$json"
JSON="$json" node -e 'const a=JSON.parse(process.env.JSON),m=Object.fromEntries(a.map(x=>[x.task_id,x]));if(a.length!==6||m.valid.status!=="completed"||m.bad.status!=="unreadable"||m["qa-state"].status!=="unreadable"||m["commander-state"].status!=="unreadable"||m["pr-sync-pending"].status!=="unreadable"||m.minimal.status!=="completed"||m.minimal.reason_code!=="pr_url_missing")throw Error("非回执分类错误");console.log("断言通过")'
test -f "$d/bad.json" && test -f "$d/pr-sync-pending.json"
```
```output
[{"task_id":"minimal","mtime":"2026-10-15T20:33:21.166Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null},{"task_id":"pr-sync-pending","mtime":"2026-10-15T20:33:21.166Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"commander-state","mtime":"2026-10-15T20:33:21.166Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"qa-state","mtime":"2026-10-15T20:33:21.166Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"bad","mtime":"2026-10-15T20:33:21.166Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"valid","mtime":"2026-10-15T20:33:21.166Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.invalid/pull/44","ci_fix":null}]
断言通过
```

### T-5
对应: Q-5
verdict: PASS
```command
set -e
d=$(mktemp -d)
printf '%s\n' '{"status":"completed","outputs":{}}' > "$d/no-pr.json"
plain=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d")
json=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n%s\n' "$plain" "$json"
PLAIN="$plain" JSON="$json" node -e 'const p=process.env.PLAIN,a=JSON.parse(process.env.JSON);if(!p.includes("no-pr  completed")||p.includes("pr_url_missing")||a.length!==1||a[0].status!=="completed"||a[0].reason_code!=="pr_url_missing"||a[0].pr_url!==null)throw Error("缺PR判读错误");console.log("断言通过")'
```
```output
no-pr  completed  2026-10-15T20:33:21.166Z
[{"task_id":"no-pr","mtime":"2026-10-15T20:33:21.166Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}]
断言通过
```

### T-6
对应: Q-6
verdict: PASS
```command
set -e
d=$(mktemp -d)
printf '%s\n' '{"status":"completed","outputs":{"pr_url":"https://example.invalid/pull/987654"}}' > "$d/fake-pr.json"
json=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n' "$json"
JSON="$json" node -e 'const a=JSON.parse(process.env.JSON);if(a.length!==1||a[0].status!=="completed"||a[0].pr_url!=="https://example.invalid/pull/987654"||a[0].ci_fix!==null)throw Error("虚构PR样本错误");console.log("断言通过；该URL未回读真实PR/head/Brain/QA，结论为尚未核实")'
```
```output
[{"task_id":"fake-pr","mtime":"2026-10-15T20:33:21.166Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.invalid/pull/987654","ci_fix":null}]
断言通过；该URL未回读真实PR/head/Brain/QA，结论为尚未核实
```

### T-7
对应: Q-7
verdict: PASS
说明: 四类 Git 范围命令也分别单独执行过；以下为同样命令的组合断言。工作区显示的两项删除及本报告未跟踪文件属于本任务流水线记录，HEAD 中仍存在被暂时隐藏的两项，未触及产品源码。
```command
set -e
head=$(git diff --name-only 52a9476e014f540d418014e7062ca66a72f38709 HEAD)
staged=$(git diff --cached --name-only)
work=$(git diff --name-only)
untracked=$(git ls-files --others --exclude-standard)
printf 'HEAD差异:\n%s\n暂存区:\n%s\n工作区:\n%s\n未跟踪:\n%s\n' "$head" "$staged" "$work" "$untracked"
HEAD_DIFF="$head" STAGED="$staged" WORK="$work" UNTRACKED="$untracked" node -e 'const h=process.env.HEAD_DIFF.split("\n").filter(Boolean),s=process.env.STAGED.split("\n").filter(Boolean),w=process.env.WORK.split("\n").filter(Boolean),u=process.env.UNTRACKED.split("\n").filter(Boolean);const root="sprints/10160349-cw-2bc1e554/";const product=h.filter(x=>!x.startsWith(root)&&x!==".implementation-source-relations.json");if(product.length!==1||product[0]!=="packages/brain/scripts/coding-workflow/runner/README.md"||s.length||u.some(x=>x!==root+"05-qa-report-r1.md")||w.some(x=>![root+"03-build.md",root+"04-evidence.md"].includes(x)))throw Error("范围越界");console.log("范围断言通过；工作区与未跟踪项均为本任务流水线记录")'
```
```output
HEAD差异:
.implementation-source-relations.json
packages/brain/scripts/coding-workflow/runner/README.md
sprints/10160349-cw-2bc1e554/01-intent.md
sprints/10160349-cw-2bc1e554/01-invariants.md
sprints/10160349-cw-2bc1e554/02-response-r1.md
sprints/10160349-cw-2bc1e554/02-review-r1.md
sprints/10160349-cw-2bc1e554/02-review-r2.md
sprints/10160349-cw-2bc1e554/02-review.md
sprints/10160349-cw-2bc1e554/02-spec.md
sprints/10160349-cw-2bc1e554/03-build.md
sprints/10160349-cw-2bc1e554/04-evidence.md
暂存区:

工作区:
sprints/10160349-cw-2bc1e554/03-build.md
sprints/10160349-cw-2bc1e554/04-evidence.md
未跟踪:
sprints/10160349-cw-2bc1e554/05-qa-report-r1.md

范围断言通过；工作区与未跟踪项均为本任务流水线记录
```

### T-8
对应: Q-1, Q-2
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["运行回执如何判读","--log-dir <回执目录>","--json","CODING_WF_LOG_DIR","mtime","倒序","[]","没有运行记录","不能证明服务健康"])if(!s.includes(x))throw Error(x);console.log("Q-1/Q-2 文本核对通过")'
```
```output
Q-1/Q-2 文本核对通过
```

### T-9
对应: Q-3, Q-4
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["running","completed","partial","failed","unreadable","last_event","failed_activity","reason_code","ci_fix","last_result","cifix-<PR号>.json","QA","Commander","pr-sync-pending.json","不能单独作为文件损坏或删除现场的依据","不能据此删除"])if(!s.includes(x))throw Error(x);console.log("Q-3/Q-4 文本核对通过")'
```
```output
Q-3/Q-4 文本核对通过
```

### T-10
对应: Q-5, Q-6
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["pr_url_missing","pr_url=null","文本行默认不打印","最终 head SHA","合并状态","runner.phase=merged","merge.merged=true","QA 终态","尚未核实","不要手工改批准或 FAIL 记录"])if(!s.includes(x))throw Error(x);console.log("Q-5/Q-6 文本核对通过")'
```
```output
Q-5/Q-6 文本核对通过
```

### T-11
对应: Q-7
verdict: PASS
```command
set -o pipefail
git show 52a9476e014f540d418014e7062ca66a72f38709:packages/brain/scripts/coding-workflow/runner/README.md | node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");const b=fs.readFileSync(0,"utf8");for(const x of [b])if(!s.includes(x))throw Error("基线README未逐字连续保留");console.log("基线README全文逐字连续保留，基线字节="+Buffer.byteLength(b))'
```
```output
基线README全文逐字连续保留，基线字节=10889
```

### T-12
对应: Q-7
verdict: PASS
```command
set -o pipefail
git show 52a9476e014f540d418014e7062ca66a72f38709:.implementation-source-relations.json | node -e 'const fs=require("fs");const p=".implementation-source-relations.json";const s=fs.readFileSync(p,"utf8");const b=fs.readFileSync(0,"utf8");const now=JSON.parse(s),base=JSON.parse(b);const added=now.relations.slice(0,now.relations.length-base.relations.length);const old=now.relations.slice(added.length);const allowed=new Set(["01-intent.md","01-invariants.md","02-spec.md","02-review.md","02-review-r1.md","02-review-r2.md","02-response-r1.md","03-build.md","04-evidence.md"]);for(const x of added)if(x.owner_path!=="packages/brain/scripts/coding-workflow/runner/run-once.mjs"||x.role!=="documentation"||!x.path.startsWith("sprints/10160349-cw-2bc1e554/")||!allowed.has(x.path.split("/").at(-1)))throw Error("来源行非法: "+JSON.stringify(x));if(JSON.stringify(old)!==JSON.stringify(base.relations)||added.length!==9||now.schema_version!==base.schema_version||now.repo!==base.repo)throw Error("历史条目或新增数量不符");console.log("新增来源="+added.length+"；历史条目逐字结构一致；路径、owner、role合法");for(const x of added)console.log(x.path)'
```
```output
新增来源=9；历史条目逐字结构一致；路径、owner、role合法
sprints/10160349-cw-2bc1e554/01-intent.md
sprints/10160349-cw-2bc1e554/01-invariants.md
sprints/10160349-cw-2bc1e554/02-response-r1.md
sprints/10160349-cw-2bc1e554/02-review-r1.md
sprints/10160349-cw-2bc1e554/02-review-r2.md
sprints/10160349-cw-2bc1e554/02-review.md
sprints/10160349-cw-2bc1e554/02-spec.md
sprints/10160349-cw-2bc1e554/03-build.md
sprints/10160349-cw-2bc1e554/04-evidence.md
```

### T-13
对应: Q-7
verdict: PASS
```command
set -e
for p in 01-intent.md 01-invariants.md 02-spec.md 02-review.md 02-review-r1.md 02-review-r2.md 02-response-r1.md 03-build.md 04-evidence.md; do git cat-file -e "HEAD:sprints/10160349-cw-2bc1e554/$p"; printf 'HEAD存在 %s\n' "$p"; done
```
```output
HEAD存在 01-intent.md
HEAD存在 01-invariants.md
HEAD存在 02-spec.md
HEAD存在 02-review.md
HEAD存在 02-review-r1.md
HEAD存在 02-review-r2.md
HEAD存在 02-response-r1.md
HEAD存在 03-build.md
HEAD存在 04-evidence.md
```

### T-14
对应: Q-7
verdict: PASS
```command
set -o pipefail
git diff --unified=0 52a9476e014f540d418014e7062ca66a72f38709 HEAD -- packages/brain/scripts/coding-workflow/runner/README.md | awk 'BEGIN{plus=0;minus=0} /^\+\+\+ /{next} /^--- /{next} /^\+/{plus++} /^-/{minus++} END{printf "README新增行=%d 删除行=%d\n",plus,minus; if(plus<1||minus!=0)exit 1}'
```
```output
README新增行=23 删除行=0
```

### T-15
对应: Q-7
verdict: PASS
```command
set -o pipefail
git show 52a9476e014f540d418014e7062ca66a72f38709:.implementation-source-relations.json | node -e 'const fs=require("fs");const p=".implementation-source-relations.json";const s=fs.readFileSync(p,"utf8");const b=fs.readFileSync(0,"utf8");const marker="  \"relations\": [\n";const i=b.indexOf(marker);if(i<0)throw Error("基线结构缺失");const tail=b.slice(i+marker.length);for(const x of [tail])if(!s.endsWith(x))throw Error("历史来源字节发生变化");console.log("历史来源尾段逐字保留，字节="+Buffer.byteLength(tail))'
```
```output
历史来源尾段逐字保留，字节=42233
```

### X-1
对应: Q-4
场景: 操作者把 JSON 标量、数组和带空 `last_event` 的状态快照放进同一目录；CLI 继续按最小字段规则分类，未把数组误判成真实回执。
verdict: PASS
```command
set -e
d=$(mktemp -d)
printf '%s\n' 'null' > "$d/null.json"
printf '%s\n' '[]' > "$d/array.json"
printf '%s\n' '{"last_event":null,"status":"completed"}' > "$d/snapshot.json"
json=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n' "$json"
JSON="$json" node -e 'const a=JSON.parse(process.env.JSON),m=Object.fromEntries(a.map(x=>[x.task_id,x]));if(a.length!==3||m.null.status!=="unreadable"||m.array.status!=="unreadable"||m.snapshot.status!=="running")throw Error("边界分类错误");console.log("探索断言通过")'
```
```output
[{"task_id":"snapshot","mtime":"2026-10-15T20:34:16.023Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"array","mtime":"2026-10-15T20:34:16.023Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"null","mtime":"2026-10-15T20:34:16.022Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
探索断言通过
```
