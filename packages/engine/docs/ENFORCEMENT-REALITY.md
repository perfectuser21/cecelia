---
id: enforcement-reality
version: 1.0.0
created: 2026-01-24
updated: 2026-01-24
changelog:
  - 1.0.0: 可验证的强制 vs 口号级保证
---

# 强制能力的真实定义

**核心原则**: "口号级保证" ≠ "可验证的强制"

---

## 强制能力分级（按真实发生的事实）

### Level 1: 真硬（不可绕过）

**定义**: 由 GitHub 服务器侧裁决，所有路径都无法绕过

| 机制 | 位置 | 可绕过？ | 证据 |
|------|------|---------|------|
| CI required checks | GitHub Actions | ❌ 不可绕过 | PR UI 无法点击 Merge |
| branch protection | GitHub Settings | ❌ 不可绕过 | API 返回 403 |
| enforce_admins: true | GitHub Settings | ❌ 不可绕过 | Admin 也必须等 CI 绿 |

**判定标准**:
```bash
# 如果能做到这个，才算"真硬"
1. GitHub Actions 中存在对应 job
2. 该 job 被设置为 required status check
3. job 失败时 GitHub UI 与 API 都无法合并
4. 质检结果由机器可验证证据产生（JSON/Artifact），不是文字 PASS
```

---

### Level 2: 理想路径强制（可绕过）

**定义**: 只强制某条路径，其他路径可绕过

| 机制 | 位置 | 可绕过？ | 绕过方式 |
|------|------|---------|---------|
| PreToolUse:Write Hook | 本地 Claude Code | ✅ 可绕过 | 直接用 vim 写文件 |
| PreToolUse:Bash Hook | 本地 Claude Code | ✅ 可绕过 | 用 gh api / Python / Node.js |
| Stop Hook | 本地 Claude Code | ✅ 可绕过 | Ctrl+C 强制退出 / 直接改文件 |

**实际能力**:
- ✅ 能做到：让 AI 在理想路径下更自律、更自动
- ❌ 不能做到：成为系统底线

**这两天真实发生的绕过**:
```bash
# 绕过 1: 用 gh api 创建 PR（绕过 pr-gate Hook）
gh api -X POST repos/.../pulls ...

# 绕过 2: 直接写 AUDIT-REPORT.md 写 "Decision: PASS"
echo "Decision: PASS" > docs/AUDIT-REPORT.md

# 绕过 3: Ctrl+C 强制退出 Stop Hook
# (Stop Hook 说不让退出，但用户可以强制退出)
```

---

### Level 3: 建议性检查（纯体验优化）

**定义**: 只是提示，无任何强制能力

| 机制 | 位置 | 作用 |
|------|------|------|
| SessionEnd Hook | 本地 Claude Code | 提示 CI 状态 |
| 文档中的"应该" | 文档 | 建议 |

---

## 9.5.0 真实强制能力表

### 修正前（口号级）

| 检查项 | 声称的能力 | 实际能力 | 问题 |
|--------|-----------|---------|------|
| Stop Hook 强制质检 | ✅ 100% | ❌ 理想路径强制 | 可绕过 |
| Audit 执行强制 | ✅ 100% | ❌ 理想路径强制 | AI 可以直接写 PASS |
| 测试执行强制 | ✅ 100% | ❌ 理想路径强制 | 可以伪造 .quality-gate-passed |

### 修正后（可验证事实）

| 检查项 | Hook 能力 | CI 能力 | 真正的强制 |
|--------|----------|---------|-----------|
| 质检必须通过 | ⚠️ 理想路径强制 | ✅ required check | CI |
| Audit Decision: PASS | ⚠️ 理想路径强制 | ❌ **缺失** | **无强制** |
| 测试必须通过 | ⚠️ 理想路径强制 | ✅ required check | CI |
| PRD/DoD 存在 | ⚠️ 理想路径强制 | ❌ **缺失** | **仅体验** |

