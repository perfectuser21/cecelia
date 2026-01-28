# 深度矛盾分析报告

**生成时间**: 2026-01-27
**分析范围**: /dev 工作流、Skills 文档、全局 CLAUDE.md
**问题来源**: 用户报告"在第4步或第7步会停下来，不知道为什么"

---

## 🔴 核心矛盾 #1：Ralph Loop 调用缺失（CRITICAL - 停顿根本原因）

### 症状

- 执行 `/dev` 后，在 Step 4 (DoD + /qa) 或 Step 7 (Quality + /audit) 处停下来
- 必须用户手动催促"继续啊"才会继续执行

### 根本原因

**AI 从未调用 `/ralph-loop`，导致缺少自动循环机制。**

### 文档要求（3 处明确规定）

#### 1. 全局规则（`~/.claude/CLAUDE.md` 第 30-82 行）

```markdown
## Ralph Loop 自动调用规则（CRITICAL）

**遇到以下场景时，必须调用 /ralph-loop，禁止手动循环。**

### 触发场景

#### 1. 进入 /dev 流程（p0 阶段）

```bash
/ralph-loop "实现<功能描述>，完成质检并创建 PR 后输出 <promise>QUALITY_GATE_PASSED</promise>" \
    --completion-promise "QUALITY_GATE_PASSED"
```

### 禁止行为（CRITICAL）

- ❌ 手动循环检查 CI 状态（手动查 `gh run list`）
- ❌ 修复一次就停下来
- ❌ 自己写 `while true` 循环
- ❌ 输出"结束对话"、"会话结束"、"等待用户确认"
```

#### 2. /dev Skill 规则（`skills/dev/SKILL.md` 第 35-80 行）

```markdown
## ⚡⚡⚡ Ralph Loop 强制调用（CRITICAL - 最高优先级）

**进入 /dev 后，必须立即调用 Ralph Loop 启动自动循环。**

### 调用时机

```bash
# 1. 检测当前阶段
PHASE=$(bash scripts/detect-phase.sh | grep "^PHASE:" | awk '{print $2}')

# 2. p0 阶段：质检循环
if [[ "$PHASE" == "p0" ]]; then
    /ralph-loop "实现 <PRD 描述的功能>，完成质检并创建 PR 后输出 <promise>QUALITY_GATE_PASSED</promise>" \
        --completion-promise "QUALITY_GATE_PASSED"
fi
```

### Ralph Loop 工作机制

**AI 的职责**：
- ✅ 循环检查完成条件（质检通过？PR 创建？CI 通过？）
- ✅ 条件未满足 → 执行修复步骤 → **不输出 promise** → Ralph Loop 自动继续
- ✅ 条件全部满足 → **输出 `<promise>SIGNAL</promise>`** → Ralph Loop 结束
```

#### 3. Skill invocation 参数

```
ARGUMENTS: 实施 Evidence CI 化（v2.0.0）：CI 生成 Evidence、本地 Fast Fail、Ralph Loop 自愈循环
```

PRD 标题明确提到"Ralph Loop 自愈循环"，但 AI 从未调用它。

### 实际执行情况

| 时间点 | AI 行为 | 应该的行为 |
|--------|---------|-----------|
| 用户调用 `/dev` | 直接进入 Step 1-8 顺序执行 | **应该调用 `/ralph-loop` 启动循环** |
| Step 4 完成 (/qa) | 停下来，等待用户 | Ralph Loop 应自动继续 |
| 用户："继续啊" | 才继续执行 | 不应需要用户催促 |
| Step 7 完成 (/audit) | 又停下来 | Ralph Loop 应自动继续 |

### 为什么缺少 Ralph Loop 会导致停顿？

#### 正常流程（有 Ralph Loop）

```
用户调用 /dev
    ↓
AI 立即调用 /ralph-loop
    ↓
Ralph Loop 启动外层循环
    ↓
AI 执行 Step 1-8
    ├─ Step 4: 调用 /qa Skill → 生成 QA-DECISION.md → /qa 返回
    │   ↓
    │   AI 自然想停下来（因为 Skill 返回了）
    │   ↓
    │   Ralph Loop 检测到没有 <promise> → 自动继续
    │   ↓
    ├─ Step 5-6: 写代码、测试
    │   ↓
    ├─ Step 7: 调用 /audit Skill → 生成 AUDIT-REPORT.md → /audit 返回
    │   ↓
    │   AI 自然想停下来
    │   ↓
    │   Ralph Loop 检测到没有 <promise> → 自动继续
    │   ↓
    └─ Step 8: 创建 PR → 输出 <promise>QUALITY_GATE_PASSED</promise>
        ↓
    Ralph Loop 检测到 promise → 结束 ✅
```

