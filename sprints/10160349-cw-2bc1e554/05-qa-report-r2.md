---
task_id: 2bc1e554-43fa-47f9-9ef4-8ab8b6c5baf3
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6", "02-spec.md#Q-7"]
---
# QA 报告（第 2 轮，环境 http://localhost:5301）

受验 HEAD：`8e9de14ad7ca3dce29648f02d8a49f311623111f`。合同场景均为本地只读 CLI、README 和仓库范围核对，无页面或 API 操作。

### T-1
对应: Q-1
verdict: PASS
```command
set -e; d=$(mktemp -d); printf '%s' '{"status":"completed","outputs":{"pr_url":"https://example.test/pull/11"}}' > "$d/older.json"; printf '%s' '{"status":"completed","outputs":{"pr_url":"https://example.test/pull/12"}}' > "$d/newer.json"; touch -t 202610160101 "$d/older.json"; touch -t 202610160102 "$d/newer.json"; t=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d"); j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json); printf '%s\n%s\n' "$t" "$j"; [[ "$(printf '%s' "$j" | jq -r 'map(.task_id)|join(",")')" == "newer,older" ]]; [[ "$(printf '%s\n' "$t" | awk '{print $1}' | paste -sd , -)" == "newer,older" ]]
```
```output
newer  completed  2026-10-15T17:02:00.000Z  https://example.test/pull/12
older  completed  2026-10-15T17:01:00.000Z  https://example.test/pull/11
[{"task_id":"newer","mtime":"2026-10-15T17:02:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.test/pull/12","ci_fix":null},{"task_id":"older","mtime":"2026-10-15T17:01:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.test/pull/11","ci_fix":null}]
```

### T-2
对应: Q-2
verdict: PASS
```command
set -e; d=$(mktemp -d); a=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json); b=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d/missing" --json); t=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d/missing"); printf 'empty=%s\nmissing=%s\ntext=%s\n' "$a" "$b" "$t"; [[ "$a" == '[]' && "$b" == '[]' && "$t" == 没有运行记录* ]]
```
```output
empty=[]
missing=[]
text=没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.bGPiw9I0Fc/missing）
```

### T-3
对应: Q-3
verdict: PASS
```command
set -e; d=$(mktemp -d); printf '%s' '{"last_event":{"x":1},"status":"completed"}' > "$d/running.json"; printf '%s' '{"status":"completed","outputs":{"pr_url":"https://example.test/pull/731"}}' > "$d/completed.json"; printf '%s' '{"status":"partial","activities":[{"key":"publish","status":"failed","attempts":[{"reason_code":"old"},{"reason_code":"partial_last"}]}]}' > "$d/partial.json"; printf '%s' '{"status":"failed","activities":[{"key":"merge","status":"failed","attempts":[{"reason_code":"old"},{"reason_code":"failed_last"}]}]}' > "$d/failed.json"; printf '%s' '{"attempts":[{"result":"failed"},{"result":"passed"}]}' > "$d/cifix-731.json"; j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json); printf '%s\n' "$j"; printf '%s' "$j" | jq -e 'length==4 and (map({key:.task_id,value:.status})|from_entries)=={"running":"running","completed":"completed","partial":"partial","failed":"failed"} and (map(select(.task_id=="partial"))[0]|.failed_activity=="publish" and .reason_code=="partial_last") and (map(select(.task_id=="failed"))[0]|.failed_activity=="merge" and .reason_code=="failed_last") and (map(select(.task_id=="completed"))[0]|.ci_fix.attempts==2 and .ci_fix.last_result=="passed")'
```
```output
[{"task_id":"failed","mtime":"2026-10-15T21:48:01.242Z","status":"failed","failed_activity":"merge","reason_code":"failed_last","pr_url":null,"ci_fix":null},{"task_id":"partial","mtime":"2026-10-15T21:48:01.242Z","status":"partial","failed_activity":"publish","reason_code":"partial_last","pr_url":null,"ci_fix":null},{"task_id":"completed","mtime":"2026-10-15T21:48:01.242Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.test/pull/731","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"running","mtime":"2026-10-15T21:48:01.242Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
true
```

