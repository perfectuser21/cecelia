---
id: qa-decision-cp-0130-gate-skill
version: 1.0.0
created: 2026-01-30
updated: 2026-01-30
changelog:
  - 1.0.0: 初始版本
---

# QA Decision: cp-0130-gate-skill

Decision: NO_RCI
Priority: P2
RepoType: Engine

## 变更范围

| 文件 | 类型 | 影响 |
|------|------|------|
| skills/gate/SKILL.md | Markdown | 新增 Skill 入口 |
| skills/gate/gates/*.md | Markdown | 审核标准定义 |
| skills/dev/steps/01-prd.md | Markdown | 集成 gate:prd |
| skills/dev/steps/04-dod.md | Markdown | 集成 gate:dod |
| skills/dev/steps/06-test.md | Markdown | 集成 gate:test |
| skills/dev/steps/07-quality.md | Markdown | 集成 gate:audit |

## 变更分析

**变更类型**: 新功能（Skill 家族）

**风险评估**:
- 低风险：纯 Markdown 文件，不涉及代码逻辑
- Gate 通过 Task tool 调用 Subagent，不改变核心流程
- 向后兼容：不使用 gate 时流程不变

## 测试决策

### 测试级别: Manual

**理由**:
- 纯 Markdown Skill 定义，无法自动化测试
- Gate 效果需要实际运行 Subagent 验证
- 关键验证点是"审核循环"能否正常工作

### 测试项

| DoD 项 | 方法 | 验证方式 |
|--------|------|----------|
| SKILL.md 入口 | manual | code-review |
| gates/*.md 审核标准 | manual | code-review |
| Subagent 审核逻辑 | manual | 实际测试 gate:dod |
| 结构化输出 | manual | 验证 FAIL 时输出格式 |
| 审核循环 | manual | 故意写烂 DoD 触发 FAIL → 修改 → 再审核 |
| /dev 集成 | manual | code-review |

## RCI (回归契约)

```yaml
new: []
update: []
```

**理由**: Gate Skill 是开发辅助工具，不影响核心产物。如果 Gate 本身有问题，不会导致发布失败（CI 仍然是最终门禁）。后续可考虑将 gate 审核结果纳入 CI 检查。

## 结论

低风险新功能，无需纳入回归契约。主要验证方式是手动测试审核循环。
