# Step 5: 写代码

> 根据 PRD 实现功能代码

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "in_progress" })`

---

## 原则

1. **只做 PRD 里说的** - 不要过度设计
2. **保持简单** - 能用简单方案就不用复杂方案
3. **遵循项目规范** - 看看已有代码怎么写的

---

## 检查清单

写代码时注意：

- [ ] 文件放对位置了吗？
- [ ] 命名符合项目规范吗？
- [ ] 有没有引入安全漏洞？
- [ ] 有没有硬编码的配置？

---

## 常见问题

**Q: 发现 PRD 有问题怎么办？**
A: 更新 PRD，调整实现方案，继续。

**Q: 需要改已有代码怎么办？**
A: 改之前先理解原代码逻辑，改完确保不破坏原有功能。

**Q: 代码写到一半发现方案不对？**
A: 调整方案，重新实现。

---

## 完成后：gate:audit 审核（必须）

代码写完后，**必须**启动 gate:audit Subagent 审计。

### 循环逻辑

```
主 Agent 写代码
    ↓
启动 gate:audit Subagent
    ↓
Subagent 返回 Decision
    ↓
├─ FAIL → 主 Agent 根据 Findings 修复 L1/L2 问题 → 再次启动 Subagent
└─ PASS → 生成 gate 文件 → 继续 Step 6
```

### gate:audit Subagent 调用

```
Task({
  subagent_type: "general-purpose",
  prompt: `你是代码审计员。审计以下改动文件：
- 改动文件：{changed_files}
- 目标层级：L2（默认）

## 分层标准

| Layer | 名称 | 描述 | 完成标准 |
|-------|------|------|----------|
| L1 | 阻塞性 | 功能不工作、崩溃、数据丢失 | **必须修** |
| L2 | 功能性 | 边界条件、错误处理、已知 edge case | **建议修** |
| L3 | 最佳实践 | 代码风格、一致性、可读性 | 可选 |
| L4 | 过度优化 | 理论边界、极端情况、性能微调 | **不修** |

## 审计标准

### L1 阻塞性（必须修）
- 脚本语法错误，无法执行
- 命令不存在，功能完全失效
- 条件判断错误，导致错误分支
- 文件路径错误，找不到依赖

### L2 功能性（建议修）
- 网络超时无保护，可能挂起
- 空字符串未处理，边界出错
- 错误码未正确返回
- 分支/路径引用不一致

### L3 最佳实践（可选）
- shebang 不统一
- set options 风格不同
- 变量命名不规范
- 注释不够清晰

### L4 过度优化（不修）
- 理论上可能的 word splitting（实际不会发生）
- 极端边界条件（需要刻意构造）
- 性能微优化（毫秒级差异）

## 输出格式（必须严格遵守，输出到 docs/AUDIT-REPORT.md）

# Audit Report

Branch: {branch_name}
Date: YYYY-MM-DD
Scope: {changed_files}
Target Level: L2

Summary:
  L1: 0
  L2: 0
  L3: 0
  L4: 0

Decision: PASS | FAIL

Findings:
  - id: A1-001
    layer: L1 | L2 | L3 | L4
    file: path/to/file
    line: 123
    issue: 问题描述
    fix: 修复建议
    status: fixed | pending

Blockers: []  # L1 + L2 问题列表

## 判定规则

L1 > 0 OR L2 > 0 → Decision: FAIL
L1 = 0 AND L2 = 0 → Decision: PASS`,
  description: "gate:audit"
})
```

### PASS 后操作

```bash
bash scripts/gate/generate-gate-file.sh audit
```

**关键原则**：
- gate:audit 在 gate:test 之前执行
- 改完代码再跑 Test，避免测试白跑

**Task Checkpoint**: `TaskUpdate({ taskId: "5", status: "completed" })`

---

继续 → Step 6
