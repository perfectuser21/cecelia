# QA Decision: 统一 Subagent Gate 机制

Decision: NO_RCI
Priority: P2
RepoType: Engine

## 变更范围

| 文件 | 类型 | 影响 |
|------|------|------|
| skills/dev/steps/*.md | 文档 | Subagent 调用规则统一 |
| skills/dev/SKILL.md | 文档 | 命名更新 |

## 分析

### 问题描述
- Subagent 调用使用 general-purpose 类型
- 审核规则未嵌入 prompt，Subagent 拿不到完整规则
- 命名不统一（QA Decision、Audit Loop 等）

### 修复方案
- 统一命名为 gate:prd, gate:dod, gate:qa, gate:audit, gate:test, gate:learning
- 把 gates/*.md 中的 Subagent Prompt 模板完整嵌入 steps 文件
- 明确循环逻辑：FAIL → 修改 → 再审核

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| steps 文件使用统一命名 | manual | 检查文件内容 |
| prompt 包含完整规则 | manual | 检查文件内容 |

RCI:
  new: []
  update: []

Reason: 文档改进，不影响核心功能执行，无需 RCI。
