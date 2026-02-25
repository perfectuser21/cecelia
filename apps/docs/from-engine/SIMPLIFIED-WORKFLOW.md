---
id: simplified-workflow
version: 1.0.0
created: 2026-01-24
updated: 2026-01-24
changelog:
  - 1.0.0: 极简工作流 - PreToolUse 入口 + Ralph Loop
---

# 极简工作流

**一句话**: PreToolUse 检查入口，Ralph Loop 自己跑，跑不完不让结束。

---

## 完整流程

```
用户: /ralph-loop "实现功能 X，质检通过后输出 DONE"
    ↓
┌─────────────────────────────────────────────────────────┐
│  PreToolUse:Write/Edit (入口检查) - 只在第一次写文件时  │
├─────────────────────────────────────────────────────────┤
│  hooks/branch-protect.sh 检查:                          │
│    ✅ 正确的 Repository（git 仓库）                      │
│    ✅ 正确的 Branch (cp-* 或 feature/*)                 │
│    ✅ 是否需要 Worktree（并行开发检测）                  │
│    ✅ PRD 存在且有效                                     │
│    ✅ DoD 存在且有效                                     │
│                                                         │
│  不通过 → exit 2 → 阻止写文件                           │
│  通过 → exit 0 → 放行 ✅                                │
└─────────────────────────────────────────────────────────┘
    ↓
┌═════════════════════════════════════════════════════════┐
║  Ralph Loop - 让它自己跑                                ║
╠═════════════════════════════════════════════════════════╣
║  AI 自由发挥:                                           ║
║    - 写代码                                             ║
║    - 写测试                                             ║
║    - 调用 /audit                                        ║
║    - 运行 npm run qa                                    ║
║    - 修复问题                                           ║
║    - 重复直到完成                                       ║
╚═════════════════════════════════════════════════════════╝
    ↓ (每次尝试结束时)
┌─────────────────────────────────────────────────────────┐
│  Stop Hook (质检门控) - 跑不完不让结束                   │
├─────────────────────────────────────────────────────────┤
│  hooks/stop.sh 检查:                                    │
│    ✅ Audit 通过？(Decision: PASS)                      │
│    ✅ 测试通过？(.quality-gate-passed 存在)             │
│                                                         │
│  未完成 → exit 2 → Ralph 继续循环 🔄                    │
│  完成 → exit 0 → Ralph 检测 completion-promise → 结束 ✅│
└─────────────────────────────────────────────────────────┘
```

---

## 两个 Hook 的职责（所有 8.x/9.0 要求 100% 保留）

### Hook 1: PreToolUse:Write/Edit（入口检查）

**时机**: 第一次写文件时

**检查**:
```bash
✅ Repository（在 git 仓库中）
✅ Branch（cp-* 或 feature/*，不能在 main/develop）
✅ Worktree（检测并行开发，提示是否需要）
✅ PRD 存在且有效（至少 3 行，包含关键字段）← 8.x/9.0 要求
✅ DoD 存在且有效（至少 3 行，包含验收清单）← 8.x/9.0 要求（Gate Contract #1）
```

**作用**: 保证进入正确的环境

**强制能力**: ✅ 100%（唯一路径，无法绕过）

**代码位置**: `hooks/branch-protect.sh:151-225`

---

### Hook 2: Stop Hook（质检门控）- **9.5.0 新增**

**时机**: AI 尝试结束会话时

**检查**:
```bash
✅ Audit 审计通过（docs/AUDIT-REPORT.md 存在 + Decision: PASS）← 9.5.0 新增强制
✅ 自动化测试通过（.quality-gate-passed 存在 + 时效性检查）← 9.5.0 新增强制
```

**8.x/9.0 vs 9.5.0**:
- 8.x/9.0: ❌ 依赖 AI 自觉（0% 强制能力）
- 9.5.0: ✅ Stop Hook 强制（100% 强制能力）

**作用**: 跑不完不让结束

**强制能力**: ✅ 100%（Stop Hook exit 2 阻止会话结束）

**代码位置**: `hooks/stop.sh:66-156`

**重点**:
```bash
# 如果 Audit 未通过或测试未通过
exit 2  # ← 阻止会话结束
        # ← Ralph Loop 继续循环
        # ← AI 被迫修复问题
```

---

## 使用方法

### 1. 启动 Ralph Loop

```bash
/ralph-loop "实现功能 X。

要求:
1. 调用 /audit，必须 Decision: PASS
2. 运行 npm run qa:gate，必须全部通过
3. 完成时输出 <promise>DONE</promise>

如果失败就修复重试，直到成功。" \
  --max-iterations 20 \
  --completion-promise "DONE"
```

### 2. Ralph Loop 自动执行

```
迭代 1: 写代码 → /audit → FAIL → Stop Hook 阻止 → Ralph 继续
迭代 2: 修复 → /audit → PASS → npm qa → 失败 → Stop Hook 阻止 → Ralph 继续
迭代 3: 修复测试 → npm qa → 成功 → 输出 DONE → Stop Hook 放行 → Ralph 结束 ✅
```

### 3. 创建 PR（阶段 2）

```bash
# 阶段 1 完成后，手动或另一个 Ralph Loop 创建 PR
gh pr create ...
```

