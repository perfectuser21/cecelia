# 合同草案（第 1 轮）

## 本次实现的功能

- Feature 1: sprint_report 路由部署 — 将 /sprint-report skill 部署到 headless account 目录，skills-index.md 加入路由映射
- Feature 2: Contract GAN 无上限对抗 — 移除任何 MAX_CONTRACT_ROUNDS 截断，REVISION 永远继续直到 APPROVED
- Feature 3: Contract Draft 持久化 — Proposer 写完 contract-draft.md 后立即 git push，Reviewer 在 Phase 1 执行 git fetch + git show 跨 worktree 读取
- Feature 4: Harness v3.1 测试覆盖 — 新增 harness-sprint-loop-v3.test.js，覆盖 10 个 Planner→Contract→Generator→Evaluator→Report 链路节点

## 验收标准（DoD）

### Feature 1: sprint_report 路由部署

**行为描述**：sprint_report task_type 能被 task-router 正确路由到 /sprint-report skill；skill 文件存在于 headless account 目录；skills-index.md 有对应条目。

**硬阈值**：
- deploy-workflow-skills.sh 执行后 ~/.claude-account1/skills/sprint-report/SKILL.md 存在
- skills-index.md 包含 sprint_report 和 sprint-report 两个关键词

**验证命令**：

```bash
# Happy path: skill 文件已部署
node -e "require('fs').accessSync(require('os').homedir()+'/.claude-account1/skills/sprint-report/SKILL.md');console.log('PASS: sprint-report skill 已部署')"

# skills-index.md 路由映射存在
node -e "
const c = require('fs').readFileSync('.agent-knowledge/skills-index.md','utf8');
if (!c.includes('sprint_report') || !c.includes('sprint-report')) {
  console.error('FAIL: skills-index.md 缺少 sprint_report 路由映射');
  process.exit(1);
}
console.log('PASS: skills-index.md 包含 sprint_report → /sprint-report 映射');
"

# 边界: deploy-workflow-skills.sh 包含 sprint-report 部署逻辑
node -e "
const c = require('fs').readFileSync('packages/workflows/scripts/deploy-workflow-skills.sh','utf8');
if (!c.includes('sprint-report')) {
  console.error('FAIL: deploy-workflow-skills.sh 未包含 sprint-report 部署');
  process.exit(1);
}
console.log('PASS: deploy-workflow-skills.sh 包含 sprint-report 部署逻辑');
"
```

---

### Feature 2: Contract GAN 无上限对抗

**行为描述**：execution.js 在处理 sprint_contract_review 回调时，若 verdict=REVISION 则无条件创建下一轮 propose 任务，不检查轮次上限。

**硬阈值**：
- execution.js 中不存在 MAX_CONTRACT_ROUNDS 常量或相关截断逻辑
- REVISION 分支永远创建新的 sprint_contract_propose 任务

**验证命令**：

```bash
# Happy path: 无 MAX_CONTRACT_ROUNDS 截断
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
if (c.includes('MAX_CONTRACT_ROUNDS')) {
  console.error('FAIL: execution.js 仍有 MAX_CONTRACT_ROUNDS 截断逻辑');
  process.exit(1);
}
console.log('PASS: execution.js 无 MAX_CONTRACT_ROUNDS 截断');
"

# REVISION 分支会创建新 propose 任务（检查关键代码路径）
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
// REVISION 分支必须创建 sprint_contract_propose 任务
const revBlock = c.match(/REVISION[\s\S]{0,500}sprint_contract_propose/);
if (!revBlock) {
  console.error('FAIL: REVISION 分支未创建 sprint_contract_propose');
  process.exit(1);
}
console.log('PASS: REVISION 分支会创建新 sprint_contract_propose 任务');
"

# 边界: APPROVED 分支进入 Generator（不再 propose）
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
const approvedBlock = c.match(/APPROVED[\s\S]{0,500}sprint_generate/);
if (!approvedBlock) {
  console.error('FAIL: APPROVED 分支未进入 sprint_generate');
  process.exit(1);
}
console.log('PASS: APPROVED 分支正确进入 sprint_generate');
"
```

---

### Feature 3: Contract Draft 持久化（跨 worktree）

**行为描述**：Proposer 写完 contract-draft.md 后立即 git push；Reviewer 在 Phase 1 执行 git fetch origin + git show 读取最新草案，不依赖本地文件系统。

