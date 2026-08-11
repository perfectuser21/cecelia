# Green Evidence — 合并权收归单一裁决闸

## 通道 1 脚本决策三态（sprints/.../tests/decision-check.sh）
PASS owned→SKIP: SKIP: harness-owned PR（Brain 归属求证 owned:true，PR #4755），跳过 CI 通用 auto-merge，交给 kernel mergeGate（evaluate+judge）处理 merge
PASS not_owned→MERGE: MERGE
PASS 非cp-*→SKIP: SKIP: 非 cp-* 分支（feature/manual-branch），不走通用 auto-merge
OK: 决策三态（owned→SKIP / not_owned→MERGE / 非cp-*→SKIP）

## 通道 1 脚本 fail-closed 三态（sprints/.../tests/failclosed-check.sh）
PASS fail-closed[5xx]: SKIP:fail-closed(Brain 归属端点非 200: 500，按 harness-owned 处理，交 kernel mergeGate)
PASS fail-closed[badjson]: SKIP:fail-closed(Brain 归属响应缺 owned 字段/非法 JSON，按 harness-owned 处理，交 kernel mergeGate)
PASS fail-closed[timeout]: SKIP:fail-closed(Brain 归属求证失败/超时 curl_exit，按 harness-owned 处理，交 kernel mergeGate) url=http://brain.invalid/api/brain/harness/pr-ownership?pr_number=4755
OK: fail-closed 三态（5xx/非法 JSON/超时）均 SKIP

## 永久回归：should-auto-merge.test.sh（决策+fail-closed+结构）
PASS: Brain owned:true（harness-owned）→ 跳过 auto-merge
PASS: Brain owned:false（手动 /dev）→ 正常 auto-merge
PASS: 非 cp-* 分支 → 跳过 auto-merge
PASS: fail-closed: Brain 5xx → SKIP
PASS: fail-closed: 非法 JSON → SKIP
PASS: fail-closed: curl 超时 → SKIP
PASS: auto-merge step 以 $PR_NUMBER 调脚本（Brain 求证归属）
PASS: auto-merge 可越过 needs 链中的 skipped jobs
PASS: auto-merge 排队等待全部分支保护条件
PASS: auto-merge job 具备最小写权限

Results: PASS=10 FAIL=0

## kernel-handlers vitest（B-07/INV-5，含新增置闸断言）

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  04:43:38
   Duration  651ms (transform 80ms, setup 0ms, collect 176ms, tests 22ms, environment 0ms, prepare 126ms)


## INV-1 mergeGate judge_verdict_missing
allow=false reason=judge_verdict_missing

## harness-judge smoke
✅ harness-judge 裁决闸 smoke 通过（归属端点 + 脚本求证 + ci PR_NUMBER + kernel 置闸）

> 端点 B-01/B-02/B-03/B-06 与 E2E 需真 Brain+Postgres，由 CI dod-behavior-dynamic 与 brain-integration（真 PG）+ evaluator final-e2e 执行；本地已离线校验归属正则前缀不误命中。
