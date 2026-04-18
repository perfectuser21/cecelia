---
name: dev
version: 15.0.0
updated: 2026-04-18
description: 统一开发工作流（4-Stage Pipeline）。代码变更必须走 /dev。autonomous 为默认（唯一）模式，harness_mode 为独立 Harness v2.0 模式。孤儿 PR 由 Brain orphan-pr-worker 兜底。
trigger: /dev, --task-id <id>
changelog:
  - 15.0.0: 模式统一 — 删除 Standard mode + autonomous_mode flag（autonomous 永远开）；harness_mode 保留为独立模式；新增孤儿 PR 兜底说明
  - 14.17.6: autonomous_mode 强制加载 autonomous-research-proxy
  - 14.14.0: autonomous_mode 新增 Step 0.5 PRD Enrich 前置层
  - 14.0.0: Superpowers 融入 — autonomous_mode 三角色架构
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

## 默认流程（autonomous，Subagent 三角色）

> autonomous 是唯一的默认流程。历史的 "Standard mode"（主 agent 直接写 Task Card/代码）与
> "autonomous_mode" 已在 v15.0.0 合并为单一流程。`.dev-mode` 中的 `autonomous_mode:` 字段
> 被忽略（向后兼容）。

```
Step 0:   Worktree       → 创建独立 worktree
Step 0.5: PRD Enrich     → 粗 PRD 自动丰满（可选，Brain 派发时触发）
Step 0.7: Decision Query → 读历史决策约束（可选）
Stage 1:  Spec           → Superpowers brainstorming + writing-plans 产出 plan + Task Card + DoD
Stage 2:  Code           → Subagent 三角色（Implementer / Spec Reviewer / Code Quality Reviewer）
Stage 3:  Integrate      → push + PR 创建（CI 由 Stop Hook 自动监控）
Stage 4:  Ship           → Learning + 标记完成（合并/清理由 Stop Hook 自动执行）
```

**加载顺序**：/dev 启动后，主 agent 必须先加载
`packages/engine/skills/dev/steps/autonomous-research-proxy.md` 到系统 context，再进入 Step 0。
该文件定义 Superpowers 所有 user 交互点 → Research Subagent 的替换规则。

**唯一完成标志**: PR 已合并到 main。

**职责分离原则**：
- **文档面**（steps/*.md）：产出代码、Learning、状态标记（step_N: done）
- **代码面**（devloop-check.sh）：CI 监控、PR 合并、cleanup.sh 调用、cleanup_done 写入

**跳过**（默认不问用户）：
- 所有 Superpowers 的用户交互问询（2-3 方案选择、DoD 确认等）
- Implementer 的"有问题要问吗"

**不跳过**（质量兜底）：
- Spec Reviewer 审查（不信任 Implementer 报告）
- Code Quality Reviewer 审查
- 失败升级规则（BLOCKED 3 次升级、Reviewer 3 轮换 implementer、3 task BLOCKED 重做 plan）
- Stop Hook 所有检查
- CI 自动合并

---

## 核心规则

1. **只在 cp-* 分支写代码**（Hook 强制）
2. **遇到问题自动修复**（禁止"建议手动"/"等待用户"）
3. **Stop Hook 保证循环**：PR 未合并 → exit 2 → 继续执行
4. **每步完成后立即执行下一步**，不停顿
5. **职责分离**：文档面产出，代码面控制（CI/合并/清理）

---

## Stop Hook 完成条件（devloop-check.sh）

### 默认模式

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

## 孤儿 PR 兜底（Brain orphan-pr-worker）

Brain tick loop 周期性扫描 `cp-*` PR（默认 30 min 一轮）。判定规则：

```
open > 2h AND 无关联 in_progress task
  ├─ CI success → gh pr merge --squash --delete-branch
  ├─ CI failure → gh pr edit --add-label needs-attention
  └─ CI in_progress/pending → skip（下轮再扫）
```

防止 agent session 中断后 PR 永远卡在 open。详见 `packages/brain/src/orphan-pr-worker.js`。

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
├── steps/00.5-enrich.md          ← PRD Enrich（可选）
├── steps/00.7-decision-query.md  ← 决策查询（可选）
├── steps/01-spec.md              ← Stage 1
├── steps/02-code.md              ← Stage 2
├── steps/03-integrate.md         ← Stage 3
├── steps/04-ship.md              ← Stage 4
├── steps/autonomous-research-proxy.md ← Superpowers 交互替换层
└── scripts/                      ← 辅助脚本
```

---

## 兼容性

**旧 `.dev-mode` 文件**中残留的 `autonomous_mode: true` 字段被**忽略**（不报错、不切分支）。
Stop Hook 只读 `harness_mode`，其他均按默认（autonomous）处理。
