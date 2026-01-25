# Customization Guide

## 自定义 Quality Platform

### 1. 调整 P0/P1 定义

编辑项目的 `docs/policy/ASSURANCE-POLICY.md`（如果没有，从 Quality Platform 复制）：

```yaml
priority_mapping:
  P0:
    - 关键词: [CRITICAL, security:]
    - RCI 要求: 必须
  P1:
    - 关键词: [HIGH]
    - RCI 要求: 必须
```

### 2. 自定义 Hook 行为

#### 禁用某个 Hook

编辑 `.claude/settings.json`：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": []  // 禁用 branch-protect
      }
    ]
  }
}
```

#### 调整 Hook 触发条件

编辑 `infra/quality/hooks/branch-protect.sh`（不推荐，建议通过配置）。

#### 添加自定义 Hook

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./scripts/custom-check.sh"
          }
        ]
      }
    ]
  }
}
```

### 3. 自定义 DevGate 检查

#### 添加新检查

创建 `scripts/devgate/custom-check.sh`：

```bash
#!/bin/bash
# 自定义检查逻辑

# 检查某个条件
if [ -f ".custom-file" ]; then
    echo "✅ Custom check passed"
    exit 0
else
    echo "❌ Custom check failed"
    exit 1
fi
```

在 CI 中调用：

```yaml
- name: Custom Check
  run: bash scripts/devgate/custom-check.sh
```

#### 覆盖现有检查

创建同名文件在项目的 `scripts/devgate/`，会优先于 Quality Platform 的版本。

### 4. 自定义 Contract

#### 添加 Gate Contract

编辑 `contracts/gate-contract.yaml`：

```yaml
gate_contract:
  - id: G7-001  # 从 G7 开始（G1-G6 是标准红线）
    rule: "自定义规则"
    trigger: [PR]
    test: scripts/custom-gate-test.sh
```

#### 添加 Regression Contract

编辑 `contracts/regression-contract.yaml`：

```yaml
contracts:
  - id: C9-001  # 根据分类选择前缀
    name: "自定义业务回归"
    priority: P1
    trigger: [PR, Release]
    test: tests/custom-regression.test.ts
```

#### 添加 Golden Path

```yaml
golden_paths:
  - id: GP-999
    name: "自定义端到端流程"
    rcis: [C9-001, C9-002]
    description: "完整的用户操作流程"
```

### 5. 自定义 Skill

#### 创建新 Skill

在项目中创建 `skills/custom/SKILL.md`：

```markdown
---
name: custom
version: 1.0.0
description: 自定义 Skill
---

# /custom - 自定义 Skill

你的 Skill 逻辑...
```

在 `.claude/settings.json` 中添加路径：

```json
{
  "skills": {
    "paths": [
      "./infra/quality/skills",
      "./skills"  // 项目 skills 优先级更高
    ]
  }
}
```

#### 覆盖现有 Skill

创建 `skills/audit/SKILL.md` 会覆盖 Quality Platform 的 `/audit`。

### 6. 自定义模板

#### 修改文档模板

复制模板到项目：

```bash
cp infra/quality/templates/AUDIT-REPORT.md templates/
```

编辑 `templates/AUDIT-REPORT.md` 以适应你的需求。

#### 使用自定义模板

在 Skill 中引用项目模板：

```bash
cp templates/AUDIT-REPORT.md docs/AUDIT-REPORT.md
```

### 7. 自定义 CI 流程

#### 简化版（只检查关键项）

```yaml
jobs:
  quality-gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Essential Checks
        run: |
          bash infra/quality/scripts/devgate/check-dod-mapping.cjs
          bash infra/quality/scripts/devgate/l2a-check.sh
```

#### 完整版（全部检查）

