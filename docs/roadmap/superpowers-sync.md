# Superpowers 对齐历史

> 官方 Superpowers 目录：`~/.claude-account3/plugins/cache/superpowers-marketplace/superpowers/`
> 每季度或官方发布新版本时手工补一条。
> 自动检测脚本：`scripts/check-superpowers-upgrade.sh`（cron monthly）

---

## 对齐快照表

| 日期 | Superpowers 版本 | 我们 Engine 版本 | 对齐度 | 关键变更 |
|------|------------------|------------------|--------|----------|
| 2026-04-18 | 5.0.7 | 14.17.0 | 79% skill / 95% 交互点 | F3/F4 补全 |

---

## 对齐度定义

- **skill 覆盖**：我们 engine 内等价实现 / 官方 Superpowers 所有顶层 skill 数量
- **交互点**：两边 skill 内所有行为细节（prompts/steps/gates）的 1:1 复刻率

---

## 关键变更说明

### 2026-04-18 — F3/F4 补全（PR #2382 + #2386）

F3 PR #2382 补三个核心缺口到 Implementer prompt：
1. Condition-Based Waiting（禁 setTimeout/sleep，改用 waitFor）
2. Pre-Completion Verification（完成前三项自证）
3. Root-Cause Tracing（bug fix 向上追 4+1 步）

F4 PR #2386 引入 4 新 skill + 修 4 gap：
1. receiving-code-review（Reviewer ARCHITECTURE_ISSUE 升级链）
2. requesting-code-review（PR body 5 项规范）
3. executing-plans（Critical Gap Abort + BLOCKED 升级链 v2）
4. finishing-a-development-branch（Discard 安全确认）

skill 覆盖 50% → 79%；交互点 1:1 复刻 78% → 95%。

剩余 5% 非关键路径（见 Epic F 的 F4.1）。

---

## 升级触发规则

- `scripts/check-superpowers-upgrade.sh` 每月 1 号 cron 检测
- 官方版本号变化时，脚本创 Brain task P1 告警
- 人工评估 → 决定是否启动新的 F 系列 PR

---

## 加强牌 vs 1:1 对照表

> **约定**：我们的 autonomous /dev 对 Superpowers 采取 **Option B** 策略 —— 保留所有 1:1 替换点，同时允许在 autonomous 场景下加强牌超出官方。本表区分两类，防止未来升级时混淆。
>
> - `[1:1]` = Superpowers 等价替换（人 → agent，其他不变）
> - `[加强]` = 我们自创，官方没有。未来可能合并到 Superpowers，也可能永远只是我们的工程保险
> - `[丢弃]` = Superpowers 有但我们刻意不做（通常因 autonomous 场景不适用）

### 17 个交互点的标签

| # | superpowers 交互点 | 我们的处理 | 标签 |
|---|---|---|---|
| 1 | brainstorming HARD-GATE design approval | autonomous 自决（Research Subagent） | `[1:1]` |
| 2 | brainstorming visual companion offer | 永不启用（autonomous 无浏览器） | `[丢弃]` |
| 3 | brainstorming design section approval | Self-Review 5 步合并一次 | `[1:1]` |
| 4 | brainstorming spec doc review | Spec Reviewer 独立审 | `[1:1]` |
| 5 | brainstorming visual companion consent | 同 #2 | `[丢弃]` |
| 6 | writing-plans subagent vs inline 选择 | 固定 subagent-driven | `[1:1]` |
| 7 | finishing 4 选项 | 固定 push + PR | `[1:1]` |
| 8 | finishing discard typed-confirm | autonomous abort + Brain task | `[1:1]`（F4 新加） |
| 9 | using-worktrees 路径选择 | 固定 `~/worktrees/cecelia/` | `[1:1]` |
| 10 | using-worktrees test-fail proceed? | baseline test 非关键路径 | `[1:1]`（部分替代）|
| 11 | subagent implementer questions | controller 传 full context | `[1:1]` |
| 12 | executing-plans 疑虑上报 | Step 5 Critical Gap Abort | `[加强]`（见下） |
| 13 | executing-plans 阻塞升级 | BLOCKED 升级链 v2 | `[加强]`（见下） |
| 14 | receiving-code-review 信息澄清 | Spec Reviewer "不信任 Implementer" | `[1:1]` |
| 15 | receiving-code-review 架构升级 | ARCHITECTURE_ISSUE 分支派 architect-reviewer | `[1:1]`（F4 新加） |
| 16 | systematic-debugging 多次失败升级 | 改派 dispatching-parallel-agents（F4 修正）| `[加强]`（见下） |
| 17 | verification-before-completion gate | Pre-Completion Verification 清单（F3）| `[1:1]` |

**统计**：`[1:1]` = 12 / `[加强]` = 3 / `[丢弃]` = 2。`[加强]` 中 #13 和 #16 实际上是把"问人"替换成"自动诊断"，界于 1:1 和加强之间；严格讲只有 #12 是纯加强。

### 4 条自创加强牌（非替换，纯增加）

| # | 加强项 | 位置 | 为什么加 | 是否未来拉回 1:1 |
|---|---|---|---|---|
| E1 | **Critical Gap Abort** | `01-spec.md §0.2.5 Step 5` | Self-Review 发现 PRD 矛盾 / 核心文件缺失 / DoD 语法错 / 决策冲突 → 暂停 autonomous 创 Brain task。官方 `executing-plans` 只说"raise concerns with human partner"，但 autonomous 无人看，所以**硬阻断**防继续跑坏 plan。 | ❌ 不会。无人值守必须有阻断 |
| E2 | **BLOCKED 升级链 v2**（第 3 次派 dispatching-parallel-agents） | `02-code.md §2.5` | 官方 `systematic-debugging` 说"3+ failures: discuss with human"，我们改成自动派 3 个诊断 subagent。纯自动化场景下"停问人"不可行。 | ⚠️ 可考虑。如果未来引入 human feedback 通道，可回归官方 |
| E3 | **决策硬约束**（`.decisions-<branch>.yaml` + Reviewer 检查） | `Step 0.7 + 01-spec.md §0.2.1 + 02-code.md §2.3` 核心检查 5 | 官方无 decision 概念。我们加是因为跨 PR 技术决策容易打架（上个 PR 选 PostgreSQL，下个选 MongoDB），autonomous 无全局人工监督，必须中央化约束。 | ❌ 不会。这是我们 Brain + Harness 架构的护城河 |
| E4 | **相关目录全套回归强制** | `02-code.md §2.2` | 官方 `test-driven-development` 只说"test the change"，我们要求"改 hooks/ 必须跑 tests/hooks/ 全套"。autonomous 下无人盯，需要工程保险防 T4-scenario 冲突（如 PR #2338 教训）。 | ❌ 不会。是 autonomous 质量底线 |

### 决策：保留 Option B，定期自检

- **加强牌全部保留**。它们是 autonomous 场景的必要工程化
- **每次 Superpowers 升级后**，跑 `scripts/audit-superpowers-sync.sh`（R1 已建）对比新官方 → 如发现官方补上了我们的加强牌（比如未来加了 Critical Gap Abort 类似机制），改标签为 `[1:1]`
- **禁止无记录的新加强**。未来若要加新的 `[加强]`，必须在本表追加一行，写明"为什么加 / 未来是否拉回"

---

### 历史一致性记录

| 日期 | 加强牌数 | 统计覆盖 |
|------|----------|----------|
| 2026-04-18 | 4 | skill 覆盖 79% / 交互点 1:1 95% + 加强 +4 |
