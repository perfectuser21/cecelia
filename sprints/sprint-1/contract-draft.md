# 合同草案（第 4 轮）

**Sprint**: Harness v3.1 流水线稳固  
**Generator**: Contract Proposer Round 4  
**基于**: Planner 任务 3217cdf0（4 个断链点识别）+ R1/R2/R3 review 反馈  
**R3 修复点**:
1. Feature D — 测试内容检查加 `expect()/assert()` 断言存在 + `sprint_contract_propose`/`sprint_generate` task_type 行为验证
2. Feature A — 补充 `propose_round` 缺失时默认为 1 的静态守卫检查命令
3. Feature B — Reviewer SKILL.md 验证命令加 `add→commit→push` 顺序检查（与 Proposer 对称）
4. Feature A 可选改进 — 控制流 regex 加 `^[^/]*` 前缀排除注释行

---

## 本次实现的功能

- Feature A: Contract 防死循环 — execution.js REVISION 路径加 MAX_CONTRACT_PROPOSE_ROUNDS=5 保护
- Feature B: Contract Draft 跨 worktree 持久化 — Proposer/Reviewer SKILL.md 写文件后立即 git push
- Feature C: sprint-report 可调用性验证 — 确认 skill 文件 + router 映射 + skills-index 条目均存在
- Feature D: MAX_CONTRACT_PROPOSE_ROUNDS 测试覆盖 — 新增 propose_round=MAX 和 MAX-1 两个 test case

---

## 验收标准（DoD）

### Feature A: Contract 防死循环

**行为描述**：
- `propose_round >= MAX_CONTRACT_PROPOSE_ROUNDS(5)` 时，不再创建新 `sprint_contract_propose` 任务，改为将 `contract-draft.md` 强制升格为 `sprint-contract.md` 并触发 `sprint_generate`
- `propose_round < 5` 时，正常创建下一轮 propose 任务
- `propose_round` 缺失时默认为 1，不崩溃

**硬阈值**：
- `execution.js` 含 `MAX_CONTRACT_PROPOSE_ROUNDS` 常量，值为 `5`
- REVISION 分支有轮次守卫控制流（非注释行）
- 超限时不调用创建 `sprint_contract_propose` 的 `createHarnessTask`
- `propose_round` 缺失（undefined/null）时有默认值守卫

**验证命令**：
```bash
# 检查常量存在且值为 5
node -e "
  const c = require('fs').readFileSync('packages/brain/src/execution.js','utf8');
  const m = c.match(/MAX_CONTRACT_PROPOSE_ROUNDS\s*=\s*(\d+)/);
  if (!m) { console.error('FAIL: 未找到 MAX_CONTRACT_PROPOSE_ROUNDS 常量'); process.exit(1); }
  if (m[1] !== '5') { console.error('FAIL: 期望值 5，实际 ' + m[1]); process.exit(1); }
  console.log('PASS: MAX_CONTRACT_PROPOSE_ROUNDS = ' + m[1]);
"

# 边界验证: 正则检查 REVISION 分支含轮次守卫（^[^/]* 排除注释行）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/execution.js','utf8');
  const lines = c.split('\n');
  const hasGuard = lines.some(l =>
    /^[^/]*nextRound\s*[>]=?\s*MAX_CONTRACT_PROPOSE_ROUNDS/.test(l) ||
    /^[^/]*propose_round\s*[>]=?\s*MAX_CONTRACT_PROPOSE_ROUNDS/.test(l)
  );
  if (!hasGuard) {
    console.error('FAIL: 未在非注释行找到轮次上限控制流守卫');
    process.exit(1);
  }
  console.log('PASS: REVISION 分支含轮次上限控制流守卫（排除注释行）');
"

# propose_round 缺失默认值守卫检查
node -e "
  const c = require('fs').readFileSync('packages/brain/src/execution.js','utf8');
  const hasDefault =
    /propose_round\s*\?\?\s*1/.test(c) ||
    /propose_round\s*\|\|\s*1/.test(c) ||
    /parseInt[^)]*propose_round[^)]*\)\s*\|\|\s*1/.test(c) ||
    /propose_round\s*==\s*null[^;]*[;\n][^;]*=\s*1/.test(c) ||
    /propose_round\s*===?\s*undefined/.test(c);
  if (!hasDefault) {
    console.error('FAIL: 未找到 propose_round 缺失时默认为 1 的守卫逻辑'); process.exit(1);
  }
  console.log('PASS: propose_round 有默认值守卫');
"
```

