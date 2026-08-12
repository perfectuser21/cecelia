# Sprint PRD — 统一 Work Router 与 Kernel Harness 2.0 强制路由

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：完成统一 coding mutation 路由、治理门禁与真实验收闭环

## 背景

前序 run 因含凭据 Git origin 被误判 orphan，活跃 Controller cwd 被删除并触发 kernel_process_fatal。本 sprint 先永久修复 origin 归一化、日志脱敏和活跃 Kernel 工作区保护，再按已批准设计交付 Knife 0-5；不得缩减原范围。Unified Map 映射状态为 `not_configured`：payload 有 `map_scope=cecelia`，但缺 `map_repo`，不得据领域猜测当前 Map revision。

## Golden Path（核心场景）

所有有头/无头 coding mutation 从任一任务创建入口 → 动作前获得不可变 Routing Receipt 并统一进入 Kernel Harness 2.0 → 读取 fresh Universal Map、建立 Impact Contract、通过 Gate 与真实验收 → 安全交付且留下完整审计。

具体：
1. 恢复前置：credential-bearing Git origin 与无凭据等价 origin 被识别为同一仓库，任何日志不泄露凭据，活跃 detached Kernel 工作区不会被孤儿清理删除；每项先有永久 RED 回归再 GREEN。
2. Knife 0-1：冻结任务类型与创建入口事实基线；Work Router 确定性分类，原子创建 task 与不可变 Routing Receipt，repo 未知/不唯一时失败关闭。
3. Knife 2：Brain API、Intent、Capture、Actions、自动任务、回调、子任务与 Scheduler 等全部可执行任务入口收敛到同一创建边界；coding mutation 只能成为 `harness_initiative`，content/research/read-only 保持各自 Pipeline。
4. Knife 3：`new_capability`、`capability_change`、`bugfix`、`parameter_only` 仅作正向 profile 映射，禁止从 gear/stage/task type 反推；每个 coding run 在 Provider 前验证同 repo fresh Map 与 baseline revision并建立 required Impact Contract，非法状态稳定失败关闭；map recovery 仅在窄化合同内可用。
5. Knife 4：有头 mutation-capable tool 在动作前校验 live session、lock、receipt、run、repo、branch、base SHA；无头 Dispatcher 在 executor 前校验同一 receipt。Generator 全量启用 frozen baseline、pushurl 熔断、非特权身份与 callback/lease 凭据剥离。
6. Knife 5：旧任务先 dry-run 再迁移；scratch 中由 API、Intent、Capture 三个真实入口创建 coding mutation，并以 content、research、read-only review 作对照，验证 stale→阻断→refresh→resume、审计保留、容器隔离和可信 transport 发布。
7. 出口：coding mutation Harness 覆盖率与有头动作前 receipt 校验覆盖率均为 100%，新 coding `dev` 直接派发与新增 `legacy_exempt` 均为 0；独立 Evaluator/Judge、CI 与 merge fence 完成收口。

## 边界情况

- repo 缺失、歧义、Map missing/stale/invalid、revision 或 scanner 不一致、Impact Contract 无法建立时均失败关闭，不默认 Cecelia、不降级 direct dev。
- 重路由只能追加 superseding receipt；运行中旧 attempt 不更换执行模型，失败恢复不得改写历史凭证。
- 只读诊断允许恢复；只读审查需要修改时派生新的 coding mutation，不原地获得写权限。
- 并发/幂等按 `source + source_id + router_version` 验证；数据库真实验收仅使用 `cecelia_test|*_scratch`。

## 范围限定

**在范围内**：恢复回归前置；Knife 0-5；五个 Workstream；四档 change_kind；所有入口收敛；Routing Receipt；Map/Impact Contract；有头/无头动作闸；Generator trust boundary；迁移、可观测性、Dashboard 审计视图、scratch 真实验收；每项 RED commit 后 GREEN commit。

