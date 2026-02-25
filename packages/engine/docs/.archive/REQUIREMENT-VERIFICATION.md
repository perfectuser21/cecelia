---
id: requirement-verification
version: 1.0.0
created: 2026-01-24
updated: 2026-01-24
changelog:
  - 1.0.0: 8.x/9.0 要求 vs 9.5.0 验证清单
---

# 8.x/9.0 要求 vs 9.5.0 实现验证

**验证结论**: ✅ 所有 8.x/9.0 要求在 9.5.0 中 100% 保留，并新增强化

---

## 9.0.0 核心要求（Gate Contract - 6 大红线）

| 要求 | 8.x/9.0 实现 | 9.5.0 实现 | 位置 | 状态 |
|------|-------------|-----------|------|------|
| 1. 空 DoD 必须 fail | pr-gate-v2.sh | ✅ branch-protect.sh + pr-gate-v2.sh | PreToolUse:Write + PreToolUse:Bash | ✅ |
| 2. QA 决策空内容必须 fail | pr-gate-v2.sh | ✅ pr-gate-v2.sh | PreToolUse:Bash | ✅ |
| 3. P0wer 不应触发 P0 流程 | detect-priority.cjs | ✅ detect-priority.cjs | 不变 | ✅ |
| 4. release 模式不跳过 L1 RCI | pr-gate-v2.sh | ✅ pr-gate-v2.sh (MODE=release) | PreToolUse:Bash | ✅ |
| 5. 非白名单命令必须 fail | run-regression.sh | ✅ run-regression.sh | 不变 | ✅ |
| 6. checkout 失败后不删除分支 | cleanup.sh | ✅ cleanup.sh | 不变 | ✅ |

---

## 9.5.0 新增强制检查（Stop Hook）

| 检查项 | 8.x/9.0 | 9.5.0 | 强制能力 |
|--------|---------|-------|----------|
| Audit 报告存在 | ❌ 依赖 AI 自觉 | ✅ Stop Hook 强制 | 100% |
| Audit Decision: PASS | ❌ 依赖 AI 自觉 | ✅ Stop Hook 强制 | 100% |
| 自动化测试通过 | ❌ 依赖 AI 自觉 | ✅ Stop Hook 强制 | 100% |
| 质检时效性 | ❌ 无检查 | ✅ Stop Hook 检查 | 100% |
| 无限循环保护 | ❌ 无 | ✅ stop_hook_active + max-iterations | 100% |
| 测试超时保护 | ❌ 无 | ✅ 120s timeout | 100% |

---

## 完整检查链（所有 Hook 和 CI）

### 第一道门：PreToolUse:Write/Edit (branch-protect.sh)

**时机**: 第一次写文件时

