---
id: qa-decision-cp-0130
version: 1.0.0
created: 2026-01-30
updated: 2026-01-30
changelog:
  - 1.0.0: 初始版本
---

# QA Decision: cp-0130-relax-skills-protection

Decision: PASS
Priority: P2
RepoType: Engine

## 变更范围

| 文件 | 类型 | 影响 |
|------|------|------|
| hooks/branch-protect.sh | Shell | 全局 skills 保护策略变更 |

## 变更分析

**变更类型**: 策略调整（收窄保护范围）

**当前行为**: 锁死整个 `~/.claude/skills/` 目录
**目标行为**: 只保护 Engine skills（dev, qa, audit, semver），其他 skills 放行

**风险评估**:
- 低风险：只是放宽限制，不会破坏现有保护
- Engine skills 仍受保护，核心安全性不变
- 其他 repo 获得部署自己 skills 的能力

## 测试决策

### 测试级别: L1 (Unit) + Manual

**理由**:
- Shell 脚本修改，逻辑变更明确
- 正则表达式匹配需要验证边界情况
- 部署后需要手动验证实际效果

### 测试项

| DoD 项 | 方法 | 位置 |
|--------|------|------|
| 只保护 Engine skills | unit | tests/hooks/branch-protect.test.ts |
| hooks 保护不变 | unit | tests/hooks/branch-protect.test.ts |
| 错误提示更新 | manual | code-review |
| 部署验证 | manual | local-deployment |
| 阻止 Engine skill | manual | local-verification |
| 放行其他 skill | manual | local-verification |

### 边界用例

需要验证的正则边界：
- `~/.claude/skills/dev/SKILL.md` → 阻止 ✓
- `~/.claude/skills/dev-tools/xxx.ts` → 放行 ✓（不是 `dev/`）
- `~/.claude/skills/qa/xxx.md` → 阻止 ✓
- `~/.claude/skills/qa-helpers/xxx.ts` → 放行 ✓（不是 `qa/`）
- `~/.claude/skills/my-skill/xxx.ts` → 放行 ✓

## RCI (回归契约)

```yaml
new:
  - id: skills-protection-selective
    description: "只保护 Engine skills (dev|qa|audit|semver)"
    trigger: "写入 ~/.claude/skills/{protected}/ 目录"
    expected: "exit 2 阻止"

update: []
```

## 结论

低风险变更，测试覆盖充分，可以继续。
