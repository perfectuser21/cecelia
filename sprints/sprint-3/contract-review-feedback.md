# Sprint 3 合同审查反馈（第 2 轮）

**审查者**: Evaluator（对抗性审查）
**审查时间**: 2026-04-06
**propose_task_id**: 7dc1a2fa-5e79-4f4b-8b36-55a7f8c8f635
**verdict**: REVISION

---

## ❌ 致命问题：合同草案文件连续两轮未提交

### 问题描述

这是第 **2 轮** 审查，同样发现：**`sprints/sprint-3/contract-draft.md` 不存在于任何可访问位置**。

已检查：
- 当前 reviewer worktree（`f3d0a5bb-edfc-4bc1-979e-ffdc05`）
- Proposer R2 分支（`cp-04060343-7dc1a2fa-5e79-4f4b-8b36-55a7f8c8f635`），该分支与 `main` 指向同一 commit（`8bf83b512`）
- 所有其他活跃 worktree
- 主仓库 `main` 分支

**结论：Proposer R2（7dc1a2fa）在任务 `completed` 时，未向 git 提交任何文件。**

---

## 必须修改的问题

### 1. [P0] Proposer MUST commit before marking completed

**问题**：`sprint-contract-proposer/SKILL.md` Phase 4 写的是"写入完成后返回"，没有要求 git commit/push。导致 Proposer 进程结束后文件消失。

**要求（Proposer R3 必须执行）**：

```bash
# Phase 4 完成时必须执行：
mkdir -p sprints/sprint-3
git add sprints/sprint-3/contract-draft.md
git commit -m "feat(harness): Sprint 3 合同草案 R3"
git push origin <当前分支>
```

**验证方式**：Reviewer 执行以下命令能成功返回文件内容：
```bash
git fetch origin
git show origin/<proposer-branch>:sprints/sprint-3/contract-draft.md
```

**若上述命令失败，则 Proposer 视为未完成，verdict 自动为 REVISION。**

---

### 2. [P0] Proposer SKILL.md 缺少 git commit 强制步骤

**要求**：修改 `packages/workflows/skills/sprint-contract-proposer/SKILL.md`，在 Phase 4 明确加入：

```markdown
### Phase 4: 提交并推送（CRITICAL — 不执行此步则任务视为失败）

完成草案后必须立即提交到 git：

\`\`\`bash
git add ${sprint_dir}/contract-draft.md
git commit -m "feat(harness): Sprint ${sprint_num} 合同草案 R${propose_round}"
git push origin $(git branch --show-current)
\`\`\`

**完成标志**：git push 成功后，才可返回 verdict。
```

---

### 3. [P1] Sprint 3 合同必须覆盖的范围（本次无法审查，但列出要求）

根据 Planner 任务（1f06aaf0）和系统目标，Sprint 3 合同草案必须覆盖以下功能点：

**功能 A：Proposer SKILL.md 强制 git commit**
- 验收条件：`sprint-contract-proposer/SKILL.md` 包含明确的 `git add/commit/push` 步骤
- 验证方式：`node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-proposer/SKILL.md','utf8'); if(!c.includes('git commit'))process.exit(1); console.log('PASS')"`

**功能 B：Brain 在创建 review 任务前验证 contract-draft.md 存在**
- 验收条件：Brain `execution_callback_harness`（或相关代码）在 Proposer completed 后，检查 `sprints/sprint-N/contract-draft.md` 是否可 git-accessible
- 失败处理：若文件不存在，将 Proposer 任务降级为 `failed` 并重试，而非创建 review 任务
- 验证方式：通过代码内容验证（node 读取 execution.js 检查存在性逻辑）

**功能 C：Evaluator 对抗强度强化**
- 验收条件：`sprint-contract-reviewer/SKILL.md` 包含更严格的审查 Checklist（具体内容由 Proposer 提出）
- 验证方式：SKILL.md 文件内容检查

**功能 D：verdict 解析健壮性**
- 验收条件：Brain execution.js 中 sprint_contract_review 的 verdict 解析能处理：`{"verdict":"APPROVED"}`、`{"verdict":"REVISION","issues_count":3}` 两种格式
- 验证方式：node 读取 execution.js 检查解析逻辑

---

## 可选改进

- Reviewer worktree 初始化时自动 fetch Proposer 分支
- Proposer verdict payload 包含 `contract_draft_sha`，Brain 可验证文件确实已提交
- Brain 任务链增加 pre-condition 检查（类似 DoD `[ARTIFACT]` 验证机制）

---

## 审查结论

**verdict: REVISION**

**连续两轮 Proposer 未提交合同草案，循环无法推进。**

Proposer R3 必须：
1. 重新生成 `sprints/sprint-3/contract-draft.md`（覆盖上述功能 A/B/C/D）
2. 执行 `git commit` + `git push`
3. 确保 `git show origin/<proposer-branch>:sprints/sprint-3/contract-draft.md` 可访问
4. 同时修复 `sprint-contract-proposer/SKILL.md`，加入强制 git commit 步骤（功能 A）
