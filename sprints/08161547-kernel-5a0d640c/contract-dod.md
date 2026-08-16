---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 每条 Run 起手召唤 Commander（Work Router 透传 + F1 默认 hybrid + 真 canary 全程唤醒）

**范围**: POST /tasks 与 Work Router 入口透传 commander_mode/commander_profile/commander_retry_budget；F1 线默认 hybrid + 默认 profile；hybrid 起手召唤 + FR-2 必唤醒节点接线；commander bundle 读闸真实结论；真 canary F1 bugfix run 全程唤醒。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增纯决策模块 commander-routing.js（F1 默认 + 透传校验），导出 resolveCommanderRunConfig / DEFAULT_F1_COMMANDER_PROFILE / F1_JOURNEY_ID
  Test: node -e "const m=require('fs').readFileSync('packages/brain/src/orchestrator/commander-routing.js','utf8');if(!m.includes('resolveCommanderRunConfig')||!m.includes('DEFAULT_F1_COMMANDER_PROFILE'))process.exit(1)"

- [ ] [ARTIFACT] work-routing-store.js 调用 commander-routing 且透传三字段进 payload（禁 mock 边落地）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/work-routing-store.js','utf8');if(!c.includes('resolveCommanderRunConfig')||!c.includes('commander_mode'))process.exit(1)"

- [ ] [ARTIFACT] 真 PG 集成测试落 brain-integration（initiative_runs.commander_mode 写路径，注册进 vitest.config POSTGRES_INTEGRATION_TESTS）
  Test: bash -c 'ls packages/brain/src/__tests__/integration/*commander*run*.pg.integration.test.js >/dev/null 2>&1 && grep -Eq "commander.*run.*pg\.integration" packages/brain/vitest.config.js'

- [ ] [ARTIFACT] Brain semver 四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: bash scripts/check-version-sync.sh

- [ ] [ARTIFACT] decisions 表新增「F1 线默认 hybrid」决策（category=decision，active）
  Test: manual:bash -c 'curl -sf "localhost:5221/api/brain/decisions?status=active" | jq -e "[.[]|select((.title//.decision//\"\")|test(\"F1.*hybrid\"))]|length>=1"'

## BEHAVIOR 条目（五行剧本，evaluator 逐条真实执行）

- [ ] [BEHAVIOR] [L2] B-01: POST /tasks 非法 commander_profile 键返回 400 invalid_commander_profile
  动作: 向 localhost:5221/api/brain/tasks POST 一个带 commander_mode=hybrid 且 profile 含未知键 strict_affinity 的 body
  预期观察: HTTP 400，响应体 error=="invalid_commander_profile"，且该 title 未落 tasks 表
  等待预算: 0s
  留证: /tmp/cp-b01.json（curl -w 的 http_code 与响应体）
  Test: manual:bash -c 'CODE=$(curl -s -o /tmp/cp-b01.json -w "%{http_code}" -X POST localhost:5221/api/brain/tasks -H "Content-Type: application/json" -d "{\"title\":\"cp-b01-$RANDOM\",\"change_kind\":\"bugfix\",\"mutation_intent\":\"write\",\"commander_mode\":\"hybrid\",\"commander_profile\":{\"primary\":{\"provider\":\"codex\",\"account\":\"team2\",\"machine\":\"us-mac-m4\"},\"strict_affinity\":true}}"); [ "$CODE" = "400" ] && jq -e ".error==\"invalid_commander_profile\"" /tmp/cp-b01.json || { echo "FAIL code=$CODE"; cat /tmp/cp-b01.json; exit 1; }'
  期望: OK exit 0

