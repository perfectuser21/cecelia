---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Diff Impact Gate 透传 reason_code + 确定性 Map 结论 fail-closed 出口（r19）

**范围**: `diff-gate.js` / `structure-gate.js` 的 mapper_stale 分支透传 `freshness.reason_code` + 确定性→`retryable:false`；`loop.js` receipt 消费按 `retryable` 归 failure_class（确定性→impact_contract_invalid）；确定性 reason_code 白名单在 Gate 侧兜底。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增 `packages/brain/src/impact-contract/mapper-stale.js`：导出 `DETERMINISTIC_STALE_REASON_CODES`（含 `projection_revision_mismatch`、`manifest_projection_mismatch`）与 `classifyMapperStale(freshness)`（返回 `{reason, reason_code, retryable}`）
  Test: node -e "import('./packages/brain/src/impact-contract/mapper-stale.js').then(m=>{if(!m.DETERMINISTIC_STALE_REASON_CODES.has('projection_revision_mismatch')||typeof m.classifyMapperStale!=='function')process.exit(1)})"

- [ ] [ARTIFACT] 新增 `packages/brain/src/orchestrator/impact-block-classify.js`：导出纯函数 `classifyImpactBlockFailureClass(receipt)`（gap_dependencies / impact_contract_invalid / infrastructure_blocked 三态），且 `loop.js` 在 receipt 消费路径（原 L1539-1544）改用该函数
  Test: node -e "import('./packages/brain/src/orchestrator/impact-block-classify.js').then(m=>{if(m.classifyImpactBlockFailureClass({retryable:false})!=='impact_contract_invalid')process.exit(1)})"

- [ ] [ARTIFACT] `diff-gate.js` mapper_stale 分支（原 L202-208）改用 `classifyMapperStale`，返回值含 `reason`/`reason_code`/`retryable`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/diff-gate.js','utf8');if(!c.includes('classifyMapperStale')||!c.includes('reason_code'))process.exit(1)"

- [ ] [ARTIFACT] `structure-gate.js` stale 分支（原 L123-125）改用 `classifyMapperStale`，与 diff-gate 一致透传 reason_code + 确定性判定
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/impact-contract/structure-gate.js','utf8');if(!c.includes('classifyMapperStale'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 确定性 stale diff-gate fail-closed 且携带真实 reason_code（覆盖 Golden Path Step 1-2）
  动作: 注入 mock Map 返回 `freshness={status:'stale',reason_code:'projection_revision_mismatch'}`，调 `evaluateDiffGate`
  预期观察: receipt `gate='impact_unknown'`、`reason='projection_revision_mismatch'`（不再裸 mapper_stale）、`reason_code='projection_revision_mismatch'`、`retryable===false`
  等待预算: 0s
  留证: vitest B-01 输出（PASS 行）
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-01"'

- [ ] [BEHAVIOR] [L2] B-02: 瞬时/缺失/unknown stale diff-gate 保留重试（覆盖 Golden Path Step 2 + 边界情况）
  动作: 依次注入 `reason_code='ttl_exceeded'`、`reason_code=null`、`status='unknown'` 三种 freshness 调 `evaluateDiffGate`
  预期观察: 三者 `retryable===true`；ttl 时 `reason='ttl_exceeded'`；缺失时 `reason='mapper_stale'` 且 `reason_code===null`；unknown 即便码命中白名单仍 retryable
  等待预算: 0s
  留证: vitest B-02 输出
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-02"'

- [ ] [BEHAVIOR] [L2] B-03: structure-gate 同款折叠一致化，与 diff-gate 不分叉（覆盖 Golden Path Step 2 边界「两 Gate 一致」）
  动作: 同一 freshness 输入分别喂 `evaluateStructureGate`（确定性码 + 瞬时码）与共享 `classifyMapperStale`
  预期观察: 确定性 → `gate='blocked'`、`reason='projection_revision_mismatch'`、`reason_code` 透传、`retryable===false`；瞬时 `ttl_exceeded` → `retryable===true` 且 `reason='ttl_exceeded'`；`classifyMapperStale` 三字段与 diff-gate 一致
  等待预算: 0s
  留证: vitest B-03 输出
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-03"'

- [ ] [BEHAVIOR] [L2] B-04: loop 消费——真 gate receipt 直接喂真 classifier 归类 failure_class（覆盖 Golden Path Step 3）
  动作: 把 `evaluateDiffGate` 真实 receipt（确定性 / 瞬时）直接传入 `classifyImpactBlockFailureClass`
  预期观察: 确定性 receipt → `'impact_contract_invalid'`（BLOCKED 终态收口不重派）；瞬时 receipt → `'infrastructure_blocked'`（backoff 重试）；`deny:impact:${det.reason}` === `deny:impact:projection_revision_mismatch`；drift receipt 仍 → `'gap_dependencies'`（既有分支不回退）
  等待预算: 0s
  留证: vitest B-04 输出
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-04"'

