---
id: harness-report-skill
description: |
  Harness Report — Harness v4.0 最终步骤：生成完整报告。
  包含 PRD 目标/GAN 对抗轮次/代码生成/CI 状态/Evaluator 轮次/成本统计。
version: 4.0.0
created: 2026-04-08
updated: 2026-04-08
changelog:
  - 4.0.0: Harness v4.0 Report（独立 skill，新增 CI/Deploy watch 状态）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**

# /harness-report — Harness v4.0 最终报告

**角色**: Reporter  
**对应 task_type**: `harness_report`

---

## 执行流程

### Step 1: 收集数据

```bash
# TASK_ID、SPRINT_DIR、PROJECT_ID 由 cecelia-run 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
# PROJECT_ID={project_id}
```

### Step 2: 生成报告

```bash
cat > "${SPRINT_DIR}/harness-report.md" << 'REPORT'
# Harness v4.0 完成报告

**完成时间**: {时间}
**Sprint Dir**: {sprint_dir}
**总耗时**: {时间}

## PRD 目标

{从 sprint-prd.md 提取目标}

## GAN 对抗过程

| 轮次 | 阶段 | 结论 | 耗时 |
|-----|------|------|------|
| R1 | Contract Propose | PROPOSED | Xs |
| R1 | Contract Review | REVISION | Xs |
| R2 | Contract Propose | PROPOSED | Xs |
| R2 | Contract Review | APPROVED | Xs |

## 代码生成

| 任务 | PR | CI | Evaluator | 结论 |
|-----|----|----|-----------|------|
| harness_generate | #NNN | PASS | PASS | ✅ |

## 成本统计

{从任务 result 里提取 total_cost_usd 汇总}

## 最终结论

✅ Harness v4.0 完成。所有 Feature 验证通过，PR 已合并。
REPORT
```

**最后一条消息**：
```
{"verdict": "DONE", "report_path": "sprints/.../harness-report.md"}
```
