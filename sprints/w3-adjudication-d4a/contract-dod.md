# Contract DoD — W3 裁决 API + 聚合分流建任务（D4 后端）

sprint: w3-adjudication-d4a
task_id: 6548d9bf-79ee-440e-bcd9-fbf9dcadf8fa
date: 2026-08-08

## 行为断言（[BEHAVIOR] 条目）

[BEHAVIOR-1] adjudication API 400 校验
- 缺 verdict 字段 → HTTP 400，body.error 含校验失败信息
- 缺 by 字段 → HTTP 400
- 缺 reason 字段 → HTTP 400
- verdict ∉ {绿,红} → HTTP 400
- DB 无任何变更（所有 400 场景均在写库前拦截）
manual:bash: curl -s -w "\n%{http_code}" -X PATCH http://localhost:5221/api/brain/acceptance/runs/__RUN_KEY__/checks/__CHECK_KEY__/adjudicate -H "Authorization: Bearer $ACCEPTANCE_API_TOKEN" -H "Content-Type: application/json" -d '{"verdict":"绿","by":"staff-1"}' | tail -1 | grep -q "^400$" && echo "PASS" || echo "FAIL"

[BEHAVIOR-2] unverifiable_this_version 例外不开 P0
- hard 格且 scenario_class='unverifiable_this_version'，裁决 verdict=绿 → 不建 hard_green_p0 任务
- detail.unverifiable_adjudicated[] 含该 check_key
- 判定通过 yaml 解析的 scenario_class 取，禁止硬编码格号
manual:bash: node -e "
const { rows } = await import('./packages/brain/src/acceptance-adjudication.js').then(m => m.getUnverifiableAdjudicated('__RUN_KEY__', pool));
console.log(rows.length > 0 ? 'PASS' : 'FAIL');
"

[BEHAVIOR-3] 哑火路径不进熔断
- ai_status='dumb' 的 run 调 adjudicate-run → 建 1 个 infra_error P0
- 不建任何 bug/trace/fission 任务
- 路径独立，不触发熔断逻辑（非绿占比检查被跳过）
manual:bash: curl -s -X PATCH http://localhost:5221/api/brain/acceptance/runs/__DUMB_RUN_KEY__/adjudicate-run -H "Authorization: Bearer $ACCEPTANCE_API_TOKEN" -H "Content-Type: application/json" -d '{"by":"adjudicator-1"}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.tasks?.filter(t=>t.payload?.acceptance_bucket==='infra_error').length===1 ? 0 : 1)"

[BEHAVIOR-4] adjudicated/stale 状态 abandon → 409
- status='adjudicated' 的 run 调 abandon → HTTP 409，body.error='cannot_abandon'，body.current_status='adjudicated'
- status='stale' 的 run 调 abandon → HTTP 409，body.error='cannot_abandon'，body.current_status='stale'
- status='pending'/'in_review'/'expired' 的 run 调 abandon → HTTP 200，状态变 abandoned
manual:bash: curl -s -w "\n%{http_code}" -X PATCH http://localhost:5221/api/brain/acceptance/runs/__ADJUDICATED_RUN_KEY__/abandon -H "Authorization: Bearer $ACCEPTANCE_API_TOKEN" -H "Content-Type: application/json" -d '{"reason":"test","by":"user-1"}' | tail -1 | grep -q "^409$" && echo "PASS" || echo "FAIL"

[BEHAVIOR-5] SAVEPOINT 保护 23505 不毒化外层事务
- 同 run_key+bucket 已存在未终态任务 → SAVEPOINT 捕获 23505，不重复建任务
- 外层 run adjudicated 状态正确落库（事务成功提交）
- 外层 API 返回 HTTP 200，无报错
manual:bash: curl -s -X PATCH http://localhost:5221/api/brain/acceptance/runs/__RUN_KEY_WITH_EXISTING_TASK__/adjudicate-run -H "Authorization: Bearer $ACCEPTANCE_API_TOKEN" -H "Content-Type: application/json" -d '{"by":"adjudicator-1"}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(!d.error ? 0 : 1)"

[BEHAVIOR-6] 查重谓词含 acceptance_bucket 维度（两个 bucket 均可独立建出）
- 同 run_key 下 bug 和 trace 两个 bucket 独立存在，互不阻断
- 查重谓词：payload->>'acceptance_run_key' = :run_key AND payload->>'acceptance_bucket' = :bucket AND status NOT IN ('completed','failed','cancelled')
manual:bash: psql $DATABASE_URL -c "SELECT COUNT(DISTINCT payload->>'acceptance_bucket') FROM tasks WHERE payload->>'acceptance_run_key' = '__RUN_KEY__' AND status NOT IN ('completed','failed','cancelled')" | grep -q "2" && echo "PASS" || echo "FAIL"

[BEHAVIOR-7] 正常分流任务 payload 含 anchor 三件套
- 分流建出的每个任务 payload 必须包含 anchor.journey_id、anchor.gp_id、anchor.step_id
- 三个字段均非空字符串
manual:bash: psql $DATABASE_URL -c "SELECT COUNT(*) FROM tasks WHERE payload->>'acceptance_run_key' = '__RUN_KEY__' AND (payload->'anchor'->>'journey_id' IS NULL OR payload->'anchor'->>'gp_id' IS NULL OR payload->'anchor'->>'step_id' IS NULL)" | grep -q "^0$" && echo "PASS" || echo "FAIL"

## 完成标准

- [ ] 所有 [BEHAVIOR-1..7] 的单元测试通过（vitest）
- [ ] 5 条 FR-6 failing test 以独立 commit 先行入库
- [ ] 既有 acceptance*.test.js 全部通过（无回归）
- [ ] DevGate 三项校验通过（facts-check / version-sync / dod-mapping）
- [ ] PR 合并后回写 Brain tasks/{task_id} status=completed
