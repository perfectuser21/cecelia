---
task_id: ecd50ab6-7553-4633-9bfe-2ae9448af68d
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 2 轮，环境 http://localhost:5300）

TESTED_HEAD: ab5e01cec4261608e1faa47efc601b0d1e808f15

本轮仅使用隔离 checkout 和预览 health。来源投影显示当前 head 的受保护同步记录已核验（同步事件 `cae426ca-09df-4e48-b4f0-f9e751e91d8c`）；该投影不替代下面的产品操作和 Git 检查。03/04 的当前工作区缺失由本轮控制器隔离事实 `2be1d18f-2c0b-45fa-bc6f-9b2a1644852f` 解释，恢复尚未发生，不能预先宣称恢复通过。

### T-1
对应: Q-1
verdict: PASS
说明: 自建回执目录，文本与 JSON 新先旧后；不存在目录给出空结果；README 说明空结果不证明健康。命令原生退出码为 0。
```command
set -e
trap 'rc=$?; find "$qa_dir" -type f -delete; rmdir "$qa_dir"; printf "EXIT_CODE=%s\n" "$rc"' EXIT
qa_dir=$(mktemp -d)
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/11"}}' > "$qa_dir/old.json"
printf '%s' '{"status":"failed","reason_code":"fixture_failed"}' > "$qa_dir/new.json"
touch -t 202610010000 "$qa_dir/old.json"
touch -t 202610020000 "$qa_dir/new.json"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir" --json | jq -e 'length == 2 and .[0].task_id == "new" and .[1].task_id == "old" and (.[0].mtime != null) and (.[1].mtime != null)'
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir/absent"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir/absent" --json | jq -e '. == []'
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["--log-dir","--json","mtime","没有运行记录","健康"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
```
```output
new  failed  2026-10-01T16:00:00.000Z  failed_activity=- reason_code=fixture_failed
old  completed  2026-09-30T16:00:00.000Z  https://github.com/example/repo/pull/11
true
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.8Np9v6PAUB/absent）
true
README 文本核对通过
EXIT_CODE=0
```

### T-2
对应: Q-2
verdict: PASS
说明: 所有状态和 ci_fix 值均由自建文件真实读出；前后文件清单相同。
```command
set -e
trap 'rc=$?; find "$qa_dir" -type f -delete; rmdir "$qa_dir"; printf "EXIT_CODE=%s\n" "$rc"' EXIT
qa_dir=$(mktemp -d)
printf '%s' '{"last_event":"build","status":"partial"}' > "$qa_dir/run.json"
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/77"}}' > "$qa_dir/ok.json"
printf '%s' '{"status":"partial","activities":[{"key":"build","status":"failed","attempts":[{"reason_code":"tests_failed"}]}]}' > "$qa_dir/part.json"
printf '%s' '{"status":"failed","reason_code":"run_failed"}' > "$qa_dir/fail.json"
printf '%s' '{bad' > "$qa_dir/broken.json"
printf '%s' '{"passed":true}' > "$qa_dir/qa-77.json"
printf '%s' '{"human":{}}' > "$qa_dir/commander-77.json"
printf '%s' '{"pending":true}' > "$qa_dir/pr-sync-pending.json"
printf '%s' '{"attempts":[{"result":"push_failed"},{"result":"pushed"}]}' > "$qa_dir/cifix-77.json"
printf 'BEFORE\n'; ls -1 "$qa_dir"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir" --json | jq -e '([.[]|select(.task_id=="run")|.status]==["running"]) and ([.[]|select(.task_id=="ok")|.status]==["completed"]) and ([.[]|select(.task_id=="ok")|.ci_fix]==[{"attempts":2,"last_result":"pushed"}]) and ([.[]|select(.task_id=="part")|[.status,.failed_activity,.reason_code]]==[["partial","build","tests_failed"]]) and ([.[]|select(.task_id=="fail")|[.status,.reason_code]]==[["failed","run_failed"]]) and ([.[]|select(.status=="unreadable")|.task_id]|sort==["broken","commander-77","pr-sync-pending","qa-77"]) and ([.[]|select(.task_id=="cifix-77")]|length==0)'
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir"
printf 'AFTER\n'; ls -1 "$qa_dir"
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["running","completed","partial","failed","unreadable","ci_fix","pr-sync-pending.json","删除"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
```
```output
BEFORE
broken.json
cifix-77.json
commander-77.json
fail.json
ok.json
part.json
pr-sync-pending.json
qa-77.json
run.json
true
pr-sync-pending  unreadable  2026-10-16T18:27:07.938Z  failed_activity=- reason_code=-
commander-77  unreadable  2026-10-16T18:27:07.938Z  failed_activity=- reason_code=-
qa-77  unreadable  2026-10-16T18:27:07.938Z  failed_activity=- reason_code=-
broken  unreadable  2026-10-16T18:27:07.938Z  failed_activity=- reason_code=-
fail  failed  2026-10-16T18:27:07.937Z  failed_activity=- reason_code=run_failed
part  partial  2026-10-16T18:27:07.937Z  failed_activity=build reason_code=tests_failed
ok  completed  2026-10-16T18:27:07.937Z  https://github.com/example/repo/pull/77  ci_fix=2次 last=pushed
run  running  2026-10-16T18:27:07.937Z  failed_activity=- reason_code=-
AFTER
broken.json
cifix-77.json
commander-77.json
fail.json
ok.json
part.json
pr-sync-pending.json
qa-77.json
run.json
README 文本核对通过
EXIT_CODE=0
```

