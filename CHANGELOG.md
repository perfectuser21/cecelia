# Changelog

All notable changes to ZenithJoy Engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [10.8.3] - 2026-01-26

### Fixed

- **修复 QA Decision：更新为 PASS**
  - QA-DECISION.md Decision 从 MUST_ADD_RCI 更新为 PASS
  - RCI W1-004 已添加到回归契约

## [10.8.2] - 2026-01-26

### Fixed

- **修复 DoD 文件：恢复 detect-phase.sh 完整 DoD**
  - 恢复 12 项 DoD（detect-phase.sh 功能验收项）
  - 为每项添加正确的 Evidence 引用（使用反引号格式）
  - 修复 release-check 失败问题

## [10.8.1] - 2026-01-26

### Changed

- **文档更新：添加 Evidence 引用**
  - 更新 .dod.md - 为每个 DoD 项添加 Evidence 引用
  - 更新 .layer2-evidence.md - v10.8.0 证据（包含手动验证 + 自动化测试章节）
  - 满足 Release PR (develop → main) 的 L3 要求

## [10.8.0] - 2026-01-26

### Fixed

- **质量检查系统修复：添加 detect-phase.sh 脚本**
  - 新增 `scripts/detect-phase.sh`（阶段检测脚本）
  - Stop Hook 现在可以正确检测开发阶段（p0/p1/p2/pending/unknown）
  - 修复 Stop Hook line 74 调用 detect-phase.sh 失败问题
  - 新增 `docs/PHASE-DETECTION.md` 阶段检测文档

### Added

- **RCI 更新**
  - W1-004: detect-phase.sh 存在性检查

## [10.7.0] - 2026-01-25

### Changed

- **流程优化：移除空盒子 + Preflight 智能化**
  - **P0: 移除认知污染源**
    - 删除 `scripts/devgate/l3-fast.sh`（只打印占位符，不做实际检查）
    - 移除 package.json 中的 lint/format 占位符
    - 标注 AI Review 为 "Disabled"（VPS_REVIEW_URL 未配置）
  - **P1: Preflight 智能化**
    - 重写 `scripts/devgate/ci-preflight.sh` 为智能跳过逻辑
    - 只检查 `.quality-gate-passed` 新鲜度（< 5 分钟）+ SHA 匹配
    - 不再重跑 typecheck/test
  - **效果**
    - Hook 检查从 2 分钟降到 0.5 分钟（75% 提升）
    - 总流程从 7 分钟降到 5.5 分钟
    - 认知清晰：只有 qa:gate 跑测试（唯一权威）

## [10.5.0] - 2026-01-25

### Added

- **P0: CI L2A Gate（堵绕过路径）**
  - 新增 `scripts/devgate/l2a-check.sh`（pr/release 双模式）
  - CI test job 添加 L2A pr 检查（L1 之后、DevGate 之前）
  - CI release-check job 添加 L2A release 检查（更严格）
  - 检查 4 个文件：`.prd.md`、`.dod.md`、`docs/QA-DECISION.md`、`docs/AUDIT-REPORT.md`
  - 远端强制 L2A，`gh pr merge --auto` 无法绕过

- **P1: develop PR L3 子集（防分支腐烂）**
  - 新增 `regression-pr` job（条件：`base_ref == develop`）
  - 执行 `scripts/run-regression.sh pr`（RCI 子集）
  - develop PR 自动跑回归测试，防止分支积累技术债

- **P1: ci-passed 条件 needs（避免 pending）**
  - 使用 `always()` + result 检查正确处理条件 job
  - regression-pr 和 release-check 允许 skipped 状态
  - 避免某个 job skipped 导致 ci-passed 永久 pending

- **RCI 更新**
  - C2-002: CI L2A Gate (pr mode)
  - C2-003: CI L2A Gate (release mode)
  - C4-001: develop PR regression
  - C2-001: CI test job（更新说明）

### Fixed

- 修复 `regression-contract.yaml` YAML 语法错误（escape `\s` in grep regex）
- 解决 2 个 `pr-gate-phase1.test.ts` 测试失败

