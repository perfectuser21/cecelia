# Sprint PRD — 统一 Work Router 与 Kernel Harness 生产恢复

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：完成统一路由、治理门禁与真实验收，使 coding mutation Harness 覆盖率达到 100%

## 背景

当前 coding 创建与执行入口分散，仍可能绕过 Kernel Harness；前序恢复又暴露了含凭据 origin 被误判孤儿、日志泄密、活跃 Kernel 工作区被删除，以及 Impact Contract 缺失等生产故障。本 Sprint 交付统一 Work Router，并严格完成批准设计的 Knife 0–5 与五个 Workstream。

## Golden Path（核心场景）

有头或无头 coding mutation 从任一入口进入 → 获得不可变 Routing Receipt → 统一进入 Kernel Harness 2.0 → 读取 fresh Universal Map 并建立 Impact Contract → 按四档 change_kind 正向选择阶段 → 经 Generator、语义 Evaluator、Judge 与真实验收后交付。

具体：
1. 任一任务创建入口提交工作请求；coding 写入被规范化为 `coding_mutation`，原子生成 `harness_initiative` 与不可变 Routing Receipt，content、research、operations、只读 review 保持各自 Pipeline。
2. 有头 mutation-capable tool 在动作前、无头 executor 在派发前验证同一 receipt；缺失、过期、被取代、字段不一致或 Brain 不可达均失败关闭并记录稳定 reason code。
3. Kernel Harness 每次读取目标 repo 的 fresh Universal Map，建立 revision-locked Impact Contract；missing、stale、invalid revision/scanner、跨 repo 污染或合同缺失时不得进入 Provider。
4. `new_capability`、`capability_change`、`bugfix`、`parameter_only` 只按已声明 change_kind 正向映射默认 profile；允许有审计证据的升档，禁止降档或从 gear/stage/task type 反推。
5. Generator 在 frozen baseline 与隔离 trust boundary 内只产生本地提交；Evaluator 按批准 PRD、合同、实际 diff 和真实产出做语义验收，Judge/merge fence 后才由受信任 transport 发布。
6. scratch 从 API、Intent、Capture 三个真实入口创建 coding mutation，均可查到 receipt、正确 repo Map、active Impact Contract 与 Harness run；stale Map 阻断且刷新后保留失败审计并恢复。

## 完成定义（≤8 条）

1. RED/GREEN 永久覆盖：含凭据 origin 被规范化比较且日志脱敏，活跃 detached Kernel 工作区不被清理。
2. 四档 change_kind、Routing Receipt、事务创建、70 个 task type 单一事实源与冻结入口 inventory 均有机器合同。
3. 全部可执行业务建任务入口收敛到唯一创建边界；三个已知 Planner/Proposal/Capture schema 陷阱永久回归。
4. 所有新 coding run 强制 fresh Map、active Impact Contract、Structure/Diff Gate，`legacy_exempt` 新增量为 0；map_recovery 仅在窄合同内可用。
5. 有头动作闸与无头 Dispatcher 闸均验证 live receipt；CI/merge fence 仅作纵深兜底。
6. 所有 Generator run 强制 frozen-baseline lineage、pushurl 熔断、非特权身份与 Brain/lease 凭据移除，容器内 hook 真实生效。
7. scratch 多入口与 content/research/review 对照、stale/resume、bootstrap、真实容器产出均通过并查库留证。
8. 四条 required command evidence 全部 exit 0，独立 Evaluator/Judge 完成语义验收。

## 边界情况

- repo 未知或不唯一、Map/Impact Contract 不可用、receipt 无效、入口枚举未知均失败关闭，不默认 Cecelia、不改 payload 自救。
- map/scanner/projection 自修复仅接受合法 `bugfix`、稳定故障码、冻结 allowlist、一次性未过期合同；正常 Map 或业务越界 diff 一律拒绝。
- 只读 review 不获得写权限；若发现需修改仓库，派生新的 coding mutation。
- 运行中旧 attempt 不切换执行模型；新重试或派生任务必须走新路由并保留历史。

## 范围限定

**在范围内**：Recovery RED/GREEN 前置；Knife 0–5；五个 Workstream；所有任务创建入口；Routing Receipt；Map/Impact Contract；四档 profile；有头/无头动作闸；Generator trust boundary；旧任务 dry-run 迁移；scratch 真实验收；Brain 版本与 DEFINITION 同步。

