# Sprint PRD — 统一 Work Router：Coding 四形式统一进入 Kernel Harness 2.0

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+4%（把「所有 coding mutation 强制进 Harness」从局部能力变为不可绕过的唯一入口）

## 背景

现状：`domain=coding` 不等于强制进入 Harness，部分 coding 任务仍能以 `dev` 直接派发；`initiative_runs` 大量处于 `legacy_exempt`，无活跃 Impact Contract，Universal Map 只是可视化产品而非每次 coding Golden Path 的必经依赖。依据两项 active decision（`29ae54ae` 定义四档 change_kind、`c3617bdf` 要求有头/无头共用同一闸门并退役 Harness 1.0），本 sprint 交付唯一顶层 **Work Router**：所有有头/无头 **coding mutation 在动作前获得不可变 Routing Receipt，统一进入 Kernel Harness 2.0**，强制读取 **fresh Universal Map** 并建立 **Impact Contract**。设计文档：`docs/superpowers/specs/2026-08-12-unified-work-router-design.md`（Knife 0-5，5 个 Workstream）。

## Golden Path（核心场景）

任一入口发起 coding 工作 → Work Router 在入队前分类并生成 Routing Receipt → 强制进入 Kernel Harness 2.0 → 消费 fresh Universal Map + Impact Contract → 动作前 receipt 校验 → 收口。

具体（每 Task 先 RED commit 再 GREEN commit）：

1. **Knife 0-1（Task 1）**：冻结路由合同（work_kind、四档 change_kind、default_execution_profile、RouteDecision、Routing Receipt）；migration 411 建不可变 `work_routing_receipts` 表 + append-only trigger + `map_recovery_contracts`；纯函数 `work-router.js` + 事务级 `createRoutedTask()`，task 与 receipt 原子同生同灭。可观测出口：`selectPipeline({coding_mutation,new_capability})` 返回 `harness/harness_initiative/new-capability-v1`；从 gear/stage 反推 change_kind 抛 `change_kind_required`。
2. **Knife 0-2（Task 2）**：从 `VALID_TASK_TYPES` 动态断言当前 70 且 unique=70；逐项冻结现状考古 33 处建任务入口为机器可检清单；永久复现三陷阱（`planner.js:1203` INSERT 缺 `task_type`、`proposal.js` 把 `change.skill` 当 `task_type`、`capture-atoms.js` decision 写不存在列）；全入口收敛到 `createRoutedTask()`，capture-triage 与 Thalamus 只出证据不各自终判。
3. **Knife 3（Task 3）**：四档 change_kind 正向状态机；`kernel-run-store.js` 对所有新 coding run 写 `impact_contract_policy='required'`（不再 payload opt-in、不新增 legacy_exempt）；强制 Map preflight（freshness + source revision + baseline + repo 隔离）+ Impact Contract 生成；§10.1 `map_recovery` bootstrap 窄化恢复合同。
4. **Knife 4（Task 4）**：有头 `dev-mode-tool-guard.sh` 在 mutation-capable tool 动作前校验 `.dev-lock` + 有效 Routing Receipt；无头 Dispatcher executor 前校验同一 receipt 并记 `route_violation`；Generator frozen baseline pre-push + lineage assertion + trust boundary（pushurl 熔断 / setpriv 降权 / `env -u HARNESS_CALLBACK_TOKEN`）全 run 武装。
5. **Knife 5（Task 5）**：旧队列 dry-run→批量重路由；scratch 多入口真实验收 + 可观测性 + Dashboard 审计视图；版本 bump + DevGate + smoke。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- coding 写入意图 `unknown` 一律按 `write` 处理，避免漏进 Harness。
- repo 无法唯一解析 → 在路由阶段失败关闭，禁止默认绑定 Cecelia。
- Map missing/stale/revision mismatch/scanner invalid → 失败关闭；仅 §10.1 allowlist 内 `map_recovery` 可自修复。
- 只读 review 得出需改仓库结论 → 派生新 `coding_mutation` 子任务，不原地取写权限。
- Brain API 不可达 / `.dev-lock` 缺字段 / worktree·HEAD 不匹配 → 有头 hook exit 2 阻断，只读诊断放行。

## 范围限定

**在范围内**：Work Router 纯函数核心 + 事务级建任务边界 + 不可变 Routing Receipt；四档 change_kind 正向映射；Map/Impact Contract 强制 preflight 与 bootstrap 恢复；有头动作闸 + 无头 Dispatcher 安全闸；Generator frozen baseline 与 trust boundary；33 入口收敛 + 三陷阱回归；scratch 多入口真实验收。
**不在范围内**：不把 70 个 task_type 重构成 70 个平级顶层入口；不要求纯只读审查启动完整 Harness；不重写 Harness 内部状态机；不用 DB trigger 做语义分类；不改运行中 attempt 的执行模型；不重命名 Harness 内部阶段。

## 假设

