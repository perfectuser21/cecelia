# 修复方案：解决 Step 4/7 停顿问题

**问题**: AI 在执行 /dev 时，Step 4 (调用 /qa) 和 Step 7 (调用 /audit) 后停下来
**根本原因**: AI 从未调用 `/ralph-loop`，缺少自动循环机制
**优先级**: P0 (CRITICAL)

---

## 问题根源

### 设计意图（文档）

```
用户调用 /dev
    ↓
AI 检测阶段（p0/p1/p2/pending）
    ↓
AI 立即调用 /ralph-loop（必须！）
    ↓
Ralph Loop 启动外层循环
    ↓
在循环内执行 Step 1-8
    ↓
检查完成条件
    ├─ 未满足 → 不输出 promise → Ralph Loop 自动继续
    └─ 满足 → 输出 <promise>SIGNAL</promise> → 结束
```

### 实际执行（现状）

```
用户调用 /dev
    ↓
AI 直接执行 Step 1-8（跳过了 Ralph Loop 调用！）
    ↓
Step 4: 调用 /qa Skill
    ↓
/qa 返回（按规范不输出总结）
    ↓
AI 停下来 ⚠️ （没有 Ralph Loop 驱动继续）
    ↓
用户："继续啊"
    ↓
AI 继续 Step 5-7
    ↓
Step 7: 调用 /audit Skill
    ↓
/audit 返回
    ↓
AI 又停下来 ⚠️
```

### 为什么会这样？

**AI 没有遵守文档中的强制规则：**

1. `~/.claude/CLAUDE.md` 第 30 行：
   ```markdown
   ## Ralph Loop 自动调用规则（CRITICAL）
   **遇到以下场景时，必须调用 /ralph-loop，禁止手动循环。**
   ```

2. `skills/dev/SKILL.md` 第 35 行：
   ```markdown
   ## ⚡⚡⚡ Ralph Loop 强制调用（CRITICAL - 最高优先级）
   **进入 /dev 后，必须立即调用 Ralph Loop 启动自动循环。**
   ```

但 AI 实际执行时，**直接跳过了这个步骤**。

---

## 修复方案

### 方案 A：强化 /dev 入口逻辑（推荐）

**修改文件**: `skills/dev/SKILL.md`

**当前问题**: 文档有 Ralph Loop 说明，但 AI 不遵守

**修复方案**: 在 SKILL.md 开头添加强制执行检查点

#### 修改内容

在 `skills/dev/SKILL.md` 的 frontmatter 之后，添加：

```markdown
---
name: dev
version: 2.1.0
updated: 2026-01-27
description: |
  统一开发工作流入口（两阶段 + Ralph Loop 强制）。

  **CRITICAL**: 进入 /dev 的第一件事是调用 /ralph-loop

  触发条件：
  - 用户说任何开发相关的需求
  - 用户说 /dev
  - Hook 输出 [SKILL_REQUIRED: dev]

  v2.1.0 变更：
  - 强化 Ralph Loop 强制调用逻辑
  - 添加入口检查点（不可跳过）
---

# /dev - 统一开发工作流（v2.1）

## ⚡⚡⚡ 入口检查点（CRITICAL - 第一步）

**你现在在 /dev Skill 的入口。在做任何其他事情之前，必须先完成这个检查点。**

### 第 0 步：Ralph Loop 强制启动（不可跳过）

```bash
# 1. 检测阶段
bash scripts/detect-phase.sh

# 2. 根据阶段调用 Ralph Loop（必须执行！）
PHASE=$(bash scripts/detect-phase.sh | grep "^PHASE:" | awk '{print $2}')

if [[ "$PHASE" == "p0" ]]; then
    # p0 阶段：质检循环
    /ralph-loop "实现 <PRD 描述的功能>，完成质检并创建 PR 后输出 <promise>QUALITY_GATE_PASSED</promise>" \
        --max-iterations 20 \
        --completion-promise "QUALITY_GATE_PASSED"

    # 如果看到这行，说明你跳过了 Ralph Loop 调用！
    # 必须回到上面，先调用 /ralph-loop

elif [[ "$PHASE" == "p1" ]]; then
    # p1 阶段：CI 修复循环
    PR_NUMBER=$(gh pr list --head $(git rev-parse --abbrev-ref HEAD) --json number -q '.[0].number')
    /ralph-loop "修复 PR #$PR_NUMBER 的 CI 失败，CI 通过并合并后输出 <promise>CI_PASSED</promise>" \
        --max-iterations 10 \
        --completion-promise "CI_PASSED"