- [ ] [BEHAVIOR] [L2] B-02: F1 线未指定 mode 默认 hybrid + 默认 profile（透传纯函数真调，禁 mock 边）
  动作: 运行 commander-routing 纯决策函数单测（route 与 routing store 共用该函数）
  预期观察: F1 默认 hybrid、非 F1 保持 kernel-only、显式 kernel-only 覆盖、非法键抛 invalid_commander_profile 全绿
  等待预算: 0s
  留证: vitest basic reporter 输出（全 pass）
  Test: manual:bash -c 'npx vitest run sprints/08161547-kernel-5a0d640c/tests/commander-routing-default.test.js --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-03: 起手召唤 + 连续无进展唤醒 + 单次瞬时不唤醒（唤醒决策核，禁 mock）
  动作: 运行 commander-wakeup 唤醒判定单测
  预期观察: run_created 首跳唤醒、同一 gate_verdict 连续 3 跳唤醒 kernel_no_progress、单次 capacity_contended 不唤醒 全绿
  等待预算: 0s
  留证: vitest basic reporter 输出
  Test: manual:bash -c 'npx vitest run sprints/08161547-kernel-5a0d640c/tests/commander-wakeup-gate.test.js --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-04: commander bundle activeRisks 含闸真实结论 + run 隔离回归
  动作: 运行 commander-bundle deriveCommanderRisks + run 隔离单测
  预期观察: activeRisks 含 impact_gate.reason/retryable + admission_reasons + error_code；跨 run 事件被 commander_bundle_run_mismatch 拒
  等待预算: 0s
  留证: vitest basic reporter 输出
  Test: manual:bash -c 'npx vitest run sprints/08161547-kernel-5a0d640c/tests/commander-risks.test.js --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-05: 真 canary hybrid F1 run 落 ≥5 条 commander.directive_accepted（DB 写路径真验，接缝×2）[接缝×2]
  动作: 解析 canary run（CANARY_RUN_ID 或近 3h 最新 hybrid run），查 orchestrator_decision_log
  预期观察: 该 run 的 action=commander.directive_accepted 计数 ≥5（分布在 Run 启动/Planner 完成/合同批准/Generator 前/Evaluator 或 Judge）
  等待预算: 2400s（canary 全程；由 ## E2E 验收 段驱动推进后查询）
  留证: psql 计数输出
  Test: manual:bash -c 'RID=${CANARY_RUN_ID:-$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE commander_mode='"'"'hybrid'"'"' AND created_at > NOW()-INTERVAL '"'"'3 hours'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " ")}; N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='"'"'$RID'"'"' AND action='"'"'commander.directive_accepted'"'"'" | tr -d " "); [ "${N:-0}" -ge 5 ] && echo "OK accepted=$N run=$RID" || { echo "FAIL accepted=${N:-0} run=$RID"; exit 1; }'
  期望: OK accepted>=5

- [ ] [BEHAVIOR] [L2] B-06: 真 canary run 的 harness_attempts role=commander 至少 5 条 completed
  动作: 解析 canary run，查 harness_attempts
  预期观察: role='commander' 且 status='completed' 计数 ≥5
  等待预算: 2400s
  留证: psql 计数输出
  Test: manual:bash -c 'RID=${CANARY_RUN_ID:-$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE commander_mode='"'"'hybrid'"'"' AND created_at > NOW()-INTERVAL '"'"'3 hours'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " ")}; N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM harness_attempts WHERE run_id='"'"'$RID'"'"' AND role='"'"'commander'"'"' AND status='"'"'completed'"'"'" | tr -d " "); [ "${N:-0}" -ge 5 ] && echo "OK commander_completed=$N" || { echo "FAIL commander_completed=${N:-0}"; exit 1; }'
  期望: OK commander_completed>=5

- [ ] [BEHAVIOR] [L2] B-07: 观测端点返回 status 且 event_cursor 单调递增
  动作: 两次调用 GET /api/brain/harness-commander/runs/:runId/commander，间隔 3s
  预期观察: status 非空；第二次 event_cursor ≥ 第一次（不回退）
  等待预算: 10s
  留证: 两次 event_cursor 值
  Test: manual:bash -c 'RID=${CANARY_RUN_ID:-$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE commander_mode='"'"'hybrid'"'"' AND created_at > NOW()-INTERVAL '"'"'3 hours'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " ")}; C1=$(curl -sf "localhost:5221/api/brain/harness-commander/runs/$RID/commander" | jq -r ".event_cursor"); curl -sf "localhost:5221/api/brain/harness-commander/runs/$RID/commander" | jq -e ".status!=null" >/dev/null; sleep 3; C2=$(curl -sf "localhost:5221/api/brain/harness-commander/runs/$RID/commander" | jq -r ".event_cursor"); [ "$C2" -ge "$C1" ] && echo "OK cursor $C1->$C2" || { echo "FAIL cursor 回退 $C1->$C2"; exit 1; }'
  期望: OK cursor 单调

