---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 三镜头 capability-controller 挪到四格路由器之前（new_capability 必经）

**范围**: `new_capability` 路由前置三镜头门禁 + postcondition/NFR 三数落 decisions；不动四格分类算法、非 new_capability 路径、三镜头提示词内部、Dashboard。
**大小**: M

## Invariant 覆盖（铁律逐条映射，来源 area）

- INV-1 [planner_role_branch] N/A：本 sprint 不触及 Planner workspace/branch checkout 逻辑（改动在 work-router/capability-gate 运行时路由）。
- INV-2 [generator_retry_identity] N/A：不触及 generator 基础设施失败重试派发。
- INV-3 [brain_url_authority] N/A：不注入/改写 HARNESS_BRAIN_URL；门禁在 Brain 进程内被调用。
- INV-4 [validation_clock] N/A：不触及 validation clock / hotfix gear 逻辑。
- INV-5 [dirty-pr-rebase] N/A：不触及 PR/main 冲突 rebase 路由。

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增门禁模块 capability-gate.js 导出 runCapabilityGate
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/capability-gate.js','utf8');if(!/export\s+(async\s+)?function\s+runCapabilityGate|runCapabilityGate\s*[:=]/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] work-router 侧接线：new_capability 在选 pipeline 前调用门禁（createRoutedTask 生产接线）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/work-routing-store.js','utf8');if(!c.includes('runCapabilityGate'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（autonomous / local_api，五行剧本，内嵌单行 manual: 命令）

- [ ] [BEHAVIOR] [L2] B-01: new_capability 过闸后 decisions 落一句 postcondition + NFR 三数（category=nfr, level=step, target_type=journey_step）
  动作: 用注入的 pass verdict 驱动 runCapabilityGate（new_capability），三镜头产出 postcondition+NFR 三数
  预期观察: decisions 表新增该 step 的 nfr/step/journey_step active 行，context.nfr 含 cost_ceiling/latency_ceiling/success_floor
  等待预算: 0s
  留证: driver stdout（OK pass ...）+ psql 计数输出
  Test: manual:bash -c 'S=b1b1b1b1-0001-0001-0001-000000000001; DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs pass "$S" && C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM decisions WHERE category='"'"'nfr'"'"' AND level='"'"'step'"'"' AND target_type='"'"'journey_step'"'"' AND target_id='"'"'"$S"'"'"' AND status='"'"'active'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C" -ge 1 ] || { echo "FAIL: nfr 行=$C"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-02: context.nfr 三数均为 number（能力验收锚点完整）
  动作: 复用 B-01 落库行，读取最新 nfr decision 的 context.nfr 三数类型
  预期观察: cost_ceiling/latency_ceiling/success_floor 三键均为 JSON number
  等待预算: 0s
  留证: psql jsonb 类型判定输出
  Test: manual:bash -c 'S=b1b1b1b1-0001-0001-0001-000000000001; DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs pass "$S" >/dev/null; psql "$DB_URL" -tAc "SELECT jsonb_typeof(context->'"'"'nfr'"'"'->'"'"'cost_ceiling'"'"')='"'"'number'"'"' AND jsonb_typeof(context->'"'"'nfr'"'"'->'"'"'latency_ceiling'"'"')='"'"'number'"'"' AND jsonb_typeof(context->'"'"'nfr'"'"'->'"'"'success_floor'"'"')='"'"'number'"'"' FROM decisions WHERE target_id='"'"'"$S"'"'"' AND category='"'"'nfr'"'"' ORDER BY created_at DESC LIMIT 1" | grep -qx t || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-03: 三镜头判 reject → fail-closed 拦截，拒绝原因可查，不写 nfr
  动作: 用注入的 reject verdict 驱动 runCapabilityGate（new_capability）
  预期观察: 抛 capability_gate_rejected（reason 含 duplicate），该 step 无 nfr 行，路由不放行
  等待预算: 0s
  留证: driver stdout（OK reject code=... reason=...）
  Test: manual:bash -c 'S=b3b3b3b3-0003-0003-0003-000000000003; DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs reject "$S" && C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM decisions WHERE category='"'"'nfr'"'"' AND target_id='"'"'"$S"'"'"'" | tr -d " "); [ "$C" = 0 ] || { echo "FAIL: reject 却写 $C 行"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-04: postcondition/NFR 三数不完整 → fail-closed（capability_gate_contract_incomplete），不写 nfr
  动作: 用缺 success_floor 的 verdict 驱动 runCapabilityGate（new_capability）
  预期观察: 抛 capability_gate_contract_incomplete，该 step 无 nfr 行
  等待预算: 0s
  留证: driver stdout（OK incomplete code=...）
  Test: manual:bash -c 'S=b4b4b4b4-0004-0004-0004-000000000004; DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs incomplete "$S" && C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM decisions WHERE category='"'"'nfr'"'"' AND target_id='"'"'"$S"'"'"'" | tr -d " "); [ "$C" = 0 ] || { echo "FAIL: incomplete 却写 $C 行"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-05: 非 new_capability（capability_change/bugfix/parameter_only）不触发门禁，四格路由行为不变
  动作: 对 bugfix / parameter_only 请求跑 routeWork，比对 pipeline 与 default_execution_profile
  预期观察: bugfix→pipeline=harness/profile=hotfix-v1；parameter_only→profile=parameter-only-v1；不涉门禁
  等待预算: 0s
  留证: driver stdout（OK regression ...）
  Test: manual:bash -c 'DB_URL="$DB_URL" node sprints/09060615-kernel-aa069d30/gate-e2e-driver.mjs regression'
  期望: OK regression

- [ ] [BEHAVIOR] [L2] B-06: 冻结控制逻辑测试转绿（短路/拦截/落库编排单元验证）
  动作: 跑本 sprint 冻结测试 capability-gate.test.ts（vitest）
  预期观察: 5 个用例全绿（实现前 RED，实现后 GREEN）
  等待预算: 0s
  留证: vitest 报告尾部
  Test: manual:bash -c 'npx vitest run sprints/09060615-kernel-aa069d30/tests/capability-gate.test.ts --reporter=basic 2>&1 | tail -5; npx vitest run sprints/09060615-kernel-aa069d30/tests/capability-gate.test.ts >/dev/null 2>&1'
  期望: exit 0
