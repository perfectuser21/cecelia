# Sprint PRD — current main 上接管既有 Draft PR #4372 并恢复 F1 等价基线

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

本次为 run `51dace32-5661-41de-8286-15627c87c8ed` 的第二次恢复。目标不是新开分支或新建 PR，而是在 `current main` 上接管并收敛既有 Draft PR `#4372`，把当前主线与 Draft PR 的证据、迁移基线、评估隔离、审批绑定重新拉回可验证状态，恢复 `F1 Golden Path × 11要素` 与旧 Claude Code `P0/P1` 等价基线。

## Golden Path（核心场景）

用户/系统从 [恢复既有 Draft PR #4372] → 经过 [基线证明、数据库隔离预检、全量等价回归] → 到达 [同一最终 PR head SHA 上的评估/裁决/人工审批闭环]

具体：
1. 恢复流程在 `current main` 上接管并收敛既有 Draft PR `#4372`，先证明 `current main 1dc9d410...` 是 merge-base，且所有冲突都已做语义解决，不接受旧 green checks 或旧 contract sha `a5daa66a6` 作为证据。
2. 系统把 migration baseline 锁定为 `366`，并要求 SQL、测试文件名、artifact oracle、task plan、文档口径完全一致；同一隔离 PostgreSQL 数据库内必须连续两次运行 migration `366` 且结果一致。
3. evaluator 在自己的容器内先做数据库可达性与隔离预检：使用 `host.docker.internal` 而不是 `127.0.0.1`，核对 `current_database()` 与 `inet_server_addr()`，且只允许数据库名匹配 `_test` 或 `preview_*`。
4. 在上述前提成立后，系统重跑完整 `F1 Journey` 当前主线等价基线：`S0-S12`、`143` cells、精确 `11` elements、`8` 类 legacy behavior family、contract oracle、integration tests、`7` 个 legacy smokes、endpoint semantics、runtime non-regression、DevGate 与 current-SHA required checks。
5. 最终出口必须保持 PR `#4372` 仍为 Draft 且 `autoMergeRequest=null`，直到 evaluator PASS、judge PASS、human approval 同时绑定同一最终 PR head SHA；任何新 commit 都会使这三类批准全部失效并要求重新验证。

## 边界情况

- 发现 merge-base 不是 `1dc9d410...` 时，本 sprint 仅记录失败证据并停止后续等价回归。
- 任一位置出现非 `366` 的 migration 编号、文件名或文档口径时，视为合同破裂，不接受部分通过。
- evaluator 容器内若数据库地址不可达、指向 `127.0.0.1`、或数据库名不匹配 `_test`/`preview_*`，则必须在预检阶段直接失败。
- 评估、裁决或人工审批引用的 PR head SHA 不一致，或验证后新增 commit，均视为旧批准失效。
- 任何试图复用历史 approval、历史 green checks、历史 contract sha `a5daa66a6` 的路径都不在本次验收内。

## 范围限定

**在范围内**：收敛既有 Draft PR `#4372`；重建 `current main` merge-base 证据；统一 migration `366` 基线；定义 evaluator 容器内数据库预检与隔离门；重跑 `F1 Journey` 当前主线等价回归；明确 Draft/approval/head SHA 绑定规则。
**不在范围内**：创建新的 PR；修改产品行为目标之外的功能扩展；接受旧 run、旧 approval、旧 green checks 作为替代证据；生产数据库变更。

## 假设

- [ASSUMPTION: `task.payload.target_environment=local_api` 仍是本 sprint 的有效执行环境，evaluator 在本地 API/容器组合中完成验证。]
- [ASSUMPTION: `step_id=0cdadc1a-e3a0-46a1-8333-ebbc102883f7` 对应本次 F1 恢复链路的收敛步骤，无需另行改写 Journey 锚点。]
- [ASSUMPTION: Draft PR `#4372` 当前仍为 OPEN Draft，且允许在原 PR 上追加恢复提交。]

## 预期受影响文件

- `database/`: 迁移 `366` 的 SQL 基线与重复运行验证证据
- `tests/`: migration `366`、F1 Journey、legacy smokes、integration tests、contract oracle 的等价基线断言
- `scripts/` 或 `ci/`: evaluator 容器内数据库预检、host.docker.internal 连通性与 current-SHA required checks
- `docs/`、`DoD.md`、`PRD.md`、`TASK-CARD.md`: migration `366` 与审批绑定规则的文档口径对齐
- `.harness/` 或 `sprints/`: contract oracle、task plan、评估证据与 PR `#4372` Draft 绑定约束

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 所有验收证据必须基于 current main 当前 SHA 与 Draft PR #4372 的最终 head SHA，不接受历史 sha
- 可观测: evaluator 预检必须记录 current_database()、inet_server_addr()、目标 DB 名称、PR 最终 head SHA、Draft 状态与 autoMergeRequest=null

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [单槽串行] 一个 slot/会话内严格串行执行任务，恢复 PR #4372 时不得并发推进第二个任务（来源: area）
- [真环境验证] 依赖真实容器/真实数据库连通性的接缝断言，未在目标环境真验前不得判 done（来源: area）
- [禁写死环境] 数据库地址、容器连通方式等环境假设值不得写死，必须以 evaluator 可达的 `host.docker.internal` 为准并真验（来源: area）
- [租户隔离] 涉及数据库读写的验证必须确保隔离，只允许 `_test` 或 `preview_*` 数据库名进入验收（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块保留验收意图，最终命令脚本由 proposer 按 `local_api` 环境细化。

```bash
# 占位：proposer 将按 local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 在 evaluator 自己的容器中验证数据库可达，地址为 host.docker.internal，且 current_database()/inet_server_addr() 与允许名单一致。
# 2. 在同一隔离 PostgreSQL 数据库中连续两次运行 migration 366，SQL、测试文件名、artifact oracle、task plan、文档均只出现 366。
# 3. 证明 current main 1dc9d410... 是 PR #4372 的 merge-base，且当前 PR head SHA 上所有冲突都已语义解决。
# 4. 重跑 F1 Journey S0-S12、143 cells、11 elements、8 legacy behavior families、contract oracle、integration tests、7 个 legacy smokes、endpoint semantics、runtime non-regression、DevGate 与 current-SHA required checks。
# 5. 验证 PR #4372 保持 Draft 且 autoMergeRequest=null；只有 evaluator PASS、judge PASS、human approval 全部绑定同一最终 PR head SHA 时才允许进入后续收口。
```

## journey_type: autonomous
## journey_type_reason: 需求聚焦 Draft PR 收敛、数据库预检、回归基线与评估闸门，属于纯后端/内核恢复链路。
## target_environment: local_api
## target_environment_reason: payload 已显式给出 local_api，验收在本地 evaluator 容器 + localhost Brain/API 上完成。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
