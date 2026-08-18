# Sprint PRD — Diff Impact Gate 透传 reason_code + 确定性 Map 结论 fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除一类无限重试空转，提升 Kernel 派发可信度）

## 背景

runs f62c7e87 / d1360a48 出现 `deny:impact:mapper_stale` 空转：Diff Impact Gate 以真实 diff 复算 Map 影响半径时，Map 返回的是一个**确定性结论**（freshness.status !== 'fresh' 且带明确 reason_code，如投影永久落后于已扫描事实、revision 终态错配），但 `diff-gate.js` 把所有非 fresh 情形一律折叠成裸 `mapper_stale` + `retryable: true`，丢弃了 `freshness.reason_code`。loop 消费该 receipt 时按 `retryable: true` 归类为 `infrastructure_blocked` → 任务被无限重派，永远等一个不会变的"事实刷新"。`DETERMINISTIC_IMPACT_ERROR_CODES`（loop.js:84）只守 Map **抛错**路径，从不校验 Gate **返回**的 receipt，故确定性结论逃过 fail-closed 分流。

## Golden Path（核心场景）

系统从 [Kernel 调 Diff Impact Gate 复算] → 经过 [透传 reason_code + 确定性判定] → 到达 [确定性 stale 一次性 fail-closed 收口，不再空转]

具体：
1. [触发] orchestrator 在 beforeGenerate/beforeEvaluate 调 `evaluateDiffGate`，以真实 diff 复算 Map；Map 返回 `freshness.status !== 'fresh'` 且携带确定性 `reason_code`
2. [系统处理] diff-gate 在 mapper_stale 分支**透传** `mapperResult.freshness.reason_code`（不再折叠成裸 `mapper_stale`）；依 reason_code 判定：确定性结论 → `retryable: false`（fail-closed 终态出口），瞬时/`reason_code` 缺失 → `retryable: true`（保留重试）
3. [系统处理] loop 消费 receipt：`retryable === false` 的确定性 stale → `failure_class: impact_contract_invalid`，任务 BLOCKED 收口，不再无限重派
4. [可观测结果] `deny:impact:<reason_code>` receipt 携带真实 reason_code；确定性 Map 结论一次性收口，f62c7e87/d1360a48 类空转不复现；瞬时 stale 仍可正常重试

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- Map 未返回 `reason_code`（字段缺失/为空）→ 保守当瞬时 stale，`retryable: true`，绝不误判为终态而放行或误 block
- `freshness.status === 'unknown'` 与 `=== 'stale'` 区分：unknown 视为瞬时可重试，明确 stale 且带确定性 reason_code 才 fail-closed
- structure-gate.js 同款 `mapper_stale` 折叠须一致处理，避免两 Gate 行为分叉
- 已到 `max_retries` 兜底仍生效，不与本次 fail-closed 出口冲突（双保险）

## 范围限定

**在范围内**：`diff-gate.js` mapper_stale 分支透传 `freshness.reason_code` + 确定性→`retryable:false`；`structure-gate.js` 同类折叠一致化；`loop.js` receipt 消费按 `reason_code`/`retryable` 判 `failure_class`（确定性→`impact_contract_invalid` 不空转）；确定性 reason_code 白名单/判定规则。

**不在范围内**：Map/Mapper 自身 freshness 计算逻辑；gap repair / map_recovery 流程；新增 reason_code 语义的定义（消费既有 Map 输出，不改 Map 契约）；merge gate 主体逻辑。

## 假设

- [ASSUMPTION: Map `/map/radius` 已在 `freshness.reason_code` 中区分确定性 vs 瞬时 stale；本 sprint 只消费不新增语义。若 Map 未产出可区分的 reason_code，则以"确定性判定白名单"在 Gate 侧兜底。]
- [ASSUMPTION: `impact_contract_invalid` 已是 BLOCKED 终态 failure_class，任务据此进人工/repair 而非重派——沿用现有语义。]
- [ASSUMPTION: map_scope=["F1"] 但 payload 未带 map_repo → Unified Map 未配置（not_configured），不做领域猜测。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`: mapper_stale 分支（当前 L202-208）透传 `mapperResult.freshness.reason_code`，确定性结论置 `retryable: false`
- `packages/brain/src/impact-contract/structure-gate.js`: `buildBlockedResult('mapper_stale', 503)`（L124）同步透传 reason_code + 确定性判定，与 diff-gate 一致
- `packages/brain/src/orchestrator/loop.js`: receipt 消费路径（L1441 / L1539-1544）按 reason_code/retryable 归类 failure_class，确定性 stale → impact_contract_invalid 不空转
- `packages/brain/src/impact-contract/__tests__/harness-gates.test.js`: 新增回归——确定性 reason_code → retryable:false fail-closed（bug 复现→修复后永久保留）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空），PrepPRD 未显式给值，以相关 invariant 兜底 -->
- 超时/延迟: 待定（PrepPRD 未指定；沿用现有 Map 客户端 timeout）
- 重试上界: 确定性 Map 结论**必须** fail-closed 一次收口，禁止 retryable:true 无限重派；瞬时 stale 仍受既有 max_retries 兜底
- 可观测: `deny:impact` receipt 必须携带真实 `reason_code`（不得再出现裸 `mapper_stale` 掩盖终态原因）
- 版本要求: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 两源为空；下列为 area 级相关铁律（88 条中筛出相关项，另含 84 条 capture-triage/smoke 自捕获学习未逐条展开） -->
- [基础设施重试身份] Generator 基础设施失败必须重试原始服务端派发动作；重试分类须与失败性质一致（来源: area）
- [validation-clock fail-closed] 默认 fail-closed，仅显式条件下才放行——本 sprint 确定性出口须沿用 fail-closed 精神（来源: area）
- [Planner 分支] Planner workspace 必须在服务端签发的 planner_branch 上，Provider 不得自行 checkout/switch（来源: area）
- [真环境验证才算done] 依赖真目标的接缝断言必须真验过才算 done，未真验只能 logic-done-pending（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + Node 单测注入 mock Map）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#  1) 注入 mock Map 返回 { freshness:{ status:'stale', reason_code:'<确定性码>' } } → evaluateDiffGate 返回的 receipt 携带该 reason_code 且 retryable===false（fail-closed）
#  2) 注入 mock Map 返回 { freshness:{ status:'stale', reason_code:null } } 或 status:'unknown' → receipt retryable===true（瞬时，保留重试）
#  3) loop 消费①的 receipt → gateVerdict=deny:impact:<reason_code>，failure_class=impact_contract_invalid，任务 BLOCKED 不再重派
#  4) 复现回归：模拟 run f62c7e87/d1360a48 输入，确认不再出现 deny:impact:mapper_stale 无限空转
```

## journey_type: autonomous
## journey_type_reason: 改动全在 packages/brain（impact-contract Gate + orchestrator loop），纯后端调度/决策，无 UI 无远端 agent 协议
## target_environment: local_api
## target_environment_reason: payload 显式 target_environment=local_api；本地 evaluator 用 curl localhost:5221 + Node 单测注入 mock Map 验证
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
