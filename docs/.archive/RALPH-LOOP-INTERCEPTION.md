---
id: ralph-loop-interception
version: 1.0.0
created: 2026-01-27
updated: 2026-01-27
changelog:
  - 1.0.0: 初始版本 - 记录 /dev skill 中两个 Ralph Loop 的拦截逻辑
---

# /dev Skill 中的 Ralph Loop 拦截逻辑

## 概述

`/dev` skill 使用两个独立的 Ralph Loop 来处理不同阶段的自动循环:

1. **Pre-PR Ralph Loop (p0 阶段)**: 质检循环 → 创建 PR
2. **After-PR Ralph Loop (p1 阶段)**: CI 修复循环 → 合并 PR

Ralph Loop 插件通过检测 `<promise>` 标记来控制循环：AI 检查任务完成条件，所有条件满足后输出 promise，Ralph Loop 检测到 promise 后结束循环。

---

## 1. Pre-PR Ralph Loop (p0 阶段)

### 启动命令

```bash
/ralph-loop "实现 <功能描述>，完成质检并创建 PR 后输出 <promise>QUALITY_GATE_PASSED</promise>" \
    --completion-promise "QUALITY_GATE_PASSED"
    # 不设置 --max-iterations = 无限循环
```

### 质检层级 (p0 阶段)

p0 阶段需要完成的质检：
- **L1**: 自动化测试 (`npm run qa:gate`)
- **L2A**: 代码审计 (`AUDIT-REPORT.md`)
- **L2B-min**: 可复核证据 (`.layer2-evidence.md`，至少 1 条证据)

### AI 检查条件

在每次迭代结束时，AI 检查以下条件，**全部满足才输出 `<promise>QUALITY_GATE_PASSED</promise>`**：

#### 检查点 1: Audit 报告
- 文件存在: `docs/AUDIT-REPORT.md`
- Decision: PASS
- 如果不满足: 调用 `/audit` 生成/更新报告，修复 L1/L2 问题直到 PASS

#### 检查点 2: 自动化测试
- 文件存在: `.quality-gate-passed`
- 内容: typecheck + test + build 全部通过
- 如果不满足: 运行 `npm run qa:gate`，修复失败的测试

#### 检查点 3: 质检时效性
- 质检文件时间 >= 最新代码修改时间
- 如果不满足: 重新运行 `npm run qa:gate`

---

#### Step 8: PR 未创建
```bash
PR_NUMBER=$(gh pr list --head "$CURRENT_BRANCH" --state open --json number -q '.[0].number')
if [[ -z "$PR_NUMBER" ]]; then
    exit 2
fi
```
**拦截原因**: 质检通过但 PR 尚未创建

**下一步行动**: 创建 PR (通过 `gh pr create` 或 `/dev` Step 8)

---

### 放行条件 (exit 0 = 允许结束)

```bash
# 所有条件满足:
✅ docs/AUDIT-REPORT.md 存在
✅ Decision: PASS
✅ .quality-gate-passed 存在且为最新
✅ PR 已创建
✅ 当前阶段: p0

→ exit 0 (允许会话结束)
```

**AI 行为**: 不输出 `<promise>QUALITY_GATE_PASSED</promise>`,直接结束会话

**原因**: p0 阶段的目标是"创建 PR",不需要等待 CI 结果。Promise 标记在 p0 不使用。

---

## 2. After-PR Ralph Loop (p1 阶段)

### 启动命令

```bash
/ralph-loop "修复 PR #<number> 的 CI 失败，CI 通过并合并后输出 <promise>CI_PASSED</promise>" \
    --completion-promise "CI_PASSED"
    # 不设置 --max-iterations = 无限循环
```

### 质检层级 (p1 阶段)

p1 阶段需要完成的质检 (与 p0 相同):
- **L1**: 自动化测试 (`npm run qa:gate`)
- **L2A**: 代码审计 (`AUDIT-REPORT.md`)
- **L2B-min**: 可复核证据 (`.layer2-evidence.md`，至少 1 条证据)

**原因**: CI 失败后修改代码,需要重新质检确保修复没有引入新问题。

### AI 检查条件

在每次迭代结束时，AI 检查以下条件，**全部满足才输出 `<promise>CI_PASSED</promise>`**：

#### 检查点 1: 质检通过

p1 阶段仍需检查所有质检条件 (与 p0 相同):
- Audit 报告存在且 Decision: PASS
- .quality-gate-passed 存在且时效性有效
- 如果不满足: 重新运行质检

**原因**: CI 失败后修改代码，需要重新质检确保修复没有引入新问题

