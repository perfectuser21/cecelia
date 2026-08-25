# Sprint PRD — kernel validation clock 按 fix 轮自动顺延（有界）[r71]

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（kernel 长跑 run 不再被固定 deadline 误杀，减少人工 psql 续命）

## 背景

`resolveValidationClock` 的 pipeline deadline 以最早的 `spawn:generator` 原点起算固定
`timeout_seconds`（默认 5400s）。fix 轮多的 run 在管线仍健康推进（不断派发
`spawn:generator-fix`）时撞死 deadline 被判 `automation_deadline_exceeded`，人工只能 psql
续命（r50/r51 手术实录）。本 sprint 让 clock 随每次 fix 轮派发自动顺延、且有界，杜绝误杀。
第十七次点火：r70 全链通过但死于在途 merge 冲突，本轮基于新 main（1.273.137）干净重跑，已知死因全部已修。

## Golden Path（核心场景）

系统（orchestrator）从 [一个长跑 run 进入 GAN 修复循环] → 经过 [反复派发 generator-fix]
→ 到达 [管线健康推进的 run 不再被固定 deadline 误杀；顺延满 6 次后照常判死]

具体（以 `orchestrator_decision_log` 行 hop 时序为唯一输入，纯函数可重放）：
1. [触发条件] `resolveValidationClock` 收到 validation 类 action，decisionLog 中含 1 个原始
   `spawn:generator` 起点 + N 个 `spawn:generator-fix` 派发成功行（按 hop 升序）。
2. [系统处理] clock 原点取 **最后一次 `spawn:generator-fix`**（而非最早 generator）；
   deadline = 该 fix 行时间 + `timeout_seconds`。顺延次数 = fix 轮数，上限 **6 次**。
3. [可观测结果]
   - 复刻 r50 场景（起点 5400s 前 + 途中多次 fix）：旧实现判死 → 新实现存活（deadline 顺延）。
   - 顺延满 6 次后再撞 deadline：照常返回过期 clock → run 判死（有界）。
   - decisionLog 无任何 `spawn:generator-fix`：语义与现状完全一致（原点 = 首个 generator）。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 无 fix 轮：行为不变（回归现状 = 首个 generator 起点）。
- 恰好第 6 次 fix：仍顺延；第 7 次起不再顺延（原点冻结在第 6 次 fix）。
- fix 行乱序/重复 hop：以 hop 升序取最后一个合法 fix 行，纯函数结果可重放。
- 持久化 clock 校验（`persistedClock`）与新原点一致性：顺延后 detail 仍需自洽，不得破坏现有 `validation_clock_invalid` 断言。

## 范围限定

**在范围内**：
- 仅改 `packages/brain/src/orchestrator/validation-clock.js`（`resolveValidationClock` 顺延逻辑）。
- 新增冻结测试于 `tests/gp/f1/`（真 import validation-clock.js，禁 mock 被改的边）。

**不在范围内**：
- 不改 `timeout_seconds` 默认值（5400s 不动）。
- 不动人审 deadline（`WAIT_HUMAN_REVIEW` / `review_head_sha` 分支）。
- 不改真库 `loop.js` 集成接缝（登记为「未覆盖真实链路清单」，见假设）。

## 假设

- [ASSUMPTION: 顺延上限固定 6 次，超限照常判死（thin_prd 明确）。]
- [ASSUMPTION: 顺延原点取「最后一次 `spawn:generator-fix` 派发成功」行，其 created_at/detail 时序来自 decisionLog。]
- [ASSUMPTION: loop.js 真实链路集成不在本 sprint，登记「未覆盖真实链路清单」交后续 sprint。]

## 预期受影响文件

- `packages/brain/src/orchestrator/validation-clock.js`: 顺延逻辑主体（原点从「最早 generator」改为「最后 fix，有界 6」）。
- `tests/gp/f1/step3-validation-clock-fix-round-extend.test.js`: 新增冻结 RED 测试（文件名避让 main 现存 step3-*，gp-anchor 闸必需）。
- `packages/brain/package.json` + `package-lock.json`: 版本 bump（四处同步）。
- `.brain-versions`: 版本 bump 补录。
- `DEFINITION.md`: 版本 bump 四处之一（如涉及）。
- `sprints/08250940-kernel-r71-validation-clock/**`: 合同四件套（sprint-prd/contract-draft/contract-dod/DoD.md）。
- `sprints/08250940-kernel-r71-validation-clock/DoD.md`: dod 闸必需产物。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（空）+ PrepPRD 显式值优先 -->
- 超时/延迟: timeout_seconds 默认 5400s 不变（PrepPRD 明确）
- 顺延上限: 6 次（PrepPRD 明确，有界）
- 可重放: 纯函数，只依赖 orchestrator_decision_log 行 hop 时序，无 I/O、无时钟旁路
- 可观测: 顺延/判死结果由 clock 返回值体现，不新增副作用

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并（本 journey 三源均空）-->
- （本 line 暂无历史 invariant 记录）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path（本 journey golden-paths 为空）-->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留空占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入。

```bash
# 占位：proposer 将填入 local_api 脚本（vitest 跑 tests/gp/f1/ 冻结测试）
# 期望验收点（自然语言）：
#  1. RED 先行：复刻 r50 场景（起点 >5400s 前 + 途中多次 fix）→ 旧实现判死断言 / 新实现存活断言。
#  2. 负向：顺延满 6 次后照常判死（有界）。
#  3. 负向：decisionLog 无 fix 轮 → 语义与现状完全一致（回归不变）。
#  4. 真 import packages/brain/src/orchestrator/validation-clock.js，无 mock 被改的边。
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/src/orchestrator 纯后端 orchestrator，无 UI/agent 协议/engine。
## target_environment: local_api
## target_environment_reason: 纯函数 + Brain 内部逻辑，验收在本地 vitest 跑冻结测试（无部署/无浏览器）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
