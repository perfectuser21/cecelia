# Sprint PRD — Diff Impact Gate 透传 reason_code + fail-closed 出口（r19）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness kernel 一类空转死循环，提升自治可信度）

## 背景

issue_ref `runs f62c7e87/d1360a48 deny:impact:mapper_stale 空转`：Diff Impact Gate
（`packages/brain/src/impact-contract/diff-gate.js`）在 Mapper 复算影响半径时，只要
`freshness.status !== 'fresh'` 就一律折叠成 `reason: 'mapper_stale', retryable: true`，
把 Mapper 已给出的**确定性结论**（`freshness.reason_code`，如 scope 无映射 / projection
永久缺失 / unknown 终态）丢弃。下游 `harness-gates.js` gateReceipt 因 `reason` 已被占位
无法恢复真实 code，orchestrator loop（`loop.js:1542`）看到 `retryable !== false` 判成
`infrastructure_blocked` → 反复重派同一角色 → `deny:impact:mapper_stale` 无限空转。
本 sprint 让确定性 Map 结论走 fail-closed 终态出口，只有真正瞬态 stale 才可重试。

## Golden Path（核心场景）

系统从 [orchestrator loop 调 Diff Impact Gate] → 经过 [Mapper 返回确定性非-fresh 结论] →
到达 [任务进入终态 blocked，不再空转]。

具体：
1. loop 在 beforeGenerate/beforeEvaluate/beforeMerge 调 `evaluateDiffGate`，Mapper 返回
   `freshness = { status: 'stale'|'unknown', reason_code: '<确定性终态码>' }`。
2. diff-gate 步骤 3a 不再无脑折叠：**透传** `mapperResult.freshness.reason_code` 到返回体
   的 `reason_code` 字段；当该 code 属于确定性/终态集合（或 `status === 'unknown'`）→
   返回 `retryable: false`（fail-closed 出口）；仅真正瞬态 stale（可自愈刷新）保留
   `retryable: true`。
3. 可观测结果：`gateVerdict` 由 `deny:impact:mapper_stale` 变为 `deny:impact:<真实 reason_code>`；
   `loop.js:1542` 命中 `retryable === false` 分支 → `failure_class = impact_contract_invalid`
   → 任务 blocked 终态，run 不再无限重试。

## 边界情况

- `freshness.reason_code` 为 null / 缺失但 status 非 fresh：无确定性依据 → 保持 `retryable: true`
  的瞬态 mapper_stale 语义（不得因缺 code 而误判终态假 block）。
- `status === 'unknown'`：视为确定性不可判定 → fail-closed（`retryable: false`）。
- 步骤 3b（revision/manifest/projection mismatch）及 Mapper 不可达（`mapper_unavailable`）行为不变，不在本次范围。

## 范围限定

**在范围内**：
- `diff-gate.js` 步骤 3a：透传 `freshness.reason_code` + 按确定性/终态判 `retryable`。
- 保证 `reason_code`/`retryable` 经 `harness-gates.js` gateReceipt 正确抵达 loop。
- 新增 failing→green 回归测试覆盖「确定性结论不空转」。

**不在范围内**：
- 修改 Mapper（`/map/radius`）本身的 freshness 判定逻辑。
- 改动 loop.js failure_class 分类语义（仅复用既有 `retryable===false` 分支）。
- structure-gate / merge-gate 的其它 blocked 分支。

## 假设

- [ASSUMPTION: 确定性/终态 reason_code 判定沿用 loop 既有 `DETERMINISTIC_IMPACT_ERROR_CODES`
  的思路，由 proposer 在合同阶段确定具体码集合；`status === 'unknown'` 恒为终态。]
- [ASSUMPTION: map_repo 未在 payload 提供（map_scope=["F1"]），Unified Map 未配置为本 sprint
  当前地图，scope 锚定改用 task.anchor（gp_id/step_id/journey_id）+ issue_ref。]

## 预期受影响文件

- `packages/brain/src/impact-contract/diff-gate.js`：步骤 3a 透传 reason_code + fail-closed。
- `packages/brain/src/impact-contract/harness-gates.js`：确认 gateReceipt 不覆盖真实 reason_code（如需）。
- `packages/brain/src/impact-contract/__tests__/diff-gate.test.js`：新增确定性结论回归断言。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step+feature 双源均为空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定，沿用 Mapper 既有 timeout）
- 频控: 无
- 版本要求: 无
- 可观测: 确定性 fail-closed 时 gateVerdict/receipt 必须携带真实 reason_code，可在 run 日志追溯

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [fail-closed] Mapper 任何不可判定情形绝不假绿，只能 blocked/impact_unknown（来源: diff-gate 既有原则）
- [nightly-red] 连续 ≥3 晚同一 job 红时，issue 贴失败 step 最后 20 行原始 stdout，不用 PowerShell 截断输出（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（jest + curl/psql）。

```bash
# 占位：proposer 将填入真实脚本（local_api → node --test / jest diff-gate.test.js + 可选 curl localhost:5221）
# 期望验收点（自然语言）：
# 1. 给定 mapperResult.freshness={status:'unknown', reason_code:'<确定性码>'}，evaluateDiffGate 返回
#    reason_code=<该码> 且 retryable=false（fail-closed，非 mapper_stale/retryable:true）。
# 2. 给定 status='stale' 且 reason_code=null（瞬态），仍返回 retryable=true（不误判终态）。
# 3. 经 harness-gates gateReceipt 后 receipt.reason 为真实 reason_code；loop 侧该 receipt 命中
#    retryable===false → failure_class=impact_contract_invalid（终态，不再重派）。
```

## journey_type: autonomous
## journey_type_reason: 改动仅在 packages/brain/ orchestrator + impact-contract 后端，无 UI/远端 agent 协议
## target_environment: local_api
## target_environment_reason: payload.target_environment 显式为 local_api，本地 evaluator 跑 jest + curl localhost:5221
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