- [ ] [BEHAVIOR] [L2] B-05: 回归 f62c7e87/d1360a48——真 radius.js 确定性码不再无限空转（覆盖 Golden Path Step 4 出口）
  动作: 用 `radius.js` 真实确定性码（`projection_revision_mismatch`/`manifest_projection_mismatch`）与瞬时码（`fact_snapshot_stale`）复现历史输入
  预期观察: 每个确定性码 `reason!=='mapper_stale'` 且 `retryable===false` 且分类 `impact_contract_invalid`（不重派）；瞬时码 `fact_snapshot_stale` `retryable===true` 分类 `infrastructure_blocked`（双保险不误伤）
  等待预算: 0s
  留证: vitest B-05 输出
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-05"'

- [ ] [BEHAVIOR] [L2] B-06: packages/brain 既有 gate 套件全绿（含更新后的 structure-gate stale 断言，9.25.0 子 shell 死规则）
  动作: 子 shell cd 进 packages/brain，用包自身 vitest 配置跑 diff-gate/structure-gate/harness-gates 既有套件
  预期观察: 三套件全 PASS；structure-gate.test.js 「reason=mapper_stale」断言已更新为透传后的 `ttl_exceeded`，无遗留旧断言
  等待预算: 0s
  留证: 子 shell vitest 汇总输出
  Test: manual:bash -c '(cd packages/brain && npx vitest run --no-cache ./src/impact-contract/__tests__/diff-gate.test.js ./src/impact-contract/__tests__/structure-gate.test.js ./src/impact-contract/__tests__/harness-gates.test.js)'

## Invariant 覆盖（铁律逐条映射）

- [ ] [BEHAVIOR] [L2] INV-1 [基础设施重试身份]: 瞬时 stale 仍归 infrastructure_blocked，沿用既有重试身份（本 sprint 不改瞬时重试路径）
  动作: 瞬时 receipt 喂 classifyImpactBlockFailureClass
  预期观察: 返回 `infrastructure_blocked`（既有重试语义不变）
  等待预算: 0s
  留证: B-04/B-05 瞬时分支输出
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-05"'

- [ ] [BEHAVIOR] [L2] INV-2 [validation-clock fail-closed]: 非 fresh 一律不放行 + 确定性走 fail-closed 终态，沿用默认 fail-closed 精神
  动作: 确定性 stale 喂 evaluateDiffGate
  预期观察: `gate='impact_unknown'`（绝不 pass/extend）且 `retryable===false`
  等待预算: 0s
  留证: B-01 输出
  Test: manual:bash -c 'npx vitest run sprints/08180424-kernel-c0d4fe12/tests/mapper-stale-fail-closed.test.ts -t "B-01"'

- INV [Planner 分支]: N/A —— 本 sprint 无 Planner workspace / checkout 行为。
- INV [真环境验证才算done]: 接缝=Map 复算的 stale 判定；本 sprint 用真 gate 函数 + 真 classifier 执行验证（Map HTTP 边界注入确定性 freshness，Map 自身不在范围）；无真机接缝，见接缝清单。
- INV [凭据安全]: N/A —— 无凭据/secrets。
- INV [端点鉴权]: N/A —— 无新增/修改 HTTP 端点。
- INV [租户隔离]: N/A —— 无租户数据查询/写入。

## 接缝清单（接缝 vs 逻辑）

| 断言 | 类型 | 验证位置 | done 判定 |
|------|------|----------|-----------|
| classifyMapperStale 确定性/瞬时判定 | 逻辑（环境无关纯函数） | vitest B-01/B-02/B-03 | 绿=真 done |
| gate retryable 透传 + reason_code | 逻辑 | vitest B-01/B-03/B-05 | 绿=真 done |
| loop failure_class 归类 | 逻辑 | vitest B-04 | 绿=真 done |
| Map freshness 输入（Map 复算 stale 结论的真实 reason_code 值域） | 接缝（依赖 Map 侧 radius.js 产出） | 白名单绑定 radius.js 现有码；Map 契约不改，白名单成员由真实 radius.js 码推导 | logic-done；白名单成员对齐 radius.js 源码，非真机接缝 |

本 sprint 全部改动为环境无关决策逻辑，接缝仅为「Map reason_code 值域」——已绑定 `radius.js` 真实源码码值，无真机/生产 env 接缝，故无 logic-done-pending 项。

## notes

- judgment-pending-user: 确定性 stale reason_code 白名单成员（`projection_revision_mismatch` / `manifest_projection_mismatch`）—— 误判后果严重（误判确定性为瞬时=无限空转，误判瞬时为确定性=丢可重试任务），属「升拍板点」级判定，PrepPRD 未逐条拍过；白名单取 radius.js 中「投影/manifest 终态错配」两码，未知码/缺失/unknown 保守当瞬时（有 max_retries 双保险）。若主理人对成员有异议需回 PrepPRD 确认。
- contract-gate: cecelia repo，代码层 Contract Gate 生效（本合同断言按合规惯用法书写，无需 skip 记录）。
- gp-anchor: skipped (product-map.json not found) —— cecelia 仓无 product-map。
- map: [MAP_NOT_CONFIGURED] —— map_scope=["F1"] 但 map_repo 缺失，无 must_run_assertions。
- 无 mock 豁免：本合同无 force_*/stub 假数据顶替真实链路（Map HTTP 边界注入 mock 属 PRD 明确排除范围外的依赖，非真实链路 mock 豁免），N/A。
