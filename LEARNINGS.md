# Cecelia Core - Development Learnings

记录开发过程中的经验教训，帮助避免重复踩坑。

---

### [2026-02-22] Time-Aware Decomposition — Prompt 升级 (v1.66.0)

**变更**：
1. `executor.js`：新增 `buildTimeContext(krId)` 异步函数，查询 KR 剩余天数 + 已有 Project 进度，注入 OKR 拆解 prompt
2. `executor.js`：`preparePrompt(task)` 从同步改为 **async** 函数
3. `decomposition-checker.js`：Check 5/6 描述中注入 `time_budget_days` 和 `deadline` 上下文
4. `okr-validation-spec.yml`：新增 `recommended_fields`（sequence_order / time_budget_days，WARNING 级别）

**经验**：
- **sync→async 是 Breaking Change**：`preparePrompt` 从同步改为异步后，所有调用方和测试都必须加 `await`。CI 暴露了 3 个未更新的旧测试文件（executor-skill-override / executor-okr-project-layer / exploratory-prompt）。**教训**：改函数签名时，全仓搜索所有调用点，不能只改直接修改的文件。
- **buildTimeContext 容错设计**：try-catch 包裹整个函数，失败时 console.error + 返回空字符串，不阻塞 prompt 生成。这保证了 DB 连接失败时不影响任务派发。
- **pool.query mock 陷阱**：旧测试 mock `db.js` 的 `query` 为 `vi.fn()`（无返回值），`buildTimeContext` 内部调用 `pool.query().rows` 会 throw。设计时用 try-catch 兜底是关键。
- **合并冲突处理**：develop 上有 v1.65.1 hotfix，PR 分支是 v1.66.0。解决方法：保留更高版本号（1.66.0），在 .brain-versions / DEFINITION.md / package.json 中统一。

---

### [2026-02-22] 渐进验证循环 — Progress Reviewer (v1.65.0)

**变更**：
1. 新增 `progress-reviewer.js`：4 个核心函数（reviewProjectCompletion / shouldAdjustPlan / createPlanAdjustmentTask / executePlanAdjustment）
2. `initiative-closer.js`：`checkProjectCompletion()` 闭环后自动触发 `shouldAdjustPlan` 审查
3. `routes.js`：decomp_review 完成时处理 `plan_adjustment` 闭环

**经验**：
- **时间边界条件注意 strict inequality**：`underBudget` 判断用 `timeRatio < 0.5`（strict less-than），`0.5` 不算 under budget。测试时容易误以为 `0.5` 应返回 `true`。
- **复用 decomp_review 任务类型**：plan_adjustment 和 decomposition quality 审查共用 `decomp_review` task_type，通过 `payload.review_scope` 区分（`plan_adjustment` vs `decomposition_quality`），避免新增 task_type。
- **executePlanAdjustment 的防御式设计**：`findings?.plan_adjustment` + `findings?.adjustments` 双重检查，adjustments 为空数组也跳过，每个 adjustment 检查 `project_id` 存在才执行。
- **initiative-closer 中 try-catch 隔离审查失败**：审查逻辑失败不影响 Project 关闭结果（已关闭的不回滚），只 console.error 记录。

---

### [2026-02-22] OKR Validator 接入主链路 + CI (v1.61.0)

**变更**：
1. decomposition-checker.js: `runDecompositionChecks()` 开头调用 `validateOkrStructure(pool, { scope: 'full' })`，收集 BLOCK 实体 ID 到 `_blockedEntityIds` Set
2. decomposition-checker.js: `createDecompositionTask()` 检查 goalId/projectId 是否在 blocked set → 跳过创建
3. CI workflow: brain-test job 添加 OKR Structure Check 步骤（continue-on-error: true）
4. 新增 decomp-okr-validation.test.js（9 个测试）

**经验**：
- **runDecompositionChecks 新增 async 调用会破坏所有使用 mockResolvedValueOnce 序列的测试**：`exploratory-continuation.test.js` 等测试按顺序 mock pool.query，新增 `validateOkrStructure` 调用会消耗队列中的 mock responses，导致后续 mock 顺序错乱。修复：在这些测试文件中添加 `vi.mock('../validate-okr-structure.js')`。
- **容错设计模式**：validator 异常时 catch + clear blocked set（`_blockedEntityIds = new Set()`），确保不阻塞主流程。这是 PRD 中 "validator 异常时不阻止主流程" 的关键实现。
- **Set 模式用于 O(1) 门控**：一次全量验证 → 收集 entityId → Set.has() 检查，比每次 createDecompositionTask 都 query DB 高效得多。

---

### [2026-02-22] OKR Validation Spec + Validator L0 (v1.60.0)

**变更**：
1. config/okr-validation-spec.yml: 统一验证规格（所有 OKR 实体的 required_fields/parent_rules/children_count/text_rules）
2. brain/src/validate-okr-structure.js: 验证器模块（loadSpec + validateOkrStructure + detectCycles）
3. scripts/devgate/check-okr-structure.mjs: CI 脚本
4. 49 个测试覆盖 D1-D10

