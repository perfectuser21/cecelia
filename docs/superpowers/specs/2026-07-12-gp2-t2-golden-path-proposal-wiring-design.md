# 设计：golden_path_proposal task_type 全链接线（GP2/T2）

> 依据 docs/architecture/2026-07-12-golden-path-mode/architecture.md「模块变更」节 + DoD F2。
> Research Subagent 三路侦察实证（2026-07-12），修正了任务描述中的三个遗漏点。

## 目标

让 Brain 能派发 `golden_path_proposal` 类型任务并走 skill-relay 路径起 golden-path-controller
（skill 本体在 T3；本任务只做映射，skill 缺失时 loadSkillContent 会带 skill 名 throw=明确报错）。

## 改动清单

1. **migration 335_golden_path_proposal_task_type.sql（新建）**
   DROP + 重建 tasks_task_type_check（复制 327 全量值 + 追加 'golden_path_proposal'），补 schema_version INSERT。
   同步 selfcheck.js EXPECTED_SCHEMA_VERSION（如引用）与 selfcheck.test.js:182 / learnings-vectorize.test.js:444 migration 地板。

2. **task-router.js 四处**
   - VALID_TASK_TYPES（:54 区）加 'golden_path_proposal'
   - SKILL_WHITELIST（:151 区）加 `'golden_path_proposal': '/harness-controller'`（校验用途；relay 实际 spawn skill 由 harness-skill-relay 映射决定）
   - LOCATION_MAP（:298 区）加 `'golden_path_proposal': 'us'`
   - CAPABILITY_REQUIREMENTS（:378 区）加 `['has_git']`

3. **executor-contracts.js:27** EXECUTOR_KIND_FOR 加 `golden_path_proposal: 'relay-container'`（漏了则 dispatch 打标 undefined）。

4. **executor.js 三处**
   - :3218 dispatch 分支 → `harness_initiative || golden_path_proposal`，复用 runHarnessInitiativeRouter（该函数不 hardcode task_type，orchestrator==='skill-relay' 硬校验天然覆盖新类型=放行即"进得来这条路"）
   - :3158 显式 machine/executor override 排除条件追加 `&& task.task_type !== 'golden_path_proposal'`（否则带 payload.executor 的 GP 任务被劫持进 override 路由绕过 relay）
   - :2963 错误文案泛化（提及两类型）
   - :4058 LANGGRAPH_TYPES 不加（:4070 skill-relay 先行 continue 已覆盖）

5. **harness-skill-relay.js 两处 loadSkill（:162 headless / :392 headed）**
   `loadSkill(task.task_type === 'golden_path_proposal' ? 'golden-path-controller' : 'harness-controller')`。
   :231/:237/:241 的 harness_controller 角色覆写**本任务不动**（容器回调按此识别节点，T3 controller skill 落地时按需调整）。

6. **dispatcher.js 三处**
   - :82 shouldApplyHarnessCap 判断加 golden_path_proposal；:470 cap 计数 SQL 同步扩口径（与 harness_initiative 共享同一全局并发额度，架构「纳入同一并发上限防线」）
   - :90 INITIATIVE_LOCK_TASK_TYPES 加入（仅 project_id 存在时生效，防同 project 并发）
   - :598 needsBridgeCheck 排除 golden_path_proposal（relay 路径不依赖 cecelia-bridge，否则 bridge 缺席时被永久 revert queued）
   - :105 retired 集合**绝不加**

## 范围外
- /select 端点建任务（T7）；golden-path-controller skill 本体（T3，skills repo）
- routes/golden-paths.js 零改动

## 测试策略
- **unit/integration（vitest）**：照 ci_patrol 接线整套模板——
  - task-router-golden-path-proposal.test.js（照 task-router-ci-patrol.test.js，4 表逐一断言）
  - dispatcher：cap 判定/计数口径（照 dispatcher-harness-concurrency-cap.test.js）+ bridge 豁免（照 dispatcher-circuit-harness-exempt.test.js）+ lock 列表
  - executor：dispatch 分支路由到 runHarnessInitiativeRouter + orchestrator 硬校验放行/拒绝（照 harness-orchestrator-lockdown.test.js）+ :3158 override 不劫持
  - harness-skill-relay：deps.loadSkill fake 断言被以 'golden-path-controller' 调用（照 harness-skill-relay.test.js 注入范式）
  - migration：CHECK 含新值、非法值仍拒（真 postgres 集成测试若模板存在则配）
- **E2E smoke（DoD F2）**：建一条 golden_path_proposal 任务（orchestrator=skill-relay），断言路由/校验/loadSkill 选择全通（skill 未就绪断言到 loadSkill 调用参数）
- **回归**：既有 harness_initiative 全部测试不动全绿
- **DevGate**：facts-check.mjs + check-version-sync.sh + check-dod-mapping；brain version bump（semver minor）

## 守卫（哨兵）
本改动为纯逻辑接缝（枚举+分支），CI regression test 即守卫；无环境接缝，无需运行时自检。
proven-to-fire：测试先行（TDD commit-1 red）即天然见红。
