# 合同草案（第 1 轮）

**生成者**: Generator (Sprint 1 Contract Proposer)
**任务**: Harness v3.0 — 对标官方设计重构 — 基础层
**提案轮次**: R1

---

## 本次实现的功能

- Feature A: Planner skill 纯 spec 化 — 彻底移除验证命令，只输出高层产品 PRD
- Feature B: Brain 断链 — sprint_planner 完成后自动创建 sprint_contract_propose 任务
- Feature C: sprint-contract-proposer skill — Generator 提合同草案，每 Feature 附广谱验证命令
- Feature D: sprint-contract-reviewer skill — Evaluator GAN 对抗，挑战验证命令严格性

---

## 验收标准（DoD）

### Feature A: Planner skill 纯 spec 化

**行为描述**：sprint-planner 的 SKILL.md 只输出高层产品 spec（产品目标、功能清单、用户视角验收标准），绝不包含可执行验证命令（curl/psql/npm test 等技术细节）。

**硬阈值**：
- SKILL.md 不含 `curl`、`psql`、`npm test`、`node -e` 关键词
- SKILL.md 含 `sprint-prd.md` 输出声明
- SKILL.md 含 "不写验证命令" 或同义约束

**验证命令**：
```bash
# Happy path: 检查 planner skill 无验证命令
node -e "
const c = require('fs').readFileSync(require('os').homedir()+'/.claude-account1/skills/sprint-planner/SKILL.md','utf8');
const forbidden = ['curl ', 'psql ', 'npm test', 'node -e \"', 'playwright test'];
const found = forbidden.filter(k => c.includes(k));
if (found.length > 0) { console.error('FAIL: Planner skill 含技术验证命令: '+found.join(', ')); process.exit(1); }
console.log('PASS: Planner skill 无技术验证命令');
"

# 边界: 检查 planner skill 含必要高层约束声明
node -e "
const c = require('fs').readFileSync(require('os').homedir()+'/.claude-account1/skills/sprint-planner/SKILL.md','utf8');
if (!c.includes('sprint-prd.md')) { console.error('FAIL: 缺少 sprint-prd.md 输出声明'); process.exit(1); }
if (!c.includes('验证命令') || (!c.includes('不写') && !c.includes('不含') && !c.includes('绝不'))) {
  console.error('FAIL: 缺少禁止写验证命令的约束'); process.exit(1);
}
console.log('PASS: Planner 约束声明完整');
"
```

---

### Feature B: Brain 断链 — planner → contract_propose

**行为描述**：execution.js 中，sprint_planner 任务完成后，Brain 自动在同一 sprint_dir 下创建 sprint_contract_propose 任务，继承 sprint_dir / planner_task_id 等参数。

**硬阈值**：
- execution.js 含 sprint_planner → sprint_contract_propose 路由逻辑
- 新建 contract_propose 任务的 payload 含 `planner_task_id` 和 `sprint_dir`
- propose_round 初始值为 1

**验证命令**：
```bash
# Happy path: execution.js 含 sprint_planner → sprint_contract_propose 路由
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
if (!c.includes('sprint_planner') || !c.includes('sprint_contract_propose')) {
  console.error('FAIL: 缺少 sprint_planner → sprint_contract_propose 路由'); process.exit(1);
}
if (!c.includes('planner_task_id')) {
  console.error('FAIL: 新建 contract_propose 任务未传递 planner_task_id'); process.exit(1);
}
if (!c.includes('propose_round')) {
  console.error('FAIL: 新建 contract_propose 任务未设置 propose_round'); process.exit(1);
}
console.log('PASS: Brain 断链路由完整');
"

# 边界: sprint_contract_review REVISION 路由回 contract_propose 且 propose_round+1
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');
if (!c.includes('REVISION') || !c.includes('sprint_contract_propose')) {
  console.error('FAIL: REVISION 路由未指向 sprint_contract_propose'); process.exit(1);
}
const hasIncrement = c.includes('propose_round + 1') || c.includes('propose_round+1') || c.includes('proposeRound + 1') || c.includes('proposeRound+1');
if (!hasIncrement) {
  console.error('FAIL: REVISION 时 propose_round 未自增'); process.exit(1);
}
console.log('PASS: REVISION → propose_round 自增路由正确');
"
```

---

### Feature C: sprint-contract-proposer skill 广谱验证命令

**行为描述**：sprint-contract-proposer/SKILL.md 明确要求 Generator 按任务类型选择广谱验证工具（API→curl+node，DB→psql，逻辑单元→npm test，UI→playwright），每个 Feature 至少 2 条验证命令（happy path + 边界）。

