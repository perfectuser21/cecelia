---
name: initiative-review
version: 1.0.0
model: claude-sonnet-4-6
created: 2026-03-20
updated: 2026-03-20
changelog:
  - 1.0.0: 合并 initiative_verify + cto_review（整体部分）为统一 Initiative 验收 Gate
description: |
  Initiative 验收 Gate（Codex Gate 4/4）。合并了 initiative_verify（功能验收）和 cto_review 的整体审查部分。
  两个 Phase：Phase 1 单 Pipeline 验收（每个 PR 合并后），Phase 2 整体验收（所有 Pipeline 完成后）。
  给出 APPROVED / NEEDS_REVISION / REJECTED 三态裁决。
  触发词：Initiative 验收、initiative-review、整体审查、功能验收。
---

> **CRITICAL LANGUAGE RULE: 所有输出必须使用简体中文。**

# Initiative-Review — Initiative 验收 Gate

**唯一职责**：验收 Initiative 的交付质量，确保功能 DoD 满足 + 架构对齐。

合并了以下两个旧 Skill 的职责：
- `initiative_verify`：功能 DoD 验收、架构对齐校验
- `cto_review`（整体部分）：多 PR 整体架构审查

**两个 Phase**：
- Phase 1：单 Pipeline 验收（每个 PR 合并后触发）
- Phase 2：整体验收（Initiative 下所有 Pipeline 完成后触发）

---

## 触发方式

```
/initiative-review --initiative-id <id>                    # 整体验收（Phase 2）
/initiative-review --initiative-id <id> --pr <number>      # 单 PR 验收（Phase 1）
/initiative-review --initiative-id <id> --phase 1          # 显式指定 Phase 1
/initiative-review --initiative-id <id> --phase 2          # 显式指定 Phase 2
```

### Brain 自动派发

Phase 1：
```json
{
  "task_type": "initiative_review",
  "initiative_id": "<uuid>",
  "phase": 1,
  "pr_number": 123,
  "branch_name": "cp-XXXX-feature"
}
```

Phase 2：
```json
{
  "task_type": "initiative_review",
  "initiative_id": "<uuid>",
  "phase": 2
}
```

---

## Phase 1：单 Pipeline 验收

### 触发时机

每个 PR 合并后，Brain 自动触发 Phase 1 审查。

### 审查维度

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **PR 目标达成** | PR 实现了对应 Task 描述的功能 | PR 内容与 Task 描述不匹配 |
| **DoD 条目满足** | 该 Task 对应的 DoD 条目全部 PASS | 有 DoD 条目 FAIL |
| **无回归** | 不破坏已有功能 | CI 失败或引入了已知问题 |
| **代码质量** | Code-Review-Gate 已 PASS | Code-Review-Gate 未通过 |

### Phase 1 输入

```bash
# 获取 Task 信息
TASK=$(curl -s "http://localhost:5221/api/brain/tasks/$TASK_ID")

# 获取 PR 信息
gh pr view $PR_NUMBER --json title,body,files,reviews

# 从 PR 分支读取 Task Card
```

### Phase 1 执行流程

```
Step 1.1  读取 Task 描述和对应的 DoD 条目
Step 1.2  读取 PR 变更内容
Step 1.3  逐条验证 DoD：
          - 有 test: 字段 -> 执行 test 命令，记录 PASS/FAIL
          - 无 test: 字段 -> 根据代码变更判断是否满足
Step 1.4  检查是否有回归（CI 状态）
Step 1.5  汇总 Phase 1 结论
```

---

## Phase 2：整体验收

### 触发时机

Initiative 下所有 dev tasks 完成、所有 Phase 1 通过后，Brain 自动触发 Phase 2。

### 审查维度

| 检查项 | 通过条件 | 失败信号 |
|--------|----------|----------|
| **整体目标达成** | Initiative 描述的所有需求都已实现 | 有需求未被任何 PR 覆盖 |
| **架构对齐** | 实现方案与原始架构设计一致 | 实现偏离了架构设计 |
| **PR 覆盖完整** | 所有 PR 加起来覆盖了 Initiative 描述的所有需求 | 需求有遗漏 |
| **集成质量** | 多个 PR 的改动之间没有冲突或不一致 | PR 之间有逻辑矛盾 |
| **DoD 全部满足** | Initiative 级别的所有 DoD 条目 PASS | 有条目 FAIL |