---

### Feature B: Contract Draft 跨 worktree 持久化

**行为描述**：
- Generator 写完 `contract-draft.md` 后执行 `git add → git commit → git push origin HEAD`
- Reviewer 写完 `contract-review-feedback.md` 后同样执行三步 push
- push 失败视为软错误，不阻塞任务回调

**硬阈值**：
- `sprint-contract-proposer/SKILL.md` 含 `git push origin HEAD`，且 `git add` 在 `git push` 之前
- `sprint-contract-reviewer/SKILL.md` 含 `git push origin HEAD`，且 `git add` 在 `git push` 之前（顺序对称）
- commit message 格式含 `contract draft round` 或 `contract review round`

**验证命令**：
```bash
# Proposer SKILL.md 含 git push 且 add→commit→push 顺序正确
node -e "
  const c = require('fs').readFileSync(
    require('os').homedir()+'/.claude-account1/skills/sprint-contract-proposer/SKILL.md','utf8');
  if (!c.includes('git push origin HEAD')) {
    console.error('FAIL: proposer SKILL.md 无 git push origin HEAD'); process.exit(1);
  }
  const addIdx = c.lastIndexOf('git add');
  const pushIdx = c.lastIndexOf('git push');
  if (addIdx === -1 || addIdx > pushIdx) {
    console.error('FAIL: proposer git add 顺序错误或缺失'); process.exit(1);
  }
  console.log('PASS: proposer SKILL.md 含 git push，add→commit→push 顺序正确');
"

# Reviewer SKILL.md 含 git push 且 add→commit→push 顺序正确（与 Proposer 对称）
node -e "
  const c = require('fs').readFileSync(
    require('os').homedir()+'/.claude-account1/skills/sprint-contract-reviewer/SKILL.md','utf8');
  if (!c.includes('git push origin HEAD')) {
    console.error('FAIL: reviewer SKILL.md 无 git push origin HEAD'); process.exit(1);
  }
  const addIdx = c.lastIndexOf('git add');
  const pushIdx = c.lastIndexOf('git push');
  if (addIdx === -1 || addIdx > pushIdx) {
    console.error('FAIL: reviewer SKILL.md git add 顺序错误或缺失'); process.exit(1);
  }
  console.log('PASS: reviewer SKILL.md 含 git push，add→commit→push 顺序正确');
"
```

---

### Feature C: sprint-report 可调用性验证

**行为描述**：
- `sprint_report` 任务派发后 executor 能找到 `/sprint-report` skill
- skill 文件存在、router 映射存在、skills-index 有条目

**硬阈值**：
- `~/.claude-account1/skills/sprint-report/SKILL.md` 文件存在（非零字节）
- `task-router.js` 中 `sprint_report` → `/sprint-report` 映射存在（正则匹配，不依赖引号风格）
- `.agent-knowledge/skills-index.md` 含 `sprint-report` 或 `sprint_report`

**验证命令**：
```bash
# 检查 skill 文件存在且非空
node -e "
  const fs = require('fs');
  const p = require('os').homedir()+'/.claude-account1/skills/sprint-report/SKILL.md';
  const stat = fs.statSync(p);
  if (stat.size === 0) { console.error('FAIL: SKILL.md 为空'); process.exit(1); }
  console.log('PASS: sprint-report SKILL.md 存在，大小 ' + stat.size + ' 字节');
"

# 检查 task-router 映射（正则，不依赖引号风格）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/task-router.js','utf8');
  if (!/sprint_report['\"]?\s*:\s*['\"]\/sprint-report/.test(c)) {
    console.error('FAIL: task-router.js 无 sprint_report → /sprint-report 映射');
    process.exit(1);
  }
  console.log('PASS: task-router.js 含 sprint_report 映射');
"

# 检查 skills-index.md 有条目
node -e "
  const c = require('fs').readFileSync('.agent-knowledge/skills-index.md','utf8');
  if (!c.includes('sprint-report') && !c.includes('sprint_report')) {
    console.error('FAIL: skills-index.md 无 sprint-report 条目'); process.exit(1);
  }
  console.log('PASS: skills-index.md 含 sprint-report 条目');
"
```