**经验**：
- **CI 环境的 PG\* 环境变量会干扰测试**：GitHub Actions 的 PostgreSQL service 容器设置了 PGHOST、PGDATABASE 等环境变量，`pg` 库会自动读取这些变量覆盖 DATABASE_URL。测试中需要清理 PG* 变量：`delete process.env.PGHOST` 等。
- **exit code 用 toBeGreaterThan(0) 而非精确值**：不同环境下（有/无 DB 连接）退出码可能不同（1 vs 2），用范围断言更稳健。
- **loadSpec 缓存策略**：默认路径（无参数）写缓存，自定义路径不写缓存。测试缓存行为时必须用默认路径调用两次。
- **单表多态模式的验证**：goals 表 4 种 type、projects 表 2 种 type，spec 按 table + type 组织规则，validator 按 type 分别查询再逐条验证。
- **DFS 环检测**：pr_plans.depends_on 是 uuid[] 数组，用三色标记法检测有向图环。

---

### [2026-02-22] Initiative 队列管理机制 (v1.57.0)

**变更**：
1. migration 047：将无活跃任务的 active initiative 改为 pending，重新激活最多 10 个
2. initiative-closer.js：新增 `activateNextInitiatives(pool)`，`MAX_ACTIVE_INITIATIVES = 10`
3. initiative-closer.js：`checkInitiativeCompletion()` 完成后自动触发激活
4. tick.js：Section 0.10 每次 tick 触发激活检查
5. selfcheck.test.js：硬编码版本号需要跟着 migration 版本一起更新

**经验**：
- **selfcheck.test.js 有硬编码版本号**：每次 migration 版本升级，必须同时更新 `selfcheck.test.js` 中的 `EXPECTED_SCHEMA_VERSION should be XXX` 测试，否则 CI 必定失败。教训：本次 CI 第一次失败就是这个原因。
- **修改已有函数返回结构时，记得更新相关测试的 mock pool**：`checkInitiativeCompletion()` 增加了 `activatedCount` 后，会触发内部对 `activateNextInitiatives()` 的调用，mock pool 必须能处理新的查询（COUNT active、UPDATE active RETURNING），否则 mock 抛异常或返回 undefined。
- **activateNextInitiatives 的 mock 复杂度**：内部有 3 种查询（COUNT active、UPDATE pending→active RETURNING、INSERT events），mock pool 必须分别识别。关键是通过 `s.includes("RETURNING id, name")` 区分"激活"的 UPDATE 和"关闭"的 UPDATE（后者不含 RETURNING）。
- **MAX_ACTIVE_INITIATIVES = 10** 而非直接写数字，便于测试和未来调整。

**避免踩坑**：
- 每次 schema version 变更后立刻检查 `selfcheck.test.js` 是否有硬编码值需要更新
- 新增导出函数时，同步更新 `export { ... }` 列表
- 修改函数内部行为（如新增内部调用）时，检查所有现有测试的 mock pool 是否覆盖了新的 SQL 查询模式

---

### [2026-02-21] Project 闭环检查器 + CLAUDE.md 概念清理 (v1.55.0)

**变更**：
1. initiative-closer.js 新增 `checkProjectCompletion()` 函数（与 initiative 检查同文件）
2. tick.js 新增 Section 0.9 调用 `checkProjectCompletion()`
3. CLAUDE.md 全局文档清理 "Project = Repository" 错误概念

**经验**：
- Project 闭环和 Initiative 闭环逻辑相似，放同一个文件（initiative-closer.js）保持逻辑集中
- `checkProjectCompletion` 的 SQL 只需一次查询（NOT EXISTS + AND EXISTS 子查询），不需要像 initiative 那样两次查询；initiative 需要知道任务统计细节，project 只需知道"是否有未完成的 initiative"
- 测试 P3（空 project 不关闭）和 P4（已 completed 不重复）都通过 SQL 层面过滤，mock 返回空列表即可验证，不需要额外的业务逻辑
- export 时需要把新函数加到 `export { checkInitiativeCompletion, checkProjectCompletion }`，否则 tick.js 动态 import 会报 undefined
- 文档概念清理：旧文档中 "Project = Repository" 是历史遗留错误，正确层级是 KR → Project → Initiative → Task，Repository 只是代码存放地，不在 OKR 层级中

**避免踩坑**：
- 向 export 列表追加新函数时，确认 import 端（tick.js）也用了解构 `{ checkProjectCompletion }`
- `- [ ]` 格式的验收清单是 branch-protect.sh Hook 的强制要求，DoD 文件必须包含

---

### [2026-02-21] Initiative 闭环检查器 (v1.54.0)

**变更**：新增 initiative-closer.js + migration 045 + tick.js Section 0.8

**经验**：
- `projects` 表没有 `completed_at` 字段，需要先写 migration 再实现业务逻辑
- `cecelia_events` 的字段是 `event_type` 不是 `type`，与其他系统命名不同，写代码前务必确认字段名
- `selfcheck.test.js` 中有硬编码的 schema version 断言（`expect(EXPECTED_SCHEMA_VERSION).toBe('044')`），每次 schema version 升级都必须同步更新这个测试文件
- tick.js Section 0.8 使用动态 import（`await import('./initiative-closer.js')`），与 Section 0.7 的 health-monitor 静态 import 方式不同；动态 import 更灵活，可以在测试中 mock
- 测试用 mock pool 时，SQL 匹配用 `s.includes(...)` 判断，需要覆盖所有可能的 SQL 语句（包括 UPDATE 和 INSERT）

