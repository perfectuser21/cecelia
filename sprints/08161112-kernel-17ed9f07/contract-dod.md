---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 每条 Run 起手召唤 Commander（Work Router 透传 + F1 默认 hybrid + 真 canary）

**范围**: POST /tasks + Work Router 透传 commander_mode/commander_profile/commander_retry_budget；F1 线未指定默认 hybrid + 默认 profile；分发层透传 commander_mode → createKernelRun → initiative_runs.commander_mode；起手召唤 + FR-2 必唤醒节点（含同一 gate_verdict 连续≥3 跳、单次 capacity_contended 不唤醒）；commander-bundle activeRisks 看得见闸真实结论 + 跨 run 隔离；一条真 canary 全程事件。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同三红测文件存在且含关键断言
  Test: node -e "const fs=require('fs');for(const f of ['commander-entry-threading','commander-wakeup-nodes','commander-bundle-gates']){const c=fs.readFileSync('sprints/08161112-kernel-17ed9f07/tests/'+f+'.test.ts','utf8');if(!c.includes('commander'))process.exit(1)}"

- [ ] [ARTIFACT] Brain 版本 bump 到 1.274.0（四处同步：package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: node -e "const v=require('./packages/brain/package.json').version;const l=require('./packages/brain/package-lock.json').version;const fs=require('fs');const bv=fs.readFileSync('.brain-versions','utf8').trim().split('\n').pop();const def=/Brain 版本\W+([0-9.]+)/.exec(fs.readFileSync('DEFINITION.md','utf8'))[1];if(!(v===l&&v===bv&&v===def&&v!=='1.273.59'))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash -c 单行命令，autonomous / local_api）

- [ ] [BEHAVIOR] [L2] B-01: 入口透传 + F1 默认 hybrid + 显式 kernel-only + 分发 commanderMode（createRoutedTask/headed dispatch）
  动作: 跑合同 entry-threading 单测（createRoutedTask 带/不带 commander_mode 各 case + 分发层捕获 createKernelRun 入参）
  预期观察: 4 个新行为断言全绿——显式 hybrid 透传 payload.commander/commander_mode；F1 未指定默认 hybrid+默认 profile；显式 kernel-only 不被覆盖；分发层把 payload.commander_mode 传成 createKernelRun.commanderMode
  等待预算: 0s
  留证: vitest 输出末 5 行（含 passed 计数）→ ${SPRINT_DIR}/screenshots/ 不适用，命令输出进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run --config ../../sprints/08161112-kernel-17ed9f07/tests/vitest.config.ts commander-entry-threading'

- [ ] [BEHAVIOR] [L2] B-02: 起手召唤 + 同一 gate_verdict 连续≥3 跳唤醒 + 单次 capacity_contended 不唤醒
  动作: 跑合同 wakeup-nodes 单测（classifyCommanderWakeup 首跳/3 跳无进展/单次抖动 case）
  预期观察: 首跳 run.created 唤醒；recentGateVerdicts 连续 3 同 → wake=true 且 reasons 含 no_progress_stall；单次 capacity_contended → wake=false
  等待预算: 0s
  留证: vitest 输出末 5 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run --config ../../sprints/08161112-kernel-17ed9f07/tests/vitest.config.ts commander-wakeup-nodes'

- [ ] [BEHAVIOR] [L2] B-03: commander-bundle activeRisks 看得见闸真实结论 + 跨 run 隔离
  动作: 跑合同 bundle-gates 单测（coordinator dispatch bundle 的 active_risks 携带 impact_gate/admission/attempt 闸结论；他 run 事件混入被拒）
  预期观察: active_risks 含 deny:impact_unclaimed_files / capacity_floor_reserved / sig-abc-123 / http_503 / infrastructure_blocked；跨 run 事件 → 抛 commander_bundle_run_mismatch
  等待预算: 0s
  留证: vitest 输出末 5 行进 log_tail
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run --config ../../sprints/08161112-kernel-17ed9f07/tests/vitest.config.ts commander-bundle-gates'

