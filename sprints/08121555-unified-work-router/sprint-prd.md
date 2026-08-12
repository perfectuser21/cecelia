# Sprint PRD — 统一 Work Router 与 Kernel Harness 2.0 生产恢复

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：恢复 coding mutation 的统一治理闭环；具体百分点待 OKR 复核

## 背景

当前有头与无头 coding mutation 仍可能绕开统一 Harness，且前序恢复因含凭据 origin 被误判为孤儿、日志泄露凭据、活跃 Kernel cwd 被删除而中止。本 Sprint 交付统一 Work Router，并严格覆盖批准设计的 Knife 0-5 与五个 Workstream。

## Golden Path（核心场景）

有头或无头 coding mutation 从任一建任务入口进入 → 在任何 mutation 动作前获得不可变 Routing Receipt 并统一进入 Kernel Harness 2.0 → 读取 fresh Universal Map、建立 Impact Contract、依四档 change_kind 正向选择执行形态 → 经 Generator、Evaluator、Judge、CI 与 merge fence → 在 scratch 多入口真实验收中产生可审计结果。

具体：
1. 先以永久 RED/GREEN 回归证明并修复含凭据 Git origin 的归一化与日志脱敏，同时保护活跃 detached Kernel 工作区不被回收。
2. Knife 0-2 冻结路由合同与建任务入口事实清单；所有可执行任务由同一事务边界创建，coding mutation 原子获得不可变 Routing Receipt，批准设计点名的三个旧缺陷永久回归。
3. Knife 3 对每个 coding run 强制读取目标 repo 的 fresh Universal Map 并建立 required Impact Contract；四档 change_kind 只做正向默认映射，Map 恢复仅允许窄化 bootstrap 合同。
4. Knife 4 在有头 mutation 动作前及无头 executor 前校验同一 receipt；所有 Generator run 强制 frozen baseline 与 trust boundary，凭据、push 和特权能力不可进入 Provider。
5. Knife 5 先 dry-run 再迁移旧任务；在 scratch 从 API、Intent、Capture 三个入口及 content、research、read-only 对照入口完成真实验收，保留 stale Map 失败与恢复审计。
6. 完成态 HEAD 必须是实现基线 `310ab9e704d4e3f866e6ce7beb25b79dd0f9d524` 的后代；Routing Receipt、Universal Map 与 Impact Contract 的 `base_sha/source_revision` 必须精确等于该基线，禁止把完成态 HEAD 要求为基线本身。

## 可执行验收计划与 DoD

1. [ARTIFACT] 每项先保留可定位的 RED commit，再保留对应 GREEN commit；Recovery 前置回归与 Knife 0-5 均不得缩减。
2. [BEHAVIOR] `git merge-base --is-ancestor "310ab9e704d4e3f866e6ce7beb25b79dd0f9d524" HEAD` 返回 0，且 `git rev-parse HEAD` 不作为等于基线的验收条件。
3. [BEHAVIOR] 单元/集成合同证明四个且仅四个 change_kind 正向映射；降档、反向推导、coding `dev` 直派和伪造 payload 全部失败关闭。
4. [BEHAVIOR] 真实临时 Git repo/数据库证明 receipt 与 task 原子创建且 receipt append-only；Map missing/stale/revision/scanner/repo 串线、Impact Contract 越界及非法 bootstrap 全部被拒绝。
5. [BEHAVIOR] 真实 worktree 与 runner 容器证明有头/无头动作闸生效；origin 凭据不会影响孤儿判定或进入日志，活跃 Kernel cwd 不被删除；Generator 无 callback/lease 凭据、无 push 能力且非特权。
6. [BEHAVIOR] scratch smoke 证明 API、Intent、Capture 三项 coding 均有 receipt、Harness run、正确 Map 与 active Impact Contract；content/research/read-only 不误入 Harness，review 的真实修复子任务进入 Harness。
7. [BEHAVIOR] stale Map 阻断 Provider；刷新后同一任务恢复且原失败审计仍在；生产只读观测为新增 `legacy_exempt=0`、coding receipt coverage=100%、coding `dev` 直派=0。
8. [ARTIFACT] 下列四条发货命令全部返回 0，且 Evaluator 以批准 PRD、合同、真实 diff 与真实产出作语义验收，不得以 CI 通过替代。

## 边界情况

- repo 未知/歧义、Map 不可查或不 fresh、scanner/revision 非法、Impact Contract 不成立时失败关闭，不默认 Cecelia、不产生 Provider attempt。
- `map_recovery` 只接受 bugfix、稳定故障原因、一次性未过期合同与冻结 allowlist；正常 Map 或业务 diff 必须拒绝。
- receipt 缺失、过期、superseded，Brain API 不可达，或 task/run/attempt/repo/branch/worktree/基线不一致时，mutation 动作必须阻断；只读诊断保持可用。
- 并发/重试必须保持 `source + source_id + router_version` 幂等，重路由只能追加 superseding receipt。