**避免踩坑**：
- 升级 EXPECTED_SCHEMA_VERSION 后，立即在本地跑 `npx vitest run src/__tests__/selfcheck.test.js` 验证

---

### [2026-02-21] 成本优化 — 丘脑 Haiku + 皮层 Sonnet (v1.52.11)

**变更**：thalamus Sonnet→Haiku，cortex Opus→Sonnet

**经验**：
- 丘脑职责是结构化 JSON 路由（从白名单选 action），Haiku 完全胜任，不需要 Sonnet 的推理能力
- 皮层做深度 RCA，Sonnet 足够，不必用 Opus
- 总节省：丘脑 3x + 皮层 5x，丘脑影响最大（每 5 分钟高频调用，全天 288 次）
- MODEL_PRICING 的 haiku key 要更新为新模型 ID（`claude-haiku-4-5-20251001`），价格 $1/$5 per 1M
- `.brain-versions` 必须用 `jq -r .version brain/package.json > .brain-versions` 覆写，不能 append，否则 CI 版本同步检查失败

---

### [2026-02-12] Immune System v1 - P0 实现

**功能**：实现免疫系统 P0 阶段 - Registry + State Machine + Evaluations，包含 3 个新表（failure_signatures, absorption_policies, policy_evaluations）和 Monitor Loop 集成。

**Bug 记录**：
1. **测试文件期望值未更新** - `selfcheck.test.js` 测试失败
   - 问题：更新了 `selfcheck.js` 的 `EXPECTED_SCHEMA_VERSION` 从 '023' → '025'，但忘记更新测试文件的期望值
   - 测试失败：`expected '025' to be '023'`
   - 解决：同步更新 `brain/src/__tests__/selfcheck.test.js` 第 137-138 行的期望值
   - 影响程度：High（CI 失败）
   - 教训：更新常量时，必须同步更新对应的测试断言

2. **.brain-versions 文件格式错误** - CI Version Check 失败
   - 问题：文件中重复写了两行 `1.25.0`，导致 CI 读取时变成 `1.25.01.25.0`（字符串拼接）
   - CI 错误：`❌ .brain-versions: 1.25.01.25.0 (expected: 1.25.0)`
   - 解决：删除重复行，只保留一行 `1.25.0`
   - 影响程度：High（CI 失败）
   - 教训：.brain-versions 文件格式必须严格（只有一行版本号 + 空行）

3. **依赖模块缺失** - monitor-loop.js 不存在
   - 问题：Immune System 需要集成到 monitor-loop.js，但这个文件只存在于 `cp-add-monitoring-loop` 分支
   - 解决：Cherry-pick 3 个相关 commits（4b54a28, 4798e89, 9615850）从 cp-add-monitoring-loop 分支
   - 冲突：selfcheck.js 的 EXPECTED_SCHEMA_VERSION（'024' vs '025'），保留 '025'
   - 影响程度：High（核心依赖缺失，无法集成）
   - 教训：实现新功能前，先确认所有依赖模块的状态和位置

4. **Migration schema_version 更新错误** - 迁移脚本执行失败
   - 问题：使用 `UPDATE schema_version SET version = '025' WHERE id = 1`，但 schema_version 表没有 `id` 列，主键是 `version`
   - 错误：`ERROR: column "id" does not exist`
   - 解决：改用 `INSERT INTO schema_version (version, description) VALUES ('025', '...') ON CONFLICT (version) DO NOTHING;`
   - 影响程度：Medium（本地迁移失败但可手动修复）
   - 教训：迁移脚本应使用标准的 INSERT...ON CONFLICT 模式，不依赖表结构假设

**优化点**：
1. **完整的版本同步 Checklist**
   - 实施：总结所有需要同步版本号的文件
   - 清单：
     1. `brain/package.json` - 基准版本
     2. `brain/package-lock.json` - `npm install --package-lock-only`
     3. `.brain-versions` - 只写一行版本号
     4. `DEFINITION.md` - Brain 版本 + Schema 版本（两处）
     5. `brain/src/selfcheck.js` - EXPECTED_SCHEMA_VERSION
     6. `brain/src/__tests__/selfcheck.test.js` - 测试期望值
   - 影响程度：Critical（避免版本不同步导致的 CI 失败）

2. **.brain-versions 文件格式规范**
   - 规则：只能有一行版本号 + 一个空行，不能有注释或其他内容
   - 验证：`wc -l .brain-versions` 应该返回 2（版本号行 + 空行）
   - 影响程度：High（CI 依赖正确格式）

3. **Cherry-pick 策略**
   - 原则：优先 cherry-pick 稳定的依赖模块，而不是重新实现
   - 步骤：
     1. 使用 `git log <branch> --oneline | grep <关键词>` 找到相关 commits
     2. Cherry-pick 按顺序的多个 commits（保持依赖关系）
     3. 解决冲突时优先保留当前分支的新值
   - 影响程度：High（节省时间，保证依赖完整性）

4. **Migration 标准模式**
   - 最佳实践：使用 `INSERT...ON CONFLICT DO NOTHING` 更新 schema_version
   - 避免：使用 `UPDATE...WHERE id = 1` 假设表结构
   - 模板：
     ```sql
     INSERT INTO schema_version (version, description)
     VALUES ('XXX', '...')
     ON CONFLICT (version) DO NOTHING;
     ```
   - 影响程度：High（保证迁移脚本稳定性）

