# Sprint 1 合同草案（第 3 轮）

**提案方**: Generator（sprint-contract-proposer）
**Sprint**: 1
**轮次**: R3（在 R1/R2 无反馈文件情况下基于系统现状重新起草）

---

## 本 Sprint 实现的功能

### Feature 1: 部署 sprint-contract-proposer / sprint-contract-reviewer 到 headless account

**现状**: `packages/workflows/skills/sprint-contract-proposer` 和 `sprint-contract-reviewer` 已存在，但未通过 `deploy-workflow-skills.sh` 软链接到 `~/.claude-account1/skills/`（account3 同样缺失）。Brain 派发 `sprint_contract_propose` / `sprint_contract_review` 时，headless session 找不到对应 SKILL.md，任务完成但产出为空（result={}，无文件写入）。

**实现**: 运行 `deploy-workflow-skills.sh --account 1` 和 `--account 3`，确保软链接到位。

### Feature 2: 修复合同协商文件写入（contract-draft.md + contract-review-feedback.md 必须 git commit + push）

**现状**: R1/R2 的 proposer 均未写入 `sprints/sprint-1/contract-draft.md`。Reviewer 未写入 `contract-review-feedback.md`。文件存在于 worktree 本地但未提交，导致下一轮 proposer 切入新 worktree 时读不到反馈。

**实现**: 
- sprint-contract-proposer SKILL.md 增加强制步骤：写完 `contract-draft.md` 后必须 `git add + commit + push`
- sprint-contract-reviewer SKILL.md 增加强制步骤：写完 `contract-review-feedback.md` 或 `sprint-contract.md` 后必须 `git add + commit + push`

### Feature 3: 修复 Brain 任务 result 存储（verdict 必须写入 result 字段）

**现状**: 所有 `sprint_contract_propose` 和 `sprint_contract_review` 任务完成后 result={}。Brain execution.js 在 review 完成时从 result 中提取 verdict，result 为空时默认 `REVISION`，导致合同永远无法被 APPROVE，循环不终止。

**实现**:
- sprint-contract-proposer 完成时调用 `PATCH /api/brain/tasks/{id}` 存储 `{"verdict": "PROPOSED", "contract_draft_path": "..."}`
- sprint-contract-reviewer 完成时调用 `PATCH /api/brain/tasks/{id}` 存储 `{"verdict": "APPROVED"|"REVISION", ...}`

### Feature 4: 合同协商最大轮次保护（防止无限循环）

**现状**: Brain execution.js 在 REVISION 时无限创建新的 `sprint_contract_propose` 任务，无上限。当 R1/R2 result={} 时 Brain 误判为 REVISION，已产生 3 轮无效循环。

**实现**: execution.js 中增加 `propose_round > MAX_PROPOSE_ROUNDS (=3)` 时跳出循环，改为创建 P0 告警任务（cecelia_event）。

---

## 验收标准（DoD）

### Feature 1: Skill 部署

- [ ] sprint-contract-proposer 已软链接到 `~/.claude-account1/skills/sprint-contract-proposer`
  验证方式: `node -e "require('fs').accessSync(require('os').homedir()+'/.claude-account1/skills/sprint-contract-proposer/SKILL.md'); console.log('PASS')"`

- [ ] sprint-contract-reviewer 已软链接到 `~/.claude-account1/skills/sprint-contract-reviewer`
  验证方式: `node -e "require('fs').accessSync(require('os').homedir()+'/.claude-account1/skills/sprint-contract-reviewer/SKILL.md'); console.log('PASS')"`

- [ ] deploy-workflow-skills.sh 在运行后同时部署两个新 skill（幂等）
  验证方式: 运行 `bash packages/workflows/scripts/deploy-workflow-skills.sh --dry-run` 输出包含 `sprint-contract-proposer` 和 `sprint-contract-reviewer`

### Feature 2: 文件提交规则

- [ ] sprint-contract-proposer SKILL.md 包含 `git add + commit + push` 强制步骤（CRITICAL 标签）
  验证方式: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-proposer/SKILL.md','utf8'); if(!c.includes('git commit') || !c.includes('CRITICAL')) process.exit(1); console.log('PASS')"`

- [ ] sprint-contract-reviewer SKILL.md 包含 `git add + commit + push` 强制步骤（CRITICAL 标签）
  验证方式: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md','utf8'); if(!c.includes('git commit') || !c.includes('CRITICAL')) process.exit(1); console.log('PASS')"`

### Feature 3: Brain result 存储

- [ ] sprint-contract-proposer SKILL.md 包含 `PATCH /api/brain/tasks` 回调并存储 verdict=PROPOSED
  验证方式: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-proposer/SKILL.md','utf8'); if(!c.includes('verdict') || !c.includes('PROPOSED')) process.exit(1); console.log('PASS')"`

- [ ] sprint-contract-reviewer SKILL.md 包含 `PATCH /api/brain/tasks` 回调并存储 verdict=APPROVED 或 REVISION
  验证方式: `node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md','utf8'); if(!c.includes('APPROVED') || !c.includes('REVISION')) process.exit(1); console.log('PASS')"`

### Feature 4: 最大轮次保护

- [ ] execution.js 中 sprint_contract_propose 处理块含最大轮次检查（propose_round > MAX）
  验证方式: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8'); if(!c.includes('MAX_PROPOSE_ROUNDS') && !c.includes('propose_round') ) process.exit(1); const hasMax = c.includes('MAX_PROPOSE_ROUNDS') || /propose_round.*[>=].*[3-9]/.test(c); if(!hasMax) process.exit(1); console.log('PASS')"`

---

## 技术实现方向

- `packages/workflows/scripts/deploy-workflow-skills.sh`：确认已覆盖所有 skills 子目录，无需修改
- `packages/workflows/skills/sprint-contract-proposer/SKILL.md`：增加 Step 3.5（git commit+push）和 Step 4（Brain PATCH回调）
- `packages/workflows/skills/sprint-contract-reviewer/SKILL.md`：增加 Step 4.5（git commit+push）和 Step 5（Brain PATCH回调，含 verdict）
- `packages/brain/src/routes/execution.js`：在 Layer 2a 处理块增加 `propose_round` 上限检查（3轮）

---

## 不在本 Sprint 范围内

- sprint-planner 修复（sprint-prd.md 未写入问题）— Sprint 2 处理
- Evaluator 对抗强度改进 — Sprint 3 处理
- 完整端到端循环验证 — Sprint 3 处理

---

## 是否为最后一个 Sprint

is_final: false