#### 检查点 2: PR 存在

- PR 已创建并处于 open 状态
- 如果不满足: 无法继续 p1 流程

#### 检查点 3: CI 状态

**CI 失败**:
- 获取失败日志: `gh run view <id> --log-failed`
- 分析失败原因并修复代码
- 提交并 push
- **不输出 promise**，继续下一次迭代检查

**CI Pending/Queued/In Progress**:
- 等待 CI 运行完成
- **不输出 promise**，Ralph Loop 自动重试
- 形成轮询循环: 检查 → 等待 → 重新检查

**CI Success**:
- 合并 PR: `gh pr merge --squash --delete-branch`
- 输出 `<promise>CI_PASSED</promise>`
- Ralph Loop 检测到 promise → 结束循环 ✅

---

## 对比总结

| 特性 | Pre-PR Loop (p0) | After-PR Loop (p1) |
|------|------------------|-------------------|
| **目标** | 完成质检 → 创建 PR | 修复 CI → 合并 PR |
| **质检层级** | L1 + L2A + L2B-min | L1 + L2A + L2B-min |
| **Promise 标记** | 不使用 (p0 直接退出) | `<promise>CI_PASSED</promise>` |
| **质检检查** | ✅ Step 7 全部检查 | ✅ Step 7 全部检查 |
| **PR 检查** | 未创建 → exit 2 | 必须存在 |
| **CI 检查** | ❌ 不检查 CI | ✅ failure → exit 2 |
| **结束条件** | PR 创建完成 | CI pass + PR 合并 |
| **max_iterations** | 不设置 (无限循环) | 不设置 (无限循环) |

---

## Stop Hook 与 Ralph Loop 配合流程

### P0 循环示例

```
[第 1 次迭代]
AI: 写代码 → 尝试结束
Stop Hook: Audit 报告缺失 → exit 2
Ralph Loop: 自动重新注入任务
    ↓
[第 2 次迭代]
AI: 运行 /audit → 生成报告 → 尝试结束
Stop Hook: Decision: FAIL (有 L2 问题) → exit 2
Ralph Loop: 自动重新注入任务
    ↓
[第 3 次迭代]
AI: 修复 L2 问题 → 重新 /audit (PASS) → 尝试结束
Stop Hook: .quality-gate-passed 缺失 → exit 2
Ralph Loop: 自动重新注入任务
    ↓
[第 4 次迭代]
AI: npm run qa:gate → 生成 .quality-gate-passed → 尝试结束
Stop Hook: PR 未创建 → exit 2
Ralph Loop: 自动重新注入任务
    ↓
[第 5 次迭代]
AI: gh pr create → PR #123 → 尝试结束
Stop Hook: 全部通过 + 阶段=p0 → exit 0
会话结束 ✅ (不输出 Promise)
```

---

### P1 循环示例

```
[第 1 次迭代]
AI: 检查 CI → FAILURE → 查看日志 → 分析原因 → 修复代码 → push
AI: 检查所有条件 → 质检过期（代码改动） → 不输出 promise
Ralph Loop: 未检测到 promise → 自动重新注入任务
    ↓
[第 2 次迭代]
AI: npm run qa:gate → 通过 → 检查 CI → PENDING
AI: 检查所有条件 → CI 未完成 → 不输出 promise
Ralph Loop: 未检测到 promise → 自动重新注入任务
    ↓
[第 3 次迭代]
AI: 检查 CI → PENDING → 等待
AI: 检查所有条件 → CI 未完成 → 不输出 promise
Ralph Loop: 未检测到 promise → 继续循环 (轮询效果)
    ↓
[第 4 次迭代]
AI: 检查 CI → SUCCESS → gh pr merge → 所有条件满足 → 输出 <promise>CI_PASSED</promise>
Ralph Loop: 检测到 completion-promise → 结束循环 ✅
```

---

## 关键设计点

### 1. 无限循环设计 (max_iterations 不设置)

```bash
# 正确用法
/ralph-loop "任务描述" --completion-promise "SIGNAL"

# 错误用法
/ralph-loop "任务描述" --completion-promise "SIGNAL" --max-iterations 20
```

**原因**:
- 质检修复次数不可预测 (可能需要多次迭代)
- CI 失败原因复杂 (可能需要多次修复)
- 设置上限可能导致任务中途中断

**安全性**:
- AI 根据实际检查条件决定是否输出 Promise
- Ralph Loop 检测不到 promise 会自动重试
- 不会出现真正的无限循环

---

### 2. P0 阶段的 Promise 使用