**硬阈值**：
- sprint-contract-proposer/SKILL.md Phase 3 包含 git push 命令
- sprint-contract-reviewer/SKILL.md Phase 1 包含 git fetch 和 git show 命令

**验证命令**：

```bash
# Proposer SKILL.md 包含 git push
node -e "
const c = require('fs').readFileSync('packages/workflows/skills/sprint-contract-proposer/SKILL.md','utf8');
if (!c.includes('git push')) {
  console.error('FAIL: sprint-contract-proposer/SKILL.md 缺少 git push');
  process.exit(1);
}
console.log('PASS: Proposer SKILL.md 包含 git push 持久化步骤');
"

# Reviewer SKILL.md 包含 git fetch 和 git show
node -e "
const c = require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md','utf8');
if (!c.includes('git fetch') || !c.includes('git show')) {
  console.error('FAIL: sprint-contract-reviewer/SKILL.md 缺少 git fetch/git show');
  process.exit(1);
}
console.log('PASS: Reviewer SKILL.md 包含 git fetch + git show 跨 worktree 读取');
"

# 边界: 两个 SKILL.md 都已部署到 headless account 目录
node -e "
const fs = require('fs'), home = require('os').homedir();
['sprint-contract-proposer','sprint-contract-reviewer'].forEach(skill => {
  fs.accessSync(home + '/.claude-account1/skills/' + skill + '/SKILL.md');
  console.log('PASS: ' + skill + ' skill 已部署');
});
"
```

---

### Feature 4: Harness v3.1 测试覆盖

**行为描述**：harness-sprint-loop-v3.test.js 覆盖 10 个链路节点：Planner 输出、Contract Propose、Contract Review REVISION/APPROVED、Generator、CI Watch、Evaluator PASS/FAIL、sprint_fix、sprint_report。

**硬阈值**：
- 测试文件存在且行数 ≥ 200
- 覆盖 sprint_report 节点（v2.0 测试缺失项）

**验证命令**：

```bash
# 测试文件存在
node -e "require('fs').accessSync('packages/brain/tests/harness-sprint-loop-v3.test.js');console.log('PASS: harness-sprint-loop-v3.test.js 存在')"

# 覆盖 sprint_report 节点
node -e "
const c = require('fs').readFileSync('packages/brain/tests/harness-sprint-loop-v3.test.js','utf8');
if (!c.includes('sprint_report')) {
  console.error('FAIL: 测试未覆盖 sprint_report 节点');
  process.exit(1);
}
console.log('PASS: 测试覆盖 sprint_report 节点');
"

# 行数 >= 200（充分覆盖）
node -e "
const lines = require('fs').readFileSync('packages/brain/tests/harness-sprint-loop-v3.test.js','utf8').split('\n').length;
if (lines < 200) {
  console.error('FAIL: 测试文件仅 ' + lines + ' 行，不足 200 行');
  process.exit(1);
}
console.log('PASS: 测试文件 ' + lines + ' 行，覆盖充分');
"

# 覆盖 GAN 对抗节点（REVISION → 继续对抗）
node -e "
const c = require('fs').readFileSync('packages/brain/tests/harness-sprint-loop-v3.test.js','utf8');
if (!c.includes('REVISION') || !c.includes('APPROVED')) {
  console.error('FAIL: 测试未覆盖 Contract GAN REVISION/APPROVED 节点');
  process.exit(1);
}
console.log('PASS: 测试覆盖 GAN 对抗 REVISION/APPROVED 节点');
"
```

---

## 技术实现方向（高层）

- **deploy-workflow-skills.sh**：加入 sprint-report skill 同步逻辑
- **execution.js**：删除任何 MAX_CONTRACT_ROUNDS 常量；REVISION 分支纯粹递增 propose_round 并创建新任务
- **sprint-contract-proposer/SKILL.md + sprint-contract-reviewer/SKILL.md**：Phase 3/Phase 1 加 git push/fetch/show 命令
- **harness-sprint-loop-v3.test.js**：新增测试文件，覆盖完整 v3.1 链路

## 不在本次范围内

- sprint_fix 多轮修复流程的完整验证（Sprint 3+）
- CI Watch 与 PR merge 的真实集成测试
- executor.js account 绑定逻辑（单独 PR 处理）
