# Architecture

## 概览

Cecelia Quality Platform 是一个分层的质量保障体系，遵循 RADNA 4层架构。

```
┌─────────────────────────────────────────────────────────┐
│                   L0 - Rules                            │
│              规则层 / 宪法                               │
│  - P0/P1 定义                                           │
│  - 必须产物要求                                          │
│  - Gate/Regression 边界                                 │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                   L1 - Contracts                        │
│              契约层 / 要求是什么                          │
│  ┌─────────────────────┐  ┌─────────────────────┐      │
│  │  Gate Contract      │  │ Regression Contract │      │
│  │  (6大红线)          │  │  (业务回归)          │      │
│  └─────────────────────┘  └─────────────────────┘      │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                   L2 - Executors                        │
│              执行层 / 怎么检查                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Hooks      │  │   DevGate    │  │   Scripts    │  │
│  │  (触发器)    │  │  (检查器)    │  │  (执行器)    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                   L3 - Evidence                         │
│              证据层 / 检查后的产物                        │
│  - QA-DECISION.md                                       │
│  - AUDIT-REPORT.md                                      │
│  - .layer2-evidence.md                                  │
└─────────────────────────────────────────────────────────┘
```

---

## L0 - Rules（规则层）

### P0/P1 定义

| 优先级 | 映射来源 | RCI 要求 | 说明 |
|-------|---------|---------|------|
| P0 | CRITICAL / security: | 必须更新 | 核心路径、安全问题 |
| P1 | HIGH | 必须更新 | 重要功能、边界条件 |
| P2 | MEDIUM | 可选 | 一般功能 |
| P3 | LOW | 可选 | 优化、边缘情况 |

### 必须产物

| 产物 | 何时需要 | 格式 |
|------|---------|------|
| QA-DECISION.md | 所有 PR | YAML frontmatter + Markdown |
| AUDIT-REPORT.md | 所有 PR | YAML frontmatter + Markdown |
| .layer2-evidence.md | Release PR | Markdown |

### Gate/Regression 边界

```
Gate 范围（安全边界）:
  - hooks/*
  - scripts/run-gate-tests.sh
  - scripts/devgate/*
  - .github/workflows/ci.yml
  - tests/gate/*
  - contracts/gate-contract.yaml

Regression 范围（业务功能）:
  - src/**
  - skills/dev/**
  - templates/**
  - contracts/regression-contract.yaml
  - 其他业务代码
```

---

## L1 - Contracts（契约层）

### Gate Contract (GCI)

**目的**: 确保"不发生灾难级误放行"

**6大红线**:

1. 空 DoD 不得通过
2. 空 QA-DECISION 不得通过
3. P0/P1 识别必须准确
4. PR to main 必须走 release-check
5. 白名单不可穿透（npm scripts）
6. cleanup.sh 不可删除未 checkout 的分支

**Contract 格式**:

```yaml
gate_contract:
  - id: G1-001
    rule: "DoD 不能为空"
    trigger: [PR]
    test: scripts/devgate/check-dod-mapping.cjs
```

### Regression Contract (RCI)

**目的**: 保持业务能力的"可回归性"

**分类体系**:

- **H** (Hooks): 钩子系统
- **W** (Workflow): 工作流
- **C** (Core): 核心功能
- **B** (Business): 业务逻辑

**Contract 格式**:

```yaml
contracts:
  - id: H1-001
    name: "分支保护 Hook 触发"
    priority: P0
    trigger: [PR, Release]
    test: tests/hooks/test-branch-protect.sh

golden_paths:
  - id: GP-001
    name: "完整开发流程"
    rcis: [H1-001, W1-001, C1-001]
```

---

## L2 - Executors（执行层）

### Hooks（触发器）

| Hook | 触发时机 | 作用 |
|------|---------|------|
| branch-protect.sh | PreToolUse (Write/Edit) | 分支保护 + PRD/DoD 检查 |
| pr-gate-v2.sh | PreToolUse (Bash) | PR 质检（双模式） |
| stop.sh | SessionEnd | 会话结束检查 |
| session-end.sh | SessionEnd | 清理工作 |
| session-start.sh | SessionStart | 初始化工作 |

### DevGate（检查器）

| 脚本 | 功能 | 输入 | 输出 |
|------|------|------|------|
| check-dod-mapping.cjs | DoD ↔ 测试映射 | .dod.md | exit code |
| require-rci-update-if-p0p1.sh | P0/P1 强制 RCI | PR title | exit code |
| scan-rci-coverage.cjs | RCI 覆盖度扫描 | regression-contract.yaml | JSON |
| l2a-check.sh | L2A 代码审计检查 | docs/AUDIT-REPORT.md | exit code |
| l2b-check.sh | L2B 证据检查 | .layer2-evidence.md | exit code |
| detect-priority.cjs | 优先级自动检测 | PR title/commit | P0/P1/P2/P3 |
| draft-gci.cjs | GCI 草稿生成 | git diff | YAML |

### Skills（决策器）

| Skill | 输入 | 输出 | 调用者 |
|-------|------|------|--------|
| /audit | 文件列表 + 目标层级 | AUDIT-REPORT.md | /dev |
| /qa | PRD + DoD | QA-DECISION.md | /dev |
| /assurance | PR diff | GCI/RCI 更新 | /dev |

---

## L3 - Evidence（证据层）

### QA-DECISION.md

```yaml
# QA Decision
Decision: NO_RCI | MUST_ADD_RCI | UPDATE_RCI
Priority: P0 | P1 | P2
RepoType: Engine | Business

Tests:
  - dod_item: "..."
    method: auto | manual
    location: "..."

RCI:
  new: []
  update: []

Reason: "..."
```

### AUDIT-REPORT.md

```yaml
# Audit Report
Branch: cp-xxx
Date: YYYY-MM-DD
Scope: [file1, file2]
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
    file: "..."
    issue: "..."
    fix: "..."
    status: fixed | pending
```

### .layer2-evidence.md

```markdown
# L2B Evidence

## 截图证据
| ID | 描述 | 文件 |
|----|------|------|
| E1 | ... | docs/evidence/e1.png |

## 命令验证
| ID | 命令 | 预期 | 实际 |
|----|------|------|------|
| C1 | curl ... | 200 OK | 200 OK |
```

---

## 数据流

```
用户修改代码
    ↓
branch-protect.sh 检查分支 + PRD/DoD
    ↓
pr-gate-v2.sh 质检
    ↓
devgate/* 执行检查
    ↓
skills/* 生成决策
    ↓
产出 Evidence (QA-DECISION + AUDIT-REPORT)
    ↓
CI 验证 Evidence
    ↓
合并 PR
```

---

## 扩展点

### 1. 自定义 DevGate 检查

创建 `scripts/devgate/custom-check.sh`：

```bash
#!/bin/bash
# 自定义检查逻辑
exit 0  # 0=通过, 1=失败
```

### 2. 自定义 Contract

编辑 `contracts/gate-contract.yaml` 或 `regression-contract.yaml`。

### 3. 自定义 Skill

在项目中创建 `skills/custom/SKILL.md`。

### 4. 自定义 Hook

在 `.claude/settings.json` 添加自定义 hook。

---

## 设计原则

1. **分层隔离**: L0-L3 职责清晰，不交叉
2. **双契约分离**: Gate ≠ Regression，永不混淆
3. **证据驱动**: 决策必须有证据支撑
4. **自动优先**: 能自动化的绝不手动
5. **有边界**: 明确知道什么时候停

---

## 相关文档

- [Integration Guide](./INTEGRATION.md)
- [Customization Guide](./CUSTOMIZATION.md)
- [README](../README.md)
