---
name: dev
version: 14.17.10
updated: 2026-04-18
description: 统一开发工作流（4-Stage Pipeline）。代码变更必须走 /dev。**Phase 1 Round 2 起 autonomous（Superpowers 三角色 subagent）是唯一模式**，Standard 代码已完全删除。保留 Harness v2.0 模式（Brain 派的 harness_generate task）。autonomous-research-proxy 用户交互替换层默认加载。
trigger: /dev, --task-id <id>
changelog:
  - 14.17.8: Phase 1 Round 2 — 真正删除 Standard 代码。01-spec.md §1.1-1.3 主 agent 直写分支 (95 行) / 02-code.md §3 standard mode (~50 行) / SKILL.md 流程标准模式章节 全部删除。autonomous_mode flag 从 .dev-mode schema 去除（parse-dev-args.sh 固定 AUTONOMOUS_MODE=true，--autonomous CLI flag 降级为 warn）。清理 00.5-enrich / 00.7-decision-query / 04-ship 的 autonomous_mode 门禁代码。autonomous 正式成为 /dev 唯一模式，harness_mode 保留给 Brain harness pipeline 用。
  - 14.17.7: Phase 1 Round 1 — Standard 模式弃用通告（代码暂留）+ 新增 Brain orphan-pr-worker 兜底扫孤儿 cp-* PR
  - 7.2.0: autonomous_mode 强制加载 autonomous-research-proxy — Superpowers user 交互点全替换为 Research Subagent
  - 7.1.0: autonomous_mode 新增 Step 0.5 PRD Enrich 前置层 — 粗 PRD 自动丰满
  - 7.0.0: Superpowers 融入 — autonomous_mode 三角色架构
---

> **CRITICAL LANGUAGE RULE（语言规则）**: 所有输出必须使用简体中文。

## 启动

```bash
cat ~/.claude-account1/skills/dev/steps/00-worktree-auto.md 2>/dev/null || cat ~/.claude/skills/dev/steps/00-worktree-auto.md
```

先执行 Step 00（Worktree 创建），再继续 Stage 1-4。

---

## Harness v2.0 模式

当 task payload 包含 `harness_mode: true` 时，/dev 作为 Generator 执行器运行：

```
Harness 模式简化流程:
  Step 0: Worktree  → 创建独立 worktree（不变）
  Stage 1: Spec     → 跳过自写 Task Card/DoD，读 sprint-contract.md
  Stage 2: Code     → 写代码，不逐条验证 DoD（Evaluator 来验）
  Stage 3: Integrate → push + PR 创建
  Stop Hook         → 代码完成 + PR 已创建 → exit 0（Brain 派 Evaluator）
```

**不执行**: DoD 逐条验证、CI 等待、Learning 写入、PR 合并。

`.dev-mode` 中标记 `harness_mode: true` + `sprint_dir: sprints/sprint-N`。

---

## 流程

```
Step 0: Worktree     → 创建独立 worktree
Step 0.5: PRD Enrich → 粗 PRD 自动丰满（Enrich Subagent）
Stage 1: Spec        → 读 enriched PRD 写 Task Card + DoD → .dev-mode
Stage 2: Code        → Subagent 三角色（Implementer / Spec Reviewer / Code Quality Reviewer）
Stage 3: Integrate   → push + PR 创建（CI 由 Stop Hook 自动监控）
Stage 4: Ship        → Learning + 自动合并 + cleanup（Stop Hook 自动执行）
```

**唯一完成标志**: PR 已合并到 main。autonomous-research-proxy.md 默认加载，替代用户交互点。

**职责分离原则**：
- **文档面**（steps/*.md）：产出代码、Learning、状态标记（step_N: done）
- **代码面**（devloop-check.sh）：CI 监控、PR 合并、cleanup.sh 调用、cleanup_done 写入

---

## 核心规则

1. **只在 cp-* 分支写代码**（Hook 强制）
2. **遇到问题自动修复**（禁止"建议手动"/"等待用户"）
3. **Stop Hook 保证循环**：PR 未合并 → exit 2 → 继续执行
4. **每步完成后立即执行下一步**，不停顿
5. **职责分离**：文档面产出，代码面控制（CI/合并/清理）

---

## Stop Hook 完成条件（devloop-check.sh）

### 标准模式

```
0. cleanup_done: true → exit 0（结束）
1. step_1_spec done？
2. step_2_code done？ + DoD 全部 [x]
3. PR 已创建？
4. CI 通过？（失败→Stop Hook 指导修复→重推）
5. PR 已合并？→ cleanup.sh + cleanup_done → exit 0
6. step_4_ship done？→ 自动合并 PR → cleanup.sh → cleanup_done → exit 0
```

### Harness 模式（harness_mode: true）

```
0. cleanup_done: true → exit 0（结束）
1. step_2_code done？
2. PR 已创建？
→ 两项满足即 exit 0，Brain 派 Evaluator
```

---

## 版本号

Brain: auto-version.yml 自动处理，PR 不手动 bump。
Engine: 手动 bump 6 文件（package.json/lock/VERSION/.hook-core-version/regression-contract.yaml/feature-registry.yml）。

---

## 加载策略

```
skills/dev/
├── SKILL.md              ← 入口
├── steps/00-worktree-auto.md
├── steps/01-spec.md      ← Stage 1
├── steps/02-code.md      ← Stage 2
├── steps/03-integrate.md ← Stage 3
├── steps/04-ship.md      ← Stage 4
└── scripts/              ← 6 个辅助脚本
```

---

## 模式说明（Phase 1 Round 2 统一后）

**触发**: `/dev` 或 `/dev --task-id <id>`。`--autonomous` flag 已废弃（保留别名防老脚本报错，会 warn）。

**加载顺序**: /dev 启动后主 agent 必须先加载 `packages/engine/skills/dev/steps/autonomous-research-proxy.md` 到系统 context，再进入 Step 0。该文件定义 Superpowers 所有 user 交互点 → Research Subagent 的替换规则。

**流程**:
- Stage 1: `superpowers:brainstorming` + `superpowers:writing-plans` 自主产出 plan（Research Subagent 替代用户）
- Stage 2: `superpowers:subagent-driven-development` 三角色（Implementer / Spec Reviewer / Code Quality Reviewer）
- Stage 3-4: push / PR / CI / merge 自动化

**跳过**: 所有用户交互问询（2-3 方案选择、DoD 确认等）、Implementer 的"有问题要问吗"

**不跳过**（质量兜底）:
- Spec Reviewer 审查（不信任 Implementer 报告）
- Code Quality Reviewer 审查
- 失败升级规则（BLOCKED 3 次升级、Reviewer 3 轮换 implementer、3 task BLOCKED 重做 plan）
- Stop Hook 所有检查
- CI 自动合并

**harness_mode**（Brain 派的 `harness_generate` 任务）仍保留 shortcut：step_2_code done + PR 创建 → exit 0，由 harness-evaluator 接手。