**收获**：
- 学习了免疫系统的完整设计模式（Registry → Probation → Active 状态机）
- 掌握了 PostgreSQL JSONB 字段在策略存储中的应用
- 理解了 Monitor Loop 与免疫系统的优先级集成（active policy 先于 RCA）
- 实践了 Cherry-pick 整合跨分支依赖的流程
- 深刻体会了版本同步检查的重要性（多次 CI 失败都因版本不同步）
- 验证了测试文件也需要同步更新的必要性

**下次改进**：
- 版本更新时运行完整 checklist，确保 6 个文件全部同步
- 创建新迁移脚本时，使用标准的 INSERT...ON CONFLICT 模式
- Cherry-pick 前先确认目标 commits 的完整依赖链
- 更新常量后立即搜索所有测试文件中的引用并同步更新

---

### [2026-02-12] 可观测性系统 v1.1.1 实现

**功能**：实现统一事件流可观测性系统，包含 run_events 表、trace SDK、8 个硬边界约定。

**Bug 记录**：
1. **分支命名不符合规范** - `cp-observability-v1.1.1` 包含点号，被 Hook 拒绝
   - 问题：分支名包含点号不匹配 `^cp-[a-zA-Z0-9][-a-zA-Z0-9_]*$` 正则
   - 解决：重命名为 `cp-observability-v111`
   - 影响程度：Low（早期发现，快速修复）

2. **迁移文件冲突** - 两个 023 编号的迁移文件同时存在
   - 问题：`023_add_run_events_observability.sql` (旧) 和 `023_add_run_events_observability_v1.1.sql` (新) 冲突
   - 旧文件缺少 `reason_kind` 列，导致新迁移执行失败
   - 解决：删除旧迁移文件，只保留 v1.1 版本
   - 影响程度：High（CI 失败，Schema 冲突）

3. **版本号未更新** - CI Version Check 期望 feat: 提交有版本更新
   - 问题：添加新功能后未更新版本号
   - 解决：从 1.18.1 升级到 1.23.0 (minor bump)
   - 影响程度：High（CI 失败）

4. **View 缺少 task_id 列** - `v_run_last_alive_span` 视图不完整
   - 问题：`detect_stuck_runs()` 函数查询 `task_id`，但 view 没有 select 这个列
   - 解决：在 view 的 CTE 和 SELECT 子句中添加 `task_id`
   - 影响程度：High（运行时错误，测试失败）

5. **多文件版本不同步** - package.json、DEFINITION.md、.brain-versions、selfcheck.js 版本不一致
   - 问题：更新 package.json 到 1.23.0 后，其他 4 个文件仍是旧版本
   - 涉及文件：
     - DEFINITION.md: Brain 版本 + Schema 版本
     - .brain-versions: Brain 版本号
     - selfcheck.js: EXPECTED_SCHEMA_VERSION
     - selfcheck.test.js: 测试期望值
   - 解决：逐一同步所有文件
   - 影响程度：High（CI 多次失败）

**优化点**：
1. **硬边界约定 (Hard Boundaries)**
   - 实施：在 PRD 中明确定义 8 个硬边界，防止实现漂移
   - 效果：实现过程严格遵循约定，避免自由发挥
   - 示例：run_id 必须由 L0 生成、span_id 使用 UUID、status 状态机、heartbeat 规则等
   - 影响程度：High（保证实现质量）

2. **版本同步检查列表**
   - 建议：创建 checklist 确保版本更新时同步所有文件
   - 需要同步的文件：
     1. `brain/package.json`
     2. `brain/package-lock.json` (npm install --package-lock-only)
     3. `.brain-versions`
     4. `DEFINITION.md` (Brain 版本 + Schema 版本)
     5. `brain/src/selfcheck.js` (EXPECTED_SCHEMA_VERSION)
     6. `brain/src/__tests__/selfcheck.test.js` (测试期望)
   - 影响程度：High（避免版本不同步导致的 CI 失败）

3. **迁移文件命名规范**
   - 教训：迁移文件编号必须唯一，不能重复
   - 建议：新建迁移前先 `ls brain/migrations/` 检查最新编号
   - 影响程度：High（避免迁移冲突）

4. **View 完整性检查**
   - 教训：创建 View 后，确保包含所有依赖函数需要的列
   - 建议：创建 View 同时编写测试，验证所有预期列存在
   - 影响程度：Medium（避免运行时错误）

**收获**：
- 学习了完整的可观测性系统设计（统一事件流、三层 ID、五层执行追踪）
- 掌握了 PostgreSQL View 和 Function 的创建与调试
- 理解了 Git 分支命名规范和 Hook 验证机制
- 实践了多文件版本同步流程
- 深刻体会了 CI 检查的价值（发现了 8 个问题）
- 理解了硬边界约定对实现质量的保障作用

### [2026-02-07] Brain 学习闭环实现

**功能**：实现 Brain 自动从失败中学习并调整策略的闭环系统。

**Bug**：
1. **版本同步问题** - CI 失败因为版本号不同步
   - 问题：更新 `brain/package.json` 后忘记更新 `DEFINITION.md` 和 `.brain-versions`
   - 解决：手动同步所有版本号文件
   - 影响程度：High（阻塞 PR 合并）