elif [[ "$PHASE" == "p2" ]] || [[ "$PHASE" == "pending" ]] || [[ "$PHASE" == "unknown" ]]; then
    # 已完成或无需处理，直接退出
    exit 0
fi
```

**禁止直接进入 Step 1**：

- ❌ 看到 /dev → 直接读 `skills/dev/steps/01-prd.md`
- ❌ 检测阶段后 → 直接执行 Step 3-8
- ✅ 看到 /dev → 检测阶段 → **调用 /ralph-loop** → 在循环内执行步骤

**如果你看到这段文字但没有调用 Ralph Loop**：

→ 停止当前操作
→ 回到上面
→ 执行阶段检测
→ 调用 /ralph-loop
→ 然后在 Ralph Loop 循环内继续

---

## Ralph Loop 循环内的执行流程

**在 Ralph Loop 循环内，AI 执行以下步骤：**

### p0 阶段（质检循环）

```
Ralph Loop 启动
    ↓
每次迭代：
    ├─ 检查完成条件：
    │   1. Audit 报告存在且 PASS？
    │   2. .quality-gate-passed 存在？
    │   3. PR 已创建？
    │
    ├─ 如果全部满足：
    │   → 输出 <promise>QUALITY_GATE_PASSED</promise>
    │   → Ralph Loop 检测到 promise → 结束 ✅
    │
    └─ 如果未满足：
        → 执行对应步骤（Step 1-8）
        → 不输出 promise
        → Ralph Loop 自动继续下一次迭代
```

### p1 阶段（CI 修复循环）

```
Ralph Loop 启动
    ↓
每次迭代：
    ├─ 检查 CI 状态（gh pr checks）
    │
    ├─ pending/queued：
    │   → 等待 30 秒
    │   → 不输出 promise
    │   → Ralph Loop 继续
    │
    ├─ failure：
    │   → 分析失败原因
    │   → 修复代码
    │   → git add && commit && push
    │   → 不输出 promise
    │   → Ralph Loop 继续
    │
    └─ success：
        → gh pr merge --squash --delete-branch
        → 输出 <promise>CI_PASSED</promise>
        → Ralph Loop 结束 ✅
```

### AI 的职责（在循环内）

**每次 Ralph Loop 迭代结束时，AI 必须：**

1. **检查完成条件**：
   - p0: Audit PASS？质检通过？PR 创建？
   - p1: CI 通过？PR 合并？

2. **根据条件决定输出**：
   - ✅ 全部满足 → 输出 `<promise>SIGNAL</promise>` → 结束
   - ❌ 未满足 → **不输出 promise** → 继续执行修复步骤

3. **禁止行为**：
   - ❌ 手动写 while 循环
   - ❌ 看到 "exit 0" 就停下来
   - ❌ 修复一次就认为完成
   - ❌ 输出"会话结束"、"等待用户确认"

### /qa 和 /audit Skills 的正确调用方式

**当执行到 Step 4 或 Step 7 时：**

```
AI: 我需要调用 /qa Skill 生成 QA-DECISION.md
    ↓
AI: 调用 /qa
    ↓
/qa Skill 执行 → 生成 docs/QA-DECISION.md → 返回
    ↓
AI: ✅ /qa 返回了，QA-DECISION.md 已生成
    ↓
AI: 根据 Ralph Loop 机制：
    - 检查完成条件
    - 条件未满足（PR 还没创建）
    - **不输出 promise**
    - 继续执行 Step 5（写代码）
    ↓
Ralph Loop 检测到没有 promise → 自动继续迭代
```

**禁止的行为**：

```
AI: 调用 /qa
    ↓
/qa 返回
    ↓
AI: ❓ /qa 返回了，我该干啥？
    ↓
AI: 🤔 没有明确指令，停下来等用户吧
    ↓
停顿 ⚠️ ← 这是错误的！
```

---

## 核心定位

（后续内容保持不变...）
```

### 修改检查清单

- [ ] 在 `skills/dev/SKILL.md` 开头添加"入口检查点"章节
- [ ] 明确 Ralph Loop 调用是第 0 步（不可跳过）
- [ ] 添加"如果你看到这段文字但没有调用 Ralph Loop"的提示
- [ ] 更新版本号到 v2.1.0
- [ ] 测试修复效果

---

## 方案 B：修改 AI Thinking 规则（补充）

**修改文件**: `~/.claude/CLAUDE.md`

**当前问题**: AI Thinking 规则没有包含 /dev 入口决策点