p0 阶段可以选择是否使用 Promise 标记：

**使用 Promise**：
```bash
/ralph-loop "实现功能X，完成质检并创建 PR 后输出 <promise>DONE</promise>" \
    --completion-promise "DONE"
```
- AI 检查所有条件满足后输出 `<promise>DONE</promise>`
- Ralph Loop 检测到 promise → 结束循环

**不使用 Promise**（简化版）：
```bash
/ralph-loop "实现功能X，完成质检并创建 PR"
```
- AI 完成所有任务后自然结束
- 依靠 prompt 中的任务描述判断完成

---

### 3. P1 阶段必须使用 Promise 标记

p1 阶段需要 Promise 标记来区分"等待 CI"和"真正完成":

```
CI Pending:
    AI: 检查 CI → pending → 不输出 Promise
    Ralph Loop: 未检测到 promise → 继续循环 (实现轮询)

CI Success:
    AI: 检查 CI → success → 合并 PR → 输出 <promise>CI_PASSED</promise>
    Ralph Loop: 检测到 promise → 结束循环
```

**原因**:
- CI 运行需要时间，需要轮询等待
- Promise 标记明确告知 Ralph Loop: PR 已合并，任务真正完成
- 实现了"等待 CI → 修复失败 → 轮询直到成功"的完整流程

---

## 相关文件

| 文件 | 作用 |
|------|------|
| Ralph Loop Plugin | `~/.claude/plugins/.../ralph-wiggum/` - 循环框架 |
| `scripts/detect-phase.sh` | 阶段检测 (p0/p1/p2/pending/unknown) |
| `skills/dev/SKILL.md` | /dev Skill 入口，流程定义 |
| `skills/dev/steps/07-quality.md` | Step 7 质检流程 |
| `skills/dev/steps/08-pr.md` | Step 8 创建 PR |
| `skills/dev/steps/09-ci.md` | Step 9 CI 循环 |

---

## 使用建议

### 开发新功能 (p0)

```bash
/ralph-loop "实现用户登录功能，完成质检并创建 PR" \
    --completion-promise "QUALITY_GATE_PASSED"
```

**预期行为**:
- 自动循环直到质检全部通过
- 自动创建 PR
- PR 创建后立即结束,不等 CI

---

### 修复 CI (p1)

```bash
/ralph-loop "修复 PR #123 的 CI 失败，CI 通过并合并" \
    --completion-promise "CI_PASSED"
```

**预期行为**:
- 自动检查 CI 状态
- CI 失败 → 修复 → push → 重新检查 (循环)
- CI pending → 等待 → 重新检查 (轮询)
- CI success → 合并 PR → 输出 Promise → 结束

---

## 故障排查

### 问题 1: Ralph Loop 未启动

**症状**: AI 手动执行任务,没有自动循环

**原因**: 未调用 Ralph Loop 命令

**解决**: 确保在任务开始时调用:
```bash
/ralph-loop "任务描述" --completion-promise "SIGNAL"
```

---

### 问题 2: 循环中途退出

**症状**: 质检未完成就退出了

**原因**: AI 提前输出了 promise

**排查**:
1. 检查 AI 是否在所有条件满足前就输出了 promise
2. 确认阶段检测结果 (`bash scripts/detect-phase.sh`)
3. 检查所有质检文件是否存在且有效

---

### 问题 3: 无限循环不停止

**症状**: 任务明明完成了但循环不结束

**原因**: AI 未输出 Promise 标记

**解决**: 检查 prompt 是否明确要求输出 promise：
```bash
/ralph-loop "任务描述，完成后输出 <promise>DONE</promise>" \
    --completion-promise "DONE"
```

确保 AI 在任务完成时输出：
```
<promise>DONE</promise>
```

---

## 总结

**两个 Ralph Loop 的本质区别**:

| 特性 | Pre-PR (p0) | After-PR (p1) |
|------|-------------|---------------|
| **循环目标** | 质检通过 → PR 创建 | CI 修复 → PR 合并 |
| **检查条件** | L1 + L2A + L2B + PR 创建 | L1 + L2A + L2B + CI 通过 + PR 合并 |
| **Promise 使用** | 可选 | 必须 |
| **轮询机制** | ❌ 不需要 | ✅ CI pending 时轮询 |
| **结束方式** | 所有条件满足 (+ promise 输出) | Promise 输出 |

**核心理念**:
- Ralph Loop 插件提供循环框架
- AI 检查完成条件并决定是否输出 promise
- Promise 标记提供明确的完成信号
- 自动循环直到任务真正完成
