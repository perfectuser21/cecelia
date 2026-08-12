# Sprint PRD — 统一 Work Router 与 Kernel Harness 2.0 恢复交付

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：完成统一 Work Router 的 Knife 0–5，并恢复失败链路的可信执行

## 背景

所有有头/无头 coding mutation 尚未由同一入口强制进入 Kernel Harness 2.0；前序运行还暴露了带凭据 origin 被误判孤儿、日志泄露凭据、活跃 Kernel 工作区被删除的问题。本 Sprint 按已批准设计完成恢复回归与 Knife 0–5，不缩减范围。

## Golden Path（核心场景）

coding mutation 从任一真实建任务入口进入统一 Work Router → 动作前取得不可变 Routing Receipt → 进入 Kernel Harness 2.0 → 读取 fresh Universal Map 并建立 Impact Contract → 按四档 change_kind 正向选择阶段 → 经 Generator、Evaluator、Judge、CI 与 merge fence → 在 scratch 环境得到真实可审计产出。

具体：
1. 先以永久 RED/GREEN 回归证明并修复：credential-bearing Git origin 不再误判 orphan、日志不泄露 credential、活跃 detached Kernel cwd 不被工作区清理删除。
2. Knife 0–2 冻结路由合同和入口清单，修复三个已知任务创建缺陷，并使全部可执行业务入口原子创建 task 与不可变 Routing Receipt。
3. Knife 3 使四种 change_kind 只做正向默认映射；所有 coding run 在 Provider 动作前校验 repo、fresh Universal Map、冻结 baseline revision，并建立 required Impact Contract；合法 map_recovery 仅走窄化恢复合同。
4. Knife 4 使有头 mutation-capable tool 与无头 Dispatcher 在动作前校验同一 receipt；Generator 无条件具备 frozen-baseline lineage、pushurl 熔断、降权和凭据清除。
5. Knife 5 完成旧任务 dry-run/迁移、事件与指标、scratch 多入口真实验收；content、research、read-only review 保持独立 Pipeline，review 派生的修复进入 Harness。
6. 最终产出 HEAD 必须是 `310ab9e704d4e3f866e6ce7beb25b79dd0f9d524` 的后代；Routing Receipt、Universal Map 与 Impact Contract 的 `base_sha/source_revision` 必须精确等于该 baseline。完成态 HEAD 不得被要求等于 baseline，RED/GREEN commits 必须追加在 baseline 之后并永久保留。

## 边界情况

- coding 语义无法排除写入时按 mutation 处理；repo 未知或不唯一时失败关闭，不默认 Cecelia。
- Map missing/stale、revision/scanner 非法、Impact Contract 不成立或真实 diff 越界时，不创建或继续 Provider attempt。
- receipt 缺失、过期、已 supersede，或 task/repo/run/attempt/lock/worktree/baseline 不一致时，动作前拒绝并记录稳定 reason_code。
- origin 的凭据、不同 URL 表示和 detached workspace 不得改变同一仓库身份；任何日志均不得出现凭据。
- map_recovery 仅接受 bugfix、稳定故障码、单 attempt、未过期合同及冻结 allowlist；正常 Map 或业务 diff 必须拒绝。
- 路由重试按 source、source_id、router_version 幂等；receipt 只能以 successor 追加，不可更新或删除。

## 范围限定

**在范围内**：Recovery 回归；设计文档 Knife 0–5；实施计划五个 Workstream；33 处入口的机器可检索清单与逐项合同；四档 change_kind；Routing Receipt；Map/Impact Contract；有头/无头动作闸；Generator trust boundary；旧任务迁移；scratch 多入口真实验收；Brain 版本与 DEFINITION 同步。

**不在范围内**：重写 Harness 状态机；把只读审查或内容创作塞进 Coding Harness；人工维护 Map；新增第五种 change_kind；继续新增 Harness 1.0 或 legacy_exempt；用数据库 trigger 做语义分类；生产数据写入。

## 假设

- [ASSUMPTION: PrepPRD 已获用户与架构审核批准，其 Knife 0–5 和五个 Workstream 是本 Sprint 的完整范围。]
- [ASSUMPTION: task payload 未配置 map_repo，因此规划阶段如实记录 Unified Map 映射未配置；实施 preflight 仍必须从 Routing Receipt 显式解析 repo，禁止路径猜测。]
- [ASSUMPTION: journey step 未提供 UUID/code，以本 Sprint 的 Knife 0–5 恢复交付作为当前 Journey Step 锚点。]

## 预期受影响文件

- `packages/brain/src/` 与 `packages/brain/migrations/411_work_routing_receipts.sql`：统一路由、原子 receipt、入口收敛、Kernel Map/Impact 与 Dispatcher Gate。
- `packages/engine/hooks/dev-mode-tool-guard.sh` 与 `/dev` worktree 管理脚本：有头动作期 receipt 闸门。
- `docker/cecelia-runner/entrypoint.sh`：Generator frozen baseline 与信任边界。
- `packages/brain/scripts/smoke/unified-work-router-smoke.sh`：scratch 多入口真实验收。
- `apps/dashboard/src/pages/warroom/WarRoomPage.tsx`：路由与治理状态审计视图。
- `packages/brain/DEFINITION.md`、`.brain-versions` 与 Brain package manifests：版本同步。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 安全：路由与 Map/Impact/动作闸均 fail closed；凭据不得进入 Provider 环境、Git remote 输出或日志。
- 一致性：task 与 receipt 原子落库；同输入同 router_version 得到确定结果；receipt append-only。
- 隔离：只连接 `cecelia_test|*_scratch` 做写入验收；多 repo 事实、worktree 与 attempt 不交叉。
- 可观测：保存稳定 reason_code，并产生 work_routed、work_route_blocked、route_violation、map_preflight_failed、impact_contract_* 等事件。
- 版本要求：Brain 源码改动必须同步 patch version、DEFINITION 与 `.brain-versions`。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [验证时钟] validation_clock_required 默认 fail-closed；仅 hotfix 且显式 PR ref 与 GitHub 实时观测一致时可建立一次共享时钟，后续 Judge 复用（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
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

验收脚本必须在 scratch 中从 API、Intent、Capture 三个真实入口创建 coding mutation，查询数据库确认 receipt、Harness Initiative、正确 repo Map、active Impact Contract 均存在；制造 stale Map 后确认 Provider 未启动，刷新后同一任务恢复且失败审计保留。另建 content/research/read-only 对照，验证有头合法/非法写入、无头 Generator 隔离、可信 transport 发布，并确认所有 receipt/Map/Impact baseline 字段精确等于上述 baseline。

## journey_type: autonomous
## journey_type_reason: 工作主体为 Brain、Engine 与 Kernel Harness 的后端自治路由和治理链路。
## target_environment: local_api
## target_environment_reason: payload 显式指定 local_api；核心验收在本地 Brain API、scratch PostgreSQL、临时 Git repo 与 runner 容器完成。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