**修复方案**: 在 Thinking 规则中添加 Ralph Loop 决策点

#### 修改内容

在 `~/.claude/CLAUDE.md` 的 "AI Thinking 规则" 部分，修改为：

```markdown
## AI Thinking 规则（覆盖系统默认）

**CRITICAL: 只在以下 3 个关键决策点使用 thinking**：

1. **/dev 入口决策点** - 判断是否需要调用 Ralph Loop（✨ 新增）
   - 用户调用 /dev 后
   - 思考：当前阶段是什么？需要调用 Ralph Loop 吗？
   - 决策：调用 /ralph-loop 还是直接退出？

2. **PR 前决策点** - 判断是否所有 DoD 完成、决定 PR 内容
   - 即将创建 PR 时
   - 思考：DoD 全勾了吗？质检通过了吗？
   - 决策：创建 PR 还是继续修复？

3. **CI 分析点** - 分析 CI 失败原因、决定修复策略
   - CI 失败时
   - 思考：失败原因是什么？
   - 决策：如何修复？

**其他时候禁止 thinking**：
- Read/Grep/Bash 等工具调用后 → 直接处理结果
- 执行开发步骤时 → 直接执行，不需要分析
- 输出 `<promise>SIGNAL</promise>` 时 → 直接输出，不要插入 thinking

**原因**: 频繁 thinking 会干扰 Ralph Loop 的自动循环机制。
```

### 修改检查清单

- [ ] 在 `~/.claude/CLAUDE.md` AI Thinking 规则中添加 "/dev 入口决策点"
- [ ] 明确这是唯一允许的 thinking 时机之一
- [ ] 强调其他时候禁止 thinking（避免打断 promise 输出）

---

## 方案 C：创建独立的入口步骤文件（可选）

**创建文件**: `skills/dev/steps/00-entry.md`

**目的**: 将 Ralph Loop 调用逻辑独立为 Step 0

#### 文件内容

```markdown
# Step 0: 入口检查点

> Ralph Loop 强制启动（不可跳过）

---

## 0.1 阶段检测

```bash
bash scripts/detect-phase.sh
```

输出格式：
```
PHASE: p0 | p1 | p2 | pending | unknown
DESCRIPTION: ...
ACTION: ...
```

---

## 0.2 根据阶段调用 Ralph Loop

### p0 阶段：质检循环

```bash
/ralph-loop "实现 <PRD 描述的功能>，完成质检并创建 PR 后输出 <promise>QUALITY_GATE_PASSED</promise>" \
    --max-iterations 20 \
    --completion-promise "QUALITY_GATE_PASSED"
```

**完成条件检查**（每次迭代结束时）：
1. ✅ Audit 报告存在且 PASS？
2. ✅ .quality-gate-passed 存在？
3. ✅ PR 已创建？

全部满足 → 输出 `<promise>QUALITY_GATE_PASSED</promise>` → 结束
未满足 → 不输出 promise → 继续执行

### p1 阶段：CI 修复循环

```bash
PR_NUMBER=$(gh pr list --head $(git rev-parse --abbrev-ref HEAD) --json number -q '.[0].number')
/ralph-loop "修复 PR #$PR_NUMBER 的 CI 失败，CI 通过并合并后输出 <promise>CI_PASSED</promise>" \
    --max-iterations 10 \
    --completion-promise "CI_PASSED"
```

**完成条件检查**（每次迭代结束时）：
- CI pending → 等待 → 不输出 promise → 继续
- CI failure → 修复 → 不输出 promise → 继续
- CI success → 合并 → 输出 `<promise>CI_PASSED</promise>` → 结束

### p2/pending/unknown 阶段：直接退出

```bash
exit 0  # 已完成或无需处理
```

---

## 0.3 禁止直接跳过

**如果你看到这个文件但没有调用 Ralph Loop**：

→ 停止当前操作
→ 回到 0.2
→ 调用 /ralph-loop
→ 然后在 Ralph Loop 循环内继续

**禁止行为**：
- ❌ 直接读取 `01-prd.md`
- ❌ 跳过 Ralph Loop 调用
- ❌ 认为"只是读个文件而已，不用调用"

---

## 完成后

**Ralph Loop 会驱动后续步骤的执行，你不需要手动调用下一步。**

Ralph Loop 循环内的步骤：
- p0: Step 1-8 (PRD → 分支 → DoD → 代码 → 测试 → 质检 → PR)
- p1: Step 9 (CI 修复)
```

### 修改检查清单