**硬阈值**：
- SKILL.md 明确列出 curl/psql/npm test/playwright 四类广谱工具
- SKILL.md 要求每 Feature 至少 2 条命令
- SKILL.md 要求命令返回 `PASS:` / `FAIL:` exit code

**验证命令**：
```bash
# Happy path: contract-proposer skill 含广谱工具规则
node -e "
const c = require('fs').readFileSync(require('os').homedir()+'/.claude-account1/skills/sprint-contract-proposer/SKILL.md','utf8');
const tools = ['curl', 'psql', 'npm test', 'playwright'];
const missing = tools.filter(t => !c.includes(t));
if (missing.length > 0) { console.error('FAIL: 缺少广谱工具声明: '+missing.join(', ')); process.exit(1); }
console.log('PASS: 广谱工具规则完整');
"

# 边界: skill 要求至少 2 条命令且含 exit code 要求
node -e "
const c = require('fs').readFileSync(require('os').homedir()+'/.claude-account1/skills/sprint-contract-proposer/SKILL.md','utf8');
if (!c.includes('exit 0') && !c.includes('exit code') && !c.includes('exit_code')) {
  console.error('FAIL: 缺少 exit code 要求'); process.exit(1);
}
if (!c.includes('2 条') && !c.includes('至少两') && !c.includes('happy path') && !c.includes('边界')) {
  console.error('FAIL: 缺少 happy path + 边界命令要求'); process.exit(1);
}
console.log('PASS: 验证命令格式规则完整');
"
```

---

### Feature D: sprint-contract-reviewer skill GAN 对抗

**行为描述**：sprint-contract-reviewer/SKILL.md 实现 Evaluator GAN 角色——读取 contract-draft.md，挑战每条验证命令是否足够严格（不是静态文件检查、覆盖真实行为、有边界测试），输出 APPROVED 或 REVISION + 具体反馈。

**硬阈值**：
- SKILL.md 输出 `{"verdict": "APPROVED"}` 或 `{"verdict": "REVISION", "feedback": [...]}`
- SKILL.md 读取 `contract-draft.md`
- SKILL.md 明确禁止静态文件检查（readFileSync + includes）作为验证命令

**验证命令**：
```bash
# Happy path: contract-reviewer skill 含 APPROVED/REVISION verdict 输出
node -e "
const c = require('fs').readFileSync(require('os').homedir()+'/.claude-account1/skills/sprint-contract-reviewer/SKILL.md','utf8');
if (!c.includes('APPROVED') || !c.includes('REVISION')) {
  console.error('FAIL: 缺少 APPROVED/REVISION verdict 声明'); process.exit(1);
}
if (!c.includes('contract-draft.md')) {
  console.error('FAIL: 未读取 contract-draft.md'); process.exit(1);
}
console.log('PASS: Reviewer GAN verdict 结构正确');
"

# 边界: reviewer 明确拒绝纯静态文件检查
node -e "
const c = require('fs').readFileSync(require('os').homedir()+'/.claude-account1/skills/sprint-contract-reviewer/SKILL.md','utf8');
const hasStaticReject = c.includes('readFileSync') || c.includes('静态') || c.includes('文件检查') || c.includes('weak') || c.includes('弱测试');
if (!hasStaticReject) {
  console.error('FAIL: 未明确拒绝纯静态文件检查作为验证命令'); process.exit(1);
}
console.log('PASS: Reviewer 拒绝弱验证规则存在');
"
```

---

## 技术实现方向（高层）

- `packages/brain/src/routes/execution.js`：在 sprint_planner → next 路由段添加 sprint_contract_propose 创建逻辑，REVISION 分支 propose_round+1
- `~/.claude-account1/skills/sprint-planner/SKILL.md`：移除所有 curl/psql/npm test 命令，加强"禁止验证命令"约束
- `~/.claude-account1/skills/sprint-contract-proposer/SKILL.md`：强化广谱工具规则 + exit code 规则
- `~/.claude-account1/skills/sprint-contract-reviewer/SKILL.md`：强化静态检查拒绝规则 + GAN 对抗逻辑

---

## 不在本次范围内

- sprint_report 步骤（Sprint 4）
- Evaluator 执行阶段机械执行（Sprint 3）
- Generator 写代码阶段（Sprint 2+）
- sprint_fix 循环（Sprint 3+）
- token/cost 统计（sprint_report）