### T-3
对应: Q-3
verdict: PASS
说明: 缺 PR 的 completed 文本不显示原因；JSON 保留缺失原因。README 具体要求只读核对 PR/head 和 Brain 终态，未把这份自建回执当作真实合并。
```command
set -e
trap 'rc=$?; find "$qa_dir" -type f -delete; rmdir "$qa_dir"; printf "EXIT_CODE=%s\n" "$rc"' EXIT
qa_dir=$(mktemp -d)
printf '%s' '{"status":"completed"}' > "$qa_dir/missing-pr.json"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir" --json | jq -e 'length==1 and .[0].status=="completed" and .[0].reason_code=="pr_url_missing" and .[0].pr_url==null'
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["pr_url_missing","headRefOid","mergedAt","runner.phase","merge.merged","qa_state","未证实","只读","批准","FAIL"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
```
```output
missing-pr  completed  2026-10-16T18:27:11.840Z
true
README 文本核对通过
EXIT_CODE=0
```

### T-4
对应: Q-4
verdict: CANNOT_VERIFY
原因: 固定 initial base 的提交与路径检查已完成，但第 1 轮裁判要求的三次失败原生命令、完整输出及退出码在本轮可用材料中缺失，且本轮结束后的 03/04 完整恢复尚未发生。无法用本轮重跑补证历史，也不能预先核验恢复；因此 Q-4 的完整来源与阶段证据不能判为已全满足。
说明: 第一笔自产提交只改 README；受保护同步第一父边只有上游路径和 manifest，第二父边保留 README 与本任务报告；上游历史未触本任务 README/报告。最后提交只增加上一轮 QA/裁判及来源行。本次命令退出码 0。
```command
set -e
git rev-list --parents --reverse a2b043435339c90b40d6fa0c0df369d15b18eb49..HEAD |
while read commit parent1 parent2; do
  printf 'COMMIT %s PARENTS %s %s\n' "$commit" "$parent1" "$parent2"
  printf 'EDGE-1\n'
  git diff --no-renames --raw "$parent1" "$commit"
  if [ -n "$parent2" ]; then
    printf 'EDGE-2\n'
    git diff --no-renames --raw "$parent2" "$commit"
    printf 'UPSTREAM HISTORY\n'
    git log --format='%H %P' --name-only a2b043435339c90b40d6fa0c0df369d15b18eb49.."$parent2" -- packages/brain/scripts/coding-workflow/runner/README.md sprints/10170022-cw-ecd50ab6
  fi
done
```
```output
COMMIT ced3da22fa0f0c591642df26dce257bfa0291469 PARENTS a2b043435339c90b40d6fa0c0df369d15b18eb49
EDGE-1
:100644 100644 6e6eb65f6 040c5952d M	packages/brain/scripts/coding-workflow/runner/README.md
COMMIT 352703711ddd49d5fe20d25339b3c0d5280359b4 PARENTS ced3da22fa0f0c591642df26dce257bfa0291469
EDGE-1
:100644 100644 675179a88 645085557 M	.implementation-source-relations.json
:000000 100644 000000000 342573334 A	sprints/10170022-cw-ecd50ab6/01-intent.md
:000000 100644 000000000 2276b9f0b A	sprints/10170022-cw-ecd50ab6/01-invariants.md
:000000 100644 000000000 fbb7d305f A	sprints/10170022-cw-ecd50ab6/02-response-r1.md
:000000 100644 000000000 b1fa6e29b A	sprints/10170022-cw-ecd50ab6/02-review-r1.md
:000000 100644 000000000 2a0d0b290 A	sprints/10170022-cw-ecd50ab6/02-review-r2.md
:000000 100644 000000000 2a0d0b290 A	sprints/10170022-cw-ecd50ab6/02-review.md
:000000 100644 000000000 edd207698 A	sprints/10170022-cw-ecd50ab6/02-spec.md
:000000 100644 000000000 a05a8f036 A	sprints/10170022-cw-ecd50ab6/03-build.md
:000000 100644 000000000 0608752e6 A	sprints/10170022-cw-ecd50ab6/04-evidence.md
COMMIT a31d0e477b855e2e71911cb9837bce9b87049c0a PARENTS a2b043435339c90b40d6fa0c0df369d15b18eb49
EDGE-1
:100644 100644 f60bfebc6 fc5f8d7c5 M	.brain-versions
:100644 100644 675179a88 45128001d M	.implementation-source-relations.json
:100644 100644 f1fdb91ac 7e8796e6b M	DEFINITION.md
:100644 000000 e2de4c900 000000000 D	changes/cp-10162312-source-diagnostics.md
:100644 100644 f2b2fa8f5 fcbe24ac6 M	package-lock.json
:100644 100644 f60bfebc6 fc5f8d7c5 M	packages/brain/VERSION
:100644 100644 8c5ed2d07 aba7d7c77 M	packages/brain/package-lock.json
:100644 100644 cb0cbf263 24f627125 M	packages/brain/package.json
COMMIT c05a1672a10365b548603907c82fe23e2ad2dd9b PARENTS 352703711ddd49d5fe20d25339b3c0d5280359b4 a31d0e477b855e2e71911cb9837bce9b87049c0a
EDGE-1
:100644 100644 f60bfebc6 fc5f8d7c5 M	.brain-versions
:100644 100644 645085557 4adb6cf9c M	.implementation-source-relations.json
:100644 100644 f1fdb91ac 7e8796e6b M	DEFINITION.md
:100644 000000 e2de4c900 000000000 D	changes/cp-10162312-source-diagnostics.md
:100644 100644 f2b2fa8f5 fcbe24ac6 M	package-lock.json
:100644 100644 f60bfebc6 fc5f8d7c5 M	packages/brain/VERSION
:100644 100644 8c5ed2d07 aba7d7c77 M	packages/brain/package-lock.json
:100644 100644 cb0cbf263 24f627125 M	packages/brain/package.json
EDGE-2
:100644 100644 45128001d 4adb6cf9c M	.implementation-source-relations.json
:100644 100644 6e6eb65f6 040c5952d M	packages/brain/scripts/coding-workflow/runner/README.md
:000000 100644 000000000 342573334 A	sprints/10170022-cw-ecd50ab6/01-intent.md
:000000 100644 000000000 2276b9f0b A	sprints/10170022-cw-ecd50ab6/01-invariants.md
:000000 100644 000000000 fbb7d305f A	sprints/10170022-cw-ecd50ab6/02-response-r1.md
:000000 100644 000000000 b1fa6e29b A	sprints/10170022-cw-ecd50ab6/02-review-r1.md
:000000 100644 000000000 2a0d0b290 A	sprints/10170022-cw-ecd50ab6/02-review-r2.md
:000000 100644 000000000 2a0d0b290 A	sprints/10170022-cw-ecd50ab6/02-review.md
:000000 100644 000000000 edd207698 A	sprints/10170022-cw-ecd50ab6/02-spec.md
:000000 100644 000000000 a05a8f036 A	sprints/10170022-cw-ecd50ab6/03-build.md
:000000 100644 000000000 0608752e6 A	sprints/10170022-cw-ecd50ab6/04-evidence.md
UPSTREAM HISTORY
COMMIT ab5e01cec4261608e1faa47efc601b0d1e808f15 PARENTS c05a1672a10365b548603907c82fe23e2ad2dd9b
EDGE-1
:100644 100644 4adb6cf9c 149ceb6c9 M	.implementation-source-relations.json
:000000 100644 000000000 dba0d9b17 A	sprints/10170022-cw-ecd50ab6/05-qa-report-r1.md
:000000 100644 000000000 e28e7a93f A	sprints/10170022-cw-ecd50ab6/06-judge-r1.md
```