**检查项**:
- ✅ Repository (git 仓库)
- ✅ Branch (cp-* 或 feature/*)
- ✅ Worktree 检测（并行开发）
- ✅ **PRD 存在 + 有效**（≥3行 + 关键字段）
- ✅ **DoD 存在 + 有效**（≥3行 + checkbox）
- ✅ PRD 时效性检查

**代码位置**: `hooks/branch-protect.sh:151-225`

**强制能力**: ✅ 100%（唯一路径）

---

### 第二道门：Stop Hook (stop.sh) - **新增**

**时机**: AI 尝试结束会话时

**检查项**:
- ✅ **Audit 报告存在** (docs/AUDIT-REPORT.md)
- ✅ **Audit Decision: PASS**
- ✅ **自动化测试通过** (.quality-gate-passed)
- ✅ **质检时效性**（代码改动后必须重新质检）

**代码位置**: `hooks/stop.sh:66-156`

**强制能力**: ✅ 100%（唯一路径）

**重点**:
```bash
# 如果 Audit 未通过或测试未通过
exit 2  # ← 阻止会话结束
        # ← Ralph Loop 继续循环
        # ← AI 被迫修复问题
```

---

### 第三道门：PreToolUse:Bash (pr-gate-v2.sh)

**时机**: 创建 PR 时

**检查项**:
- ✅ **DoD 检查**（内容有效性）
- ✅ **DoD 引用 QA 决策**
- ✅ **QA-DECISION.md 存在 + 有效 + Decision 字段**
- ✅ **Audit 报告存在 + Decision: PASS**
- ✅ P0/P1 → RCI 检查
- ✅ DoD ↔ Test 映射检查

**代码位置**: `hooks/pr-gate-v2.sh:423-569`

**强制能力**: ⚠️ 60%（多路径，可用 Python/Node 绕过）

**FAST_MODE 说明**:
```bash
FAST_MODE=true  # 跳过本地测试，不跳过检查
                # 测试已在 Stop Hook 强制通过
                # 只检查产物存在
```

---

### 第四道门：CI (GitHub Actions)

**时机**: PR 创建后

**检查项**:
- ✅ npm run typecheck
- ✅ npm run test
- ✅ npm run build
- ✅ release-check.sh (PR to main 时)
- ✅ DevGate 检查
- ✅ RCI 覆盖率检查

**代码位置**: `.github/workflows/ci.yml`

**强制能力**: ✅ 100%（服务器端）

---

### 第五道门：A+ Protection (GitHub)

**时机**: PR 合并前

**检查项**:
- ✅ 必须 PR（禁止直接 push）
- ✅ CI 必须通过
- ✅ 必须 1 人审核
- ✅ **Admin 也必须遵守** (enforce_admins: true)

**配置位置**: GitHub Branch Protection Rules

**强制能力**: ✅ 100%（服务器端）

---

## Ralph Loop 完整执行流程

```
用户: /ralph-loop "实现功能 X（包含 PRD + DoD）"
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  第一次写文件 → PreToolUse:Write 检查
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ✅ PRD 存在 + 有效
    ✅ DoD 存在 + 有效
    ✅ Branch 正确
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Ralph Loop 迭代 1-N（自动执行）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    写代码
    写测试
    调用 /audit → Decision: FAIL → 修复 → 重试
    运行 npm run qa:gate → 失败 → 修复 → 重试
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Stop Hook 检查（每次尝试结束时）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    ✅ Audit Decision: PASS
    ✅ .quality-gate-passed 存在
    → exit 0 → 允许结束
    ↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  阶段 2: 创建 PR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    PreToolUse:Bash → pr-gate 检查
        ✅ DoD + QA-DECISION + Audit 全部有效
    → 创建 PR
    ↓
    CI 运行（服务器端）
    ↓
    A+ Protection（人工审核 + Auto Merge）
    ↓
    完成 ✅
```

---

## 验证方法

### 验证 1: 空 DoD 必须 fail

```bash
# 测试用例
touch .dod.md  # 空文件
# 尝试写代码
# 预期: PreToolUse:Write 阻止（exit 2）
```

**位置**: `hooks/branch-protect.sh:197-215`

**结果**: ✅ 通过（见 tests/gate/gate.test.ts:A1）

### 验证 2: QA 决策空内容必须 fail

```bash
# 测试用例
echo "" > docs/QA-DECISION.md  # 空文件
gh pr create ...
# 预期: pr-gate 阻止（exit 2）
```

**位置**: `hooks/pr-gate-v2.sh:557-569`

**结果**: ✅ 通过（见 tests/gate/gate.test.ts:A2）

### 验证 3: Audit 未通过必须阻止会话结束

```bash
# 测试用例
# Decision: FAIL 在 AUDIT-REPORT.md
# AI 尝试结束会话
# 预期: Stop Hook 阻止（exit 2）
```

**位置**: `hooks/stop.sh:83-102`

**结果**: ✅ 新增（9.5.0）

### 验证 4: 自动化测试未通过必须阻止会话结束

```bash
# 测试用例
# .quality-gate-passed 不存在
# AI 尝试结束会话
# 预期: Stop Hook 阻止（exit 2）
```

**位置**: `hooks/stop.sh:108-126`

**结果**: ✅ 新增（9.5.0）

---

## 总结

### 8.x/9.0 所有要求 100% 保留

| 类别 | 数量 | 状态 |
|------|------|------|
| Gate Contract (6 大红线) | 6/6 | ✅ 100% |
| 安全修复 (8.24.0) | 3/3 | ✅ 100% |
| 优先级检测 (8.25.0) | 1/1 | ✅ 100% |
| DoD ↔ Test 映射 (8.23.0) | 1/1 | ✅ 100% |

### 9.5.0 新增强化

| 类别 | 检查项 | 强制能力 |
|------|--------|----------|
| Stop Hook 质检门控 | Audit + 测试 + 时效性 | ✅ 100% |
| Ralph Loop 集成 | 自动重试 + 无限循环保护 | ✅ 100% |
| 超时保护 | 所有测试命令 120s | ✅ 100% |

### 检查覆盖率

```
入口检查 (PreToolUse:Write)     ✅ 100%
质检检查 (Stop Hook)            ✅ 100% (新增)
PR 前检查 (PreToolUse:Bash)     ⚠️ 60%
CI 检查 (GitHub Actions)        ✅ 100%
A+ Protection (GitHub)          ✅ 100%
```

**结论**: 9.5.0 = 8.x/9.0 所有要求 + Stop Hook 强化 + Ralph Loop 自动化

---

*生成时间: 2026-01-24*
