---
name: dev
version: 5.2.0
updated: 2026-04-03
description: 统一开发工作流（4-Stage Pipeline）。代码变更必须走 /dev。支持 Harness v2.0 模式。
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

## 流程（标准模式）

```
Step 0: Worktree → 创建独立 worktree
Stage 1: Spec   → 主 agent 写 Task Card + DoD → 写 .dev-mode
Stage 2: Code   → 主 agent 写代码 + 逐条验证 DoD
Stage 3: Integrate → push + PR + CI 监控
Stage 4: Ship   → Learning + 合并 PR + 清理
```

**唯一完成标志**: PR 已合并到 main。

---

## 核心规则

1. **只在 cp-* 分支写代码**（Hook 强制）
2. **遇到问题自动修复**（禁止"建议手动"/"等待用户"）
3. **Stop Hook 保证循环**：PR 未合并 → exit 2 → 继续执行
4. **每步完成后立即执行下一步**，不停顿

---

## Stop Hook 完成条件（devloop-check.sh）

### 标准模式

```
0. cleanup_done: true → exit 0（结束）
1. step_1_spec done？
2. step_2_code done？ + DoD 全部 [x]
3. PR 已创建？
4. CI 通过？（失败→修复→重推）
5. step_4_ship done？（Learning 已写）
6. PR 已合并？→ cleanup_done: true
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