### T-5
对应: Q-4
verdict: PASS
说明: 基线 README 每一行按字节与顺序仍在当前文件中；全仓枚举显示工作区仅有控制器隔离的 03/04 两个删除项，暂存区、未跟踪项为空。发布后 manifest 来源增量不能按发布前零差异误判。
```command
set -e
git show a2b043435339c90b40d6fa0c0df369d15b18eb49:packages/brain/scripts/coding-workflow/runner/README.md > /private/tmp/qa-ecd50ab6-base-readme.md
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");const x=fs.readFileSync("/private/tmp/qa-ecd50ab6-base-readme.md","utf8");let pos=0;for(const line of x.match(/[^\n]*\n|[^\n]+$/g)||[]){const at=s.indexOf(line,pos);if(at<0)throw Error("基线行缺失: "+line);pos=at+line.length}console.log("基线 README 原文按字节及顺序保留；原字节数="+Buffer.byteLength(x)+"，现字节数="+Buffer.byteLength(s))'
find /private/tmp/qa-ecd50ab6-base-readme.md -type f -delete
git diff --name-status a2b043435339c90b40d6fa0c0df369d15b18eb49 HEAD
git diff --cached --name-status
git diff --name-status
git ls-files --others --exclude-standard
printf 'EXIT_CODE=0\n'
```
```output
基线 README 原文按字节及顺序保留；原字节数=10889，现字节数=13759
M	.brain-versions
M	.implementation-source-relations.json
M	DEFINITION.md
D	changes/cp-10162312-source-diagnostics.md
M	package-lock.json
M	packages/brain/VERSION
M	packages/brain/package-lock.json
M	packages/brain/package.json
M	packages/brain/scripts/coding-workflow/runner/README.md
A	sprints/10170022-cw-ecd50ab6/01-intent.md
A	sprints/10170022-cw-ecd50ab6/01-invariants.md
A	sprints/10170022-cw-ecd50ab6/02-response-r1.md
A	sprints/10170022-cw-ecd50ab6/02-review-r1.md
A	sprints/10170022-cw-ecd50ab6/02-review-r2.md
A	sprints/10170022-cw-ecd50ab6/02-review.md
A	sprints/10170022-cw-ecd50ab6/02-spec.md
A	sprints/10170022-cw-ecd50ab6/03-build.md
A	sprints/10170022-cw-ecd50ab6/04-evidence.md
A	sprints/10170022-cw-ecd50ab6/05-qa-report-r1.md
A	sprints/10170022-cw-ecd50ab6/06-judge-r1.md
D	sprints/10170022-cw-ecd50ab6/03-build.md
D	sprints/10170022-cw-ecd50ab6/04-evidence.md
EXIT_CODE=0
```

