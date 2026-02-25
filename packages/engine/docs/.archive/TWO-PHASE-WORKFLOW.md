---
id: two-phase-workflow
version: 1.0.0
created: 2026-01-24
updated: 2026-01-24
status: DEPRECATED
changelog:
  - 1.0.0: 两阶段工作流设计 - Stop Hook 强制本地质检
---

# ⚠️ DEPRECATED - 两阶段工作流

**本文档已过时。请使用 v10.0.0 权威文档：**
- **权威**: [`docs/contracts/WORKFLOW-CONTRACT.md`](./contracts/WORKFLOW-CONTRACT.md)
- **自动生成视图**: [`docs/paths/GOLDEN-PATHS.md`](./paths/GOLDEN-PATHS.md)

**不要使用本文档**。本文档描述的是 v9.5.0 的两阶段工作流，使用"100%强制"和"Ralph Loop"概念，这些在 v10.0.0 Contract Rebase 后已被废弃。

---

# 两阶段工作流（已废弃描述）

**核心思想**: 用 Stop Hook 强制本地质检，阻止未完成质检就退出会话

---

## 问题

### 原来：一步到底（9 步一个阶段）

```
Step 1-9: 写代码 → 质检 → 创建 PR (不间断)
    ↓
会话结束 → Stop Hook 触发
    ↓
（已经没用了，PR 都创建了，质检可能被跳过）
```

**问题**:
- AI 可以跳过质检
- Stop Hook 触发时已经太晚
- 无法利用 Stop Hook 强制质检

---

## 解决方案：两阶段（9 步两个阶段）

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  阶段 1: 本地开发 + 质检 (Retry Loop)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1-7: PRD → 分支 → 代码 → 测试
    ↓
Step 8: 质检 (有 Retry Loop)
    ├─ 运行: npm run qa:gate
    ├─ 失败 → 修复 → 再试
    ├─ 再失败 → 再修复 → 再试
    └─ 成功 → 生成 .quality-gate-passed ✅
    ↓
会话结束尝试 → Stop Hook 触发
    ├─ 检查: .quality-gate-passed 存在？
    ├─ ❌ 不存在 → exit 2 → 阻止会话结束
    │   └─ AI 被迫继续 Retry Loop
    └─ ✅ 存在 → exit 0 → 允许会话结束

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  阶段 2: 提交 PR + CI (服务器端)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

用户重新启动或新会话
    ↓
Step 9: 创建 PR
    ├─ pr-gate 快速检查产物
    └─ 创建 PR ✅
    ↓
CI 运行（服务器端）
```

---

## 核心机制

### 1. Stop Hook（hooks/stop.sh）

**职责**: Step 7 完整质检门控，阻止未完成质检就退出

**检查流程**（完整的 Step 7）:

```bash
# Step 7.1: 检查 Audit 报告 (L2A)
if [[ ! -f "docs/AUDIT-REPORT.md" ]]; then
    echo "❌ Step 7.1: Audit 报告缺失！"
    echo "请调用 /audit Skill"
    exit 2  # ← 阻止会话结束
fi

# Step 7.2: 检查 Audit Decision (Blocker)
DECISION=$(grep "^Decision:" docs/AUDIT-REPORT.md | awk '{print $2}')
if [[ "$DECISION" != "PASS" ]]; then
    echo "❌ Step 7.2: Audit 未通过！"
    echo "当前 Decision: $DECISION"
    echo "请修复 L1/L2 问题后重新审计"
    echo "(Retry Loop: Audit → FAIL → 修复 → 重新审计)"
    exit 2  # ← 阻止会话结束
fi

# Step 7.3: 检查自动化测试 (L1)
if [[ ! -f ".quality-gate-passed" ]]; then
    echo "❌ Step 7.3: 自动化测试未通过！"
    echo "请运行: npm run qa:gate"
    exit 2  # ← 阻止会话结束
fi

# 时效性检查（代码改动后需重新质检）
if (( 最新代码时间 > 质检文件时间 )); then
    echo "⚠️ 代码已修改，质检结果过期！"
    echo "请重新运行: npm run qa:gate"
    exit 2  # ← 阻止会话结束