- [ ] [BEHAVIOR] [L2] B-04: POST /tasks 非法 commander_profile 键 → 400 invalid_commander_profile（不落库）
  动作: curl 真打 live Brain，POST /api/brain/tasks 带 commander_mode=hybrid + commander_profile 含未知键 strict_affinity
  预期观察: HTTP 400 且 body.error=="invalid_commander_profile"，任务不落库
  等待预算: 0s
  留证: /tmp/b04-badprof.json + http_code 进 log_tail
  Test: manual:bash -c 'curl -s -o /tmp/b04-badprof.json -w "%{http_code}" -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"title\":\"b04 invalid commander profile probe\",\"task_type\":\"harness_initiative\",\"change_kind\":\"bugfix\",\"commander_mode\":\"hybrid\",\"commander_profile\":{\"primary\":{\"provider\":\"codex\",\"account\":\"team2\"},\"strict_affinity\":true}}" | grep -qx 400 && jq -e ".error==\"invalid_commander_profile\"" /tmp/b04-badprof.json'

- [ ] [BEHAVIOR] [L3] B-05: 真 canary run commander_mode 落 hybrid 且 orchestrator_decision_log ≥5 条 commander.directive_accepted [接缝×2]
  动作: 触发/等待真 canary（F1 bugfix hybrid，见 ## E2E 验收 脚本 step 3-6），对最近 3 小时 hybrid run 查 decision log
  预期观察: 该 run initiative_runs.commander_mode='hybrid' 且 action='commander.directive_accepted' 计数 ≥5（分布于 Run启动/Planner完成/合同批准/Generator前/Evaluator或Judge）
  等待预算: 2700s（真 provider 全程；超时=FAIL）
  留证: psql 计数输出进 log_tail + evidence
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log dl JOIN initiative_runs r ON r.id=dl.run_id WHERE r.commander_mode='"'"'hybrid'"'"' AND r.started_at > NOW()-interval '"'"'3 hours'"'"' AND dl.action='"'"'commander.directive_accepted'"'"'" | tr -d " " | awk '"'"'{ok=($1>=5); print "directive_accepted="$1; exit !ok}'"'"''

- [ ] [BEHAVIOR] [L3] B-06: 真 canary harness_attempts role=commander completed ≥5
  动作: 对最近 3 小时 hybrid canary run 查 harness_attempts
  预期观察: role='commander' 且 status='completed' 的 attempt ≥5 条
  等待预算: 0s（B-05 通过后即可查）
  留证: psql 计数输出进 log_tail
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts a JOIN initiative_runs r ON r.id=a.run_id WHERE r.commander_mode='"'"'hybrid'"'"' AND r.started_at > NOW()-interval '"'"'3 hours'"'"' AND a.role='"'"'commander'"'"' AND a.status='"'"'completed'"'"'" | tr -d " " | awk '"'"'{ok=($1>=5); print "commander_completed="$1; exit !ok}'"'"''

- [ ] [BEHAVIOR] [L3] B-07: observation 端点返回 status 且 event_cursor 单调递增
  动作: 取最近 3 小时 hybrid canary run_id，两次 GET /api/brain/harness-commander/runs/:runId/commander
  预期观察: 返回 status(string) 且第二次 event_cursor ≥ 第一次（单调）
  等待预算: 5s
  留证: 两次 event_cursor 值进 log_tail
  Test: manual:bash -c 'RID=$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE commander_mode='"'"'hybrid'"'"' AND started_at > NOW()-interval '"'"'3 hours'"'"' ORDER BY started_at DESC LIMIT 1" | tr -d " "); [ -n "$RID" ] || { echo FAIL_no_canary; exit 1; }; C1=$(curl -sf localhost:5221/api/brain/harness-commander/runs/$RID/commander | jq -er ".status|type==\"string\"" >/dev/null && curl -sf localhost:5221/api/brain/harness-commander/runs/$RID/commander | jq -er ".event_cursor"); sleep 2; C2=$(curl -sf localhost:5221/api/brain/harness-commander/runs/$RID/commander | jq -er ".event_cursor"); echo "cursor $C1 -> $C2"; [ "$C2" -ge "$C1" ]'

