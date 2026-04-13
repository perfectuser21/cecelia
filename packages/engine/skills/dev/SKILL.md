---
name: dev
version: 6.0.0
updated: 2026-04-13
description: 统一开发工作流（4-Stage Pipeline）+ Superpowers 行为纪律。代码变更必须走 /dev。
trigger: /dev, --task-id <id>
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

## Superpowers 集成

/dev 流程内嵌了 [Superpowers](https://github.com/obra/superpowers) 插件（v5.0.7）的行为纪律：

| Stage | Superpowers Skill | 作用 |
|-------|------------------|------|
| Stage 1 | `superpowers:writing-plans` 零占位符原则 | DoD 精度 + Self-Review |
| Stage 2 | `superpowers:test-driven-development` | TDD 红绿循环，先红再绿 |
| Stage 2 | `superpowers:verification-before-completion` | 验证门禁，证据先于声明 |
| Stage 2 | `superpowers:systematic-debugging` | 4 Phase 调试 + 3 次失败升级 |
| Stage 3 | `superpowers:systematic-debugging` | CI 失败系统化修复 |
| 任意 | `superpowers:dispatching-parallel-agents` | 并行 subagent 独立分析 |

**Superpowers 管行为纪律，Engine 管流程强制（Stop Hook + Brain + CI 自动合并）。**

---

## 流程（标准模式）

```
Step 0: Worktree → 创建独立 worktree
Stage 1: Spec   → 写 Task Card + DoD（零占位符 + Self-Review）→ 写 .dev-mode
Stage 2: Code   → TDD 红绿循环 + Verification Gate + 逐条验证 DoD
Stage 3: Integrate → push + PR（CI 失败用 Systematic Debugging 修复）
Stage 4: Ship   → Learning + 标记完成（合并/清理由 Stop Hook 自动执行）
```

**唯一完成标志**: PR 已合并到 main。

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