### T-4
对应: Q-4
verdict: PASS
```command
set -e; d=$(mktemp -d); printf '%s' '{"status":"completed","outputs":{"pr_url":"https://example.test/pull/8"}}' > "$d/valid.json"; printf '%s' '{bad' > "$d/bad.json"; printf '%s' '{"qa_state":"pending"}' > "$d/qa-state.json"; printf '%s' '{"phase":"review"}' > "$d/commander-state.json"; printf '%s' '{"pending":true}' > "$d/pr-sync-pending.json"; printf '%s' '{"status":"completed","outputs":{}}' > "$d/minimal.json"; j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json); printf '%s\n' "$j"; printf '%s' "$j" | jq -e 'length==6 and ([.[]|select(.status=="unreadable")|.task_id]|sort)==["bad","commander-state","pr-sync-pending","qa-state"] and ([.[]|select(.task_id=="valid")][0].status=="completed") and ([.[]|select(.task_id=="minimal")][0]|.status=="completed" and .reason_code=="pr_url_missing")'
```
```output
[{"task_id":"minimal","mtime":"2026-10-15T21:48:01.243Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null},{"task_id":"pr-sync-pending","mtime":"2026-10-15T21:48:01.243Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"commander-state","mtime":"2026-10-15T21:48:01.243Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"qa-state","mtime":"2026-10-15T21:48:01.242Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"bad","mtime":"2026-10-15T21:48:01.242Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"valid","mtime":"2026-10-15T21:48:01.242Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.test/pull/8","ci_fix":null}]
true
```

### T-5
对应: Q-5
verdict: PASS
```command
set -e; d=$(mktemp -d); printf '%s' '{"status":"completed","outputs":{}}' > "$d/no-pr.json"; t=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d"); j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json); printf '%s\n%s\n' "$t" "$j"; [[ "$t" == *completed* && "$t" != *pr_url_missing* ]]; printf '%s' "$j" | jq -e 'length==1 and .[0].status=="completed" and .[0].reason_code=="pr_url_missing" and .[0].pr_url==null'
```
```output
no-pr  completed  2026-10-15T21:48:01.242Z
[{"task_id":"no-pr","mtime":"2026-10-15T21:48:01.242Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}]
true
```

### T-6
对应: Q-6
verdict: PASS
```command
set -e; d=$(mktemp -d); printf '%s' '{"status":"completed","outputs":{"pr_url":"https://example.invalid/pull/999999"}}' > "$d/fake-pr.json"; j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json); printf '%s\n' "$j"; printf '%s' "$j" | jq -e 'length==1 and .[0].status=="completed" and .[0].pr_url=="https://example.invalid/pull/999999" and .[0].ci_fix==null'
```
```output
[{"task_id":"fake-pr","mtime":"2026-10-15T21:48:01.242Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.invalid/pull/999999","ci_fix":null}]
true
```