- [ASSUMPTION: 当前 `VALID_TASK_TYPES` 计数为 70，以 `task-router.js` 实时导出为准，实施与验收从该单一事实源计数。]
- [ASSUMPTION: 现状考古 33 处建任务入口以 Knife 0 冻结清单为准，主线实际结果可增减。]
- [ASSUMPTION: 真实验收数据库限 `cecelia_test|*_scratch`，禁止连生产库。]

## 预期受影响文件

- `packages/brain/src/work-router.js`（新增）：纯函数 normalize/classify/repo/profile 决策
- `packages/brain/src/work-routing-store.js`（新增）：事务级 task+receipt 原子写入
- `packages/brain/src/routes/work-routing.js`（新增）：receipt 查询 + 动作期验证 API
- `packages/brain/migrations/411_work_routing_receipts.sql`（新增）：不可变 receipt + 恢复合同
- `packages/brain/src/orchestrator/kernel-run-store.js` / `derive.js` / `dispatcher.js`：四形式、Map preflight、L2 强制
- `packages/brain/src/{planner.js,proposal.js,actions.js,intent.js,routes/capture-atoms.js,routes/task-tasks.js}`：入口收敛 + 三陷阱回归
- `packages/engine/hooks/dev-mode-tool-guard.sh` / `skills/dev/scripts/worktree-manage.sh`：有头 receipt 绑定
- `docker/cecelia-runner/entrypoint.sh`：Generator frozen baseline 与 trust boundary
- `packages/brain/scripts/smoke/unified-work-router-smoke.sh`（新增）：scratch 多入口真实验收
- `apps/dashboard/src/pages/warroom/WarRoomPage.tsx`：work kind/Pipeline/repo/Map/Impact/route reason 审计视图

## NFR 约束

<!-- 来源: decisions category=nfr（step/feature 均空）+ PrepPRD 显式约束，PrepPRD 优先 -->
- 幂等：同 `source + source_id + router_version` 产生同一 RouteDecision（LLM 分类须收敛成枚举 + 存证据）。
- 原子性：Work Router 与任务写入同事务，绝不出现有任务无凭证。
- 失败可解释：路由错误返回稳定 `reason_code`，不得只存自由文本。
- 覆盖率目标：coding mutation Harness 覆盖率 100%、无 receipt 新业务任务 0、coding `dev` 直接派发 0、新增 `legacy_exempt` 0。
- 数据隔离：验收仅连 `cecelia_test|*_scratch`；写入侧与校验侧 DB_NAME 同源解析。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/feature 空，取 area 级相关铁律 -->
- [验证时钟] validation_clock 默认 fail-closed；仅 gear=hotfix 且 payload pr_url/pr_head_sha 与 GitHub 实时观测完全一致时首个 Evaluator 可建共享时钟，缺失/不一致一律拒绝（来源: area）
- [smoke exit 语义] 合同验证命令必须实跑确认 exit code：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 0，不得据此判过（来源: area）
- [local_api 无 UI] judge 机械闸⑤ meta_verification_gap 对 local_api/无 UI smoke 任务会死锁，此类须在合同侧给出替代 oracle（来源: area）
- [台账隔离] controller 台账 `.harness/progress.md` 必须保持在 git 追踪之外，不得随 sprint PR 带入 repo（来源: area）
- [并发隔离] evaluator/smoke 临时脚本落会话独享路径（含 session id），禁止共享 /tmp 固定文件名（来源: area）
- [DB 同源] 冒烟/校验脚本写入侧与校验侧 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无已验收 ability 历史：journey golden-paths 均为 planned 状态，经 done/working 过滤后为空）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl localhost:5221 + psql cecelia_scratch + smoke.sh）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：在 cecelia_scratch 从 API/Intent/Capture 三个真实入口各建一项 coding mutation，
# 查库确认三项均有 Routing Receipt、均成为 harness_initiative、均查询正确 repo 的 fresh Map、均建立 active Impact Contract；
# 人为制造 stale Map 后任务不能进入编码阶段，刷新四 scanner 后同一任务可 resume 且保留失败审计；
# content/read-only review/research 对照任务进入各自 Pipeline（review 派生的真实修复任务进 Harness）；
# 新建 coding dev 直接派发计数=0；有头缺 receipt 写入被 hook 阻断、合法 receipt 允许一次受控写入。
# required_command_evidence:
#   node scripts/facts-check.mjs
#   bash scripts/check-version-sync.sh
#   node packages/quality/scripts/devgate/check-dod-mapping.cjs
#   bash packages/brain/scripts/smoke/unified-work-router-smoke.sh
```

## journey_type: autonomous
## journey_type_reason: 核心 Golden Path 是系统自主的 coding mutation 路由与 Harness 强制门禁，验收经 Brain API + psql 完成，无人工浏览器交互；dashboard 仅次要审计视图
## target_environment: local_api
## target_environment_reason: E2E 全部为 curl localhost:5221 + psql cecelia_scratch + unified-work-router-smoke.sh，无前端浏览器/Windows/微信环境，本地 evaluator 执行
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116-169c-46ec-bc7c-b335a22f80ec