---

### Feature D: MAX_CONTRACT_PROPOSE_ROUNDS 测试覆盖

**行为描述**：
- `propose_round=5` + REVISION → `createHarnessTask` 不被调用（或调用的是 `sprint_generate`，非 `sprint_contract_propose`）
- `propose_round=4` + REVISION → `createHarnessTask` 被调用，`task_type='sprint_contract_propose'`，`propose_round=5`
- 两个 test case 均通过 vitest 无报错，且有实际 `expect()` 断言

**硬阈值**：
- 测试文件存在（`harness-sprint-loop-v3.test.js` 追加 或 新建 `contract-max-rounds.test.ts`）
- 测试文件含 `propose_round` 相关 describe/test block
- 测试文件含 `expect()` 或 `assert()` 实际断言（非零断言）
- 测试文件验证 `sprint_contract_propose` 和 `sprint_generate` 的 task_type 行为
- `bash -c 'set -o pipefail; ...'` 运行测试 exit code 为 0

**验证命令**：
```bash
# 检查测试文件存在、含 propose_round 场景、有实际断言、验证 task_type 行为
node -e "
  const fs = require('fs');
  const candidates = [
    'packages/brain/tests/harness-sprint-loop-v3.test.js',
    'packages/brain/tests/contract-max-rounds.test.ts',
    'packages/brain/tests/contract-max-rounds.test.js'
  ];
  let content = null, found = '';
  for (const p of candidates) {
    try { content = fs.readFileSync(p,'utf8'); found = p; break; } catch(e) {}
  }
  if (!content) { console.error('FAIL: 未找到测试文件'); process.exit(1); }
  if (!/propose_round|MAX_CONTRACT_PROPOSE_ROUNDS/.test(content)) {
    console.error('FAIL: 测试文件不含 propose_round 或 MAX_CONTRACT_PROPOSE_ROUNDS 用例'); process.exit(1);
  }
  if (!content.includes('expect(') && !content.includes('assert(')) {
    console.error('FAIL: 测试文件无 expect()/assert() 断言，零断言测试无效'); process.exit(1);
  }
  if (!/sprint_contract_propose/.test(content) || !/sprint_generate/.test(content)) {
    console.error('FAIL: 测试未验证 sprint_contract_propose 和 sprint_generate 的 task_type 行为'); process.exit(1);
  }
  console.log('PASS: ' + found + ' 含 propose_round 测试用例、实际断言、task_type 行为验证');
"

# 用 pipefail 运行测试（防止 tail 掩盖 exit code）
bash -c 'set -o pipefail; cd packages/brain && npm test -- --testPathPattern="harness-sprint-loop|contract-max-rounds" 2>&1 | tail -30'
```

---

## 技术实现方向（高层）

- **execution.js**：REVISION 分支顶部增加 `const MAX_CONTRACT_PROPOSE_ROUNDS = 5;`，`propose_round` 用 `?? 1` 或 `|| 1` 做默认值，用 `if (nextRound > MAX_CONTRACT_PROPOSE_ROUNDS)` 保底升格（复制 draft → sprint-contract.md，触发 sprint_generate）
- **sprint-contract-proposer/SKILL.md**：Phase 3 补充 `git add → git commit → git push origin HEAD`
- **sprint-contract-reviewer/SKILL.md**：同上，Reviewer 也 push feedback 文件，add→commit→push 顺序与 Proposer 对称
- **测试**：`harness-sprint-loop-v3.test.js` 追加 MAX_ROUNDS describe block，含 `propose_round=5`（不创建 sprint_contract_propose）和 `propose_round=4`（创建 sprint_contract_propose，round=5）两个有 `expect()` 断言的 case

## 不在本次范围内

- harness v4 任务类型的 MAX 保护（仅修 sprint_contract_propose/review）
- sprint-report 输出内容格式质量
- GAN 执行阶段（sprint_evaluate/sprint_fix）轮次上限 — 设计上无上限，禁止修改
- Brain DB migration — 本次无 schema 变更