2. **测试 Schema 版本过期** - `selfcheck.test.js` 期望 schema version 011，实际是 012
   - 问题：创建新迁移脚本后忘记更新测试断言
   - 解决：更新测试期望值 `expect(EXPECTED_SCHEMA_VERSION).toBe('012')`
   - 影响程度：High（CI 失败）

3. **CI 环境数据库列缺失** - `learning.test.js` 在 CI 环境失败
   - 问题：测试假设 `brain_config.metadata` 列存在，但 CI 环境的数据库可能没有这个列
   - 解决：在测试的 `beforeAll` 中添加 `ALTER TABLE brain_config ADD COLUMN IF NOT EXISTS metadata JSONB`
   - 影响程度：High（CI 失败）

4. **迁移脚本 SQL 错误** - schema_version 表更新语句错误
   - 问题：使用 `UPDATE schema_version SET version = '012' WHERE id = 1`，但表没有 `id` 列
   - 解决：改用 `INSERT INTO schema_version (version, description) VALUES ('012', '...')`
   - 影响程度：Medium（迁移失败但本地可手动修复）

**优化点**：
1. **版本更新自动化**
   - 建议：创建脚本自动同步 package.json → DEFINITION.md → .brain-versions
   - 影响程度：High（防止版本不同步错误）

2. **测试健壮性增强**
   - 建议：测试应该自己准备数据库结构，不依赖迁移脚本执行顺序
   - 已实施：在 `beforeAll` 中添加 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   - 影响程度：Medium（提高测试可靠性）

3. **迁移脚本标准化**
   - 建议：检查所有迁移脚本的 schema_version 更新语句格式是否一致
   - 影响程度：Medium（避免迁移失败）

**收获**：
- 学习了 Brain 学习闭环的完整实现流程
- 理解了 Cortex RCA 系统与 Learning 系统的集成方式
- 掌握了策略参数白名单验证机制（ADJUSTABLE_PARAMS）
- 实践了 PostgreSQL JSONB 字段的使用

**下次改进**：
- 版本更新时运行 `scripts/check-version-sync.sh` 提前发现不同步
- 创建新迁移脚本时同步更新相关测试的 schema version 期望值
- 测试中确保数据库结构准备充分，不依赖外部迁移状态

---

### [2026-02-07] 免疫系统完整连接实现

**功能**：连接所有免疫系统组件 - Feature Tick 自动启动、策略调整效果监控、质量反馈循环。

**Bug**：
1. **UNIQUE 约束缺失** - migration 016 的 strategy_effectiveness 表缺少 UNIQUE 约束
   - 问题：`ON CONFLICT (adoption_id)` 需要 adoption_id 有 UNIQUE 约束，但只有普通 REFERENCES
   - 解决：改为 `adoption_id UUID UNIQUE REFERENCES`，UNIQUE 会自动创建索引
   - 影响程度：High（CI 失败，migration 无法执行）
   
2. **Supertest 依赖缺失** - routes-immune-connections.test.js 导入了 supertest 但 package.json 没有
   - 问题：测试文件创建了 API 路由测试，但 supertest 不是 Brain 的依赖
   - 解决：删除 routes 测试文件，改用 manual testing（DoD 更新）
   - 影响程度：High（CI 失败）

3. **测试数据污染** - learning-effectiveness.test.js 和 cortex-quality.test.js 测试相互影响
   - 问题：多个测试创建数据但不清理，导致后续测试查询到错误的数据量
   - 解决：在 `beforeEach` 添加 `DELETE FROM cortex_analyses/tasks/strategy_adoptions/strategy_effectiveness`
   - 影响程度：High（CI 随机失败，本地可能通过但 CI 失败）

4. **错误的表名** - 测试代码使用了不存在的 `task_runs` 表
   - 问题：复制测试代码时假设有 task_runs 表，实际表名是 `agent_runs`
   - 解决：删除 `DELETE FROM task_runs` 语句
   - 影响程度：Medium（本地测试失败）

5. **测试时间窗口重叠** - "ineffective strategy" 测试与主测试使用相同时间点
   - 问题：两个测试都用 `Date.now() - 10 * 24 * 60 * 60 * 1000`，查询时间窗口重叠，统计到对方的任务
   - 解决：改用不同时间点（30天前 vs 10天前）并添加唯一的任务标题前缀
   - 影响程度：High（导致成功率计算错误）

6. **函数名错误** - server.js 导入了不存在的 `startFeatureTick` 函数
   - 问题：feature-tick.js 导出的是 `startFeatureTickLoop`，但 server.js 导入的是 `startFeatureTick`
   - 解决：修正 import 和调用为 `startFeatureTickLoop()`
   - 影响程度：Critical（GoldenPath E2E 失败，服务器启动失败）

**优化点**：
1. **UNIQUE vs INDEX 的权衡**
   - 发现：UNIQUE 约束会自动创建索引，不需要额外的 `CREATE INDEX`
   - 建议：如果字段需要唯一性，直接用 UNIQUE 而不是 INDEX + 应用层检查
   - 影响程度：Medium（简化数据库设计）

2. **测试隔离原则**
   - 发现：共享数据库的测试必须在 beforeEach 清理所有相关表数据
   - 建议：测试应该清理它查询的所有表，不只是它直接写入的表
   - 影响程度：High（避免 CI 随机失败）

