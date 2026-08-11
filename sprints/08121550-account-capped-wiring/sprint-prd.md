# Sprint PRD — 账号 CAPPED 判定接线：kernel 选号消除双系统裂脑 + seven_day 硬过滤

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除主运行时 429 判死，闲置算力恢复可用）

## 背景

2026-08-11 三条 P0 任务（9b3a2609 / 9806d99a / d33c81ab）全部因 `api_error_status=429`
判死，其中 9b3a2609 跑到 hop 146、烧 $7.75；三者 PR（#4771/#4770/#4775）代码完整、CI 全绿，
仅因 run 死于 429 而缺 evaluator/judge 盖章。同期 account2 的 seven_day 仅 9%~15%，85%+ 额度闲置。
根因：kernel-v1 / fleet-worker 主运行时的派发器从未向 `resolveExecutionTarget` 注入
`is_account_capped` 谓词（`execution-targets.js:58` 注释「消除双系统裂脑」——机制已建但调用方未接线），
`makeCappedCheck` 无注入即恒返回 `() => false`；叠加排序主看 five_hour（被限流账号 five_hour 反降到 0%
显得最空闲），系统持续把任务喂给已打满 seven_day 的账号。

## Golden Path（核心场景）

系统从 [kernel 派发任务] → 经过 [注入 capped 谓词 + 额度感知选号] → 到达 [attempt 落非 capped 账号]

具体：
1. kernel dispatcher 派发一个 task，account1 在 `account_usage_cache` 中 `is_spending_capped=true`
   且 `seven_day=100%`，account2 正常（seven_day 低）。
2. dispatcher 调用 `resolveExecutionTarget` 时从 `account-usage`（`isSpendingCapped` 单一事实源）
   注入 `is_account_capped` 谓词；候选排序把「剩余额度」纳入判据，`seven_day` 利用率作为硬过滤
   （默认 >=95% 视为不可用），`five_hour` 仅作次级排序项。
3. 可观测结果：解析出的 `selectedAccount === 'account2'`，`harness_attempts.account_id` 落 account2；
   谓词未注入/抛错时按 `!capped` 降级（不 crash、不误跳过好账号），fallback/降级路径写 Brain 日志。

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 谓词未注入 / 谓词抛错 → 按 `!capped` 处理，所有账号视为可用，绝不 crash（降级铁律）。
- `seven_day_omelette` 字段缺失 → 不得按 0 当健康；必须以 `seven_day` 利用率兜底硬过滤。
- 显式指定的账号（payload CECELIA_CREDENTIALS）已 capped → 按既有 fallback 轮换并记日志。
- 两个账号 seven_day 均低（均未打满）→ 退化为按 five_hour 升序（既有行为不变）。

## 范围限定

**在范围内**：
- 第 1 环：kernel dispatcher 调 `resolveExecutionTarget` 注入 `is_account_capped` 谓词，数据源 `account-usage`。
- 第 2/4 环：候选排序纳入剩余额度，`seven_day` 硬过滤（阈值可配，默认 >=95%），five_hour 仅次级排序。
- 第 5 环：`harness-skill-relay.js` 构造 `acctOpts` 携带 `task.payload.CECELIA_CREDENTIALS`（若有）。
- 单一事实源：两条路径 capped/额度判定共用 `account-usage`，不各自维护。

**不在范围内**：
- 不改 mergeGate、不改 evaluator/judge 流程、不改 gear 分档。
- 不改 `account_usage_cache` 表结构。
- 不实现「额度耗尽自动降级模型」（属 cascade middleware 职责，本次不含）。

## 假设

- [ASSUMPTION: seven_day 硬过滤阈值默认 >=95% 视为不可用，且可配置（PrepPRD「阈值可配」）。]
- [ASSUMPTION: 单一事实源以 `packages/brain/src/account-usage.js` 的 `isSpendingCapped` 为准；两路径共用。]

## 预期受影响文件

- `packages/brain/src/orchestrator/dispatcher.js`: 调 `resolveExecutionTarget` 时注入 capped 谓词（第 1 环核心）。
- `packages/brain/src/orchestrator/preflight/execution-targets.js`: `expandUnresolvedAccountTargets` 展开后候选按剩余额度排序（第 2/4 环）。
- `packages/brain/src/account-usage.js`: seven_day 硬过滤 + five_hour 次级排序，暴露/共用单一事实源判定。
- `packages/brain/src/harness-skill-relay.js`: `acctOpts` 携带 `task.payload.CECELIA_CREDENTIALS`（第 5 环）。
- `packages/brain/src/orchestrator/preflight/execution-targets-capped.test.js`: 扩充/复用既有 capped 回归测试。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: seven_day 利用率硬过滤阈值默认 >=95% 视为不可用（阈值可配，来源: PrepPRD）
- 版本要求: 无
- 可观测: 谓词降级 / 显式账号已 capped 轮换 / fallback 必须写 Brain 日志（来源: PrepPRD）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本 line 暂无） -->
- [降级铁律] capped 谓词未注入/抛错 → 按 `!capped` 语义安全处理，绝不因取数失败 crash 或误跳过好账号（来源: execution-targets.js 设计契约）
- [validation-clock] evaluator 已有 PR 校验时钟默认 fail-closed，仅 gear=hotfix 且 pr_url/pr_head_sha 与 GitHub 实时一致才建时钟（来源: area）
- [证据排序] evaluator 产 .brain-result.json 必须把一手证据排进 judge 前 8 条×600 字符窗口，否则被证据截断误打回（来源: area）
- [验证命令实跑] 合同验证命令写入前须实跑确认 exit code 语义（vitest 对 include 范围外路径绿态也 exit 1）（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位。最终可执行脚本由 proposer 在 GAN 阶段按 target_environment（local_api）产出：
> curl localhost:5221 + psql，写进 contract-draft.md 的 `## E2E 验收` 区块。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest 单测 + psql 集成）
# 期望验收点（自然语言）：
#  1. 单测(核心红线) account1=CAPPED、account2 正常 → dispatcher 解析 selectedAccount==='account2'（解析出 account1 即失败）
#  2. 单测(降级铁律) 不注入谓词 / 谓词抛错 → 不 crash 且所有账号按可用处理
#  3. 单测(seven_day 硬过滤) seven_day=100%、five_hour=0%、omelette 字段缺失 → 该账号被排除（被选中即失败）
#  4. 单测(次级排序) 两账号 seven_day 均低仅 five_hour 不同 → 按 five_hour 升序（行为不变）
#  5. 单测(人工钉号) payload CECELIA_CREDENTIALS=account2 且可用 → 最终使用 account2
#  6. 集成 以 account_usage_cache 中 is_spending_capped=true 的记录跑一次派发 → harness_attempts.account_id != 被 capped 账号
#  7. 零回归 dispatcher / execution-targets / account-usage 既有单测全绿
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端派发器与选号逻辑，无 UI / 远端 agent 协议 / engine hooks。
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端选号，本地 evaluator 用 vitest + curl localhost:5221 + psql 验证。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