```yaml
jobs:
  quality-gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Full DevGate
        run: |
          bash infra/quality/scripts/devgate/check-dod-mapping.cjs
          bash infra/quality/scripts/devgate/require-rci-update-if-p0p1.sh
          bash infra/quality/scripts/devgate/scan-rci-coverage.cjs
          bash infra/quality/scripts/devgate/l2a-check.sh
          bash infra/quality/scripts/devgate/l2b-check.sh

      - name: Gate Tests
        run: bash infra/quality/scripts/run-gate-tests.sh

      - name: Regression Tests
        run: bash infra/quality/scripts/run-regression.sh
```

### 8. 环境变量配置

Quality Platform 支持以下环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `QUALITY_STRICT_MODE` | `false` | 严格模式（所有检查都必须通过） |
| `QUALITY_SKIP_HOOKS` | `false` | 跳过 hooks（仅测试用） |
| `QUALITY_LOG_LEVEL` | `info` | 日志级别 (debug/info/warn/error) |

在 `.claude/settings.json` 中设置：

```json
{
  "env": {
    "QUALITY_STRICT_MODE": "true"
  }
}
```

### 9. 自定义分支策略

#### 允许其他分支前缀

编辑 `infra/quality/hooks/branch-protect.sh`（或创建项目版本）：

```bash
# 在检查中添加新前缀
ALLOWED_PREFIXES="cp-|feature/|hotfix/|bugfix/"
```

#### 禁用分支保护

在 `.claude/settings.json` 中移除 hook：

```json
{
  "hooks": {
    "PreToolUse": []  // 空数组 = 不触发 hook
  }
}
```

### 10. 多 Repo 配置差异

不同项目可以有不同配置：

#### 项目 A（严格）

```json
{
  "env": {
    "QUALITY_STRICT_MODE": "true"
  }
}
```

#### 项目 B（宽松）

```json
{
  "env": {
    "QUALITY_STRICT_MODE": "false"
  }
}
```

---

## 最佳实践

### 1. 优先配置，避免修改

- ✅ 通过 `.claude/settings.json` 配置
- ✅ 通过环境变量调整
- ❌ 直接修改 Quality Platform 代码

### 2. 项目级覆盖

- ✅ 在项目中创建同名文件覆盖
- ✅ 保持 Quality Platform 原样
- ❌ 在 submodule 中修改

### 3. 版本锁定

- ✅ 生产环境锁定版本
- ✅ 测试环境跟随最新版
- ❌ 混用多个版本

### 4. 文档优先

- ✅ 记录自定义配置
- ✅ 在 README 中说明差异
- ❌ 隐式配置

---

## 常见自定义场景

### 场景 1: 禁用 L2B 检查（开发阶段）

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": []  // 禁用 pr-gate (包含 L2B 检查)
      }
    ]
  }
}
```

### 场景 2: 只在 Release PR 启用完整检查

```yaml
# .github/workflows/ci.yml
jobs:
  quality-gates:
    runs-on: ubuntu-latest
    steps:
      - name: Detect PR Type
        id: pr-type
        run: |
          if [[ "${{ github.base_ref }}" == "main" ]]; then
            echo "type=release" >> $GITHUB_OUTPUT
          else
            echo "type=pr" >> $GITHUB_OUTPUT
          fi

      - name: Run Checks
        run: |
          if [[ "${{ steps.pr-type.outputs.type }}" == "release" ]]; then
            bash infra/quality/scripts/devgate/l2b-check.sh
          fi
```

### 场景 3: 添加业务特定检查

```bash
# scripts/devgate/business-check.sh
#!/bin/bash
# 检查业务规则

# 检查是否有 API 文档更新
if git diff --name-only | grep -q "src/api/"; then
    if ! git diff --name-only | grep -q "docs/api/"; then
        echo "❌ API 修改必须更新文档"
        exit 1
    fi
fi

echo "✅ Business check passed"
exit 0
```

---

## 相关文档

- [Integration Guide](./INTEGRATION.md)
- [Architecture](./ARCHITECTURE.md)
- [README](../README.md)
