# Sprint PRD — 三镜头 capability-controller 挪到四格路由器之前（new_capability 必经）

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1%（Crystal 结晶线第 6 件，能力级门禁接主链）

## 背景

能力级三镜头对抗（该不该做 / 边界 / 归位）现只挂在 1.0 relay 上，仅 `golden_path_proposal` 走到（`controllerSkillFor()` 返回 `capability-controller`），**从未接进主链**（memory harness-four-lanes 记载）。因此 `work-router.js` 的四格分类（`new_capability` / `capability_change` / `bugfix` / `parameter_only`）在遇到 `new_capability` 时，没有先经过"该不该做/边界/归位"的把关就直接选 pipeline。本 sprint 把三镜头挪到四格路由器**之前**，让每个 `new_capability` 必经三镜头，并强制产出一句 postcondition + NFR 三数，作为该能力的验收锚点。

## Golden Path（核心场景）

系统从 [一个被判为 new_capability 的 work request 进入路由] → 经过 [四格路由器分类前先跑三镜头 capability-controller] → 到达 [三镜头判决 + postcondition + NFR 三数落库，过闸后才继续四格路由]

具体：
1. [触发条件] 一个 work request 进入 `work-router.routeWork()`（或其上游 dispatcher.pre_trigger），`classifyWork` 结果指向 `change_kind = new_capability`
2. [系统处理] 在选定 pipeline/profile 之前，先调用三镜头 capability-controller，对该能力做三镜头对抗：**该不该做**（价值/重复判断）、**边界**（范围是否过宽）、**归位**（落在正确模块/line）
3. [可观测结果] 三镜头产出**一句 postcondition** + **NFR 三数（成本上限 / 时延上限 / 成功率下限）**，写入 Brain `decisions` 表（`category=nfr`, `level=step`）；只有三镜头过闸的 new_capability 才继续进四格路由选 pipeline，未过闸的被拦下（可观测拒绝原因）

## 边界情况

- `change_kind ≠ new_capability`（capability_change / bugfix / parameter_only）：不触发三镜头，路由行为不变
- 三镜头判决为"不该做/边界过宽/归错位"：拦截该能力，路由不放行，拒绝原因可查
- decisions 落库失败：门禁 fail-closed，不得静默放行
- 依赖的 Crystal 第 1 件尚未合入时：本能力的接线以第 1 件产出为前置（见假设）

## 范围限定

**在范围内**：把 capability-controller 三镜头挂到四格路由器（`work-router`）之前，仅对 `new_capability` 生效；产出 postcondition + NFR 三数并写入 `decisions`（category=nfr, level=step）。
**不在范围内**：四格分类算法本身、非 new_capability 的路由路径、三镜头对抗提示词内部逻辑重写、Dashboard 展示、第 1 件的能力本体。

## 假设

- [ASSUMPTION: 本 sprint 依赖 Crystal 第 1 件先合入（任务描述"依赖第1件先合"），第 1 件提供三镜头接主链所需的前置结构]
- [ASSUMPTION: "四格路由器"= `packages/brain/src/work-router.js`（`routeWork`/`CHANGE_KINDS`）；"capability-controller"三镜头本体由 `harness-skill-relay.js` `controllerSkillFor()` 选取，原名 golden-path-controller]
- [ASSUMPTION: 三镜头输出的 NFR 三数口径为 成本上限 / 时延上限 / 成功率下限，各为单一数值，挂在 step 级 decision]

## 预期受影响文件

- `packages/brain/src/work-router.js`: 在四格分类选 pipeline 前插入 new_capability 三镜头前置调用
- `packages/brain/src/harness-skill-relay.js`: `controllerSkillFor()`/relay 接线，使 capability-controller 可被主链调用
- `packages/brain/src/__tests__/work-router.test.js`: new_capability 必经三镜头 + postcondition/NFR 三数落库的回归断言

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step 级/feature 级均为空），PrepPRD 未显式给运行时 NFR -->
- 超时/延迟: 待定（decisions 无 sprint 级 NFR；注意"时延上限"是三镜头**产出物**，由实现落 decisions，见 Golden Path Step 3）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 三镜头判决 + NFR 三数必须写入 Brain `decisions`（category=nfr, level=step），落库失败 fail-closed，拒绝原因可查

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step/journey_feature 两源为空，下列取 area 源中 harness-kernel 路由域相关项（area 源为 90 条 capture-triage 宽表，已按本任务 F1 路由域筛选） -->
- [planner_role_branch] Planner workspace 必须停在服务端签发的 planner_branch；Provider 只可校验，禁止 checkout/switch（来源: area）
- [generator_retry_identity] Generator 基础设施失败必须重试原始服务端派发动作（generator→generator，generator-fix→generator-fix）（来源: area）
- [brain_url_authority] Dispatcher 与 Fleet Worker 必须注入服务端权威 HARNESS_BRAIN_URL；预检 fail-closed，禁手工绕过（来源: area）
- [validation_clock] validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时可建一次共享 validation clock（来源: area）
- [dirty-pr-rebase] PR 与 main 冲突(DIRTY) 时路由 generator-fix rebase，根除死等/判死 [r84]（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 下 golden-paths 均为 planned，无 done/working -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql 查 decisions）。

```bash
# 占位：proposer 将填入 local_api 脚本（node 内起 work-router / 调 routeWork + psql 查 decisions）
# 期望验收点（自然语言）：
#   1. 一个 new_capability work request 进路由 → 四格选 pipeline 之前先跑三镜头 capability-controller
#   2. 三镜头产出一句 postcondition + NFR 三数（成本上限/时延上限/成功率下限）写入 decisions（category=nfr, level=step）
#   3. capability_change/bugfix/parameter_only 不触发三镜头，路由行为不变（回归无破坏）
#   4. 三镜头判"不该做/边界过宽"→ 拦截不放行，拒绝原因可查（fail-closed）
```

## journey_type: autonomous
## journey_type_reason: 改动落在 packages/brain（work-router/harness-skill-relay 路由与调度层），纯后端自主流程，无 UI/远端 agent 协议
## target_environment: local_api
## target_environment_reason: Brain 内部路由/调度逻辑，E2E 在本地 evaluator 用 curl localhost:5221 + psql 查 decisions 验证
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
