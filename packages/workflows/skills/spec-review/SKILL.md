---
name: spec-review
version: 1.0.0
model: claude-sonnet-4-6
created: 2026-03-20
updated: 2026-03-20
changelog:
  - 1.0.0: 合并 dod_verify + cto_review（单 PR 部分）为统一 Spec 审查 Gate
description: |
  Spec 审查 Gate（Codex Gate 2/4）。合并了 dod_verify（DoD 验证）和 cto_review 的单 PR 审查部分。
  在 /dev Stage 1 (Spec) 完成后、写代码之前触发。
  审查 DoD 测试设计、PRD 对齐度、架构方向、测试命令可执行性。
  给出 PASS / FAIL 裁决。
  触发词：审查 Spec、spec-review、DoD 审查、写代码前检查。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# Spec-Review — Spec 审查 Gate

**唯一职责**：在 /dev Stage 1 (Spec) 完成后、写代码之前，审查 DoD + 实现方案的质量。

合并了以下两个旧 Skill 的职责：
- `dod_verify`：DoD 测试设计验证
- `cto_review`（单 PR 部分）：架构方向审查

**时机**：/dev Stage 1 完成 -> Spec-Review 审查 -> 通过后才能进入 Stage 2 写代码。

---

## 触发方式

```
/spec-review                             # 审查当前分支的 Spec
/spec-review --task-id <id>              # 指定 Brain 任务
```

### Brain 自动派发

```json
{
  "task_type": "spec_review",
  "task_id": "<uuid>",
  "branch_name": "cp-XXXX-feature",
  "prd_path": "PRD.md",
  "dod_path": "DoD.md"
}
```

---

## 输入

审查以下文件（从当前分支读取）：

| 文件 | 用途 |
|------|------|
| `.task-cp-xxx.md` | Task Card，包含需求 + 成功标准 + DoD |
| `PRD.md` | 需求文档（若有独立 PRD） |
| `.dev-mode` / `.dev-lock` | 开发状态文件，包含 stage 信息 |

---

## 审查维度

### 维度 A：DoD 测试设计合理性

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **test 字段完整** | 每个 DoD 条目有 `test:` 字段 | 缺少 test 字段 |
| **测试有效性** | test 命令能真正验证需求（不是假测试） | `echo "pass"` 或 `grep \| wc -l` 等假测试 |
| **边界覆盖** | 涵盖正常路径 + 异常路径 | 只测 happy path |
| **独立性** | 每个 test 可独立运行 | test 之间有隐藏依赖 |

### 维度 B：DoD 与 PRD 的对齐度

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **成功标准覆盖** | PRD 中每个成功标准在 DoD 中有对应条目 | 成功标准被遗漏 |
| **场景完整** | PRD 描述的所有场景都有 DoD 覆盖 | 有场景无人测试 |
| **非功能需求** | 性能、安全等非功能需求有 DoD 条目 | 非功能需求被忽略 |

### 维度 C：架构方向

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **方案合理** | 实现方案能达成 PRD 目标 | 方案与目标不匹配 |
| **边界正确** | 改动在正确的 package 内（brain/engine/workflows） | 跨边界（如在 engine 里写 brain 逻辑） |
| **复杂度适当** | 方案复杂度与问题匹配 | 过度工程或过于简陋 |
| **兼容性** | 不破坏现有功能 | 有明显的破坏性变更 |

### 维度 D：测试命令可执行性

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **白名单工具** | `manual:` 命令只用 node/npm/curl/bash/psql | 使用了 grep/ls/cat 等非白名单工具 |
| **路径正确** | 引用的文件路径存在或将在实现中创建 | 引用了不存在且不会创建的路径 |
| **退出码明确** | 命令有明确的 exit 0（成功）/ exit 1（失败） | 命令只有输出没有判定 |
| **无 npx vitest** | 不使用 `npx vitest` / `npm test`（CI 无完整依赖） | 使用了 CI 无法执行的命令 |

---

## 裁决规则

### PASS

所有维度通过，或只有 warning 级别的小问题。可以进入 Stage 2 写代码。

### FAIL

以下任一情况为 FAIL：
- DoD 缺少 test 字段（任何一个条目）
- PRD 成功标准未被 DoD 覆盖
- 架构方向有明显问题（跨边界、破坏性变更）
- test 命令使用了非白名单工具
- test 命令是假测试（echo/grep|wc -l）

FAIL 时必须返回 Stage 1 修正 Spec，不能进入 Stage 2。

---

## 输出格式（必须 JSON）

```json
{
  "verdict": "PASS | FAIL",
  "issues": [
    {
      "severity": "blocker | warning",
      "dimension": "A | B | C | D",
      "description": "具体问题描述",
      "suggestion": "修正建议"
    }
  ],
  "summary": "一句话总结"
}
```

severity 规则：
- `blocker`：必须修正，否则不能进入 Stage 2（导致 verdict=FAIL）
- `warning`：建议修正，不阻塞（verdict 仍可为 PASS）

---

## Brain 回调

审查完成后回调 `/api/brain/execution-callback`：

```bash
curl -s -X POST http://localhost:5221/api/brain/execution-callback \
  -H "Content-Type: application/json" \
  -d "{
    \"task_id\": \"$TASK_ID\",
    \"run_id\": \"$RUN_ID\",
    \"status\": \"AI Done\",
    \"result\": {
      \"verdict\": \"PASS\",
      \"summary\": \"$SUMMARY\"
    }
  }"
```

---

## 核心原则

1. **写代码前拦截**：在 Stage 1 完成后立即审查，避免写了代码再发现方向错
2. **blocker 必须清零**：有 blocker 就不能写代码
3. **具体可操作**：每个 issue 必须有 suggestion，不能只说"不好"
4. **快速审查**：一次审查不超过 3 分钟
