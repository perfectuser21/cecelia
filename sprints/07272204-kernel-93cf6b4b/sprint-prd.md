# Sprint PRD — F1 × 11要素账本归位与等价基线 Recovery

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

旧任务 `51836fb2-10ea-48eb-97b2-c324df32d147` 与旧 run `13d41c64-f5f1-4aaf-9487-c2608c3ec990` 已在 2026-07-27 失败收账，失败原因为 `blocked_same_state:BLOCKED`。本次必须以新 task/run 从 current main 对账恢复，同一条 F1 Journey 原位补齐 S0-S12 × 11要素账本，并补回旧 Claude Code P0/P1 等价基线；旧 Draft PR #4372 只作为历史证据，所有 CI、Evaluator、Judge、人审证据都必须重新绑定 current SHA。

## Golden Path（核心场景）

用户/系统从 [已存在的 Cecelia Harness Pipeline F1 Journey] → 经过 [current main 对账、S0-S12 骨干归位、11要素逐格补齐、P0/P1 等价基线重建] → 到达 [同一 Journey 上形成可继续执行的新 head 与 fresh 验收基线]

具体：
1. 任务以新 task、新 run、新 attempts/sessions 启动，并以 current main 作为唯一对账起点，禁止沿用旧失败 run 的完成结论。
2. 系统在既有 F1 Journey 上原位核对并补齐 S0-S12 生命周期与每步 11 要素格子，所有状态只允许来自当前仓库与当前 SHA 证据。
3. 系统把旧 Claude Code P0/P1 守卫逐项映射回同一 Journey 与根 `regression-contract.yaml`，明确 active/shadowed/retired/drifted/unknown 基线，不新增平行 Journey、状态机、账本或 regression SSOT。
4. 在新 head 上重新生成可执行验收链，确保 CI 只产证据，fresh evaluator、independent judge、主理人人审都绑定 current SHA 后，F1 才能继续向 ready/merge 推进。

## 边界情况

- current main 与 Draft PR #4372 产生冲突时，以 current main 为准重新对账，旧 SHA 证据全部失效。
- 发现某个 Step 或 11 要素缺失定义时，允许补齐迁移与映射，但不得借机新建第二条 Journey 或第二本账本。
- 历史合同、CI 记录、审计报告只能作为比对输入；若与 current SHA 证据不一致，必须以 current SHA 重新判色。
- 若某项 P0/P1 守卫无法提供 current SHA 绑定证据，该格子保持 `pending`、`red` 或 `unknown`，不得写成 `green`。

## 范围限定

**在范围内**：current main 对账；既有 F1 Journey 的 S0-S12 归位；11要素格子补齐；旧 Claude Code P0/P1 等价基线重建；fresh evaluator/judge/人审绑定 current SHA 的验收链重建。  
**不在范围内**：新建平行 Journey；新建状态机或行为账本；新增第二份 regression SSOT；修改实际 merge/staging/production 运行时行为；把旧 Draft PR 改为 ready/merge。

## 假设

- [ASSUMPTION: `bb8cc561-b3ee-4fec-b74d-2255694bd963` 即现有 Cecelia Harness Pipeline F1 Journey，需继续沿用而非重建。]
- [ASSUMPTION: `a6888ef3-2482-4655-8703-cf3b9f037cb9` 是本次 Recovery 对应的既有锚点 step，可承接 S0-S12 归位工作。]
- [ASSUMPTION: 本 sprint 主要落在 Brain / Harness 内部账本与验收链，因此 target_environment 仍为 `local_api`。]

## 预期受影响文件

- `packages/brain/src/`: F1 Journey、Kernel Harness、验收链与账本归位逻辑所在主模块
- `packages/brain/src/lib/eleven-elements-ledger.js`: 11要素格子归位与状态口径
- `regression-contract.yaml`: 旧 Claude Code P0/P1 等价基线统一落点
- `docs/current/SYSTEM_MAP.md`: DevOps 七大机制与 F1 Journey 对齐证据
- `tests/`: S0-S12、11要素完整性、单 Journey、不假完成、assertion_ref 存在性验证

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: current main 上的新 head；旧 SHA 的 CI/Evaluator/Judge/人审证据全部失效
- 可观测: CI 只产证据；fresh evaluator、independent judge、主理人人审必须绑定 current SHA；状态判色只认当前仓库证据

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [恢复重跑] watchdog_overdue 标 failed 的 relay run 必须经 orphan requeue 与外部真相核查后从头重跑（来源: area）
- [环境路由] target_environment 必须从 DB `tasks.payload` 读取并保持正确，不得从本地文件猜测（来源: area）
- [失败分支] 遇到返回 null/false 表示失败的契约时必须显式处理失败分支，不能只靠 try/catch（来源: area）
- [报告落账] report 阶段必须真正写入产出物，不能仅凭容器 exit code 0 判定完成（来源: area）
- [点火元数据] headed relay 点火必须带 `base_repo` 或 `pr_url`，并保持分支与任务短 ID 可追溯（来源: area）
- [生成器无合并权] generator 只推分支并报告 ready，merge 权归 controller，不得自行 merge PR（来源: area）
- [CI 共享禁区] 未经合同显式授权不得修改共享 CI 基础设施文件以换取验收通过（来源: area）
- [提前合并防漂移] 任意 evaluator/judge verdict 都必须与实际 head SHA 一致，旧 verdict 不得复用（来源: area）
- [单 slot 串行] 同一 slot 内只允许一个任务状态推进，恢复链不得并发踩同一任务（来源: area）
- [真环境完成] 依赖真实外部状态的接缝断言未真验前不得标 done（来源: area）
- [多租户隔离] 涉及租户数据的查询与写入必须严格按当前租户隔离（来源: area）
- [环境假设] 禁止写死环境假设值，环境差异必须由推导或真实校准解决（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块只框定端到端必须验到的结果；最终可执行脚本由 proposer 按 `local_api` 模板补齐。

```bash
# 占位：proposer 将按 local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 基于 current main 创建新 head 后，F1 仍只有同一条 Journey，未新增平行 Journey/状态机/账本。
# 2. 同一 Journey 上可观察到 S0-S12 骨干与 11 要素格子结构完整，缺口按真实证据判色而非默认绿。
# 3. 根 regression-contract.yaml 可回指旧 Claude Code P0/P1 等价基线，assertion_ref 均指向真实存在的合同或测试。
# 4. 新 head 上的 CI、fresh evaluator、independent judge、主理人人审都绑定 current SHA；旧 SHA 证据不会让任务 ready/merge。
```

## journey_type: autonomous
## journey_type_reason: 本任务是 Cecelia Kernel Harness 的内部恢复与账本归位工作，围绕 Brain/Harness 后端闭环推进，无前端或远端 agent 主路径。
## target_environment: local_api
## target_environment_reason: thin_prd 未指向 playground、dashboard、Windows 或生产服务器，且任务聚焦 Brain/Harness 内部 API 与账本基线，验收应在 localhost:5221 与本地数据面完成。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: a6888ef3-2482-4655-8703-cf3b9f037cb9