## [10.4.4] - 2026-01-25

### Fixed

- **真正移除 FAST_MODE（修复 PR #273 假修复问题）**
  - 删除 hooks/pr-gate-v2.sh 第 15-16 行的 `FAST_MODE=true` 配置
  - 删除第 245-253 行的快速模式提示
  - 删除所有测试命令中的 FAST_MODE 条件（4 处）
  - 确保 `grep "FAST_MODE" hooks/pr-gate-v2.sh` 返回空
  - 本地 PR 创建现在 100% 强制执行 L1 + L2A 检查（Ralph Loop 无限修复）

## [10.4.3] - 2026-01-25

### Fixed

- 移除 hooks/pr-gate-v2.sh 中的 FAST_MODE 配置
- 本地 PR Gate 强制执行 L1 + L2A 检查
- 统一本地和 CI 的分层标准：
  - 本地: L1 + L2A（失败 → Ralph Loop 无限循环修复）
  - CI → develop: L1 + L2A + L2B
  - CI → main: L1 ~ L4

## [10.4.2] - 2026-01-25

### Fixed

- 修复 pending 阶段行为描述，明确应该等待 CI 结果而不是退出
- 更新 scripts/detect-phase.sh 中 pending 阶段的 ACTION 说明
- 更新 skills/dev/SKILL.md 添加 pending 等待流程图
- 新增 skills/dev/steps/09.5-pending-wait.md 文档说明等待循环逻辑

## [10.4.0] - 2026-01-25

### Changed

- **P1 轮询循环 - 正确的两阶段分离**
  - Step 8 (08-pr.md): PR 创建后不调用 Step 9，由 Stop Hook 触发会话结束
  - Step 9 (09-ci.md): 改为完整的 while 轮询循环（在 P1 阶段执行）
    - 运行中/等待中：sleep 30s 后继续
    - 失败：修复代码 → push → continue（继续循环，不退出）
    - 成功：自动合并 PR → break（退出循环）
  - skills/dev/SKILL.md: 更新流程图和核心规则
  - 两阶段分离：
    - P0 (会话 1): 质检 → PR 创建 → 结束（不等 CI）
    - P1 (会话 2): 轮询循环 → 持续修复直到成功

### Added

- **regression-contract.yaml**: W1-008 - P1 阶段轮询循环（新增 RCI）
- **超时保护**: P1 轮询循环 1 小时超时自动退出

### Updated

- **regression-contract.yaml**: W1-004 - P0 阶段完整流程（Step 8 不调用 Step 9）
- **features/feature-registry.yml**: W1 feature 描述更新

## [10.3.0] - 2026-01-25

### Changed

- **术语更新**: Checkpoint → Task
  - 避免与官方 Claude Code Checkpoint（自动撤销功能）混淆
  - 官方 Checkpoint: 文件级别自动保存（Esc+Esc rewind）
  - 我们的 Task: 开发单元（1 个 PR）

- **文件更新**:
  - skills/dev/steps/03-branch.md - 添加概念说明
  - docs/INTERFACE-SPEC.md - API 完整更新（checkpoints → tasks）
  - templates/prd-schema.json - Schema 字段更新
  - templates/PRD-TEMPLATE.md - 模板更新
  - templates/prd-example.json - 示例更新
  - n8n/test-prd*.json - 测试文件更新
  - regression-contract.yaml - RCI 引用更新
  - skills/dev/scripts/track.sh - 脚本变量更新

## [10.2.0] - 2026-01-24

### Changed

- **skills/dev/steps/01-prd.md**: 清理垃圾提示词
  - 删除"等用户确认"、"用户确认后才能继续"
  - 改为"生成 PRD 后直接继续 Step 2"

- **skills/dev/steps/05-code.md**: 清理垃圾提示词
  - 删除"停下来，和用户确认"
  - 改为"更新 PRD，调整实现方案，继续"

### Removed

- **skills/dev/steps/02.5-parallel-detect.md**: 删除并行检测步骤
  - 不需要询问用户选择 worktree
  - 一次只做一个任务，自动检测即可