### T-6
对应: Q-4
verdict: PASS
说明: 临时 Git 反例已设置独立身份并禁用该临时库的 hook。最终 README 与基线相同，第一父边和上游历史仍揭示曾改 README，按合同必须拒绝这种情况；本任务实际 DAG 未见该情况。
```command
set -e
trap 'rc=$?; find "$qa_repo" -depth -delete; printf "EXIT_CODE=%s\n" "$rc"' EXIT
qa_repo=$(mktemp -d)
git -C "$qa_repo" init -b task -q
git -C "$qa_repo" config user.name "QA"
git -C "$qa_repo" config user.email "qa@example.invalid"
git -C "$qa_repo" config core.hooksPath /dev/null
printf 'base\n' > "$qa_repo/README.md"
git -C "$qa_repo" add README.md
git -C "$qa_repo" commit -qm base
base=$(git -C "$qa_repo" rev-parse HEAD)
git -C "$qa_repo" branch upstream
printf 'task\n' > "$qa_repo/task.txt"
git -C "$qa_repo" add task.txt
git -C "$qa_repo" commit -qm task
git -C "$qa_repo" switch -q upstream
printf 'changed\n' > "$qa_repo/README.md"
git -C "$qa_repo" add README.md
git -C "$qa_repo" commit -qm upstream
git -C "$qa_repo" switch -q task
git -C "$qa_repo" merge --no-ff -qm merge upstream
merge=$(git -C "$qa_repo" rev-parse HEAD)
first=$(git -C "$qa_repo" rev-parse HEAD^1)
git -C "$qa_repo" show "$base:README.md" > "$qa_repo/README.md"
git -C "$qa_repo" add README.md
git -C "$qa_repo" commit -qm restore
printf 'DAG\n'
git -C "$qa_repo" rev-list --parents --reverse "$base"..HEAD
printf 'MERGE FIRST-PARENT EDGE\n'
git -C "$qa_repo" diff --no-renames --raw "$first" "$merge"
printf 'UPSTREAM README HISTORY\n'
git -C "$qa_repo" log --format=%s --name-only "$base"..upstream -- README.md
printf 'FINAL DIFF\n'
git -C "$qa_repo" diff --name-status "$base" HEAD -- README.md
git -C "$qa_repo" diff --quiet "$base" HEAD -- README.md
git -C "$qa_repo" diff --quiet "$first" "$merge" -- README.md && exit 1 || test "$?" -eq 1
printf '反例判定：最终同文，但合并第一父边曾改 README，不能验收\n'
```
```output
DAG
b48b5881b727bb90e52d972ac09539d20ef52f12 f0e978b5c45ec7a2d4a7edbc9dcc0c28cca87b9b
56f8f2e765798bf5346f97c8c3ab77bddc904327 f0e978b5c45ec7a2d4a7edbc9dcc0c28cca87b9b
e2c144b118ce5b91c9864795629a799aa30c70de 56f8f2e765798bf5346f97c8c3ab77bddc904327 b48b5881b727bb90e52d972ac09539d20ef52f12
9d8bf423daba62bf8470c84739b8dd0aec43fc95 e2c144b118ce5b91c9864795629a799aa30c70de
MERGE FIRST-PARENT EDGE
:100644 100644 df967b9 5ea2ed4 M	README.md
UPSTREAM README HISTORY
upstream

README.md
FINAL DIFF
反例判定：最终同文，但合并第一父边曾改 README，不能验收
EXIT_CODE=0
```