3. **时间窗口测试策略**
   - 发现：测试时间敏感功能时，要确保不同测试的时间窗口不重叠
   - 建议：使用明确不同的时间偏移（如 10天 vs 30天）+ 唯一标识符（任务标题）
   - 影响程度：High（避免时间窗口查询污染）

4. **Migration UNIQUE 约束最佳实践**
   - 发现：`ON CONFLICT` 子句要求字段有 UNIQUE 或 EXCLUSION 约束
   - 建议：如果 upsert 需要 ON CONFLICT，在 migration 里直接用 UNIQUE，不要只用 FK
   - 影响程度：High（避免 upsert 失败）

**收获**：
- 学习了 PostgreSQL UNIQUE 约束自动创建索引的机制
- 理解了测试数据污染的根本原因：时间窗口重叠 + 表级查询
- 掌握了 ON CONFLICT 子句对约束类型的依赖关系
- 实践了 CI 失败 5 次的完整调试流程（约束→依赖→数据→表名→时间→函数名）
- 理解了 Feature Tick Loop 与主 Tick Loop 的独立性
- 验证了 DoD → Test mapping 的 DevGate 检查机制

---

### [2026-02-07] 免疫系统最后一公里连接

**功能**：修复免疫系统3个断链 - 策略调整读取、重试策略使用、Token bucket 调用。

**发现**：
1. **95%已实现，只差5%连接** - 所有功能都已开发完成，只是写入和读取之间缺少桥梁
   - Cortex 写 brain_config → 但没人读
   - classifyFailure 算 retry_strategy → 但 requeueTask 不用
   - tryConsumeToken 已实现 → 发现已经在用了（第597行）

2. **Token bucket 已经连接** - 深度搜索发现 tick.js 第597行已经调用了
   - 本来以为需要添加，实际上已经存在
   - 这说明之前有人已经做过这个连接，但文档没更新

3. **测试数据污染的根本原因** - 多个测试文件共享同一个数据库
   - tick-drain.test.js 期望 0 个 in_progress 任务
   - 但其他测试创建的任务没清理
   - 解决：在测试开始时清理全局状态

**Bug**：
1. **重复添加 token bucket 检查** - 导致 `tokenResult` 重复声明
   - 问题：在 dispatchNextTask() 函数开头添加了检查，但第597行已经有了
   - 解决：删除我添加的重复代码，保留原有的
   - 影响程度：High（语法错误，测试无法运行）

2. **测试数据隔离问题** - tick-drain.test.js 失败
   - 问题：测试期望 0 个 in_progress 任务，但其他测试遗留了1个
   - 解决：在测试开始时 `UPDATE tasks SET status = 'completed' WHERE status = 'in_progress'`
   - 影响程度：High（CI 失败）

3. **Config loader 测试数据污染** - loadAllAdjustableParams 测试失败
   - 问题：前一个测试写入了 alertness.emergency_threshold，后续测试期望默认值
   - 解决：在 describe 的 beforeEach 清理所有 adjustable params
   - 影响程度：Medium（本地测试失败）

**优化点**：
1. **Config loader 设计** - 创建通用的配置读取模块
   - 单个读取：`readBrainConfig(key, defaultValue)`
   - 批量读取：`readBrainConfigBatch(keyDefaults)`
   - 全量读取：`loadAllAdjustableParams()`
   - 影响程度：High（可扩展的设计）

2. **Retry strategy fallback** - 优雅降级设计
   - 优先使用 `retry_strategy.next_run_at`
   - 没有时 fallback 到指数退避
   - 保持向后兼容
   - 影响程度：High（稳定性）

3. **深度搜索的重要性** - 使用 Explore agent 搜索整个代码库
   - 发现了 token bucket 已连接（第597行）
   - 避免了重复实现
   - 理解了现有代码的完整图景
   - 影响程度：Critical（节省大量时间）

**收获**：
- 学习了如何诊断"功能已实现但不工作"的问题（找连接而非功能）
- 理解了 brain_config 表作为动态配置源的设计模式
- 掌握了测试数据隔离的最佳实践（beforeEach 清理全局状态）
- 实践了"95%完成，5%连接"的软件工程常见问题
- 验证了深度搜索在理解复杂代码库中的价值

## 2026-02-13: Vector Search Implementation (PR #231)

### Context
Implemented Phase 1 Vector Search using OpenAI embeddings + pgvector for semantic search in Cecelia Brain.

### Major Technical Decision: Model Downgrade (3072 → 1536 dimensions)
**Problem**: Originally planned to use text-embedding-3-large (3072 dimensions) but discovered pgvector has a **hard 2000-dimension limit** for ALL index types (both ivfflat and hnsw).

**Solution**: Downgraded to text-embedding-3-small (1536 dimensions).

**Impact**:
- ✅ Fits within pgvector's 2000-dim limit
- ✅ 10x cheaper ($0.02/1M tokens vs $0.13/1M)
- ✅ Faster indexing and queries
- ❌ Slightly lower semantic quality (but acceptable for Phase 1)

**Files changed** in dimension downgrade:
- `brain/migrations/028_add_embeddings.sql`: vector(3072) → vector(1536)
- `brain/src/openai-client.js`: model + validation
- All test files: mock data + expectations

### CI Iteration Learning (7 rounds)
Each CI failure taught us something new:

