---
name: review
version: 2.0.0
updated: 2026-02-05
description: |
  统一代码审查 + 质量基础设施 Skill。

  两种模式：
  1. 审查模式 - 找问题，不改代码
     - QA 视角：测试决策、回归契约、覆盖度
     - Audit 视角：代码问题分层（L1/L2/L3/L4）
  2. 初始化模式 (qa_init) - 设置新 repo 的质量基础设施
     - CI/CD 配置
     - 分支保护
     - 测试规范

  权限：Plan Mode（只读）或 bypassPermissions（qa_init）
---

# /review - 统一代码审查

> 找问题，不改代码。发现问题后输出 PRD 让 /dev 去修。

---

## 核心原则

```
审查员的职责 = 发现问题 + 记录问题 + 建议修复方案
审查员的禁区 = 直接修改代码
```

**Plan Mode 运行**：只读代码，不修改任何文件（由 executor 强制）

---

## 两个视角

### QA 视角 - 测试决策

| 检查项 | 说明 |
|--------|------|
| 测试覆盖 | 哪些功能需要测试？覆盖度够吗？ |
| 回归契约 | 需要加 RCI 吗？更新现有 RCI 吗？ |
| Golden Path | 是否影响关键用户路径？ |
| 风险评估 | RISK SCORE 几分？需要深度 QA 吗？ |

### Audit 视角 - 代码问题

| Layer | 名称 | 描述 | 处理方式 |
|-------|------|------|----------|
| **L1** | 阻塞性 | 功能不工作、崩溃、数据丢失 | 必须修 → 输出 PRD |
| **L2** | 功能性 | 边界条件、错误处理、edge case | 建议修 → 输出 PRD |
| **L3** | 最佳实践 | 代码风格、一致性、可读性 | 记录到报告 |
| **L4** | 过度优化 | 理论边界、极端情况 | 忽略 |

---

## 输出格式

### REVIEW-REPORT.md

```yaml
# Review Report

Date: YYYY-MM-DD
Branch: cp-xxx
Scope: [审查的文件列表]
Mode: QA | Audit | Full

## Summary

| 类别 | 数量 |
|------|------|
| L1 阻塞性问题 | 0 |
| L2 功能性问题 | 0 |
| L3 最佳实践 | 0 |
| 测试覆盖缺口 | 0 |
| RCI 需更新 | 0 |

## Decision

Overall: PASS | FAIL | NEEDS_FIX
- PASS: 无 L1/L2 问题，可继续
- FAIL: 有 L1 阻塞问题，必须修
- NEEDS_FIX: 有 L2 问题，建议修

## Findings

### L1 阻塞性

(无 或 问题列表)

### L2 功能性

- id: R-001
  file: path/to/file.ts
  line: 123
  issue: 问题描述
  suggestion: 修复建议

### L3 最佳实践

(记录但不强制修复)

## QA Recommendations

### 测试决策

- [ ] 需要新增单元测试
- [ ] 需要更新 E2E 测试
- [ ] 需要添加 RCI 条目

### RCI 影响

- new: []
- update: []

## Fix PRD (如果 NEEDS_FIX)

如果发现需要修复的问题，在此生成 PRD：

---prd---
# PRD - 修复 [问题标题]

## 背景
Review 发现以下问题需要修复：
[问题列表]

## 修复方案
[具体修复步骤]

## 验收标准
- [ ] L1/L2 问题清零
- [ ] 相关测试通过
---end-prd---
```

---

## 调用方式

### 审查模式

```bash
/review              # 完整审查（QA + Audit）
/review qa           # 只做 QA 视角
/review audit        # 只做 Audit 视角
/review <文件路径>   # 指定范围
```

### 初始化模式 (qa_init)

```bash
/review init         # 初始化当前 repo
/review init --strict  # 严格模式（version_check=true, coverage=50）
```

**触发场景**：新 repo 加入 Cecelia 管理时

**执行内容**：

```bash
# 自动执行 qa-init.sh 脚本
bash /home/xx/dev/ci-templates/scripts/qa-init.sh $(pwd) [--strict]
```

**初始化清单**：
- ✅ 创建 .github/workflows/ci.yml（引用 ci-templates）
- ✅ 创建 .github/workflows/auto-merge.yml
- ✅ 创建 .github/workflows/back-merge.yml
- ✅ 设置 main 分支保护
- ✅ 设置 develop 分支保护

**模板来源**：`perfectuser21/ci-templates`（GitHub Reusable Workflows）

### 在 /dev 流程中

```
Step 4 (DoD) → /review qa   → 测试决策
Step 7 (Quality) → /review audit → 代码审计
```

---

## 严重性 → 优先级映射

| 审计严重性 | 业务优先级 | RCI 要求 |
|-----------|-----------|----------|
| **CRITICAL** | **P0** | ✅ 必须更新 RCI |
| **HIGH** | **P1** | ✅ 必须更新 RCI |
| MEDIUM | P2 | 可选 |
| LOW | P3 | 可选 |

---

## 与 /dev 的关系

```
/review 是审查员
/dev 是执行者

/review 发现问题 → 输出 PRD
/dev 执行 PRD → 修复问题
/review 再次审查 → 确认修复

循环直到 PASS
```

**职责分离**：
- /review 不改代码（Plan Mode 强制）
- 修复工作交给 /dev

---

## 快速参考

| 用户意图 | 模式 | 输出 |
|----------|------|------|
| "审查这个 PR" | Full | REVIEW-REPORT.md |
| "测试要跑什么" | QA | 测试决策 |
| "找 bug" | Audit | L1/L2 问题列表 |
| "代码质量怎么样" | Full | 完整报告 |

---

## 约束

1. **只读**：绝不修改代码文件
2. **有边界**：L1/L2 清零即 PASS，不追求完美
3. **输出导向**：发现问题 → 输出报告/PRD
4. **不阻塞**：记录 L3/L4 但不因此 FAIL
