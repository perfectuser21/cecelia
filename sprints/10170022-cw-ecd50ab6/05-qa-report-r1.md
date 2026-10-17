---
task_id: ecd50ab6-7553-4633-9bfe-2ae9448af68d
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 1 轮，环境 http://localhost:5300）

TESTED_HEAD: c05a1672a10365b548603907c82fe23e2ad2dd9b

来源事实：控制器投影 status=verified；本轮同步事件 cae426ca-09df-4e48-b4f0-f9e751e91d8c，隐藏事件 b67c6505-92c0-46a1-a9c8-55b5767c32cd。该投影只用于归属与当前临时隔离的判断，不作为产品功能证据，也不声称本轮之后的恢复、CI、远端合并或 Brain 终态已完成。

过程记录：Q-1 首次断言误将包含目录路径的「没有运行记录」文本要求为完全相等；Q-3 首次文本断言漏算 Markdown 反引号；临时 Git 反例首次受全局 pre-commit hook 拦截。三项均是验收命令自身问题，已分别修正并重新实际执行，下面只用退出码为 0 的完整重测命令判定产品。

### T-1
对应: Q-1
verdict: PASS
```command
set -e
d=$(mktemp -d)
trap 'for f in "$d"/*.json; do test -e "$f" && unlink "$f"; done; rmdir "$d"' EXIT
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/11"}}' > "$d/old.json"
printf '%s' '{"status":"failed","reason_code":"fixture_failed"}' > "$d/new.json"
touch -t 202610010000 "$d/old.json"
touch -t 202610020000 "$d/new.json"
t=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d")
printf '%s\n' "$t"
printf '%s\n' "$t" | awk 'NR==1 && $1!="new"{exit 1} NR==2 && $1!="old"{exit 1} END{if(NR!=2)exit 1}'
j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n' "$j"
printf '%s\n' "$j" | jq -e 'length==2 and .[0].task_id=="new" and .[1].task_id=="old" and (.[0].mtime|type=="string") and (.[1].mtime|type=="string")' >/dev/null
e=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d/absent")
printf '%s\n' "$e"
printf '%s\n' "$e" | grep -q '没有运行记录'
n=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d/absent" --json)
printf '%s\n' "$n"
test "$n" = '[]'
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["运行回执如何判读","--log-dir","--json","mtime","没有运行记录","不能证明服务健康"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
```
```output
new  failed  2026-10-01T16:00:00.000Z  failed_activity=- reason_code=fixture_failed
old  completed  2026-09-30T16:00:00.000Z  https://github.com/example/repo/pull/11
[{"task_id":"new","mtime":"2026-10-01T16:00:00.000Z","status":"failed","failed_activity":null,"reason_code":"fixture_failed","pr_url":null,"ci_fix":null},{"task_id":"old","mtime":"2026-09-30T16:00:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/11","ci_fix":null}]
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.7eV18Jkwqj/absent）
[]
README 文本核对通过
```