### X-1
对应: Q-1
verdict: PASS
场景: 真实用户指向已存在但为空的目录，输出同样提示无记录且 JSON 为空数组。
```command
set -e
trap 'rc=$?; rmdir "$qa_dir"; printf "EXIT_CODE=%s\n" "$rc"' EXIT
qa_dir=$(mktemp -d)
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir" --json | jq -e '. == []'
```
```output
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.PAVUoKPpyO）
true
EXIT_CODE=0
```

## 裁判指出的历史缺口与本轮失败记录

第 1 轮报告曾提及 Q-1、Q-3 和临时 Git 反例的三次失败，却未保留原始命令、完整输出和退出码。本轮隔离规则禁止读取旧 QA 报告，且第 1 轮原生执行事件不可在本轮重取；这三次历史失败的原始证据仍缺失，不能把本轮成功重测冒充为旧命令记录。本轮另外发生了以下两次断言失败，逐字保留命令、输出及原生退出码。它们是 QA 断言写错字段／措辞，并非产品缺陷，修正后的独立执行见 T-1 与下方 README 内容回读。

第一次断言误用 `file` 字段，实际 JSON 字段为 `task_id`：
```command
set -e
trap 'rc=$?; find "$qa_dir" -type f -delete; rmdir "$qa_dir"; printf "EXIT_CODE=%s\n" "$rc"' EXIT
qa_dir=$(mktemp -d)
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/11"}}' > "$qa_dir/old.json"
printf '%s' '{"status":"failed","reason_code":"fixture_failed"}' > "$qa_dir/new.json"
touch -t 202610010000 "$qa_dir/old.json"
touch -t 202610020000 "$qa_dir/new.json"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir" --json | jq -e 'length == 2 and .[0].file == "new.json" and .[1].file == "old.json" and (.[0].mtime != null) and (.[1].mtime != null)'
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir/absent"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir/absent" --json | jq -e '. == []'
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["--log-dir","--json","mtime","没有运行记录","健康"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
```
```output
new  failed  2026-10-01T16:00:00.000Z  failed_activity=- reason_code=fixture_failed
old  completed  2026-09-30T16:00:00.000Z  https://github.com/example/repo/pull/11
false
EXIT_CODE=1
```