#### 实际流程（无 Ralph Loop）

```
用户调用 /dev
    ↓
AI 直接执行 Step 1-8（没有外层循环）
    ↓
AI 执行 Step 4: 调用 /qa Skill → 生成 QA-DECISION.md
    ↓
/qa Skill 返回（按规范不输出总结）
    ↓
AI：❓ /qa 返回了，那我该干啥？
    ↓
AI：🤔 没有明确指令继续，停下来等用户吧
    ↓
停顿 ⚠️
    ↓
用户："继续啊"
    ↓
AI 继续 Step 5-7
    ↓
Step 7: 调用 /audit Skill → 生成 AUDIT-REPORT.md
    ↓
/audit Skill 返回
    ↓
又停顿 ⚠️
```

### /qa 和 /audit Skills 的行为是正确的

**`/qa` SKILL.md 第 368-377 行**：

```markdown
## ⚡ 完成后行为（CRITICAL）

**生成 QA-DECISION.md 后，立即返回调用方**：

1. **不要**输出"QA 决策已生成！现在返回 /dev 流程..."
2. **不要**停顿或输出总结
3. **立即**返回，让调用方（/dev）继续执行下一步
4. **绝对不要**等待用户确认

这个 Skill 的职责是"生成决策文件"，不是"等待确认"。
```

**`/audit` SKILL.md 第 270-279 行**：

```markdown
## ⚡ 完成后行为（CRITICAL）

**生成 AUDIT-REPORT.md 后，立即返回调用方**：

1. **不要**输出"审计报告已生成！现在返回 /dev 流程..."
2. **不要**停顿或输出总结
3. **立即**返回，让调用方（/dev）继续执行下一步
4. **绝对不要**等待用户确认

这个 Skill 的职责是"生成审计报告"，不是"等待确认"。
```

**结论**：/qa 和 /audit 按照规范正确返回了，但**调用方（/dev）缺少 Ralph Loop 的自动循环机制**，导致 AI 停下来等待。

---

## 🟡 矛盾 #2：自动执行规则 vs 实际行为

### 文档要求

**`skills/dev/SKILL.md` 自动执行规则部分**：

```markdown
## ⚡ 自动执行规则（CRITICAL）

**每个步骤完成后，必须立即执行下一步，不要停顿、不要等待用户确认、不要输出总结。**

### 执行流程

```
Step N 完成 → 立即读取 skills/dev/steps/{N+1}-xxx.md → 立即执行下一步
```

### 禁止行为

- ❌ 完成一步后输出"已完成，等待用户确认"
- ❌ 完成一步后停下来总结
- ❌ 询问用户"是否继续下一步"
- ❌ Skill 调用返回后停顿（如 /qa、/audit）

### 正确行为

- ✅ 完成 Step 4 (DoD + /qa) → **立即**执行 Step 5 (Code)
- ✅ 完成 Step 5 (Code) → **立即**执行 Step 6 (Test)
- ✅ 完成 Step 6 (Test) → **立即**执行 Step 7 (Quality)
- ✅ 完成 Step 7 (Quality + /audit) → **立即**执行 Step 8 (PR)
- ✅ 一直执行到 Step 8 创建 PR 为止

### 特别注意：Skill 调用后必须继续

当调用 `/qa` 或 `/audit` Skill 后：
1. **不要**输出"QA 决策已生成！现在返回 /dev 流程继续执行..."
2. **不要**停下来等待
3. **立即**读取下一步的 steps 文件并执行
```

### 实际发生

- Step 4 (DoD + /qa) 完成后 → **停顿** ⚠️
- Step 7 (Quality + /audit) 完成后 → **停顿** ⚠️
- 用户说"继续啊" → AI 才继续

### 根本原因

**依赖 AI 的"自觉性"执行自动化流程是不可靠的。**

正确的做法：
1. 调用 `/ralph-loop` 提供外层循环框架
2. AI 检查完成条件
3. 未满足 → 继续执行下一步 → 不输出 promise
4. 满足 → 输出 `<promise>` → Ralph Loop 结束

---

## 🟡 矛盾 #3：Stop Hook 行为预期 vs 实际效果

### 文档描述

**`skills/dev/SKILL.md` 关于 Stop Hook 和 Ralph Loop 配合**：

```markdown
### Stop Hook 配合

**P0 阶段**（`hooks/stop.sh`）：
```bash
if [ 质检未通过 ]; then
    exit 2  # Ralph Loop 继续
elif [ PR 未创建 ]; then
    exit 2  # Ralph Loop 继续
else
    exit 0  # 允许结束
fi
```
```

### 问题

**没有 Ralph Loop 的情况下，Stop Hook 的 `exit 2` 无法触发自动重试。**