### Added

- **skills/dev/SKILL.md**: 多 Feature 支持文档
  - 简单任务：单 PR 流程（向后兼容）
  - 复杂任务：拆分 Features → 多个 PR
  - 状态文件格式：`.local.md` + YAML frontmatter（官方标准）
  - `/dev continue` 命令支持

### Fixed

- **skills/dev/steps/03-branch.md**: 清理过时示例
  - 移除 parallel-detect 分支命名示例
  - 更新 Checkpoint 示例，删除 CP-001-parallel-detect

## [10.0.2] - 2026-01-24

### Added

- **docs/production/PROD-READINESS.md**: v10.0.0 生产就绪报告
  - 三层防御体系实证验收
  - 验收完成度统计 (单元测试 186/186, RCI 13/13)
  - 核心机制说明 (GitHub 原生 Auto-merge, 两阶段工作流)
  - 生产使用指南和回归验证清单

## [10.0.1] - 2026-01-24

### Fixed

- **pr-gate-v2.sh**: 验证逻辑宽松匹配，避免误判
  - QA-DECISION.md Decision 字段支持 Markdown 标题和空格变化
  - AUDIT-REPORT.md Decision: PASS 大小写不敏感，增加 TBD 拦截
  - DoD 检查改为"全勾完成"而非"本次修改"，对齐两阶段工作流

## [10.0.0] - 2026-01-24

### BREAKING CHANGES

- **Contract Rebase**: 文档架构重构，建立单一事实源体系
  - `features/feature-registry.yml` 成为唯一的 Feature 定义位置
  - 所有其他文档（FEATURES.md, Minimal/Golden/Optimal Paths）变为派生视图
  - 旧的手动维护模式废弃，全部改为自动生成
  - 修改 feature 定义必须先更新 registry，再运行生成脚本

### Added

- **单一事实源**: `features/feature-registry.yml`
  - Platform Core 5: H1 (Branch Protection), H7 (Stop Hook), H2 (PR Gate), W1 (Two-Phase), N1 (Cecelia)
  - Product Core 5: P1 (Regression), P2 (DevGate), P3 (QA Reporting), P4 (CI Gates), P5 (Worktree)
  - 机器可读的 YAML 结构化定义，包含 entrypoints/golden_path/minimal_paths/tests/rcis

- **Contract 文档**:
  - `docs/contracts/WORKFLOW-CONTRACT.md` - 两阶段工作流契约（p0/p1/p2 状态机）
  - `docs/contracts/QUALITY-CONTRACT.md` - 三套质量分层体系（质检流程/问题严重性/测试覆盖度）

- **派生视图（自动生成，不可手动编辑）**:
  - `docs/paths/MINIMAL-PATHS.md` - 最小验收路径（每个 feature 1-3 条）
  - `docs/paths/GOLDEN-PATHS.md` - 端到端成功路径（GP-001 ~ GP-007）
  - `docs/paths/OPTIMAL-PATHS.md` - 推荐体验路径
  - `scripts/generate-path-views.sh` - 从 registry 生成视图的脚本

- **自动化防漂移机制**:
  - CI `contract-drift-check` job - 检测视图与 registry 不同步，失败时提供修复步骤
  - 强制开发者更新 registry 后运行生成脚本，确保一致性
  - 系统特性：可持续自动维护，防止"2 周后又漂移"

- **DRCA v2.0 事件驱动诊断闭环**:
  - `docs/runbooks/DRCA-v2.md` - 事件驱动诊断闭环
  - 核心变化：从"连续等待诊断"升级到"事件驱动诊断"
  - CI fail → 诊断 → 修复 → push → 退出 → 等待下次事件唤醒（不挂着）

- **RCI v2.0.0 语义对齐**:
  - **W1-004**: "Loop 1 循环" → "p0 阶段完整流程"（P0）
  - **W1-005**: "CI 失败后循环" → "p1 阶段事件驱动修复"（P0）
  - **W1-006**: 新增 "p2 阶段自动 merge"（P0）
  - **N1-004**: 新增 "p1 阶段无头修复语义"（P0）
  - **H7-001/002/003**: Stop Hook 质量门禁 RCI（P0）