### T-2
对应: Q-2
verdict: PASS
```command
set -e
d=$(mktemp -d)
trap 'for f in "$d"/*.json; do test -e "$f" && unlink "$f"; done; rmdir "$d"' EXIT
printf '%s' '{"last_event":"build","status":"partial"}' > "$d/run.json"
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/77"}}' > "$d/ok.json"
printf '%s' '{"status":"partial","activities":[{"key":"build","status":"failed","attempts":[{"reason_code":"tests_failed"}]}]}' > "$d/part.json"
printf '%s' '{"status":"failed","reason_code":"run_failed"}' > "$d/fail.json"
printf '%s' '{bad' > "$d/broken.json"
printf '%s' '{"passed":true}' > "$d/qa-77.json"
printf '%s' '{"human":{}}' > "$d/commander-77.json"
printf '%s' '{"pending":true}' > "$d/pr-sync-pending.json"
printf '%s' '{"attempts":[{"result":"push_failed"},{"result":"pushed"}]}' > "$d/cifix-77.json"
before=$(ls -1 "$d" | sort)
printf 'BEFORE\n%s\n' "$before"
j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n' "$j"
printf '%s\n' "$j" | jq -e 'length==8 and (map({key:.task_id,value:.})|from_entries) as $r | $r.run.status=="running" and $r.ok.status=="completed" and $r.ok.ci_fix=={"attempts":2,"last_result":"pushed"} and $r.part.status=="partial" and $r.part.failed_activity=="build" and $r.part.reason_code=="tests_failed" and $r.fail.status=="failed" and $r.fail.reason_code=="run_failed" and (["broken","qa-77","commander-77","pr-sync-pending"]|all(. as $k|$r[$k].status=="unreadable")) and ($r["cifix-77"]==null)' >/dev/null
t=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d")
printf '%s\n' "$t"
printf '%s\n' "$t" | grep -q 'ok  completed.*ci_fix=2次 last=pushed'
after=$(ls -1 "$d" | sort)
printf 'AFTER\n%s\n' "$after"
test "$before" = "$after"
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["running","completed","partial","failed","unreadable","qa-*.json","commander-*.json","pr-sync-pending.json","不能据此删除文件","ci_fix","last_result"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
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
[{"task_id":"pr-sync-pending","mtime":"2026-10-16T17:21:45.710Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"commander-77","mtime":"2026-10-16T17:21:45.710Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"qa-77","mtime":"2026-10-16T17:21:45.710Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"broken","mtime":"2026-10-16T17:21:45.710Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"fail","mtime":"2026-10-16T17:21:45.710Z","status":"failed","failed_activity":null,"reason_code":"run_failed","pr_url":null,"ci_fix":null},{"task_id":"part","mtime":"2026-10-16T17:21:45.710Z","status":"partial","failed_activity":"build","reason_code":"tests_failed","pr_url":null,"ci_fix":null},{"task_id":"ok","mtime":"2026-10-16T17:21:45.710Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/77","ci_fix":{"attempts":2,"last_result":"pushed"}},{"task_id":"run","mtime":"2026-10-16T17:21:45.710Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
pr-sync-pending  unreadable  2026-10-16T17:21:45.710Z  failed_activity=- reason_code=-
commander-77  unreadable  2026-10-16T17:21:45.710Z  failed_activity=- reason_code=-
qa-77  unreadable  2026-10-16T17:21:45.710Z  failed_activity=- reason_code=-
broken  unreadable  2026-10-16T17:21:45.710Z  failed_activity=- reason_code=-
fail  failed  2026-10-16T17:21:45.710Z  failed_activity=- reason_code=run_failed
part  partial  2026-10-16T17:21:45.710Z  failed_activity=build reason_code=tests_failed
ok  completed  2026-10-16T17:21:45.710Z  https://github.com/example/repo/pull/77  ci_fix=2次 last=pushed
run  running  2026-10-16T17:21:45.710Z  failed_activity=- reason_code=-
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
```

### T-3
对应: Q-3
verdict: PASS
```command
set -e
d=$(mktemp -d)
trap 'unlink "$d/missing-pr.json"; rmdir "$d"' EXIT
printf '%s' '{"status":"completed"}' > "$d/missing-pr.json"
j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n' "$j"
printf '%s\n' "$j" | jq -e 'length==1 and .[0].task_id=="missing-pr" and .[0].status=="completed" and .[0].reason_code=="pr_url_missing" and .[0].pr_url==null' >/dev/null
t=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d")
printf '%s\n' "$t"
printf '%s\n' "$t" | grep -q '^missing-pr  completed'
if printf '%s\n' "$t" | grep -q 'pr_url_missing'; then exit 1; fi
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["不等于最终合并","pr_url_missing","不能从表格行推断已有有效 PR","gh pr view","headRefOid,state,mergedAt,url","result.runner.phase=merged","result.merge.merged=true","result.qa_state","未证实合并","不手工修改批准、FAIL 记录"])if(!s.includes(x))throw Error(x);console.log("README 文本核对通过")'
```
```output
[{"task_id":"missing-pr","mtime":"2026-10-16T17:21:56.155Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}]
missing-pr  completed  2026-10-16T17:21:56.155Z
README 文本核对通过
```