## 范围限定

**在范围内**：Recovery 前置修复；批准设计 Knife 0-5 与五个 Workstream；四形式；全部建任务入口收敛；Map/Impact Contract；有头/无头动作闸；Generator frozen baseline 与 trust boundary；迁移、观测与 scratch 真验。

**不在范围内**：重写 Harness 内部状态机；把只读审查、content 或 research 强塞进 Coding Harness；新增第五种 change_kind；人工登记 Map；中途迁移正在运行的旧 attempt；绕过 Evaluator/Judge/CI/merge fence。

## 假设

- [ASSUMPTION: 本任务属于已批准设计后的 `new_capability`，因此保留完整 Planner、三轮 GAN、Generator、Evaluator、Judge 与默认人工审核。]
- [ASSUMPTION: task payload 已提供 map_scope=`cecelia` 但缺 map_repo；Unified Map 映射状态如实记为 `not_configured`，后续必须由 receipt 中的显式 repo 绑定消除，不做路径猜测。]
- [ASSUMPTION: PrepPRD 未提供 Golden Path step UUID，本 Sprint 以设计中的 Knife 0-5 作为 step 锚点。]

## 预期受影响文件

- `packages/brain/src/` 与 `packages/brain/migrations/411_work_routing_receipts.sql`：统一路由、原子 receipt、入口收敛、Map/Impact Contract、Dispatcher 与观测合同。
- `packages/engine/hooks/dev-mode-tool-guard.sh` 与 `packages/engine/skills/dev/scripts/worktree-manage.sh`：有头动作前 receipt/lock 闸与活跃工作区保护。
- `docker/cecelia-runner/entrypoint.sh`：全部 Generator 的 frozen baseline、凭据隔离、push 熔断及非特权边界。
- `packages/brain/scripts/smoke/unified-work-router-smoke.sh`：scratch 多入口真实产出验收。
- `apps/dashboard/src/pages/warroom/WarRoomPage.tsx`：只读审计视图，不作为路由事实源。
- `packages/brain/DEFINITION.md`、`.brain-versions` 与 Brain package version：Brain 变更版本同步。

## NFR 约束

<!-- 来源: PrepPRD 主源；decisions NFR 双源均已读取且为空 -->
- 安全: receipt 不可变；未知 coding 写入按 write；凭据不进 git、Provider 或日志；API 有鉴权；失败关闭。
- 一致性: 同输入同 router version 得到同 RouteDecision；task 与 receipt 原子落库；跨 repo 不串线。
- 可观测: 稳定 reason_code 与路由/Map/合同事件齐全，失败、恢复和 supersede 历史不可覆盖。
- 兼容/性能: PrepPRD 未指定具体阈值；不得用未批准的假设值补齐。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step/feature 为空，area 端点返回 80 条。以下为与本 Sprint 可执行边界直接相交的去重铁律；全量原始响应已在规划运行中读取。 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容及 Git origin 凭据不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [租户隔离] 涉及租户数据的查询与写入必须按当前租户隔离（来源: area）
- [测试多租户] 单元与 E2E 默认至少两个租户并断言互不串线（来源: area）
- [真环境验证] 依赖真实环境的接缝必须在目标环境验证后才可标 done（来源: area）
- [环境假设] 环境相关值不得写死，必须从合同推导或真实校准（来源: area）
- [单写手] 单 slot 任务串行，任务内同一时刻只有一个实现者写代码（来源: area）
- [验证命令] 合同中的验证命令必须实跑确认 exit code 语义（来源: area）
- [证据窗口] Evaluator 将 root cause、RED→GREEN 时序与 exit_code 一手证据置于 Judge 消费窗口前列（来源: area）
- [Generator隔离] Generator Provider 不得持有 Brain callback 或 push 能力，发布由受信任 transport 完成（来源: area）
- [基线血统] frozen baseline 是实现血统与治理证据基点，产出 HEAD 必须是其后代而非与其相等（来源: PrepPRD 高优先级修订）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 golden paths -->
- （本 line 暂无历史）

## E2E 验收

```bash
BASELINE_SHA=310ab9e704d4e3f866e6ce7beb25b79dd0f9d524
git merge-base --is-ancestor "$BASELINE_SHA" HEAD
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
```

验收真相为 scratch 数据库记录、真实临时 Git repo/worktree、runner 容器内身份/环境/push 结果、Map stale→refresh 审计链与上述命令 exit code；CI 绿灯仅是补充证据。

## journey_type: autonomous
## journey_type_reason: 工作主体是 Brain、Engine 与 Kernel Harness 的后端自治路由和治理链路。
## target_environment: local_api
## target_environment_reason: base_repo=cecelia，核心真验在本地 Brain API、scratch PostgreSQL、临时 Git repo 与 runner 容器执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: Knife-0-5