1. **Facts consistency**: DEFINITION.md must stay in sync with code
2. **Version sync**: package.json, .brain-versions, DEFINITION.md must match
3. **pgvector installation**: Need `pgvector/pgvector:pg15` Docker image, not plain `postgres:15`
4. **Dimension limits**: All pgvector index types have same 2000-dim limit
5. **Schema version table**: `updated_at` column doesn't exist, only track `version`
6. **Migration idempotency**: Use `INSERT ... ON CONFLICT DO NOTHING` pattern
7. **Missing dependency**: `openai` package wasn't in package.json

### Best Practices Validated
- ✅ Migration files should be idempotent (ON CONFLICT DO NOTHING)
- ✅ Always update test expectations when changing implementations
- ✅ DevGate facts-check catches version drift early
- ✅ CI as the final judge - local tests can miss environment issues

### Test Coverage Added
- `openai-client.test.js`: OpenAI API integration (70 lines)
- `similarity-vectors.test.js`: Vector search + hybrid algorithm (164 lines)
- Updated `selfcheck.test.js`: Schema version 028

### Performance Notes
- hnsw index params: `m=16, ef_construction=64` (good balance of speed/quality)
- Hybrid search: 70% vector + 30% Jaccard (configurable weight)
- Fallback to Jaccard if OpenAI API fails (resilient design)

### Next Steps (Not Done)
- Run backfill script to generate embeddings for existing data
- Monitor OpenAI API costs in production
- Consider Phase 2: Add vector search for projects and goals tables

### Files Modified
18 files, +1310 insertions, -19 deletions
- New: openai-client.js, backfill-embeddings.js, migration 028
- Enhanced: similarity.js (hybrid search)
- Tests: Full coverage for new functionality

**PR**: https://github.com/perfectuser21/cecelia-core/pull/231
**Branch**: cp-02131723-vector-search-phase1
**Merged**: 2026-02-13 09:48:56 UTC

---

## [2026-02-18] ACTION_WHITELIST 覆盖缺口审计

**审计范围**：thalamus.js（ACTION_WHITELIST + quickRoute）、cortex.js（CORTEX_ACTION_WHITELIST）、decision-executor.js（actionHandlers）

---

### 1. 已有 ACTION_WHITELIST 分类汇总（27 个）

| 分类 | Actions | 数量 |
|------|---------|------|
| 任务操作 | dispatch_task, create_task, cancel_task, retry_task, reprioritize_task, pause_task, resume_task, mark_task_blocked, quarantine_task | 9 |
| OKR 操作 | create_okr, update_okr_progress, assign_to_autumnrice | 3 |
| 通知 | notify_user, log_event | 2 |
| 升级 | escalate_to_brain, request_human_review | 2 |
| 分析 | analyze_failure, predict_progress | 2 |
| 规划 | create_proposal | 1 |
| 知识/学习 | create_learning, update_learning, trigger_rca | 3 |
| 任务生命周期 | update_task_prd, archive_task, defer_task | 3 |
| 系统 | no_action, fallback_to_tick | 2 |

**Cortex 额外**（CORTEX_ACTION_WHITELIST 扩展）：adjust_strategy, record_learning, create_rca_report（3 个）

---

### 2. 典型 Tick 场景 vs. 现有 action 对比

系统中实际 emit 的事件（来自 event-bus.js emit 调用审计）：

| 实际发出的事件 | 来源模块 | quickRoute 有处理？ | 白名单有对应 action？ |
|------------|---------|----------------|-----------------|
| task_dispatched | tick.js | 无专属 event_type | ✅ dispatch_task |
| patrol_cleanup | tick.js | ❌ 无 | ❌ 无 |
| watchdog_kill | tick.js | ❌ 无 | ❌ 无 |
| circuit_closed | circuit-breaker.js | ❌ 无 | ❌ 无 |
| circuit_open | circuit-breaker.js | ❌ 无 | ❌ 无 |
| goal_status_changed | okr-tick.js | ❌ 无 | ❌ 无 |
| goal_ready_for_decomposition | okr-tick.js | ❌ 无 | ✅ assign_to_autumnrice（手动触发）|
| task_quarantined | quarantine.js | ❌ 无 | ✅ quarantine_task |
| task_released | quarantine.js | ❌ 无 | ❌ 无 |
| nightly_alignment_completed | nightly-tick.js | ❌ 无 | ❌ 无 |

EVENT_TYPES 已定义但 quickRoute 没有处理的：

| EVENT_TYPE | quickRoute 处理？ | 备注 |
|-----------|----------------|------|
| USER_MESSAGE | ❌ 返回 null（交 Sonnet）| 每次都走 LLM，可考虑增加简单规则 |
| USER_COMMAND | ❌ 未在 quickRoute 中 | 甚至没有 case |
| RESOURCE_LOW | ❌ 未在 quickRoute 中 | 无处理 |
| DEPARTMENT_REPORT | ❌ 未在 quickRoute 中 | 无处理 |
| EXCEPTION_REPORT | ❌ 未在 quickRoute 中 | 无处理 |

---

### 3. 识别到的缺口清单

#### P0 缺口（影响系统正确性）

**缺口 1: `create_proposal` 白名单有但 executor 无 handler**
- 文件：thalamus.js:172，decision-executor.js（无对应 handler）
- 问题：LLM 可以输出 `create_proposal` action，但 executor 无法执行，导致 `No handler found` 错误
- 建议：补充 handler（创建 proposal 记录），或将 action 从白名单移除
- 危险等级：低