Stop Hook 的设计依赖于 Ralph Loop 插件：
- Ralph Loop 插件检测到 Stop Hook 返回 `exit 2` → 自动重新注入任务
- 没有 Ralph Loop → `exit 2` 只是让 AI 看到一个错误，但没有自动重试机制

### 实际行为

- Stop Hook 可能执行了（检查质检状态）
- 但没有 Ralph Loop 框架承接 `exit 2`
- 结果：AI 停下来，用户必须手动催促

---

## 🟢 非矛盾项：Evidence 生成位置（已正确）

### v10.11.0+ 规定

- Evidence 只在 CI 生成
- 本地不生成 Evidence
- `skills/dev/steps/07-quality.md` 已经更新（cleanup PR）

### 实际检查

**`skills/dev/steps/07-quality.md` 第 165 行**：
```markdown
- **Evidence 由 CI 生成**：本地不再生成 Evidence，CI 自动生成（v10.11.0+）
```

**`.gitignore` 已更新**：
```
.quality-evidence*.json
```

**CI 脚本已实现**：
- `ci/scripts/generate-evidence.sh` - 生成 Evidence
- `ci/scripts/evidence-gate.sh` - 验证 Evidence
- `.github/workflows/ci.yml` - 集成到 CI

**结论**：✅ Evidence CI 化已正确实现，文档与实现一致。

---

## 🔴 总结：为什么会停在 Step 4 或 Step 7

### 直接原因

1. **Step 4**：调用 `/qa` Skill 生成 `QA-DECISION.md`
   - `/qa` 按规范返回（不输出总结）
   - AI 缺少明确指令继续
   - **停顿** ⚠️

2. **Step 7**：调用 `/audit` Skill 生成 `AUDIT-REPORT.md`
   - `/audit` 按规范返回（不输出总结）
   - AI 缺少明确指令继续
   - **停顿** ⚠️

### 根本原因

**❌ AI 从未调用 `/ralph-loop`，缺少自动循环机制。**

Ralph Loop 的作用：
- 提供外层循环框架
- 检测 AI 是否输出 `<promise>`
- 如果没有 → 自动重新注入任务 → AI 继续执行
- 如果有 → 循环结束

### 解决方案

**在进入 /dev 后，AI 必须立即调用 `/ralph-loop`。**

正确的执行流程：

```bash
# 1. 检测阶段
PHASE=$(bash scripts/detect-phase.sh | grep "^PHASE:" | awk '{print $2}')

# 2. p0 阶段：调用 Ralph Loop
if [[ "$PHASE" == "p0" ]]; then
    /ralph-loop "实现 Evidence CI 化，完成质检并创建 PR 后输出 <promise>QUALITY_GATE_PASSED</promise>" \
        --max-iterations 20 \
        --completion-promise "QUALITY_GATE_PASSED"
fi
```

然后在 Ralph Loop 循环中：
- AI 执行 Step 1-8
- 每次迭代结束，检查完成条件
- 条件未满足 → 不输出 promise → Ralph Loop 自动继续
- 条件全部满足 → 输出 `<promise>QUALITY_GATE_PASSED</promise>` → 结束

---

## 📋 修复建议

### 1. 强化 /dev 入口逻辑（CRITICAL）

**位置**: `skills/dev/SKILL.md` 开头

**当前问题**: 有 Ralph Loop 调用说明，但 AI 实际执行时没有遵守

**修复方案**: 在 SKILL.md 的 Arguments 解析部分，添加强制检查：

```markdown
## 入口：强制 Ralph Loop 调用

**CRITICAL: 进入 /dev 后的第一件事是调用 Ralph Loop。**

### 执行顺序（不可改）

```bash
# 1. 检测阶段
bash scripts/detect-phase.sh

# 2. 根据阶段调用 Ralph Loop（必须！）
if p0: /ralph-loop "..." --completion-promise "QUALITY_GATE_PASSED"
if p1: /ralph-loop "..." --completion-promise "CI_PASSED"
if p2/pending/unknown: 直接退出

# 3. 在 Ralph Loop 循环内执行步骤
#    AI 不需要手动调用 Step 1-8，Ralph Loop 会驱动
```

**禁止直接进入 Step 1**：
- ❌ 看到 /dev → 直接读 01-prd.md
- ✅ 看到 /dev → 检测阶段 → 调用 Ralph Loop → 在循环内执行步骤
```

### 2. 增强 AI Thinking 规则（补充）

**位置**: `~/.claude/CLAUDE.md`

**补充说明**: 在 AI Thinking 规则中，明确 Ralph Loop 相关的决策点：

