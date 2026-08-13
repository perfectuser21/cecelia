---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Harness PR 机器身份 + AI 验收前合并硬闸

**范围**: should-auto-merge 机器身份识别；kernel premature_merge fail-closed + 可追责事件；合并唯一权威三闸（同 head_sha）；contract-store 状态分流 + 真实 PostgreSQL 回归；Brain 签发 harness label。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] should-auto-merge.sh 接受第 3 参数 labels，判据不再依赖 feat(harness): 标题前缀
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/should-auto-merge.sh','utf8'); if(/grep -qE .\\^feat\\\\\\(harness\\\\\\):/.test(c)) process.exit(1); if(!/labels|LABELS/i.test(c)) process.exit(1)"

- [ ] [ARTIFACT] ci.yml auto-merge job 把 PR labels 传入 should-auto-merge.sh 第 3 参数
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const m=c.match(/auto-merge:[\\s\\S]*?should-auto-merge\\.sh[^\\n]*/); if(!m||!/labels/i.test(m[0])) process.exit(1)"

- [ ] [ARTIFACT] Brain 编排层给 generator PR 签发 harness label 的专用测试落地（marker Brain 侧签发，runner 只读；避免复用 orphan-pr-worker 的通用 --add-label 造成假绿）
  Test: node -e "const fs=require('fs'); fs.accessSync('packages/brain/src/orchestrator/__tests__/harness-pr-identity.test.js'); const c=fs.readFileSync('packages/brain/src/orchestrator/__tests__/harness-pr-identity.test.js','utf8'); if(!/harness/.test(c)) process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 通用 auto-merge 凭机器身份 SKIP harness PR（RED-A，任意 change_kind）
  动作: 以 (cp-* 分支, "fix(harness): kernel 合并硬闸", labels="harness") 调用 should-auto-merge.sh
  预期观察: stdout 首词为 SKIP（不论标题是 fix/feat/chore(harness)），merge 决定权交还 harness gate
  等待预算: 0s
  留证: 脚本 stdout（含 SKIP 行）
  Test: manual:bash -c 'OUT=$(bash .github/workflows/scripts/should-auto-merge.sh "cp-08131846-6a99f97c" "fix(harness): kernel 合并硬闸" "harness"); echo "$OUT"; echo "$OUT" | grep -qE "^SKIP" || { echo "FAIL: harness 身份未 SKIP"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-02: 普通 /dev PR（无机器身份）仍被正常 MERGE（不误伤 /dev；含反猜测）
  动作: 分别以无 harness label 的 "fix(brain): 修复调度" 与 "fix(harness): 无身份" 调用脚本
  预期观察: 两者 stdout 均为 MERGE（证明既不误拦 /dev，也不再靠标题把 fix(harness) 猜成 SKIP）
  等待预算: 0s
  留证: 两次脚本 stdout
  Test: manual:bash -c 'A=$(bash .github/workflows/scripts/should-auto-merge.sh "cp-08131846-a" "fix(brain): 修复调度" ""); B=$(bash .github/workflows/scripts/should-auto-merge.sh "cp-08131846-b" "fix(harness): 无身份" ""); echo "A=$A B=$B"; echo "$A" | grep -qx MERGE && echo "$B" | grep -qx MERGE || { echo "FAIL: /dev 或反猜测分支未 MERGE"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: auto-merge 判据回归自测全绿（INV-2 守护 + 结构断言）
  动作: 运行 should-auto-merge.test.sh（CI lint-auto-merge-decision job 同款）
  预期观察: 自测输出 Results: PASS=N FAIL=0，覆盖 harness label→SKIP / 无 label /dev→MERGE / 非 cp-*→SKIP / always()/--auto/最小权限
  等待预算: 30s
  留证: 自测 stdout 末行 Results: 计数
  Test: manual:bash -c 'bash .github/workflows/scripts/__tests__/should-auto-merge.test.sh || { echo "FAIL: auto-merge 判据自测未全绿"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: derive() 对「外部已合 + Generator running + 无 Evaluator/Judge」路由 premature_merge（RED-B 纯函数）
  动作: 运行 derive-premature-merge 单测，喂入 pr.merged=true + inflight generator running + evaluateVerdict/judgeVerdict=null 的 observed
  预期观察: derive 返回 {phase:'failed', action:'mark_failed', reason:'premature_merge'}（非现状 pr_merged/done）
  等待预算: 30s
  留证: vitest 通过计数
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/derive-premature-merge.test.js --reporter=dot || { echo "FAIL: derive 未路由 premature_merge"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-05: kernel fail-closed 落库——run/task 不 completed + failure_reason=premature_merge + 可追责事件（RED-B 真 PG）
  动作: 真 Postgres 上构造该场景 run 并跑 kernel 终局，运行 kernel-premature-merge 集成测试
  预期观察: initiative_runs.phase<>'done' 且 failure_reason='premature_merge'、tasks.status<>'completed'、harness_run_events 命中 premature_merge 事件
  等待预算: 60s
  留证: 集成测试内 pg 断言输出 + 通过计数
  Test: manual:bash -c 'cd packages/brain && DATABASE_URL="$DB_URL" DB="$DB_URL" NODE_ENV=test npx vitest run --config vitest.integration.config.js src/orchestrator/__tests__/kernel-premature-merge.pg.integration.test.js --reporter=dot || { echo "FAIL: premature_merge 真 PG 回归未过"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-06: 合并唯一权威三闸——缺验收/stale sha 拒、齐备且同 head_sha 放行（INV-1）
  动作: 运行 gates 单测，覆盖 evaluate/judge 缺失、非 PASS、跨 head_sha（stale）、三闸齐备
  预期观察: mergeGate 分别返回 evaluate_verdict_missing / stale_evaluate_verdict / judge_verdict_missing / stale_judge_verdict / all_gates_passed
  等待预算: 30s
  留证: vitest 通过计数
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/orchestrator/__tests__/gates.test.js --reporter=dot || { echo "FAIL: mergeGate 唯一权威回归未过"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-07: contract-store 状态分流真 PG——draft 换版 / approved 同证据幂等 / superseded·未知 fail-closed
  动作: 真 Postgres 上运行 contract-store 集成测试，覆盖 draft 附着换版、approved 同证据幂等、approved 异证据抛错、superseded/未知态抛错
  预期观察: draft→v2 approved+v1 superseded 原子成功；同证据 approved 幂等返回；异证据/ superseded/未知态一律抛错（禁静默覆盖）
  等待预算: 60s
  留证: 集成测试通过计数（含 superseded/未知 fail-closed 断言）
  Test: manual:bash -c 'cd packages/brain && DATABASE_URL="$DB_URL" DB="$DB_URL" NODE_ENV=test npx vitest run --config vitest.integration.config.js src/orchestrator/__tests__/contract-store.test.js --reporter=dot || { echo "FAIL: contract-store 状态分流真 PG 回归未过"; exit 1; }; echo OK'
