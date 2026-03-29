---
name: playwright-evaluator
version: 1.0.0
model: claude-sonnet-4-6
created: 2026-03-29
updated: 2026-03-29
changelog:
  - 1.0.0: 初始版本 — Stage 3 CI 通过后的端到端行为验证 Gate
description: |
  Playwright Evaluator — 端到端行为验证 Gate。
  在 /dev Stage 3 CI 通过后自动触发，读取 Task Card [BEHAVIOR] DoD 条目，
  逐条执行 Test: 命令，始终包含 Brain API /health 基线检查。
  失败时返回详细反馈给主 agent 修复。
  触发词：/playwright-evaluator、行为验证、DoD 验证、端到端验证。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# Playwright Evaluator — 端到端行为验证 Gate

**唯一职责**：Stage 3 CI 通过后，对照 Task Card [BEHAVIOR] DoD 条目逐条执行验证，
确认运行时行为符合预期。

---

## 触发时机

由 `/dev Stage 3` 在 CI 全部通过后调用（见 `03-integrate.md` 第 3.3 节）。

---

## 输入

| 输入 | 说明 |
|------|------|
| Task Card `.task-cp-*.md` | 包含 [BEHAVIOR] DoD 条目和 Test: 字段 |
| Brain URL | 默认 http://localhost:5221 |

---

## 执行逻辑

### 步骤 1：自动查找 Task Card

```bash
# 在当前工作目录查找 .task-cp-*.md
ls .task-cp-*.md 2>/dev/null | head -1
```

### 步骤 2：Dry Run（先列出再执行）

```bash
node packages/engine/scripts/devgate/playwright-evaluator.cjs --dry-run
```

输出示例：
```
DRY RUN — 将要执行的检查（共 3 项）：
  1. [基线] Brain API /health 基线检查
     Test: manual:curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/health
  2. [BEHAVIOR] 某功能行为验证
     Test: manual:node -e "..."
```

### 步骤 3：执行所有验证

```bash
node packages/engine/scripts/devgate/playwright-evaluator.cjs --run
```

### 步骤 4：处理结果

| 结果 | 处理方式 |
|------|---------|
| 全部 PASS | 继续 Stage 4 Ship |
| 有 FAIL | 分析失败原因 → 修复代码 → 重新 push → 等 CI → 再次 evaluator |

---

## 评估报告格式

```
╔════════════════════════════════════════╗
║   Playwright Evaluator — 行为验证      ║
╚════════════════════════════════════════╝
  Task Card: .task-cp-xxx.md
  Brain URL: http://localhost:5221
  模式: 执行验证
  发现 N 个 [BEHAVIOR] 条目 + 1 个基线检查

  1/N [基线] Brain API /health 基线检查 ... PASS
  2/N [BEHAVIOR] 某功能 ... PASS
  3/N [BEHAVIOR] 另一功能 ... FAIL
    ↳ 退出码 1：...

════ 评估摘要 ════
  总计：N 项
  通过：N-1
  失败：1

❌ FAIL — 1 项检查未通过
```

---

## Brain API 基线检查（始终包含）

无论 Task Card 是否声明，Evaluator 始终检查：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5221/api/brain/health
```

预期返回 HTTP 200。Brain 离线则基线 FAIL。

---

## 对接 03-integrate.md

本 skill 由 `/dev Stage 3 - 3.3 节` 在 CI 通过后调用。
评估失败时主 agent 需修复代码并重新经过完整 CI → Evaluator 循环。

---

## 底层脚本

```
packages/engine/scripts/devgate/playwright-evaluator.cjs
```

RCI 注册：`PE-001`（见 `regression-contract.yaml`）