为确认真实字段又执行：
```command
set -e
trap 'rc=$?; find "$qa_dir" -type f -delete; rmdir "$qa_dir"; printf "EXIT_CODE=%s\n" "$rc"' EXIT
qa_dir=$(mktemp -d)
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/11"}}' > "$qa_dir/old.json"
printf '%s' '{"status":"failed","reason_code":"fixture_failed"}' > "$qa_dir/new.json"
touch -t 202610010000 "$qa_dir/old.json"
touch -t 202610020000 "$qa_dir/new.json"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$qa_dir" --json
```
```output
[{"task_id":"new","mtime":"2026-10-01T16:00:00.000Z","status":"failed","failed_activity":null,"reason_code":"fixture_failed","pr_url":null,"ci_fix":null},{"task_id":"old","mtime":"2026-09-30T16:00:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/11","ci_fix":null}]
EXIT_CODE=0
```

第二次断言误要求 README 逐字包含「不等于 PR 已合并」，实际用语是「不等于最终合并」：
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["运行回执如何判读","--log-dir","--json","mtime","没有运行记录","pr-sync-pending.json","不等于 PR 已合并","pr_url_missing","headRefOid","runner.phase","merge.merged","qa_state"])if(!s.includes(x))throw Error(x);const a=s.indexOf("运行回执如何判读");console.log(s.slice(a,a+3600))'
```
```output
[eval]:1
const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["运行回执如何判读","--log-dir","--json","mtime","没有运行记录","pr-sync-pending.json","不等于 PR 已合并","pr_url_missing","headRefOid","runner.phase","merge.merged","qa_state"])if(!s.includes(x))throw Error(x);const a=s.indexOf("运行回执如何判读");console.log(s.slice(a,a+3600))
                                                                                                                                                                                                                                                                                                                          ^

Error: 不等于 PR 已合并
    at [eval]:1:321
    at runScriptInThisContext (node:internal/vm:219:10)
    at node:internal/process/execution:485:12
    at [eval]-wrapper:6:24
    at runScriptInContext (node:internal/process/execution:317:30)
    at evalFunction (node:internal/process/execution:485:22)
    at evalTypeScript (node:internal/process/execution:329:3)
    at node:internal/main/eval_string:71:3

Node.js v26.8.2
```
原生退出码: 1。随后使用去掉错误逐字要求的同形状命令真实回读，输出中有「`completed` 不等于最终合并」「不能从表格行推断已有有效 PR」「未证实合并，可稍后重查」，原生退出码 0。

预览身份另经只读请求确认：
```command
curl -sS http://localhost:5300/api/brain/health | jq -e '.git_sha == "ab5e01cec4261608e1faa47efc601b0d1e808f15"'
```
```output
true
```

本轮没有页面类场景，未启动浏览器或生成截图。正式 CI、GitHub 合并、Brain 终态、Learning、预览回收及 03/04 恢复均发生在本 QA 之后，本报告不把它们判作完成。