### Phase 2 输入

```bash
# 获取 Initiative 所有已完成 tasks
TASKS=$(curl -s "http://localhost:5221/api/brain/tasks?project_id=$INITIATIVE_ID&status=completed")

# 获取所有 PR 编号
PR_NUMBERS=$(echo $TASKS | jq -r '.[].payload.pr_number // empty' | sort -u)

# 获取 Initiative 描述和 DoD
INITIATIVE=$(curl -s "http://localhost:5221/api/brain/projects/$INITIATIVE_ID")
```

### Phase 2 执行流程

```
Step 2.1  流程验收
          - 所有 dev tasks 已完成？
          - 所有 Phase 1 已通过？

Step 2.2  功能 DoD 验收
          - 读取 Initiative 级别的 DoD
          - 逐条验证 F1/F2/F3... 条件
          - 记录每条的 PASS / FAIL

Step 2.3  架构对齐校验
          - 数据模型对齐：查询实际 DB schema，确认新增字段/表是否存在
          - API 端点对齐：确认新增端点是否存在
          - 关键决策对齐：逐条校验代码实现是否符合选定方案

Step 2.4  PR 覆盖度检查
          - 汇总所有 PR 的变更文件
          - 对照 Initiative 需求，检查是否有需求未被覆盖
          - 检查 PR 之间是否有逻辑矛盾

Step 2.5  汇总 Phase 2 结论
```

---

## 裁决规则

### APPROVED

- Phase 1：DoD 条目全部 PASS，PR 目标达成
- Phase 2：整体目标达成，架构对齐，覆盖完整

### NEEDS_REVISION

- Phase 1：有可修复的小问题（实现偏差、边界条件缺失）
- Phase 2：整体基本达成但有遗漏（1-2 个次要需求未覆盖）

NEEDS_REVISION 时 Brain 创建修订 dev task，最多 3 轮。

### REJECTED

- Phase 1：PR 与 Task 描述完全不匹配，或引入了严重回归
- Phase 2：架构根本性偏离、关键需求未实现、多处 DoD FAIL

REJECTED 时 Brain 发送 P0 告警。

---

## 输出格式（必须 JSON）

### Phase 1 输出

```json
{
  "verdict": "APPROVED | NEEDS_REVISION | REJECTED",
  "phase": 1,
  "summary": "一句话总结",
  "dod_results": [
    { "id": "F1", "status": "PASS", "note": "功能正常" },
    { "id": "F2", "status": "FAIL", "note": "边界条件未处理" }
  ],
  "issues": [
    "具体问题1（必须可操作）",
    "具体问题2"
  ]
}
```

### Phase 2 输出

```json
{
  "verdict": "APPROVED | NEEDS_REVISION | REJECTED",
  "phase": 2,
  "summary": "一句话总结",
  "dod_results": [
    { "id": "F1", "status": "PASS", "note": "..." }
  ],
  "architecture_alignment": "aligned | deviated | needs_manual_check",
  "coverage": {
    "total_requirements": 10,
    "covered": 9,
    "uncovered": ["需求X 未被任何 PR 覆盖"]
  },
  "pr_summary": [
    { "pr": 123, "phase1_verdict": "APPROVED", "files_changed": 5 }
  ],
  "issues": ["..."]
}
```

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
      \"verdict\": \"APPROVED\",
      \"phase\": $PHASE,
      \"summary\": \"$SUMMARY\",
      \"dod_results\": $DOD_RESULTS_JSON
    }
  }"
```

| `verdict` 值 | 含义 | Brain 行为 |
|-------------|------|-----------|
| `APPROVED` | 验收通过 | Phase 1: 继续下一个 Task；Phase 2: Initiative status -> completed |
| `NEEDS_REVISION` | 有问题但可修复 | 创建修订 dev task（最多 3 轮） |
| `REJECTED` | 根本性问题 | cecelia_events P0 告警 |

---

## 核心原则

1. **分层验收**：Phase 1 管单个 PR，Phase 2 管整体
2. **DoD 驱动**：以 DoD 条目为验收基准，不凭主观判断
3. **架构对齐不可妥协**：实现偏离架构设计必须修正
4. **具体可操作**：每个 issue 必须说明具体问题和修正方向
5. **自动化优先**：有 test 字段的条目自动执行，无 test 字段的才人工判断