- [ ] [BEHAVIOR] [L2] B-08: 至少一条异常唤醒 directive action ∈ 非 continue_default 集
  动作: 查 canary run 的 orchestrator_decision_log directive action
  预期观察: 至少一条 accepted directive 的 action ∈ {retry_attempt,switch_provider,switch_machine,revise_guidance,pause_run,request_human}
  等待预算: 2400s
  留证: psql 计数输出
  Test: manual:bash -c 'RID=${CANARY_RUN_ID:-$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE commander_mode='"'"'hybrid'"'"' AND created_at > NOW()-INTERVAL '"'"'3 hours'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " ")}; AB=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='"'"'$RID'"'"' AND action='"'"'commander.directive_accepted'"'"' AND detail->'"'"'directive'"'"'->>'"'"'action'"'"' IN ('"'"'retry_attempt'"'"','"'"'switch_provider'"'"','"'"'switch_machine'"'"','"'"'revise_guidance'"'"','"'"'pause_run'"'"','"'"'request_human'"'"')" | tr -d " "); [ "${AB:-0}" -ge 1 ] && echo "OK anomaly=$AB" || { echo "FAIL anomaly=${AB:-0}"; exit 1; }'
  期望: OK anomaly>=1

## Invariant 覆盖条目（历史铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [不绕门禁] Commander directive schema 禁 actor 副作用键，无绕 gate 能力（回归：directive 不含 action/route/command/cwd/session_id 作为可执行副作用被 kernel 直接执行）
  动作: 运行 commander-contract directive schema 既有守卫（本单不放松）
  预期观察: 含 actor 副作用键的 directive 被拒
  等待预算: 0s
  留证: 单测/合约输出
  Test: manual:bash -c 'node -e "import(\"./packages/brain/src/orchestrator/commander-contract.js\").then(m=>{try{m.parseCommanderDirective({schema:\"commander-directive/v1\",run_id:\"11111111-1111-4111-8111-111111111111\",event_cursor:1,action:\"retry_attempt\",reason:\"x\",evidence_refs:[\"event:1\"],command:\"rm -rf\"});console.error(\"FAIL: side-effect key accepted\");process.exit(1)}catch(e){console.log(\"OK rejected\");process.exit(0)}})"'
  期望: OK rejected

- [ ] [BEHAVIOR] [L2] INV-2 [不改执行权] canary run 里出现的 directive 均由 kernel 执行或落 request_human，未见 Commander 直接产生 merge/PR 副作用（回归：无 commander 身份的 merge_pr 决策）
  动作: 查 canary run orchestrator_decision_log，确认无 actor=commander 的 merge_pr/执行类越权记录
  预期观察: commander 只出现 directive_* / failover_* 类 action，无执行类
  等待预算: 2400s
  留证: psql 输出
  Test: manual:bash -c 'RID=${CANARY_RUN_ID:-$(psql "$DB_URL" -tAc "SELECT id FROM initiative_runs WHERE commander_mode='"'"'hybrid'"'"' AND created_at > NOW()-INTERVAL '"'"'3 hours'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " ")}; BAD=$(psql "$DB_URL" -tAc "SELECT count(*) FROM orchestrator_decision_log WHERE run_id='"'"'$RID'"'"' AND action LIKE '"'"'commander.%'"'"' AND action IN ('"'"'merge_pr'"'"','"'"'commander.merge_pr'"'"')" | tr -d " "); [ "${BAD:-0}" = "0" ] && echo "OK no-exec-override" || { echo "FAIL commander exec override=$BAD"; exit 1; }'
  期望: OK no-exec-override

- [ ] [BEHAVIOR] [L2] INV-3 [run 隔离] 不同 run 的合同/反馈不进本 run bundle（buildCommanderBundle 拒跨 run 事件）
  动作: 运行 commander-risks 里的 run 隔离用例
  预期观察: 跨 run 事件抛 commander_bundle_run_mismatch
  等待预算: 0s
  留证: vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/08161547-kernel-5a0d640c/tests/commander-risks.test.js -t "rejects events from a different run" --reporter=basic'
  期望: exit 0

- [ ] [BEHAVIOR] INV-4 [nightly-red 原始日志] N/A：本 sprint 不触及 nightly issue 生成模块（无改动），铁律不受影响
  动作: N/A
  预期观察: N/A
  等待预算: 0s
  留证: N/A
  Test: manual:bash -c 'echo "N/A: nightly issue module untouched"; git diff --name-only HEAD~1 2>/dev/null | grep -qi nightly && { echo "FAIL: 意外改动 nightly 模块"; exit 1; } || echo OK'
  期望: OK