**不在范围内**：重写 Harness 状态机；把 70 个 task_type 变成平级入口；让纯只读审查或内容创作进入 Coding Harness；以数据库 trigger 作语义分类；人工登记 Map；改变运行中旧 attempt；生产数据写入。

## 假设

- [ASSUMPTION: `gp_anchor=factory/F1/step-1` 对应 payload anchor.step_id；以显式 UUID 作为 step_id。]
- [ASSUMPTION: Unified Map 的 repo 映射需下游在创建 Impact Contract 前补齐；Planner 不从 base_repo 推导 map_repo。]

## 预期受影响文件

- `packages/brain/src/`、`packages/brain/migrations/`：统一路由、原子凭证、入口收敛、Kernel/Dispatcher/Map Gate 与可观测性。
- `packages/engine/hooks/dev-mode-tool-guard.sh`、`packages/engine/skills/dev/scripts/worktree-manage.sh`：有头动作前 receipt 与 lock 校验。
- `docker/cecelia-runner/entrypoint.sh`：Generator frozen baseline 与 trust boundary。
- `apps/dashboard/src/pages/warroom/WarRoomPage.tsx`：只读路由审计视图。
- `packages/brain/scripts/smoke/unified-work-router-smoke.sh`：scratch 多入口真实验收。
- `packages/brain/DEFINITION.md`、`packages/brain/package.json`、`packages/brain/package-lock.json`、`.brain-versions`：Brain 版本同步。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: frozen baseline 固定为 `310ab9e704d4e3f866e6ce7beb25b79dd0f9d524`；Map revision 必须与其一致
- 可观测: 保存稳定 reason_code、路由事件、失败审计、receipt 历史与真实命令 exit code；凭据不得进入日志

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 id 去重；step/feature 为空 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容与 Git origin 凭据不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [租户隔离] 涉及租户数据的查询与写入必须 scope 到当前租户，测试默认至少两个租户且互不串（来源: area）
- [真环境验证] 依赖真实环境或调用方的接缝必须在目标环境验证后才算 done（来源: area）
- [环境假设] 环境值不得写死，必须从事实推导或真实校准（来源: area）
- [单写手] 单 slot 内任务串行，任务内同时仅一个代码实现者（来源: area）
- [验证命令] 合同命令批准前必须真实执行并记录 exit code 与目标解释器启动证据（来源: area）
- [数据库目标] smoke 写入侧与校验侧必须共享同一 DB_NAME 解析，禁止触碰生产库（来源: area）
- [Red提交] RED commit 只能精确加入测试路径，不得混入实现或 Harness 台账（来源: area）
- [共享CI禁区] 未经合同显式授权不得修改跨 sprint 共享 CI 判定文件（来源: area）
- [Generator权限] Generator 不得自行 merge 或发布，只能由受信任 transport 在 Judge 后发布（来源: area）
- [现有PR时钟] validation clock 默认 fail-closed，仅满足既定 existing-PR hotfix 合同才可建立共享时钟（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line done/working ability 的 golden_path；查询结果仅含 planned，故无可注入历史 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本（curl + psql + 临时 Git repo + 容器合同测试）
# 期望验收点：先运行四项 DevGate/smoke 必需命令；再从 API、Intent、Capture 三个真实入口验证 receipt、Harness、正确 repo Map 与 active Impact Contract；制造 stale Map 验证阻断，刷新后 resume 并保留失败审计；验证有头/无头 Gate、Generator 隔离、对照 Pipeline、coding dev=0 与 legacy_exempt 新增=0。
```

## journey_type: autonomous
## journey_type_reason: 任务以 packages/brain 纯后端统一路由、Kernel 与 Engine/runner 治理为主，不包含用户页面交互主路径。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；在本地 Brain API、scratch PostgreSQL、临时 Git repo 与 runner 合同环境完成验收。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116-169c-46ec-bc7c-b335a22f80ec