### T-4
对应: Q-4
场景: 固定基线完整 DAG、逐父 raw diff、最终范围、工作区和全仓未跟踪核对；来源投影的 main SHA 与 HEAD tree 已对照真实 Git。当前工作区 03/04 的删除仅按本轮控制器临时隐藏事实解释。
verdict: PASS
```command
set -e
base=a2b043435339c90b40d6fa0c0df369d15b18eb49
task=352703711ddd49d5fe20d25339b3c0d5280359b4
main=a31d0e477b855e2e71911cb9837bce9b87049c0a
head=c05a1672a10365b548603907c82fe23e2ad2dd9b
test "$(git rev-parse HEAD)" = "$head"
test "$(git rev-parse 'HEAD^{tree}')" = 7afae9c8fdde92fa91e522a500e9d5d86977fc29
test "$(git merge-base "$task" "$main")" = "$base"
printf 'DAG\n'
git rev-list --parents --reverse "$base"..HEAD
printf 'PRODUCT_EDGE\n'
git diff --no-renames --raw "$base" ced3da22fa0f0c591642df26dce257bfa0291469
printf 'REGISTRATION_EDGE\n'
git diff --no-renames --raw ced3da22fa0f0c591642df26dce257bfa0291469 "$task"
printf 'UPSTREAM_EDGE\n'
git diff --no-renames --raw "$base" "$main"
printf 'MERGE_FIRST_PARENT\n'
git diff --no-renames --raw "$task" "$head"
printf 'MERGE_SECOND_PARENT\n'
git diff --no-renames --raw "$main" "$head"
test "$(git diff --name-only "$base" ced3da22fa0f0c591642df26dce257bfa0291469)" = packages/brain/scripts/coding-workflow/runner/README.md
test -z "$(git diff --name-only "$base" "$main" -- packages/brain/scripts/coding-workflow/runner/README.md sprints/10170022-cw-ecd50ab6)"
test -z "$(git diff --unified=0 "$base" "$head" -- packages/brain/scripts/coding-workflow/runner/README.md | awk '/^--- /{next} /^-/{print; exit}')"
printf 'README 基线原行顺序保留\n'
printf 'FINAL_SCOPE\n'
git diff --name-status "$base" HEAD
printf 'STAGED\n'
git diff --cached --name-status
test -z "$(git diff --cached --name-status)"
printf 'WORKTREE\n'
git diff --name-status
test "$(git diff --name-only | sort)" = "$(printf '%s\n' sprints/10170022-cw-ecd50ab6/03-build.md sprints/10170022-cw-ecd50ab6/04-evidence.md | sort)"
printf 'UNTRACKED\n'
git ls-files --others --exclude-standard
test -z "$(git ls-files --others --exclude-standard)"
node -e 'const fs=require("fs");const p=".implementation-source-relations.json";const s=fs.readFileSync(p,"utf8");for(const x of ["packages/brain/scripts/coding-workflow/runner/run-once.mjs","sprints/10170022-cw-ecd50ab6/01-intent.md","sprints/10170022-cw-ecd50ab6/01-invariants.md","sprints/10170022-cw-ecd50ab6/02-spec.md","sprints/10170022-cw-ecd50ab6/03-build.md","sprints/10170022-cw-ecd50ab6/04-evidence.md","documentation"])if(!s.includes(x))throw Error(x);console.log("当前任务来源行存在")'
```
```output
DAG
ced3da22fa0f0c591642df26dce257bfa0291469 a2b043435339c90b40d6fa0c0df369d15b18eb49
352703711ddd49d5fe20d25339b3c0d5280359b4 ced3da22fa0f0c591642df26dce257bfa0291469
a31d0e477b855e2e71911cb9837bce9b87049c0a a2b043435339c90b40d6fa0c0df369d15b18eb49
c05a1672a10365b548603907c82fe23e2ad2dd9b 352703711ddd49d5fe20d25339b3c0d5280359b4 a31d0e477b855e2e71911cb9837bce9b87049c0a
PRODUCT_EDGE
:100644 100644 6e6eb65f6 040c5952d M	packages/brain/scripts/coding-workflow/runner/README.md
REGISTRATION_EDGE
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
UPSTREAM_EDGE
:100644 100644 f60bfebc6 fc5f8d7c5 M	.brain-versions
:100644 100644 675179a88 45128001d M	.implementation-source-relations.json
:100644 100644 f1fdb91ac 7e8796e6b M	DEFINITION.md
:100644 000000 e2de4c900 000000000 D	changes/cp-10162312-source-diagnostics.md
:100644 100644 f2b2fa8f5 fcbe24ac6 M	package-lock.json
:100644 100644 f60bfebc6 fc5f8d7c5 M	packages/brain/VERSION
:100644 100644 8c5ed2d07 aba7d7c77 M	packages/brain/package-lock.json
:100644 100644 cb0cbf263 24f627125 M	packages/brain/package.json
MERGE_FIRST_PARENT
:100644 100644 f60bfebc6 fc5f8d7c5 M	.brain-versions
:100644 100644 645085557 4adb6cf9c M	.implementation-source-relations.json
:100644 100644 f1fdb91ac 7e8796e6b M	DEFINITION.md
:100644 000000 e2de4c900 000000000 D	changes/cp-10162312-source-diagnostics.md
:100644 100644 f2b2fa8f5 fcbe24ac6 M	package-lock.json
:100644 100644 f60bfebc6 fc5f8d7c5 M	packages/brain/VERSION
:100644 100644 8c5ed2d07 aba7d7c77 M	packages/brain/package-lock.json
:100644 100644 cb0cbf263 24f627125 M	packages/brain/package.json
MERGE_SECOND_PARENT
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
README 基线原行顺序保留
FINAL_SCOPE
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
STAGED
WORKTREE
D	sprints/10170022-cw-ecd50ab6/03-build.md
D	sprints/10170022-cw-ecd50ab6/04-evidence.md
UNTRACKED
当前任务来源行存在
```