### T-7
对应: Q-1, Q-2, Q-3, Q-4, Q-5, Q-6
verdict: PASS
README 内容断言覆盖命令、分类、待办保护及最终成功判据；功能结果见 T-1 至 T-6。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["运行回执如何判读","--log-dir","--json","mtime","没有运行记录","不能证明服务健康","running","completed","partial","failed","unreadable","ci_fix","last_result","pr-sync-pending.json","pr_url_missing","pr_url=null","head SHA","runner.phase=merged","merge.merged=true","QA 终态","不要手工改批准或 FAIL"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
```
```output
README 文本核对通过
```

### T-8
对应: Q-7
verdict: PASS
固定基线至明确 HEAD 的 README 仅新增 23 行、无删除；manifest 在前部新增本任务 11 条，基线历史 relations 保持原顺序及内容。完整仓库未跟踪列表为空；工作区的 03-build、04-evidence 是本轮可见删除状态，未进入受验 HEAD，均为本任务流水线记录。
```command
set -e; base=52a9476e014f540d418014e7062ca66a72f38709; git rev-parse HEAD; git diff --name-only "$base" HEAD; git diff --cached --name-only; git diff --name-only; git ls-files --others --exclude-standard; git diff --numstat "$base" HEAD -- packages/brain/scripts/coding-workflow/runner/README.md; b=$(mktemp); git show "$base":.implementation-source-relations.json > "$b"; jq -e --slurpfile old "$b" '(.relations|length)==247 and (.relations[11:]==$old[0].relations) and ([.relations[0:11][]|select(.owner_path!="packages/brain/scripts/coding-workflow/runner/run-once.mjs" or .role!="documentation" or (.path|startswith("sprints/10160349-cw-2bc1e554/")|not))]|length)==0 and ([.relations[0:11][].path]|sort)==(["01-intent.md","01-invariants.md","02-response-r1.md","02-review-r1.md","02-review-r2.md","02-review.md","02-spec.md","03-build.md","04-evidence.md","05-qa-report-r1.md","06-judge-r1.md"]|map("sprints/10160349-cw-2bc1e554/"+.)|sort)' .implementation-source-relations.json
```
```output
8e9de14ad7ca3dce29648f02d8a49f311623111f
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
sprints/10160349-cw-2bc1e554/05-qa-report-r1.md
sprints/10160349-cw-2bc1e554/06-judge-r1.md
sprints/10160349-cw-2bc1e554/03-build.md
sprints/10160349-cw-2bc1e554/04-evidence.md
23	0	packages/brain/scripts/coding-workflow/runner/README.md
true
```

### T-9
对应: Q-7
verdict: CANNOT_VERIFY
原因: 裁判 J-1 要求证明新增来源由许可控制器产生、对应报告内容确属本任务真实阶段。Git 提交能证明来源 manifest 与对应路径同提交，第二次提交者显示 runner；首次提交者为 Cecelia Test，仅凭作者名与文件清单无法证明是许可控制器执行。此次输入明确禁止读取 05-qa-report-r1.md、03-build.md、04-evidence.md 等开发方文件，因此也无法逐份核实报告内容任务归属；不把路径名当作内容证据。
```command
set -e; git show --format=fuller --name-status 9e25b9b8653f28606ff8064ec884899ea930e49a -- .implementation-source-relations.json sprints/10160349-cw-2bc1e554; git show --format=fuller --name-status 8e9de14ad7ca3dce29648f02d8a49f311623111f -- .implementation-source-relations.json sprints/10160349-cw-2bc1e554
```
```output
commit 9e25b9b8653f28606ff8064ec884899ea930e49a
Author:     Cecelia Test <test@cecelia.dev>
AuthorDate: Fri Oct 16 04:00:34 2026 +0800
Commit:     Cecelia Test <test@cecelia.dev>
CommitDate: Fri Oct 16 04:00:34 2026 +0800

    feat(workflow): 运行回执判读手册：区分任务状态与最终合并

M	.implementation-source-relations.json
A	sprints/10160349-cw-2bc1e554/01-intent.md
A	sprints/10160349-cw-2bc1e554/01-invariants.md
A	sprints/10160349-cw-2bc1e554/02-response-r1.md
A	sprints/10160349-cw-2bc1e554/02-review-r1.md
A	sprints/10160349-cw-2bc1e554/02-review-r2.md
A	sprints/10160349-cw-2bc1e554/02-review.md
A	sprints/10160349-cw-2bc1e554/02-spec.md
A	sprints/10160349-cw-2bc1e554/03-build.md
A	sprints/10160349-cw-2bc1e554/04-evidence.md
commit 8e9de14ad7ca3dce29648f02d8a49f311623111f
Author:     coding-workflow-runner <coding-workflow-runner@cecelia.local>
AuthorDate: Fri Oct 16 04:36:39 2026 +0800
Commit:     coding-workflow-runner <coding-workflow-runner@cecelia.local>
CommitDate: Fri Oct 16 04:36:39 2026 +0800

    docs(qa): 第 1 轮AI QA PASS，独立裁判 FAIL

M	.implementation-source-relations.json
A	sprints/10160349-cw-2bc1e554/05-qa-report-r1.md
A	sprints/10160349-cw-2bc1e554/06-judge-r1.md
```

### X-1
对应: Q-4
verdict: PASS
场景: 用户把未知状态和 JSON null 放进回执目录，两条均被列出并显示 unreadable。
```command
set -e; d=$(mktemp -d); printf '%s' '{"status":"mystery"}' > "$d/unknown.json"; printf '%s' 'null' > "$d/null.json"; j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json); printf '%s\n' "$j"; printf '%s' "$j" | jq -e 'length==2 and all(.[]; .status=="unreadable")'
```
```output
[{"task_id":"null","mtime":"2026-10-15T21:48:40.380Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"unknown","mtime":"2026-10-15T21:48:40.380Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
true
```