**不在范围内**：重写 Harness 内部状态机；把约 70 个 task type 变成平级顶层入口；把只读审查或内容创作塞入 Coding Harness；普通任务使用 `legacy_exempt`；未经批准的生产数据直改。

## 假设

- [ASSUMPTION: PrepPRD 已由用户和架构审核批准，Knife 0–5 与五个 Workstream 是不可缩减范围。]
- [ASSUMPTION: task payload 的 `gp_anchor=factory/F1/step-1` 对应 step_id `3bf6c116-169c-46ec-bc7c-b335a22f80ec`。]
- [ASSUMPTION: local_api 的验证真相由真实 PostgreSQL、临时 Git repo、容器命令链、Brain API 与进程退出码共同构成，不以 CI 绿灯替代。]

## 预期受影响文件

- `packages/brain/src/`、`packages/brain/migrations/`：统一路由、不可变 receipt、入口收敛、Map/Impact 与 Dispatcher 合同。
- `packages/engine/hooks/`、`packages/engine/skills/dev/scripts/`：有头动作前 receipt 闸与 dev lock 合同。
- `docker/cecelia-runner/entrypoint.sh`：Generator frozen baseline 与 trust boundary。
- `packages/brain/scripts/smoke/unified-work-router-smoke.sh`：scratch 多入口真实验收。
- `apps/dashboard/src/pages/warroom/`：路由与治理状态审计视图。
- `packages/brain/DEFINITION.md`、版本文件：Brain 行为定义与版本同步。

## NFR 约束

<!-- 来源: PrepPRD 主源 + decisions category=nfr 副源；副源为空 -->
- 安全：receipt 不可变；凭据不进代码、git 或日志；Provider 无 push/Brain callback 能力；未知 coding mutation 按 write 处理并失败关闭。
- 一致性：同一请求与 router version 得到确定性结果；task 与 receipt 原子同生同灭；重路由以新 receipt 留链。
- 可观测：稳定 reason code 与 work_routed/work_route_blocked/route_violation/map_preflight_failed/impact_contract_created 等事件可查询。
- 兼容与性能：PrepPRD 未指定数值阈值；不得以未声明阈值替代真实验收。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 id 去重；以下为与本 Sprint 直接作用的 area 铁律 -->
- [基线血统] 冻结实现基线始终为 `310ab9e704d4e3f866e6ce7beb25b79dd0f9d524`；它是产出 HEAD 的祖先而非完成态 HEAD，验收用 `git merge-base --is-ancestor`（来源: PrepPRD）
- [修复时序] 每项先保留可复现失败的 RED commit，再追加 GREEN commit；禁止压掉 RED/GREEN 历史（来源: PrepPRD）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容与 Git origin 凭据不得明文进入日志（来源: area）
- [租户隔离] 涉及租户的查询和写入必须限定当前租户，测试默认至少两个租户且互不串（来源: area）
- [端点鉴权] 每个 API 端点必须鉴权，无鉴权端点不得交付（来源: area）
- [真环境验证] 依赖真实数据库、Git、容器或调用方的接缝必须在目标环境验证后才算 done（来源: area）
- [单槽串行] 一个 slot 同时只推进一个任务；任务内只读可扇出，但写代码实现者同一时刻只有一个（来源: area）
- [验证时钟] validation clock 默认 fail-closed；仅满足既定 existing-PR hotfix 合同才可由首个 Evaluator 建立并供 Judge 复用（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 须把下列真相翻译成可执行 local_api 脚本：
# 1) 先执行 Recovery RED/GREEN 回归，再在 cecelia_scratch 从 API、Intent、Capture 建三项 coding mutation并查库。
# 2) 验证 receipt/Harness/Map/Impact Contract；制造 stale Map 阻断 Provider，刷新后恢复且保留失败审计。
# 3) 验证 baseline 是 HEAD 祖先，且 Receipt/Map/Impact 的 base_sha/source_revision 精确等于 310ab9e704d4e3f866e6ce7beb25b79dd0f9d524。
# 4) 实跑 required command evidence，并验证 Generator 容器凭据不可见、push 失败、Judge 后 trusted transport 才发布。
```

## journey_type: autonomous
## journey_type_reason: 范围以 packages/brain、Engine hook、runner 与纯后端治理为主，无用户页面主流程。
## target_environment: local_api
## target_environment_reason: 在本地 Brain API、PostgreSQL scratch、临时 Git repo 与 runner 容器完成真实验收。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116-169c-46ec-bc7c-b335a22f80ec
