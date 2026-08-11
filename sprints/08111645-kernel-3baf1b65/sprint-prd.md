# Sprint PRD — 迁移扩 failure_class 约束纳入 account_exhausted + 代码↔schema 奇偶回归测试

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（止血 P0：账号轮换/429 配额恢复链路恢复可用）

## 背景

PR #4789 引入 `failure_class='account_exhausted'`（`packages/brain/src/orchestrator/execution-contract.js:147/214`）但未带配套迁移。DB 约束 `harness_attempts_failure_class_check` 仍只允许 4 个旧值，任何 429 配额失败的 attempt 回调落库即违反约束（23514），Brain 500 拒收，runner 容器无限重试（实证 attempt a17d61ac 重试 113+ 次），账号轮换新代码收不到 429 完全失效。生产正在流血（Brain issue：cap修复#4789缺配套迁移 P0）。本 sprint 补齐迁移 + 代码↔schema 奇偶校验回归测试，防止未来枚举再脱钩。

## Golden Path（核心场景）

系统从 [429 配额失败回调落库] → 经过 [DB 约束接受 account_exhausted] → 到达 [derive 用另一账号重试，不再无限重试]

具体：
1. execution-contract.js 把 provider 周限/限流失败判为 `failure_class='account_exhausted'`，attempt 回调发起 UPDATE/INSERT。
2. 迁移后的 `harness_attempts_failure_class_check` 约束接受 `account_exhausted`（同时保留 NULL 与原 4 值），落库成功，Brain 不再 500。
3. 可观测结果：`INSERT ... failure_class='account_exhausted'` 成功；zod 枚举全集逐一被 DB 约束接受（奇偶校验）；未知值仍被拒。

## 边界情况

- 迁移必须幂等：重复执行不报错（`DROP CONSTRAINT IF EXISTS` 后 `ADD`；schema_version `ON CONFLICT DO NOTHING`）。
- NULL 与原 4 值（infrastructure_blocked / semantic_refusal / runner_failure / needs_context）必须继续被接受。
- 未知/非法 failure_class 仍必须被约束拒绝（负例）。

## 范围限定

**在范围内**：
- 新增迁移：`ALTER harness_attempts_failure_class_check`，追加 `account_exhausted`。
- 复现 failing test（迁移前红 / 迁移后绿）+ 代码↔schema 奇偶校验回归测试（枚举 zod `failure_class` 全集逐一断言 DB 约束接受），永久入 CI。
- 若仓库有 schema 版本要求则同步 `selfcheck.js` EXPECTED_SCHEMA_VERSION。

**不在范围内**：
- 不改 `execution-contract.js` / `derive.js` 的分类或 derive 逻辑（只加迁移与测试）。
- 不改账号轮换/重试策略本体。

## 假设

- [ASSUMPTION: 迁移目录为 `packages/brain/migrations/`，编号顺延（下一号 = 406）；测试放 `packages/brain/src/__tests__/`。]
- [ASSUMPTION: 奇偶校验的 zod 枚举全集 = {infrastructure_blocked, semantic_refusal, runner_failure, needs_context, account_exhausted}（execution-contract.js:142-147）。]
- [CONCERN: base_sha 2a98c02ba 的 HEAD 提交 #4798「fix(kernel): allow account exhaustion callback recovery」似乎已落地本 sprint 全部产出——`packages/brain/migrations/406_harness_attempt_account_exhausted.sql`、单测 `migration-406-account-exhausted-class.test.js`、集成测试 `migration-406-account-exhausted.integration.test.js`（含迁移前复现红 / 迁移后绿 / 拒未知值三例）、`selfcheck.js EXPECTED_SCHEMA_VERSION='406'` 均已存在。下游 proposer/evaluator 应先核对是否为幂等重跑；若已合并则本 sprint 应收敛为回归验收（跑测试 + selfcheck 绿），不重复造迁移编号。]

## 预期受影响文件

- `packages/brain/migrations/406_harness_attempt_account_exhausted.sql`：迁移本体（已存在，见 CONCERN）。
- `packages/brain/src/__tests__/migration-406-account-exhausted-class.test.js`：代码↔schema 奇偶校验单测（已存在）。
- `packages/brain/src/__tests__/integration/migration-406-account-exhausted.integration.test.js`：真库复现红/绿 + 拒未知值集成测试（已存在）。
- `packages/brain/src/selfcheck.js`：EXPECTED_SCHEMA_VERSION 同步（已为 '406'）。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（golden-path + ability 双源均为空），PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 无
- 版本要求: schema_version 需推进至 406（EXPECTED_SCHEMA_VERSION 同步）
- 可观测: 迁移前后 INSERT 结果可由 psql 直接观测；奇偶校验测试入 CI 常驻

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [已有PR时钟] 保留 validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 payload 显式 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时可建一次共享 validation clock，缺失/不一致一律拒绝（来源: area）
- （step 级 / journey_feature 级 invariant：本 ability 暂无历史）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史：journey e6f803f2 下 ability 均为 planned 态，无 done/working 已验收 golden_path）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（psql + vitest）
# 期望验收点（自然语言）：
#  1. 迁移前：向 harness_attempts 插入 failure_class='account_exhausted' 被约束拒绝（23514）——复现红。
#  2. 应用迁移 406 后：同一 INSERT 成功落库；重复执行迁移幂等不报错——绿。
#  3. 奇偶校验：遍历 zod failure_class 全集 {infrastructure_blocked, semantic_refusal, runner_failure, needs_context, account_exhausted}，逐一 INSERT 均被 DB 约束接受。
#  4. 负例：未知 failure_class（如 'bogus'）仍被约束拒绝。
#  5. selfcheck EXPECTED_SCHEMA_VERSION 与 DB max(schema_version) 同步（'406'），selfcheck 绿。
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain 后端 DB 迁移 + 后端测试，无 UI/agent 桥/engine 参与，走自治后端验证。
## target_environment: local_api
## target_environment_reason: 验收为本地 evaluator 用 psql + curl localhost:5221 观测 harness_attempts 约束与 selfcheck，无浏览器/Windows/远端部署。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 36121154-5e52-4b20-a2cd-2f415ee72fac