- **验收清单**: `docs/CONTRACT-REBASE-ACCEPTANCE.md` - 94% 完成度追踪

### Changed

- **FEATURES.md**: 从独立文档变为派生视图，指向 registry 为真源
  - 添加 H7: Stop Hook Quality Gate（v2.0.0 核心）
  - 更新 W1: "11 步流程" → "Two-Phase Dev Workflow"
  - 更新 W5: "四模式" → "Phase Detection (p0/p1/p2/pending/unknown)"
  - 废弃 W3: "循环回退" → 被 p1 事件驱动循环替代
  - 添加 v2.0.0 重要变更说明，指向单一事实源

- **regression-contract.yaml**: 添加 H7/W1/N1 的 v2.0.0 RCI
  - H7: 3 条 RCI（p0 质检门禁 / p1 CI 状态 / 阶段检测集成）
  - W1: 更新 W1-004/005 语义，新增 W1-006（p0/p1/p2 完整覆盖）
  - N1: 新增 N1-004（p1 无头修复语义）

- **skills/dev/SKILL.md**: 更新流程图，对齐 v2.0.0 两阶段工作流

### Documentation

- `docs/ENFORCEMENT-REALITY.md` - Stop Hook 强制能力的现实
- 所有 Contract 和 Path 文档包含明确的来源说明和更新规则

## [9.5.0] - 2026-01-24

### Added

- **两阶段工作流**: 用 Stop Hook 强制本地质检（100% 强制能力）
  - 阶段 1: 本地开发 + 质检（Stop Hook 阻止未质检退出）
  - 阶段 2: 提交 PR + CI（服务器端验证）
  - hooks/stop.sh: 质检门控，检查 .quality-gate-passed 存在性和时效性
  - scripts/qa-with-gate.sh: 运行质检，成功时生成门控文件
  - npm run qa:gate: 带门控的质检命令
  - Retry Loop: AI 被迫循环直到质检通过
  - 时效性检查: 代码改动后质检结果失效，必须重新质检

### Changed

- **pr-gate-v2.sh v4.0**: 快速模式（FAST_MODE=true）
  - 只检查产物存在性，不运行测试
  - 测试已在阶段 1 通过 Stop Hook 强制完成
  - 减少 PR 创建等待时间

### Documentation

- **极简工作流**: PreToolUse + Ralph Loop + Stop Hook
  - docs/SIMPLIFIED-WORKFLOW.md: 极简流程说明（一句话：PreToolUse 管入口，Ralph Loop 自己跑，Stop Hook 管出口）
  - docs/COMPLETE-WORKFLOW-WITH-RALPH.md: Ralph Loop 完整流程图和使用示例
  - docs/TWO-PHASE-WORKFLOW.md: 两阶段工作流详细文档
  - 集成 Ralph Wiggum 官方插件（已安装）
  - 说明真正有强制能力的只有 2 个 Hook: PreToolUse:Write 和 Stop

- **8.x/9.0 要求验证**: 所有要求 100% 保留
  - docs/REQUIREMENT-VERIFICATION.md: 完整的要求对比和验证清单
  - Gate Contract 6 大红线: 全部保留（DoD、QA 决策、P0 检测、RCI、白名单、分支保护）
  - 新增 Stop Hook 强化: Audit + 测试 + 时效性检查（0% → 100% 强制能力）
  - Ralph Loop 100% 自动执行: 写代码 + 写测试 + 质检 + 失败重试

### Integration

- **Ralph Loop 集成**: 与 Stop Hook 协作实现自动质检循环
  - Ralph Loop: 外层循环，重复注入任务提示语
  - Stop Hook: 质检门控，跑不完不让结束
  - completion-promise: Ralph 的结束信号
  - max-iterations: 防止无限循环（双重保护）

## [9.4.1] - 2026-01-24

### Fixed