### T-5
对应: Q-4
场景: 临时仓库中上游曾改 README，合并后恢复原文；即使最终 diff 为空，仍须从历史与第一父边拒绝归属。
verdict: PASS
```command
set -e
d=$(mktemp -d)
trap 'python3 -c "import shutil,sys;shutil.rmtree(sys.argv[1])" "$d"' EXIT
git init -q -b task "$d"
git -C "$d" config user.name QA
git -C "$d" config user.email qa@example.invalid
printf '原文\n' > "$d/README.md"
git -C "$d" add README.md
git -C "$d" -c core.hooksPath=/dev/null commit -qm baseline
b=$(git -C "$d" rev-parse HEAD)
git -C "$d" branch upstream
printf '任务文件\n' > "$d/task.txt"
git -C "$d" add task.txt
git -C "$d" -c core.hooksPath=/dev/null commit -qm task
git -C "$d" switch -q upstream
printf '上游改文\n' > "$d/README.md"
git -C "$d" add README.md
git -C "$d" -c core.hooksPath=/dev/null commit -qm upstream
u=$(git -C "$d" rev-parse HEAD)
git -C "$d" switch -q task
p=$(git -C "$d" rev-parse HEAD)
git -C "$d" -c core.hooksPath=/dev/null merge --no-ff -qm sync upstream
m=$(git -C "$d" rev-parse HEAD)
git -C "$d" show "$b:README.md" > "$d/README.md"
git -C "$d" add README.md
git -C "$d" -c core.hooksPath=/dev/null commit -qm restore
printf 'DAG\n'
git -C "$d" rev-list --parents --reverse "$b"..HEAD
printf 'MERGE_FIRST_PARENT\n'
git -C "$d" diff --no-renames --raw "$p" "$m"
printf 'UPSTREAM_HISTORY\n'
git -C "$d" diff --no-renames --raw "$b" "$u" -- README.md
printf 'FINAL_DIFF\n'
git -C "$d" diff --no-renames --raw "$b" HEAD -- README.md
test -z "$(git -C "$d" diff --no-renames --raw "$b" HEAD -- README.md)"
test -n "$(git -C "$d" diff --no-renames --raw "$p" "$m" -- README.md)"
test -n "$(git -C "$d" diff --no-renames --raw "$b" "$u" -- README.md)"
printf '反例判定：最终相同，但上游和合并第一父均触碰 README；拒绝归属\n'
```
```output
DAG
1437f2aacc09981e2e6c2718dfe5448ea546119f 82e6414789197f75207b4e8d46af71e395d6d0cd
4bfc717b0cfe8587b8e8203aa359504e9d2fc728 82e6414789197f75207b4e8d46af71e395d6d0cd
c66cb455dae3738b9c3ace4926eb1b9939b6b7a2 4bfc717b0cfe8587b8e8203aa359504e9d2fc728 1437f2aacc09981e2e6c2718dfe5448ea546119f
eac7ed32c295c5baef83ae41031aa712fb6bd31a c66cb455dae3738b9c3ace4926eb1b9939b6b7a2
MERGE_FIRST_PARENT
:100644 100644 9c08d57 eef35a7 M	README.md
UPSTREAM_HISTORY
:100644 100644 9c08d57 eef35a7 M	README.md
FINAL_DIFF
反例判定：最终相同，但上游和合并第一父均触碰 README；拒绝归属
```