---

## 真正的 100% 强制需要什么

### 当前缺失的 CI 强制

```yaml
# .github/workflows/quality-gate.yml (不存在！)
name: Quality Gate

jobs:
  quality-gate:  # ← 这个 job 不存在
    runs-on: ubuntu-latest
    steps:
      # 1. 检查 Audit 证据
      - name: Verify Audit Evidence
        run: |
          # 不能只检查文件存在，要检查结构化证据
          test -f artifacts/quality/audit.json
          jq -e '.decision == "PASS" and .l1 == 0' artifacts/quality/audit.json

      # 2. 检查测试证据
      - name: Verify Test Evidence
        run: |
          npm run qa:gate
          test -f artifacts/quality/test-results.json
          jq -e '.failed == 0' artifacts/quality/test-results.json

      # 3. 检查 QA 决策证据
      - name: Verify QA Decision
        run: |
          test -f artifacts/quality/qa-decision.json
          jq -e '.decision == "PASS"' artifacts/quality/qa-decision.json

# 这个 job 必须设为 required check
```

### Branch Protection 设置（缺失）

```bash
# 当前 required checks（不包含 quality-gate）
required_status_checks:
  checks:
    - context: test  # ← 只有这个

# 应该是（包含 quality-gate）
required_status_checks:
  checks:
    - context: test
    - context: quality-gate  # ← 缺失！
```

---

## 修正后的架构

```
┌─────────────────────────────────────────────┐
│  Hook = 体验层（可绕过，早失败）             │
├─────────────────────────────────────────────┤
│  PreToolUse:Write    → 提前阻止错误分支      │
│  PreToolUse:Bash     → 提前阻止缺失产物      │
│  Stop Hook           → 提前阻止跳过质检      │
│                                             │
│  作用: 让 AI 在理想路径下更自律             │
│  不能做到: 成为系统底线                     │
└─────────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│  CI = 质量宪法（不可绕过）                   │
├─────────────────────────────────────────────┤
│  required checks:                           │
│    - test          ✅ 存在                  │
│    - quality-gate  ❌ 缺失！                │
│                                             │
│  作用: 真正的系统底线                       │
└─────────────────────────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│  Branch Protection = 权限宪法（不可绕过）    │
├─────────────────────────────────────────────┤
│  enforce_admins: true  ✅ 存在              │
│  required reviews: 1   ✅ 存在              │
└─────────────────────────────────────────────┘
```

---

## 硬门禁定义提示词（系统规则）

**从现在起，任何声称"强制/100%/不可绕过"的机制，必须满足**:

1. 在 GitHub Actions 中存在对应 job
2. 该 job 被设置为 main/develop 的 required status check
3. job 失败时 GitHub UI 与 API 都无法合并
4. 质检结果必须由机器可验证证据（JSON/Artifact）产生，而不是文字 PASS

**否则一律只能称为**:
- "建议/早失败/体验优化"
- "理想路径强制"
- 不得称为"系统强制"或"100% 强制"

---

## 下一步：补全真正的强制

### 缺失的 CI Jobs

| Job | 作用 | 证据文件 | Required Check |
|-----|------|---------|---------------|
| quality-gate | 质检门控 | artifacts/quality/*.json | ❌ 缺失 |

### 缺失的证据文件格式

```json
// artifacts/quality/audit.json
{
  "decision": "PASS",
  "l1": 0,
  "l2a": 0,
  "timestamp": "2026-01-24T13:30:00Z",
  "checked_files": 42
}

// artifacts/quality/test-results.json
{
  "passed": 186,
  "failed": 0,
  "timestamp": "2026-01-24T13:30:00Z"
}

// artifacts/quality/qa-decision.json
{
  "decision": "PASS",
  "test_strategy": "full",
  "timestamp": "2026-01-24T13:30:00Z"
}
```

---

*生成时间: 2026-01-24*
