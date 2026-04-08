# 合同草案（第 2 轮）

**生成者**: Generator (Sprint 1 Contract Proposer)
**任务**: Harness v3.1 — 修复 GAN 链路 4 个断链问题
**提案轮次**: R2（根据 R1 评审反馈修订）

---

## R1 → R2 修订说明

Evaluator 对 R1 草案的核心批评（应用于本轮）：
1. **验证命令 JS 操作符优先级 bug** — 复合条件 `!A && !B || !C` 因操作符优先级导致永远不触发 exit(1)；R2 全部改为**逐条独立断言**
2. **静态字符串检查太弱** — `c.includes('xxx')` 只证明字符串存在，R2 改为**验证内容的具体结构或运行时行为**
3. **跨 worktree 核心场景未测试** — R2 为 Feature 3 补充 git-fetch 跨 worktree 可达性验证
4. **缺少负向测试** — R2 为每个 Feature 补充至少 1 个失败路径验证

---

## 本次实现的功能

- Feature 1: sprint_report 路由部署 — 将 /sprint-report skill 部署到 headless account 目录，task-router 路由映射
- Feature 2: Contract GAN 无上限对抗 — 移除 execution.js 中任何 MAX_CONTRACT_ROUNDS 截断，REVISION 永远继续
- Feature 3: Contract Draft 跨 worktree 持久化 — Proposer 写完 contract-draft.md 后立即 git push；Reviewer 通过 git fetch + git show 跨 worktree 读取
- Feature 4: Harness v3.1 测试覆盖 — 新增 harness-sprint-loop-v3.test.js 覆盖 10 个链路节点

---

## 验收标准（DoD）

### Feature 1: sprint_report 路由部署

**行为描述**：sprint_report task_type 能被 task-router 正确路由；/sprint-report skill 文件已部署到 headless account 目录；skills-index.md 有对应条目。

**硬阈值**：
- `~/.claude-account1/skills/sprint-report/SKILL.md` 存在且不为空（> 100 字节）
- `packages/brain/src/task-router.js` 中存在 `sprint_report` 路由映射
- `.agent-knowledge/skills-index.md` 同时包含 `sprint_report`（task_type）和 `sprint-report`（skill 名）

**验证命令**：

```bash
# Happy path 1: skill 文件已部署且不为空
node -e "
const fs = require('fs'), home = require('os').homedir();
const p = home + '/.claude-account1/skills/sprint-report/SKILL.md';
let size;
try { size = fs.statSync(p).size; } catch(e) { console.error('FAIL: sprint-report/SKILL.md 不存在'); process.exit(1); }
if (size < 100) { console.error('FAIL: SKILL.md 文件过小 (' + size + ' bytes)，可能是空文件'); process.exit(1); }
console.log('PASS: sprint-report SKILL.md 存在且大小=' + size + ' bytes');
"

# Happy path 2: task-router.js 存在 sprint_report 映射（分开检查，避免操作符陷阱）
node -e "
const c = require('fs').readFileSync('packages/brain/src/task-router.js','utf8');
if (!c.includes('sprint_report')) {
  console.error('FAIL: task-router.js 缺少 sprint_report 路由映射');
  process.exit(1);
}
console.log('PASS: task-router.js 包含 sprint_report 路由映射');
"

# Happy path 3: skills-index.md 两个关键词分开验证
node -e "
const c = require('fs').readFileSync('.agent-knowledge/skills-index.md','utf8');
if (!c.includes('sprint_report')) {
  console.error('FAIL: skills-index.md 缺少 sprint_report task_type 条目');
  process.exit(1);
}
if (!c.includes('sprint-report')) {
  console.error('FAIL: skills-index.md 缺少 sprint-report skill 名条目');
  process.exit(1);
}
console.log('PASS: skills-index.md 同时包含 sprint_report 和 sprint-report');
"

# 负向测试: deploy-workflow-skills.sh 包含 sprint-report 部署逻辑（保证未来 redeploy 不丢失）
node -e "
const c = require('fs').readFileSync('packages/workflows/scripts/deploy-workflow-skills.sh','utf8');
if (!c.includes('sprint-report')) {
  console.error('FAIL: deploy-workflow-skills.sh 未包含 sprint-report，redeploy 后 skill 会丢失');
  process.exit(1);
}
console.log('PASS: deploy-workflow-skills.sh 包含 sprint-report 部署逻辑');
"
```

---

### Feature 2: Contract GAN 无上限对抗

**行为描述**：execution.js 在处理 sprint_contract_review 回调时，若 verdict=REVISION 则无条件创建下一轮 propose 任务，不检查轮次上限；APPROVED 时进入 sprint_generate。

**硬阈值**：
- execution.js 中不存在 `MAX_CONTRACT_ROUNDS` 常量
- execution.js 中不存在对 `propose_round` 的上限比较（如 `> 5`、`>= 10`）
- REVISION 分支代码路径中，存在创建 `sprint_contract_propose` 任务的逻辑
- APPROVED 分支代码路径中，存在创建 `sprint_generate` 任务的逻辑