**PreToolUse:Bash (pr-gate-v2.sh) 检查**:
```bash
✅ DoD 检查（内容有效性）← 8.x/9.0 要求（Gate Contract #1）
✅ DoD 引用 QA 决策 ← 8.x/9.0 要求
✅ QA-DECISION.md 存在 + 有效 + Decision 字段 ← 8.x/9.0 要求（Gate Contract #2）
✅ Audit 报告存在 + Decision: PASS
✅ P0/P1 → RCI 检查 ← 8.x/9.0 要求
✅ DoD ↔ Test 映射检查 ← 8.x/9.0 要求
⚡ FAST_MODE: 跳过本地测试（已在 Stop Hook 强制通过）
```

**代码位置**: `hooks/pr-gate-v2.sh:423-569`

---

## 优势

| 项目 | 传统方式 | Ralph Loop 方式 |
|------|---------|----------------|
| **入口检查** | 人工确认 | ✅ PreToolUse 自动 |
| **质检执行** | 人工提醒 AI | ✅ Stop Hook 强制 |
| **失败重试** | 人工重跑 | ✅ Ralph 自动循环 |
| **完成确认** | 人工判断 | ✅ completion-promise |
| **无限循环** | 可能卡住 | ✅ max-iterations 保护 |

---

## 核心原则

**PreToolUse 管入口，Ralph Loop 管执行，Stop Hook 管出口**

```
入口 (PreToolUse)
    ├─ 正确的 Repository
    ├─ 正确的 Branch
    ├─ 正确的 Worktree
    └─ 正确的 PRD/DoD
    ↓
执行 (Ralph Loop)
    └─ AI 自由发挥，自动重试
    ↓
出口 (Stop Hook)
    └─ 跑不完不让出去
```

---

## 对比：有头 vs 无头

### 有头模式（手动启动）

```bash
# 用户在 Claude Code 中
/ralph-loop "实现功能 X..." --max-iterations 20
```

### 无头模式（Cecelia）

```bash
# N8N 或脚本调用
cecelia-run "实现功能 X..." --max-iterations 20
```

**共同点**: 都用 Ralph Loop + Stop Hook，流程完全一样

---

## 总结

### 两个 Hook，各司其职

| Hook | 时机 | 检查什么 | 强制能力 |
|------|------|---------|---------|
| PreToolUse:Write | 写文件前 | Repository + Branch + PRD/DoD | ✅ 100% |
| Stop | 结束前 | Audit + 测试 | ✅ 100% |

### 一个循环，全自动

```
Ralph Loop
    └─ 失败 → 修复 → 重试 → 直到成功
```

### 零人工干预

```
用户: /ralph-loop "任务..."
    ↓
（等待 5-30 分钟）
    ↓
完成 ✅
```

**Over！** 🎉

---

## 8.x/9.0 所有要求 100% 保留验证

### Gate Contract (6 大红线) - 全部保留

| 要求 | 8.x/9.0 | 9.5.0 检查点 | 状态 |
|------|---------|-------------|------|
| 1. 空 DoD 必须 fail | pr-gate-v2.sh | ✅ PreToolUse:Write + PreToolUse:Bash | ✅ |
| 2. QA 决策空内容必须 fail | pr-gate-v2.sh | ✅ PreToolUse:Bash | ✅ |
| 3. P0wer 不应触发 P0 | detect-priority.cjs | ✅ detect-priority.cjs | ✅ |
| 4. release 模式不跳过 RCI | pr-gate-v2.sh | ✅ pr-gate MODE=release | ✅ |
| 5. 非白名单命令 fail | run-regression.sh | ✅ run-regression.sh | ✅ |
| 6. checkout 失败不删分支 | cleanup.sh | ✅ cleanup.sh | ✅ |

### 9.5.0 新增强化（Stop Hook）

| 检查项 | 8.x/9.0 | 9.5.0 | 强制能力 |
|--------|---------|-------|----------|
| Audit 执行 | ❌ 0% (AI 自觉) | ✅ Stop Hook | 100% |
| 测试执行 | ❌ 0% (AI 自觉) | ✅ Stop Hook | 100% |
| 质检时效性 | ❌ 无检查 | ✅ Stop Hook | 100% |
| 无限循环保护 | ❌ 无 | ✅ stop_hook_active | 100% |
| 测试超时保护 | ❌ 无 | ✅ 120s timeout | 100% |

### Ralph Loop 100% 自动执行

**用户视角**:
```bash
# 用户只需要做的事
/ralph-loop "实现功能 X（包含 PRD + DoD）"

# Ralph 自动完成（无需人工干预）:
1. ✅ 写代码（遵守 PRD）
2. ✅ 写测试（满足 DoD）
3. ✅ 调用 /audit（生成 QA-DECISION.md）← 8.x/9.0 要求
4. ✅ 运行 npm run qa:gate（生成 .quality-gate-passed）
5. ✅ 失败自动修复重试（Stop Hook 强制）← 9.5.0 新增
6. ✅ 全部通过后结束

# 阶段 2: 创建 PR
gh pr create ...  # 所有 8.x/9.0 检查自动执行
```

**详细验证**: 见 `docs/REQUIREMENT-VERIFICATION.md`

---

*生成时间: 2026-01-24*