fi

# Step 7 全部通过
echo "✅ Step 7 质检全部通过！"
echo "  ✅ L2A: Audit 审计 (Decision: PASS)"
echo "  ✅ L1: 自动化测试 (typecheck + test + build)"
exit 0  # ← 允许会话结束
```

### 2. 无限循环保护

**检查 stop_hook_active 标志**:

```bash
# Stop Hook 读取输入
HOOK_INPUT=$(cat)
STOP_HOOK_ACTIVE=$(echo "$HOOK_INPUT" | jq -r '.stop_hook_active // false')

if [[ "$STOP_HOOK_ACTIVE" == "true" ]]; then
    echo "已经重试过一次，允许结束（防止无限循环）"
    exit 0  # 允许结束
fi
```

**工作原理**:
- 第一次 Stop Hook 触发: `stop_hook_active=false` → 检查质检 → exit 2 阻止
- AI 继续工作 → 运行质检
- 第二次 Stop Hook 触发: `stop_hook_active=true` → exit 0 允许结束

**防止**: AI 卡在无限循环中无法退出

### 3. qa:gate 脚本（scripts/qa-with-gate.sh）

**职责**: 运行质检，成功时生成门控文件

```bash
# 运行完整质检
npm run typecheck || exit 1
npm run test || exit 1
npm run build || exit 1

# 全部通过，生成门控文件
cat > .quality-gate-passed << EOF
typecheck: PASS
test: PASS
build: PASS
Generated: $(date)
EOF
```

### 3. Retry Loop（官方确认行为）

**Stop Hook exit 2 → Blocks stoppage**（官方文档）

根据 Claude Code 官方文档，Stop Hook 的 exit 2 会：
- **Blocks stoppage**: 阻止会话结束
- **Shows stderr to Claude**: 将错误信息显示给 Claude

**AI 被迫循环**:

```
AI: 完成代码 → 尝试结束会话
    ↓
Stop Hook: 质检未通过 → exit 2
    ↓
Claude Code: 会话无法结束
    ↓
AI: 发现问题 → 运行 npm run qa:gate
    ↓
测试失败 → AI 修复 → 再运行 qa:gate
    ↓
再失败 → 再修复 → 再运行
    ↓
成功 → .quality-gate-passed 生成 ✅
    ↓
AI: 再次尝试结束会话
    ↓
Stop Hook: 质检已通过 → exit 0
    ↓
会话成功结束 ✅
```

---

## 真正有强制能力的 Hook

### 只有 2 个 Hook 有 100% 强制能力

```
1. PreToolUse:Write/Edit (hooks/branch-protect.sh)
   └─ 入口门控：分支 + PRD + DoD
   └─ 强制能力: ✅ 100%（唯一路径）

2. Stop Hook (hooks/stop.sh)
   └─ 退出门控：质检必须通过
   └─ 强制能力: ✅ 100%（会话结束唯一路径）
```

### 其他 Hook 都是"提示性"的

```
PreToolUse:Bash (hooks/pr-gate-v2.sh)
   └─ PR 前快速检查
   └─ 强制能力: ⚠️ 60%（多路径）
   └─ 作用: 快速失败，减少 CI 浪费

SessionEnd (hooks/session-end.sh)
   └─ CI 状态提示
   └─ 强制能力: ❌ 0%（只是提示）
   └─ 作用: 提醒用户检查 CI
```

---

## 工作流对比

### 原来的三层 Gate（一步到底）

```
Gate 1: 入口（PreToolUse:Write）        ✅ 100%
    ↓
（AI 写代码，质检可能跳过）
    ↓
Gate 2: PR 前（PreToolUse:Bash）        ⚠️ 60%
    ├─ 可能被绕过
    └─ 依赖 AI 自觉
    ↓
Gate 3: CI + A+（服务器端）             ✅ 100%
```

**问题**: 质检阶段无法强制，依赖 AI 自觉

### 现在的两阶段 + Stop Hook

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  阶段 1: 本地质检阶段
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Gate 1: 入口（PreToolUse:Write）        ✅ 100%
    ↓
（AI 写代码）
    ↓
Gate 2: 质检（Stop Hook）               ✅ 100%
    ├─ 强制 Retry Loop
    └─ 无法跳过

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  阶段 2: 提交 PR 阶段
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Gate 3: PR 前（PreToolUse:Bash）        ⚠️ 60%
    └─ 快速检查
    ↓
Gate 4: CI + A+（服务器端）             ✅ 100%
```