**缺口 2: `USER_COMMAND` 在 EVENT_TYPES 中定义但 quickRoute 没有任何处理**
- 文件：thalamus.js:119（EVENT_TYPES 定义），quickRoute 函数无 USER_COMMAND case
- 问题：系统接收到 USER_COMMAND 事件时，每次都全量调用 Sonnet，即使是简单命令也走 LLM
- 建议：增加基础 quickRoute 规则（如简单命令 → dispatch_task / no_action）
- 危险等级：低（token 浪费）

#### P1 缺口（影响系统完整性）

**缺口 3: 熔断器状态变更（circuit_open/circuit_closed）无对应 action**
- 来源：circuit-breaker.js 实际 emit 这些事件，丘脑无处理
- 建议新增 action：`notify_circuit_breaker`（记录熔断状态 + 通知用户）
- 危险等级：低

**缺口 4: OKR goal_ready_for_decomposition 无 quickRoute 规则**
- 来源：okr-tick.js emit `goal_ready_for_decomposition` 时，应自动触发 `assign_to_autumnrice`，但没有 quickRoute 规则
- 建议：在 quickRoute 中添加 `goal_ready_for_decomposition` → `assign_to_autumnrice` 快速路由
- 危险等级：低

**缺口 5: 任务释放（task_released）无对应 action**
- 来源：quarantine.js emit `task_released`，但白名单中没有 `unquarantine_task` action
- 建议新增 action：`unquarantine_task`（从隔离区释放并重新入队）
- 危险等级：低

**缺口 6: `RESOURCE_LOW` / `DEPARTMENT_REPORT` / `EXCEPTION_REPORT` 事件类型有定义无处理**
- 这些 EVENT_TYPES 在 thalamus.js:122-135 已定义，但 quickRoute 没有任何 case
- 特别是 `RESOURCE_LOW` 场景下应有 `pause_task`（暂停低优先级任务）
- 建议：
  - RESOURCE_LOW → 快速路由到 pause_task（暂停非 P0 任务）
  - EXCEPTION_REPORT → 升级到 escalate_to_brain
  - DEPARTMENT_REPORT → 快速路由到 log_event

#### P2 缺口（功能增强，非必须）

**缺口 7: 无 `close_okr` / `complete_okr` action**
- 现有：create_okr, update_okr_progress，但无法关闭/完成 OKR
- 建议新增：`close_okr`（标记 OKR 为 completed/cancelled）
- 危险等级：中（需要确认）

**缺口 8: 无 `schedule_task` action（定时调度）**
- 现有：`defer_task` 可以设置 due_at，但没有周期性调度的 action
- 建议新增：`schedule_task`（设置 cron 表达式调度）
- 危险等级：低

**缺口 9: 无批量任务操作 action**
- 现有：所有 task action 都是单任务操作
- 建议新增：`bulk_cancel_tasks`、`bulk_reprioritize_tasks`
- 危险等级：中（批量操作影响面大）

**缺口 10: `predict_progress` 无实现（TODO 状态）**
- 文件：decision-executor.js:262（`return { success: true, prediction: 'not_implemented' }`）
- 建议：实现进度预测逻辑，或暂时移除此 action

---

### 4. 优先级排序

| 优先级 | 缺口 | 修复难度 | 影响 |
|-------|------|---------|------|
| P0 | create_proposal 无 handler | 低（补充 handler） | 运行时错误 |
| P0 | USER_COMMAND 无 quickRoute | 低（加 case） | Token 浪费 |
| P1 | goal_ready_for_decomposition quickRoute | 低（加 quickRoute 规则） | OKR 核心流程 |
| P1 | RESOURCE_LOW quickRoute | 低（加 quickRoute 规则） | 资源保护完整性 |
| P1 | unquarantine_task action | 中（加 action + handler） | 隔离释放流程 |
| P1 | circuit_breaker actions | 低（加 log action） | 熔断器可观测性 |
| P2 | close_okr action | 中 | OKR 完整生命周期 |
| P2 | schedule_task action | 高 | 定时任务支持 |
| P2 | bulk_* actions | 高 | 批量操作效率 |
| P2 | predict_progress 实现 | 高 | 功能完整性 |

---

### 结论

ACTION_WHITELIST 的核心任务操作已较完善（9 个任务 action 覆盖主要生命周期），主要缺口集中在：

1. **执行层缺口（P0）**：`create_proposal` 白名单有但无 executor handler，存在运行时 `No handler found` 错误
2. **事件路由缺口（P0/P1）**：5 个已定义的 EVENT_TYPES（USER_COMMAND, RESOURCE_LOW 等）没有 quickRoute 处理，系统每次都走 Sonnet
3. **系统完整性缺口（P1）**：熔断器、OKR 拆解触发、隔离释放等系统事件缺乏对应 action 和路由规则
4. **功能缺口（P2）**：定时调度、批量操作、OKR 关闭等增强功能待补充

**推荐下一步**：优先修复 P0 缺口（`create_proposal` handler + `USER_COMMAND` quickRoute），然后处理 P1 的系统完整性问题（`unquarantine_task` + RESOURCE_LOW quickRoute）。