### X-1
对应: Q-1
场景: 探索空但存在的回执目录，确认与不存在目录一样有可理解的空结果。
verdict: PASS
```command
set -e
d=$(mktemp -d)
trap 'rmdir "$d"' EXIT
j=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d" --json)
printf '%s\n' "$j"
test "$j" = '[]'
t=$(node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$d")
printf '%s\n' "$t"
printf '%s\n' "$t" | grep -q '没有运行记录'
```
```output
[]
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.1NQjVTWOd7）
```


### T-6
对应: Q-4
场景: 直接读取固定基线 README，并断言该基线到 HEAD 的零上下文差异没有删除任何原行。
verdict: PASS
```command
set -e
base=a2b043435339c90b40d6fa0c0df369d15b18eb49
printf 'BASE_README_HEAD\n'
git show "$base:packages/brain/scripts/coding-workflow/runner/README.md" | sed -n '1,5p'
printf 'README_REMOVED_LINES\n'
removed=$(git diff --unified=0 "$base" HEAD -- packages/brain/scripts/coding-workflow/runner/README.md | awk '/^--- /{next} /^-/{print}')
printf '%s\n' "$removed"
test -z "$removed"
printf '基线原行无删除，顺序保留\n'
```
```output
BASE_README_HEAD
# Coding workflow runner 常驻运行交接

本手册只描述现有 system LaunchDaemon 的安装、无领单检查和故障判读。下列路径是示例，执行前须以实际运行用户、订阅账号、专用 clone 和已安装 plist 为准。本次手册验收不安装或启用服务，不领单，不启动浏览器，不操作生产 Brain。

## 安装前核对
README_REMOVED_LINES

基线原行无删除，顺序保留
```


### T-7
对应: Q-4
场景: 将同步后的上游非任务路径与真实 main 提交逐 blob/mode 对照，并将本任务 README 与已登记报告对照同步第一父。
verdict: PASS
```command
set -e
main=a31d0e477b855e2e71911cb9837bce9b87049c0a
task=352703711ddd49d5fe20d25339b3c0d5280359b4
git diff --quiet "$main" HEAD -- .brain-versions DEFINITION.md changes/cp-10162312-source-diagnostics.md package-lock.json packages/brain/VERSION packages/brain/package-lock.json packages/brain/package.json
printf '上游非任务路径 blob/mode 与 main 相同，含删除\n'
git diff --quiet "$task" HEAD -- packages/brain/scripts/coding-workflow/runner/README.md sprints/10170022-cw-ecd50ab6
printf '本任务 README 与已登记报告 blob/mode 与第一父相同\n'
```
```output
上游非任务路径 blob/mode 与 main 相同，含删除
本任务 README 与已登记报告 blob/mode 与第一父相同
```