```markdown
## AI Thinking 规则（覆盖系统默认）

**CRITICAL: 只在以下 3 个关键决策点使用 thinking**：

1. **/dev 入口决策点** - 判断是否需要调用 Ralph Loop ✨ 新增
2. **PR 前决策点** - 判断是否所有 DoD 完成、决定 PR 内容
3. **CI 分析点** - 分析 CI 失败原因、决定修复策略

**其他时候禁止 thinking**：
- Read/Grep/Bash 等工具调用后 → 直接处理结果
- 执行开发步骤时 → 直接执行，不需要分析
- 输出 `<promise>SIGNAL</promise>` 时 → 直接输出，不要插入 thinking
```

### 3. 添加阶段检测后的自动跳转

**位置**: `skills/dev/steps/02-detect.md` 或独立文件

**新增内容**: 阶段检测后，根据结果自动决定下一步

```markdown
## Step 2: 环境检测 + Ralph Loop 跳转

### 2.1 检测阶段

```bash
bash scripts/detect-phase.sh
```

### 2.2 根据阶段跳转

**p0** → 调用 Ralph Loop，执行 Step 3-8
**p1** → 调用 Ralph Loop，执行 Step 9 (CI 修复)
**p2** → 直接退出（已完成）
**pending** → 等待 CI（可选）
**unknown** → 直接退出（API 错误）

### 2.3 p0 阶段：Ralph Loop 启动

```bash
/ralph-loop "实现 <PRD 描述>，完成质检并创建 PR 后输出 <promise>QUALITY_GATE_PASSED</promise>" \
    --max-iterations 20 \
    --completion-promise "QUALITY_GATE_PASSED"
```

**在 Ralph Loop 循环内，AI 执行 Step 3-8。**
```

### 4. 测试验证

**创建测试 PRD**：

```bash
cd /home/xx/dev/zenithjoy-engine
git checkout develop
git pull
git checkout -b test-ralph-loop

cat > .prd-test-ralph-loop.md <<'EOF'
# PRD: 测试 Ralph Loop 自动调用

> Type: Test
> Priority: P3

## 目标

验证 /dev 调用时，AI 是否自动调用 Ralph Loop。

## 成功标准

- /dev 入口立即检测到需要调用 Ralph Loop
- Ralph Loop 成功启动
- Step 4 和 Step 7 调用 Skill 后不停顿
- 输出 <promise>QUALITY_GATE_PASSED</promise> 后结束
EOF
```

**调用测试**：

```bash
/dev .prd-test-ralph-loop.md
```

**预期行为**：
1. AI 检测阶段 → p0
2. AI 立即调用 `/ralph-loop "..." --completion-promise "QUALITY_GATE_PASSED"`
3. Ralph Loop 循环内执行 Step 1-8
4. Step 4 和 Step 7 不停顿
5. 创建 PR 后输出 `<promise>QUALITY_GATE_PASSED</promise>`
6. Ralph Loop 检测到 promise → 结束

---

## 🎯 验证清单

### 文档层面

- [x] Ralph Loop 调用规则在 CLAUDE.md（第 30-82 行）
- [x] Ralph Loop 调用规则在 skills/dev/SKILL.md（第 35-80 行）
- [x] /qa 返回规则在 skills/qa/SKILL.md（第 368-377 行）
- [x] /audit 返回规则在 skills/audit/SKILL.md（第 270-279 行）
- [x] Evidence CI 化在 skills/dev/steps/07-quality.md（第 165 行）

### 实现层面

- [x] Evidence 生成脚本（ci/scripts/generate-evidence.sh）
- [x] Evidence 验证脚本（ci/scripts/evidence-gate.sh）
- [x] CI 集成（.github/workflows/ci.yml）
- [x] .gitignore 更新（.quality-evidence*.json）

### 执行层面

- [ ] **AI 实际调用 Ralph Loop（缺失！）**
- [ ] Step 4 后自动继续（依赖 Ralph Loop）
- [ ] Step 7 后自动继续（依赖 Ralph Loop）
- [ ] 完成条件检查（依赖 Ralph Loop）

---

## 结论

**唯一的 CRITICAL 矛盾**：AI 从未调用 `/ralph-loop`，导致：
1. 缺少外层自动循环机制
2. Step 4 和 Step 7 调用 Skill 后停顿
3. 用户必须手动催促"继续"

**其他检查项**：
- Evidence CI 化：✅ 已正确实现
- /qa 和 /audit 返回规则：✅ 文档正确，行为正确
- Stop Hook 配合：⚠️ 依赖 Ralph Loop，当前无效

**修复优先级**：
1. **P0**: 强化 /dev 入口的 Ralph Loop 强制调用逻辑
2. **P1**: 添加阶段检测后的自动跳转
3. **P2**: 增强 AI Thinking 规则中的 Ralph Loop 决策点
4. **P3**: 创建测试 PRD 验证修复效果