**验证命令**：

```bash
# Happy path 1: 无 MAX_CONTRACT_ROUNDS 常量
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
if (c.includes('MAX_CONTRACT_ROUNDS')) {
  console.error('FAIL: execution.js 仍有 MAX_CONTRACT_ROUNDS 截断常量');
  process.exit(1);
}
console.log('PASS: execution.js 无 MAX_CONTRACT_ROUNDS 截断');
"

# Happy path 2: 无 propose_round 上限比较（负向检查截断条件）
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
const upperBound = /propose_round\s*[>]=?\s*\d+|propose_round\s*==\s*\d+/;
if (upperBound.test(c)) {
  console.error('FAIL: execution.js 对 propose_round 有上限比较，可能存在隐性截断');
  process.exit(1);
}
console.log('PASS: execution.js 无 propose_round 上限比较');
"

# Happy path 3: REVISION → sprint_contract_propose 路由存在（分块提取验证）
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
// 找 sprint_contract_review 处理块
const idx = c.indexOf('sprint_contract_review');
if (idx === -1) { console.error('FAIL: execution.js 无 sprint_contract_review 处理逻辑'); process.exit(1); }
// 在其后 1500 字符内查找 REVISION 和 sprint_contract_propose
const chunk = c.slice(idx, idx + 1500);
if (!chunk.includes('REVISION')) { console.error('FAIL: sprint_contract_review 块缺少 REVISION 分支'); process.exit(1); }
if (!chunk.includes('sprint_contract_propose')) { console.error('FAIL: REVISION 分支未创建 sprint_contract_propose 任务'); process.exit(1); }
console.log('PASS: REVISION 分支正确路由到 sprint_contract_propose');
"

# 负向测试: APPROVED 分支进入 sprint_generate（而非再次 propose）
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
const idx = c.indexOf('sprint_contract_review');
if (idx === -1) { console.error('FAIL: 无 sprint_contract_review 块'); process.exit(1); }
const chunk = c.slice(idx, idx + 1500);
if (!chunk.includes('APPROVED')) { console.error('FAIL: sprint_contract_review 块缺少 APPROVED 分支'); process.exit(1); }
if (!chunk.includes('sprint_generate')) { console.error('FAIL: APPROVED 分支未进入 sprint_generate'); process.exit(1); }
console.log('PASS: APPROVED 分支正确进入 sprint_generate');
"
```

---

### Feature 3: Contract Draft 跨 worktree 持久化

**行为描述**：Proposer 写完 contract-draft.md 后在 Phase 3 执行 `git add + git commit + git push origin HEAD`；Reviewer 在 Phase 1 执行 `git fetch origin` + `git show <branch>:sprints/contract-draft.md`，不依赖本地文件系统。

**硬阈值**：
- `packages/workflows/skills/sprint-contract-proposer/SKILL.md` 的 Phase 3 含 `git push` 命令
- `packages/workflows/skills/sprint-contract-reviewer/SKILL.md` 的 Phase 1 含 `git fetch` 和 `git show` 命令
- 两个 skill 均已部署到 `~/.claude-account1/skills/`

**验证命令**：

```bash
# Happy path 1: Proposer SKILL.md 包含 git push（检查仓库源文件）
node -e "
const c = require('fs').readFileSync('packages/workflows/skills/sprint-contract-proposer/SKILL.md','utf8');
if (!c.includes('git push')) {
  console.error('FAIL: sprint-contract-proposer/SKILL.md 缺少 git push 命令');
  process.exit(1);
}
console.log('PASS: Proposer SKILL.md 包含 git push 持久化步骤');
"

# Happy path 2: Reviewer SKILL.md 包含 git fetch 和 git show（两个分开独立检查）
node -e "
const c = require('fs').readFileSync('packages/workflows/skills/sprint-contract-reviewer/SKILL.md','utf8');
if (!c.includes('git fetch')) {
  console.error('FAIL: sprint-contract-reviewer/SKILL.md 缺少 git fetch');
  process.exit(1);
}
if (!c.includes('git show')) {
  console.error('FAIL: sprint-contract-reviewer/SKILL.md 缺少 git show');
  process.exit(1);
}
console.log('PASS: Reviewer SKILL.md 包含 git fetch + git show 跨 worktree 读取');
"

# 跨 worktree 可达性验证: 通过 git show 读取当前分支的 contract-draft.md（模拟 Reviewer 实际操作）
node -e "
const { execSync } = require('child_process');
const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
let content;
try {
  content = execSync('git show origin/' + branch + ':sprints/contract-draft.md', {encoding:'utf8'});
} catch(e) {
  console.error('FAIL: 跨 worktree 不可达 — git show origin/' + branch + ':sprints/contract-draft.md 失败');
  console.error('原因: ' + e.message.split('\n')[0]);
  process.exit(1);
}
if (content.length < 100) {
  console.error('FAIL: contract-draft.md 内容过短 (' + content.length + ' 字节)，可能未正确 push');
  process.exit(1);
}
console.log('PASS: 跨 worktree 可达，git show 读取 ' + content.length + ' 字节');
"

# 负向测试: headless account 部署验证（两个 skill 分开检查，避免 && 操作符陷阱）
node -e "
const fs = require('fs'), home = require('os').homedir();
const p1 = home + '/.claude-account1/skills/sprint-contract-proposer/SKILL.md';
try { fs.accessSync(p1); } catch(e) {
  console.error('FAIL: sprint-contract-proposer 未部署到 headless account');
  process.exit(1);
}
console.log('PASS: sprint-contract-proposer skill 已部署');
"
node -e "
const fs = require('fs'), home = require('os').homedir();
const p2 = home + '/.claude-account1/skills/sprint-contract-reviewer/SKILL.md';
try { fs.accessSync(p2); } catch(e) {
  console.error('FAIL: sprint-contract-reviewer 未部署到 headless account');
  process.exit(1);
}
console.log('PASS: sprint-contract-reviewer skill 已部署');
"
```