- **pr-gate-v2.sh v3.1**: 添加 timeout 保护，防止测试命令卡住
  - 所有测试命令（typecheck, lint, test, build, pytest, go test）添加 120s 超时
  - 超时时明确提示 `[TIMEOUT - 120s]` 而不是无限等待
  - 降级支持：系统没有 timeout 命令时直接运行（旧版 macOS）
  - 修复用户发现的关键漏洞：测试卡住时 Hook 永远等待的问题

## [9.4.0] - 2026-01-24

### Added

- **GitHub Actions Auto Merge**: 配置自动合并工作流
  - 在 PR approved + CI 通过后自动合并
  - 使用 squash merge 保持历史简洁
  - 适配 A+ (100%) Team Organization 保护要求
  - 超时 5 分钟避免配额浪费

### Changed

- **升级到 Team Organization**: A+ (100%) Branch Protection
  - required_approving_review_count: 1（必须人工审核）
  - restrictions: 空（禁止任何人直接 push）
  - enforce_admins: true（Admin 也必须遵守）
  - 转移仓库到 ZenithJoycloud Organization

## [9.3.6] - 2026-01-23

### Fixed

- **测试目录污染**: 修复 pr-gate-phase2.test.ts 污染 PROJECT_ROOT
  - 所有测试改用独立临时目录（带时间戳避免冲突）
  - 添加 beforeEach 清理，防止测试之间污染
  - 添加 afterAll 全局清理，防止残留文件
  - 修复 Hook 环境测试不稳定问题（186/186 稳定通过）

## [9.3.5] - 2026-01-23

### Fixed

- **release-check.sh 可移植性**: grep 无匹配时添加 `|| true`
  - 修复最后一个块（C4）处理时 `set -e` 导致脚本提前退出的问题

## [9.3.4] - 2026-01-23

### Fixed

- **release-check.sh 兼容性**: 使用 `sed '$d'` 替代 `head -n -1`
  - 处理最后一个块（无下一个 ###）的情况

## [9.3.3] - 2026-01-23

### Fixed

- **release-check.sh awk 模式 bug**: 使用 sed 替代 awk 提取证据块
  - 修复范围模式在同一行匹配开始和结束的问题

## [9.3.2] - 2026-01-23

### Changed

- **Release 证据补充**: 更新 .layer2-evidence.md 用于 v9.3.1 release

## [9.3.1] - 2026-01-23

### Fixed

- **H3-001 回归期望值**: 将 `hook-core version: 1.0.0` 改为通用匹配 `hook-core version:`
  - 避免版本升级时回归测试失败

## [9.3.0] - 2026-01-23

### Added

- **Worktree 并行开发检测**: 在 /dev 流程中自动检测活跃分支
  - 新增 `skills/dev/steps/02.5-parallel-detect.md`: 并行开发检测步骤
  - 新增 `skills/dev/scripts/worktree-manage.sh`: Worktree 管理脚本
    - `create <task-name>`: 创建新 worktree
    - `list`: 列出所有 worktree
    - `remove <branch>`: 移除指定 worktree
    - `cleanup`: 清理已合并的 worktree

- **Cleanup worktree 清理**: cleanup.sh 新增 Step 4.5
  - 自动检测并移除关联的 worktree
  - 安全处理未提交改动的情况

### Changed

- **SKILL.md**: 流程图更新，添加并行检测步骤
- **03-branch.md**: 添加 worktree 环境感知

---

## [9.2.0] - 2026-01-23

### 🎉 里程碑版本：完整质量保证体系

**核心成果**：建立"可证伪、可审计、可强制、可交叉验证"的质量保证体系。

#### Full-System Validation 7/7 全绿

| 验证项 | 结果 |
|--------|------|
| Gate Full Test | ✅ 52/52 |
| Regression Full Test | ✅ 186/186 |
| RCI Coverage | ✅ 100% (8/8) |
| Anti-Cheat Test | ✅ exit=1 |
| CI Integrity | ✅ 4/4 guards |
| GCI Draft | ✅ Working |
| Cross-Verify | ✅ 8=8 |

