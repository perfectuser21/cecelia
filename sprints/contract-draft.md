# 合同草案（第 1 轮）

**Generator**: sprint-contract-proposer
**本次 Sprint 目标**: 修复 Harness v3.1 四个断链/不稳定点，让流水线端到端可跑通

---

## 本次实现的功能

- **Feature 1**: 部署 `sprint-report` skill 到 headless 账号，并将其加入 `deploy-workflow-skills.sh` 自动部署清单
- **Feature 2**: 在 `execution.js` 的 GAN 对抗层加入 `MAX_CONTRACT_ROUNDS = 3` 保护，超限时创建 P0 告警并终止循环
- **Feature 3**: Proposer 写完 `contract-draft.md` 后立即 `git add && git commit && git push`，确保跨 worktree 可见
- **Feature 4**: 补充 `harness-sprint-loop-v3.test.js`，覆盖 GAN 层和 sprint_report 断链

---

## 验收标准（DoD）

### Feature 1: Sprint Report Skill 部署

- [x] `sprint-report` skill 已部署到 `~/.claude-account1/skills/sprint-report/SKILL.md`
- [x] `deploy-workflow-skills.sh` 包含 `sprint-report` 在部署清单中
- [x] `skills-index.md` 包含 `sprint_report` 任务类型路由条目

**验证命令**:
```bash
node -e "require('fs').accessSync(require('os').homedir()+'/.claude-account1/skills/sprint-report/SKILL.md');console.log('PASS')"
```

```bash
node -e "const c=require('fs').readFileSync('packages/workflows/scripts/deploy-workflow-skills.sh','utf8');if(!c.includes('sprint-report'))process.exit(1);console.log('PASS')"
```

```bash
node -e "const c=require('fs').readFileSync('.agent-knowledge/skills-index.md','utf8');if(!c.includes('sprint_report'))process.exit(1);console.log('PASS')"
```

---

### Feature 2: Contract GAN 防死循环

- [x] `execution.js` 中 `MAX_CONTRACT_ROUNDS = 3` 常量存在
- [x] `sprint_contract_review REVISION` 路径：当 `nextRound > MAX_CONTRACT_ROUNDS` 时，创建 P0 告警 cecelia_event，不再创建新的 `sprint_contract_propose`
- [x] 正常情况（`nextRound <= MAX_CONTRACT_ROUNDS`）行为不变

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('MAX_CONTRACT_ROUNDS'))process.exit(1);console.log('PASS')"
```

```bash
npx vitest run packages/brain/src/__tests__/harness-sprint-loop-v3.test.js --reporter=verbose 2>&1 | tail -5
```

---

### Feature 3: Contract Draft 跨 worktree 持久化

- [x] `sprint-contract-proposer` SKILL.md 中 Phase 3 步骤包含 `git add && git commit && git push` 指令
- [x] `sprint-contract-reviewer` SKILL.md 中 Phase 1 读取 PRD 前先执行 `git pull` 确保获取最新 draft

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-proposer/SKILL.md','utf8');if(!c.includes('git push'))process.exit(1);console.log('PASS')"
```

```bash
node -e "const c=require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md','utf8');if(!c.includes('git pull'))process.exit(1);console.log('PASS')"
```

---

### Feature 4: v3.1 测试覆盖

- [x] 新增 `packages/brain/src/__tests__/harness-sprint-loop-v3.test.js`
- [x] 测试覆盖 4 个断链场景：
  - `sprint_planner → sprint_contract_propose`（Layer 1）
  - `sprint_contract_propose → sprint_contract_review`（Layer 2a）
  - `sprint_contract_review APPROVED → sprint_generate`（Layer 2b 正向）
  - `sprint_contract_review REVISION → sprint_contract_propose R2`（Layer 2b 反向）
  - `sprint_contract_review REVISION × 3 → P0告警 + 终止`（防死循环）
  - `sprint_evaluate PASS → sprint_report`（Layer 3 → 4）
- [x] 所有测试通过

**验证命令**:
```bash
node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-sprint-loop-v3.test.js');console.log('PASS')"
```

```bash
npx vitest run packages/brain/src/__tests__/harness-sprint-loop-v3.test.js 2>&1 | grep -E "PASS|FAIL|Tests"
```

---

## 技术实现方向（高层）

### Feature 1
- `packages/workflows/scripts/deploy-workflow-skills.sh` 加一行 `sprint-report`
- 运行 `bash packages/workflows/scripts/deploy-workflow-skills.sh` 部署
- `.agent-knowledge/skills-index.md` 任务路由表加 `sprint_report → /sprint-report`

### Feature 2
- `packages/brain/src/routes/execution.js` 约 line 1627 处，在 REVISION 分支加：
  ```js
  const MAX_CONTRACT_ROUNDS = 3;
  const nextRound = (harnessPayload.propose_round || 1) + 1;
  if (nextRound > MAX_CONTRACT_ROUNDS) {
    // 创建 P0 cecelia_event 告警，不再循环
    await createTask({ task_type: 'cecelia_event', priority: 'P0', ... });
    return;
  }
  ```
- 注意：`nextRound` 变量已在当前代码中定义，只需在创建 propose 任务前加 guard

### Feature 3
- `sprint-contract-proposer/SKILL.md` Phase 3 增加：写完 draft 后执行 git commit + push（sprint_dir 下的文件）
- `sprint-contract-reviewer/SKILL.md` Phase 1 增加：读文件前先 `git pull origin HEAD` 获取最新

### Feature 4
- 新建 `harness-sprint-loop-v3.test.js`，模式参考现有 `harness-sprint-loop.test.js`
- 用 `simulateHarnessCallback()` 模拟各 task_type 的 execution callback
- 验证 createTask 的调用参数是否正确

---

## 不在本次范围内

- 修改 `sprint-report` skill 的内容（内容已存在，只需部署）
- 修改 `sprint-evaluator`、`sprint-generator` 的行为
- 修改 Brain 的 tick/thalamus/scheduler 层
- `sprint_generate → sprint_fix → sprint_evaluate` 循环已有 `MAX_EVAL_ROUNDS`，不动
- `arch_review` 相关逻辑，不动