**优势**: 质检阶段 100% 强制，无法跳过

---

## 使用方法

### 开发流程（阶段 1）

```bash
# 1. 开始开发
/dev

# 2. AI 自动执行
# - 创建分支
# - 写 PRD/DoD
# - 写代码
# - 写测试
# - 运行质检: npm run qa:gate

# 3. 如果质检失败
# AI 自动进入 Retry Loop:
#   - 修复失败的测试
#   - 重新运行 npm run qa:gate
#   - 直到成功

# 4. 质检通过后
# - 生成 .quality-gate-passed
# - Stop Hook 允许会话结束
# - 会话结束 ✅
```

### 提交 PR（阶段 2）

```bash
# 1. 重新启动会话或新会话
cd project

# 2. 创建 PR
gh pr create --title "..." --body "..."

# 3. pr-gate 快速检查
# - 检查产物存在
# - 不运行测试（已经在阶段 1 验证过）
# - 立即创建 PR ✅

# 4. CI 运行（服务器端）
# - GitHub Actions 自动运行
# - 最终验证
```

---

## 关键文件

| 文件 | 作用 | 强制能力 |
|------|------|---------|
| hooks/branch-protect.sh | 入口门控（分支 + PRD/DoD）| ✅ 100% |
| hooks/stop.sh | 质检门控（阻止未质检退出）| ✅ 100% |
| hooks/pr-gate-v2.sh | PR 前快速检查 | ⚠️ 60% |
| scripts/qa-with-gate.sh | 质检 + 生成门控文件 | - |
| .quality-gate-passed | 质检门控文件（时效性检查）| - |

---

## 时效性检查

**防止绕过**: 代码改动后，旧的质检结果失效

```bash
# Stop Hook 检查
最新代码修改时间 > 质检文件时间？
    ├─ 是 → exit 2（阻止退出，要求重新质检）
    └─ 否 → exit 0（允许退出）
```

**场景**:
```
1. AI 运行 npm run qa:gate → 生成 .quality-gate-passed
2. AI 又修改了代码
3. AI 尝试结束会话
4. Stop Hook: "代码已修改，质检结果过期！"
5. AI 被迫重新运行 npm run qa:gate
```

---

## 优势总结

### 原来（一步到底）

| 阶段 | 强制能力 | 问题 |
|------|---------|------|
| 入口 | ✅ 100% | 无 |
| 质检 | ❌ 0% | 依赖 AI 自觉 |
| PR | ⚠️ 60% | 可被绕过 |
| CI | ✅ 100% | 但已经浪费 CI 配额 |

### 现在（两阶段 + Stop Hook）

| 阶段 | 强制能力 | 优势 |
|------|---------|------|
| 入口 | ✅ 100% | 无 |
| **质检** | ✅ **100%** | **Stop Hook 强制 Retry Loop** |
| PR | ⚠️ 60% | 快速检查 |
| CI | ✅ 100% | 最终验证 |

**关键改进**: 质检从 0% → 100% 强制能力

---

## FAQ

### Q: 为什么不在 pr-gate 里强制质检？

A: pr-gate 是 PreToolUse:Bash，有多路径问题（AI 可用 Python 绕过）。Stop Hook 是会话结束唯一路径，无法绕过。

### Q: AI 能伪造 .quality-gate-passed 文件吗？

A: 可以，但 Stop Hook 有时效性检查。如果代码改动后没重新质检，会被拦住。

### Q: 如果 AI 一直失败怎么办？

A: Retry Loop 会一直循环。用户可以 Ctrl+C 中断，手动修复，或调整 DoD。

### Q: 阶段 2 可以跳过吗？

A: 可以。如果用户手动创建 PR，pr-gate 会快速检查后放行。最终 CI 会验证。

---

*生成时间: 2026-01-24*