#### 四项核心验证

1. **可证伪** - 新增未覆盖入口 → exit code = 1
2. **可审计** - `--explain` 输出分母来源 + 匹配原因
3. **强制执行** - CI DevGate 阻塞未覆盖入口
4. **独立交叉验证** - `--stats` 分母核对 + 防篡改哨兵

#### 验证命令

```bash
npm run coverage:rci -- --explain  # 审计证据
npm run coverage:rci -- --stats    # 独立分母核对
bash scripts/devgate/assert-ci-guards.sh  # 防篡改哨兵
```

---

## [9.1.4] - 2026-01-23

### Added

- **scan-rci-coverage.cjs `--stats` 模式**: 独立分母核对
  - 用 find/ls 独立计数，与扫描器对比
  - 验证扫描器没有漏算

- **scripts/devgate/assert-ci-guards.sh**: 防篡改哨兵
  - 验证 CI 守门没有被移除
  - 检查 coverage:rci、version-check、DevGate、release-check

### Milestone

**独立交叉验证**: 从"自证"变成"可信"

四项验证全部完成：
1. ✅ 可证伪（反证能 fail）
2. ✅ 可审计（--explain 有分母来源 + 匹配原因）
3. ✅ 强制执行（CI 守门）
4. ✅ 独立交叉验证（--stats 分母核对 + 防篡改哨兵）

---

## [9.1.3] - 2026-01-23

### Added

- **scan-rci-coverage.cjs `--explain` 模式**: 输出详细审计证据
  - 分母验证：扫描规则 + 入口清单 + 文件存在性
  - 分子验证：命中的 RCI 条目 + 匹配原因

- **CI RCI 覆盖率守门**: DevGate 检查集成 `coverage:rci`
  - 新增业务入口必须添加 RCI 条目，否则 CI 失败
  - 失败时输出修复指引

### Milestone

**RCI 可验证性**: 100% 覆盖率现在是"可证伪的真实"，而不是"自嗨数字"

验证方式：
1. `npm run coverage:rci -- --explain` 查看审计证据
2. 新增入口不加 RCI → CI 阻塞

---

## [9.1.2] - 2026-01-23

### Added (RCI 条目补充)

- **C1-008**: /qa Skill 加载
- **C1-009**: /audit Skill 加载
- **C1-010**: /assurance Skill 加载
- **C3-004**: run-regression.sh 执行回归测试
- **C3-005**: qa-report.sh 生成报告
- **C3-006**: release-check.sh 发布检查

### Milestone

**RCI 覆盖率达到 100%** (8/8 业务入口)

从此进入增量维护模式：
- 新增业务入口 → 必须添加 RCI 条目
- Gate 改动 → 只更新 GCI（不影响 RCI）

---

## [9.1.1] - 2026-01-23

### Added

- **scripts/devgate/scan-rci-coverage.cjs**: RCI 覆盖率扫描器
  - 枚举业务入口（Skills, Hooks, Scripts）
  - 解析 RCI 并计算覆盖率
  - 生成 baseline-coverage.json 和 BASELINE-SNAPSHOT.md

- **tests/gate/scan-rci-coverage.test.ts**: 17 个单元测试

- **npm run coverage:rci**: 检查 RCI 覆盖率命令

### Baseline Snapshot

当前 RCI 覆盖率: 25% (2/8 业务入口)

未覆盖入口（需后续添加 RCI）：
- /qa, /audit, /assurance Skills
- run-regression.sh, qa-report.sh, release-check.sh

---

## [9.1.0] - 2026-01-23

### Added

- **scripts/devgate/draft-gci.cjs**: GCI 草稿自动生成
  - 分析 git diff，检测 Gate 相关文件改动
  - 自动生成契约草稿（YAML 格式）
  - 用法: `node scripts/devgate/draft-gci.cjs [--base <branch>] [--output <file>]`

- **tests/gate/draft-gci.test.ts**: 19 个单元测试
  - isGateFile: Gate 文件模式匹配
  - getCategory: GCI 分类映射
  - generateDraft: 草稿生成逻辑

