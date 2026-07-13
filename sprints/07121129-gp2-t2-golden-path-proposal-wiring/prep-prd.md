# 小改动 PrepPRD：[GP2/7] T2 golden_path_proposal task_type 全链接线

## 改什么
按 docs/architecture/2026-07-12-golden-path-mode/architecture.md「模块变更」节，让新 task_type `golden_path_proposal` 可被 Brain 派发并跑专属 controller：

1. **migration 335**：扩 `tasks_task_type_check` CHECK 约束加入 `golden_path_proposal`（照 327_ci_patrol_task_type.sql 先例：DROP + 重建保留现行全部值）
2. **task-router.js 四处**：VALID_TASK_TYPES / SKILL_WHITELIST / LOCATION_MAP('us') / CAPABILITY_REQUIREMENTS(['has_git'])
3. **executor.js**：行 3218 dispatch 分支扩为 `harness_initiative || golden_path_proposal` 复用 runHarnessInitiativeRouter；行 2958 区 orchestrator==='skill-relay' 硬校验放行新类型
4. **harness-skill-relay.js**：行 162/392 两处 loadSkill 按 task.task_type 选 controller：`golden_path_proposal` → 'golden-path-controller'（skill 本体在 T3；本任务做映射 + skill 缺失时明确报错）
5. **dispatcher.js 行 82-99**：shouldApplyHarnessCap + INITIATIVE_LOCK_TASK_TYPES 纳入新类型

## 为什么改
GP loop（AI 自提 Golden Path 模式）T2，依据 decisions cb6be3f6/b416bfb3；GP1（golden_paths 表底座，#3779）已合并，圈选端点 /select 建出的 golden_path_proposal 任务需要这条派发链才能跑起来。

## 关联上下文
- 架构 SSOT：docs/architecture/2026-07-12-golden-path-mode/architecture.md（已合 main）
- 验收：initiative-dod.md F2
- Brain task：8a049255-eb97-463e-9364-3b42075670f4（已 claim in_progress）
- 先例：migration 327（ci_patrol 同类病同款修法）

## 影响范围
仅新增枚举/分支，不改 harness_initiative 既有行为；golden-path-controller skill 未就绪前，该类型任务派发会在 loadSkill 处得到明确报错（而非静默走错 controller）。

## 判定点登记表
（本任务无接缝判定点，N/A——纯枚举接线+分支复用，无对外部真实状态的推断）

## 验收标准（DoD F2）
- [ ] E2E smoke：建一条 golden_path_proposal 任务，断言 task-router 路由通过 / executor orchestrator 校验放行 / loadSkill 被以 'golden-path-controller' 调用（skill 未就绪前断言到 loadSkill 调用参数即可）
- [ ] migration 335 应用后非法 task_type 仍被拒、golden_path_proposal INSERT 通过
- [ ] 既有 harness_initiative 路径测试全绿（无回归）
- [ ] CI 全绿