- [ ] 创建 `skills/dev/steps/00-entry.md`
- [ ] 将 Ralph Loop 调用逻辑从 SKILL.md 移到这里
- [ ] 在 `skills/dev/SKILL.md` 中引用 Step 0
- [ ] 确保 AI 进入 /dev 后首先读取 `00-entry.md`

---

## 测试验证

### 测试 1：简单功能（P3）

```bash
cd /home/xx/dev/zenithjoy-engine
git checkout develop
git pull
git checkout -b test-ralph-loop-p3

cat > .prd-test-ralph.md <<'EOF'
# PRD: 测试 Ralph Loop 调用

> Type: Test
> Priority: P3

## 目标

验证 /dev 入口是否正确调用 Ralph Loop。

## 成功标准

- /dev 入口立即调用 Ralph Loop
- Step 4 (调用 /qa) 后不停顿
- Step 7 (调用 /audit) 后不停顿
- 创建 PR 后输出 <promise>QUALITY_GATE_PASSED</promise>
EOF

# 调用 /dev
/dev .prd-test-ralph.md
```

**预期行为**：
1. ✅ AI 检测阶段 → p0
2. ✅ AI 立即调用 `/ralph-loop "..." --completion-promise "QUALITY_GATE_PASSED"`
3. ✅ Ralph Loop 循环启动
4. ✅ Step 4 调用 /qa 后，AI 自动继续 Step 5（不停顿）
5. ✅ Step 7 调用 /audit 后，AI 自动继续 Step 8（不停顿）
6. ✅ 创建 PR 后，AI 输出 `<promise>QUALITY_GATE_PASSED</promise>`
7. ✅ Ralph Loop 检测到 promise → 结束

**失败行为**：
- ❌ AI 直接进入 Step 1（没有调用 Ralph Loop）
- ❌ Step 4 或 Step 7 后停顿
- ❌ 需要用户催促"继续"

### 测试 2：CI 修复（P1）

```bash
# 假设有一个 PR 的 CI 失败了
# 运行 /dev 应该自动进入 p1 阶段

/dev
```

**预期行为**：
1. ✅ AI 检测阶段 → p1
2. ✅ AI 立即调用 `/ralph-loop "修复 PR #X..." --completion-promise "CI_PASSED"`
3. ✅ Ralph Loop 循环内持续检查 CI
4. ✅ CI failure → 修复 → push → 不输出 promise → 继续
5. ✅ CI success → 合并 → 输出 `<promise>CI_PASSED</promise>` → 结束

---

## 回滚方案

如果修复导致新问题，回滚步骤：

```bash
cd /home/xx/dev/zenithjoy-engine
git checkout develop

# 恢复 skills/dev/SKILL.md 到 v2.0.0
git checkout HEAD~1 -- skills/dev/SKILL.md

# 如果创建了 00-entry.md，删除它
rm -f skills/dev/steps/00-entry.md

# 如果修改了 CLAUDE.md，恢复
git checkout HEAD~1 -- ~/.claude/CLAUDE.md

# 提交回滚
git add -A
git commit -m "revert: 回滚 Ralph Loop 强制调用修复"
git push
```

---

## 时间线

| 任务 | 预计时间 | 负责人 |
|------|----------|--------|
| 修改 skills/dev/SKILL.md | 30 分钟 | AI |
| 修改 CLAUDE.md | 10 分钟 | AI |
| 创建 00-entry.md（可选） | 20 分钟 | AI |
| 测试验证 | 1 小时 | AI + 用户 |
| 文档更新 | 20 分钟 | AI |

**总计**: 约 2 小时

---

## 成功标准

修复成功的标志：

1. ✅ 用户调用 `/dev` 后，AI 立即检测阶段并调用 Ralph Loop
2. ✅ Step 4 和 Step 7 调用 Skill 后，AI 自动继续（不停顿）
3. ✅ 完成条件满足时，AI 输出 `<promise>` 并结束
4. ✅ 用户不需要手动催促"继续"
5. ✅ 至少通过 2 个测试用例验证

---

## 相关文件

- `skills/dev/SKILL.md` - /dev 主入口（需修改）
- `skills/dev/steps/00-entry.md` - 新建入口步骤（可选）
- `~/.claude/CLAUDE.md` - 全局规则（需补充）
- `docs/CONTRADICTION_ANALYSIS.md` - 矛盾分析报告
- `hooks/stop.sh` - Stop Hook（无需修改，已正确）
- `scripts/detect-phase.sh` - 阶段检测（无需修改）