### Changed

- **/assurance Skill**: 集成 draft-gci 自动化工具
- 体系从"手写契约"升级为"审核契约草稿"

---

## [9.0.0] - 2026-01-23

### 里程碑版本：RADNA 体系 + 全量审计 + Gate Test Suite

**核心成果**：建立"可封顶、可收口"的质量保证体系，终结 Gate/Regression/QA/Audit 的混乱。

---

### Added (RADNA 体系)

#### 4 层架构
| 层级 | 名称 | 文件 |
|------|------|------|
| L0 | Rules（宪法） | `docs/policy/ASSURANCE-POLICY.md` |
| L1 | Contracts（契约） | `contracts/gate-contract.yaml`, `contracts/regression-contract.yaml` |
| L2 | Executors（执行器） | `scripts/run-gate-tests.sh`, `scripts/run-regression.sh` |
| L3 | Evidence（证据） | `artifacts/QA-DECISION.md`, `artifacts/AUDIT-REPORT.md` |

#### /assurance Skill
- **skills/assurance/SKILL.md**: 统一的质量保证协调者
- 自动判断 PR 改动属于 Gate 还是 Business
- 强制更新对应契约（GCI / RCI）
- 自动生成 QA/Audit 产物

#### Gate Contract (GCI)
- **contracts/gate-contract.yaml**: 保护检查系统不会放错行
- 6 大红线：空 DoD、空 QA、优先级误判、CI 跳过、白名单穿透、误删分支

#### Regression Contract (RCI)
- **contracts/regression-contract.yaml**: 保护业务功能不回归
- 重新组织为 C1-C6 系列

---

### Added (Gate Test Suite)

- **tests/gate/gate.test.ts**: 16 个检查系统自测
  - A1: 空 DoD 必须 fail
  - A2: QA 决策空内容必须 fail
  - A3: P0wer 不应触发 P0 流程
  - A5: release 模式不跳过 L1 RCI
  - A6: 非白名单命令必须 fail
  - A7: checkout 失败后不删除分支

- **docs/KNOWN-ISSUES.md**: 6 个 B 层问题的触发条件和 workaround

---

### Fixed (全量审计 - 152 个问题)

#### hooks/ (24 个问题)
- **branch-protect.sh v16**: 非 git 仓库/空分支名改为 exit 2、realpath 兼容性
- **pr-gate-v2.sh v3.0**: 空 DoD 检查、QA 内容校验、jq 检查

#### scripts/devgate/ (25 个问题)
- **detect-priority.cjs**: 词边界修复（防止 P0wer 误匹配）、CRITICAL/HIGH/security 映射
- **metrics.cjs/append-learnings.cjs**: 修复参数解析双重递增 bug

#### scripts/ (30 个问题)
- **run-regression.sh**: npm 命令限制（只允许 test/qa/build/ci/install）
- **install-hooks.sh**: cp 失败时显示警告而非 OK
- **cleanup.sh**: checkout 失败时跳过远程分支删除

#### CI/YAML (22 个问题)
- **ci.yml**: ci-passed 依赖 release-check（PR to main 时）、fetch-depth: 0

#### TypeScript (22 个问题)
- 测试污染修复、输出格式更新

---

### Changed

- 测试数量从 134 增加到 150+
- 目录结构重组（contracts/, artifacts/, docs/policy/）

---

## [8.25.0] - 2026-01-23

### Fixed (P0 优先级检测 Bug 修复)

- **detect-priority.cjs**: 添加 CRITICAL→P0, HIGH→P1, security→P0 映射
- 21 个单元测试覆盖优先级检测

## [8.24.0] - 2026-01-23

### Security (CRITICAL 级安全修复)

- branch-protect.sh: JSON 预验证防止注入
- pr-gate-v2.sh: 命令执行安全加固
- run-regression.sh: 白名单限制

## [8.23.0] - 2026-01-22

### Added

- DoD ↔ Test 映射检查
- P0/P1 → RCI 更新检查
- 回归契约 v1.0（67 个条目）