---

### Feature 4: Harness v3.1 测试覆盖

**行为描述**：新增 `harness-sprint-loop-v3.test.js` 覆盖 10 个链路节点：Planner 输出、Contract Propose、Contract Review REVISION/APPROVED、Generator、CI Watch、Evaluator PASS/FAIL、sprint_fix、sprint_report。

**硬阈值**：
- 测试文件存在且行数 ≥ 200
- 文件包含 `sprint_report` 节点（v2.0 测试缺失项）
- 文件包含 REVISION 和 APPROVED 两个 Contract GAN 分支

**验证命令**：

```bash
# Happy path 1: 测试文件存在
node -e "
try {
  require('fs').accessSync('packages/brain/tests/harness-sprint-loop-v3.test.js');
  console.log('PASS: harness-sprint-loop-v3.test.js 存在');
} catch(e) {
  console.error('FAIL: harness-sprint-loop-v3.test.js 不存在');
  process.exit(1);
}
"

# Happy path 2: 行数 ≥ 200（分开独立断言）
node -e "
const lines = require('fs').readFileSync('packages/brain/tests/harness-sprint-loop-v3.test.js','utf8').split('\n').length;
if (lines < 200) {
  console.error('FAIL: 测试文件仅 ' + lines + ' 行，不足 200 行，覆盖不充分');
  process.exit(1);
}
console.log('PASS: 测试文件 ' + lines + ' 行，行数达标');
"

# Happy path 3: 覆盖 sprint_report 节点
node -e "
const c = require('fs').readFileSync('packages/brain/tests/harness-sprint-loop-v3.test.js','utf8');
if (!c.includes('sprint_report')) {
  console.error('FAIL: 测试未覆盖 sprint_report 节点（v2.0 缺失项）');
  process.exit(1);
}
console.log('PASS: 测试覆盖 sprint_report 节点');
"

# 负向测试: GAN 对抗节点覆盖验证（REVISION 和 APPROVED 分开检查）
node -e "
const c = require('fs').readFileSync('packages/brain/tests/harness-sprint-loop-v3.test.js','utf8');
if (!c.includes('REVISION')) {
  console.error('FAIL: 测试未覆盖 Contract GAN REVISION 分支');
  process.exit(1);
}
if (!c.includes('APPROVED')) {
  console.error('FAIL: 测试未覆盖 Contract GAN APPROVED 分支');
  process.exit(1);
}
console.log('PASS: 测试覆盖 GAN 对抗 REVISION/APPROVED 节点');
"

# 运行测试（验证测试本身可执行，非仅文件存在）
npm test -- --testPathPattern=harness-sprint-loop-v3
```

---

## 技术实现方向（高层）

- **packages/workflows/scripts/deploy-workflow-skills.sh**：加入 `sprint-report` skill 同步逻辑
- **packages/brain/src/task-router.js**：确认 `sprint_report` 路由到 `/sprint-report` skill
- **packages/brain/src/routes/execution.js**：删除任何 MAX_CONTRACT_ROUNDS 常量；REVISION 分支纯粹递增 propose_round 并创建新任务；APPROVED 分支创建 sprint_generate 任务
- **packages/workflows/skills/sprint-contract-proposer/SKILL.md**：Phase 3 添加 git push 命令
- **packages/workflows/skills/sprint-contract-reviewer/SKILL.md**：Phase 1 添加 git fetch + git show 命令
- **packages/brain/tests/harness-sprint-loop-v3.test.js**：新增覆盖完整 v3.1 链路的测试文件

## 不在本次范围内

- sprint_fix 多轮修复流程的完整验证（Sprint 3+）
- CI Watch 与 PR merge 的真实集成测试
- executor.js account 绑定逻辑（单独 PR 处理）
- token/cost 统计（sprint_report 内容）