- [ ] [BEHAVIOR] [L3] B-08: ≥1 条异常唤醒 directive action ∈ 异常集，被 kernel 执行/记 request_human（门禁不可绕过 INV）
  动作: 对最近 3 小时 hybrid canary run 查 directive detail 的 action
  预期观察: ≥1 条 commander.directive_accepted 的 detail->directive->action ∈ {retry_attempt,switch_provider,switch_machine,revise_guidance,pause_run,request_human}（异常唤醒经 directive-executor 由 kernel 执行，非 Commander 直接副作用）
  等待预算: 0s
  留证: psql 命中计数 + action 明细进 log_tail
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log dl JOIN initiative_runs r ON r.id=dl.run_id WHERE r.commander_mode='"'"'hybrid'"'"' AND r.started_at > NOW()-interval '"'"'3 hours'"'"' AND dl.action='"'"'commander.directive_accepted'"'"' AND (dl.detail->'"'"'directive'"'"'->>'"'"'action'"'"') IN ('"'"'retry_attempt'"'"','"'"'switch_provider'"'"','"'"'switch_machine'"'"','"'"'revise_guidance'"'"','"'"'pause_run'"'"','"'"'request_human'"'"')" | tr -d " " | awk '"'"'{ok=($1>=1); print "exceptional_directives="$1; exit !ok}'"'"''

- [ ] [BEHAVIOR] [L2] B-09: Brain semver 四处同步 + DevGate 三项全过
  动作: 跑 facts-check + check-version-sync + check-dod-mapping
  预期观察: 三个门禁 exit 0，版本四处一致且非旧值 1.273.59
  等待预算: 0s
  留证: 三命令 stdout 末行进 log_tail
  Test: manual:bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs'

## Invariant 覆盖（铁律逐条映射 INV-N 或 N/A）

- INV-1 [门禁不可绕过/kernel唯一执行权] Commander 异常指令经 directive-executor 由 kernel 执行/记 request_human，不直接触发副作用 → 由 B-08 覆盖（异常 directive 落 decision log，非 Commander 直接 mutate）。
- INV-2 [重试身份] retry_of/logical_cycle_id 保持、终态 Attempt 不复活、跨 provider/机器不复用旧 Session ID：N/A 直接新增测——本单不改 commander failover 语义（coordinator failover 现有测试不得回退），仅新增唤醒节点判定；由现有 commander-coordinator.test.js failover 用例守护。
- INV-3 [单槽串行] 单 slot 串行：N/A——本单不改容量/派发并发模型。
- INV-4 [planner分支] planner 绑定 server 签发 role branch：N/A——本单不改 planner 分支绑定，只让首跳 Commander 先于 Planner 派发（顺序，不改分支来源）。
- INV-5 [环境读payload/多租户/凭据/日志脱敏/端点鉴权/租户隔离]：N/A 或既有守护——commander_mode/profile 从 tasks.payload 读（不写死）；profile 经 assertNoSecretMaterial + strict schema（凭据不入 bundle/log）；observation 端点复用现有鉴权/限流，本单不改。

## 禁 mock 边清单（与 contract-draft 同步，generator 违约=CONTRACT-IS-LAW FAIL）

- routes/task-tasks POST ↔ work-routing-store createRoutedTask（route 集成测试真调 store 或 integration 真 PG）
- createRoutedTask ↔ tasks 表 payload（DB 写：真 PG 验 payload.commander_mode，canary/integration）
- 分发层 ↔ createKernelRun（跨模块 commander_mode；单元捕获入参 + canary/integration 真 PG 验 initiative_runs.commander_mode）
- createKernelRun ↔ initiative_runs 表（DB 写 commander_mode 列，真 PG）
- commander-coordinator ↔ commander-wakeup/commander-bundle（跨模块：测试 import 真实模块，仅 mock 外层 store）

需真 PG 的测试放 packages/brain/src/__tests__/integration/（*.integration.test.js / *.pg.integration.test.js），CI brain-integration job 起真 Postgres 跑。
