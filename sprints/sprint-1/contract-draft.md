# 合同草案（第 2 轮）

**Generator**: sprint-contract-proposer  
**Sprint 目标**: 优化并稳固 Harness v3.1 流水线  
**基准**: Planner 识别的 4 个断链/不稳定点  

---

## 本次实现的功能

- Feature 1: 验证 sprint-report 端到端可执行
- Feature 2: Contract Draft 持久化 — Proposer 写完必须 git push
- Feature 3: 认证故障时 GAN 对抗任务不死循环（任务隔离保护）
- Feature 4: v3.1 测试补全 — 覆盖 sprint_report 创建、contract 持久化验证

> **注意**：GAN 对抗轮次「无上限」是刻意设计（详见 `harness-gan-design.md`），不引入 MAX_GAN_ROUNDS。

---

## 验收标准（DoD）

### Feature 1: sprint-report Skill 端到端可执行

**行为描述**: 当 `sprint_evaluate` 返回 PASS 时，Brain execution callback 创建 `sprint_report` 任务；skill 执行时从 DB 读取本次 Harness 任务并写入 `${sprint_dir}/sprint-report.md`。

**硬阈值**:
- `sprint-report` skill 已部署到 account1 skill 目录
- `packages/workflows/skills/sprint-report/SKILL.md` 存在且含 `sprint_dir` 输入参数定义
- task-router.js 中 `sprint_report` → `/sprint-report` 映射存在

**验证命令**:
```bash
# Happy path: skill 已部署
node -e "
  require('fs').accessSync(
    require('os').homedir() + '/.claude-account1/skills/sprint-report/SKILL.md'
  );
  console.log('PASS: sprint-report skill 已部署');
"

# skill 内容包含 sprint_dir 参数定义
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/sprint-report/SKILL.md', 'utf8'
  );
  if (!c.includes('sprint_dir')) { console.error('FAIL: 缺少 sprint_dir 参数'); process.exit(1); }
  if (!c.includes('planner_task_id')) { console.error('FAIL: 缺少 planner_task_id 参数'); process.exit(1); }
  console.log('PASS: skill 含必要参数定义');
"

# task-router 映射存在
node -e "
  const c = require('fs').readFileSync('packages/brain/src/task-router.js', 'utf8');
  if (!c.includes(\"'sprint_report': '/sprint-report'\")) {
    console.error('FAIL: task-router 缺少 sprint_report 映射');
    process.exit(1);
  }
  console.log('PASS: task-router sprint_report 映射存在');
"

# 边界：SKILL.md 含执行流程步骤（不是空壳）
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/sprint-report/SKILL.md', 'utf8'
  );
  const stepCount = (c.match(/### Step \d/g) || []).length;
  if (stepCount < 2) { console.error('FAIL: skill 内容不足，步骤数 < 2'); process.exit(1); }
  console.log('PASS: sprint-report skill 包含 ' + stepCount + ' 个执行步骤');
"
```

---

### Feature 2: Contract Draft 持久化（git push）

**行为描述**: `sprint-contract-proposer` skill 写完 `contract-draft.md` 后必须执行 git push，确保其他 worktree 中的 Evaluator 能通过 git pull 读取到该文件。

**硬阈值**:
- skill SKILL.md 中包含 `git push origin HEAD` 步骤
- git push 发生在 `contract-draft.md` 写入之后

**验证命令**:
```bash
# SKILL.md 含 git push 步骤
node -e "
  const c = require('fs').readFileSync(
    require('os').homedir() + '/.claude-account1/skills/sprint-contract-proposer/SKILL.md', 'utf8'
  );
  if (!c.includes('git push origin HEAD')) {
    console.error('FAIL: sprint-contract-proposer SKILL.md 缺少 git push origin HEAD');
    process.exit(1);
  }
  console.log('PASS: SKILL.md 包含 git push 步骤');
"

# git push 在 contract-draft.md git add 之后出现
node -e "
  const c = require('fs').readFileSync(
    require('os').homedir() + '/.claude-account1/skills/sprint-contract-proposer/SKILL.md', 'utf8'
  );
  const addIdx = c.indexOf('git add');
  const pushIdx = c.indexOf('git push origin HEAD');
  if (addIdx === -1) { console.error('FAIL: 缺少 git add'); process.exit(1); }
  if (pushIdx === -1) { console.error('FAIL: 缺少 git push'); process.exit(1); }
  if (pushIdx < addIdx) { console.error('FAIL: git push 在 git add 之前'); process.exit(1); }
  console.log('PASS: git push 顺序正确（add→commit→push）');
"

# 边界：reviewer skill 中含 git pull 或 git fetch 步骤（确保跨 worktree 可见）
node -e "
  const c = require('fs').readFileSync(
    require('os').homedir() + '/.claude-account1/skills/sprint-contract-reviewer/SKILL.md', 'utf8'
  );
  if (!c.includes('git pull') && !c.includes('git fetch')) {
    console.error('FAIL: sprint-contract-reviewer 缺少 git pull/fetch，无法读取跨 worktree 的 contract-draft.md');
    process.exit(1);
  }
  console.log('PASS: reviewer 包含 git pull/fetch 同步步骤');
"
```

---

### Feature 3: 认证故障时 GAN 任务不无限派发

**行为描述**: 当 `sprint_contract_propose` 或 `sprint_contract_review` 任务因认证故障（auth_fault）失败时，execution callback 不应继续创建新的对抗轮次任务，而是将任务标记为 quarantined 并等待人工干预。

> **注意**: 这不是限制 GAN 轮次（GAN 无上限是合理设计），而是区分「auth error」和「正常 REVISION」两种失败原因。

**硬阈值**:
- execution.js 中 `sprint_contract_review` 的 REVISION 分支只在 `result` 非空时创建新 propose 任务
- `result === null`（AI 失败/认证失败）时不创建新轮次

**验证命令**:
```bash
# 检查 execution.js REVISION 分支有 result null 守卫
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 找到 sprint_contract_review 的 REVISION 分支
  const reviewSection = c.slice(c.indexOf('sprint_contract_review'));
  const revisionIdx = reviewSection.indexOf('REVISION');
  if (revisionIdx === -1) { console.error('FAIL: 找不到 REVISION 分支'); process.exit(1); }
  // 检查 REVISION 之前有 result null 检查
  const before = reviewSection.slice(0, revisionIdx);
  if (!before.includes('result === null') && !before.includes('result == null')) {
    console.error('FAIL: REVISION 之前缺少 result null 守卫');
    process.exit(1);
  }
  console.log('PASS: sprint_contract_review REVISION 分支有 result null 守卫');
"

# psql 验证：查看 tasks 表中 sprint_contract_propose 任务的 quarantine_info
psql cecelia -c "
  SELECT id, title, payload->>'propose_round' as propose_round,
         payload->>'quarantine_info' as quarantine
  FROM tasks
  WHERE task_type = 'sprint_contract_propose'
  ORDER BY created_at DESC
  LIMIT 5;
"

# 边界：测试文件覆盖 sprint_contract_review result=null 不创建新轮次
node -e "
  const c = require('fs').readFileSync(
    'packages/brain/src/__tests__/harness-sprint-loop-v3.test.js', 'utf8'
  );
  if (!c.includes('sprint_contract_review') || !c.includes('null')) {
    console.error('FAIL: 测试未覆盖 contract_review result=null 场景');
    process.exit(1);
  }
  console.log('PASS: 测试覆盖 contract_review null 场景');
"
```

---

### Feature 4: v3.1 测试补全

**行为描述**: `harness-sprint-loop-v3.test.js` 测试覆盖 9 个链路转接点，其中对 `sprint_report` 的测试（链路6）已有，但缺少：(a) `sprint_contract_review result=null` 不创建 propose 的守卫测试；(b) `sprint_report` 任务不重复创建（幂等性）的测试。

**硬阈值**:
- 测试文件包含 `sprint_contract_review` + `null result` 测试用例
- 测试文件包含 `sprint_report` 幂等性测试（已有 sprint_report 时不再创建）

**验证命令**:
```bash
# 运行 v3 harness 测试
npm test -- --testPathPattern=harness-sprint-loop-v3 --reporter=verbose 2>&1 | tail -20

# 验证测试数量 >= 10（原9个 + 至少1个新增）
node -e "
  const c = require('fs').readFileSync(
    'packages/brain/src/__tests__/harness-sprint-loop-v3.test.js', 'utf8'
  );
  const itCount = (c.match(/^\s+it\(/gm) || []).length;
  if (itCount < 10) {
    console.error('FAIL: 测试用例数量不足，当前 ' + itCount + '，期望 >= 10');
    process.exit(1);
  }
  console.log('PASS: 测试用例数量 = ' + itCount);
"

# sprint_report 幂等测试存在
node -e "
  const c = require('fs').readFileSync(
    'packages/brain/src/__tests__/harness-sprint-loop-v3.test.js', 'utf8'
  );
  if (!c.includes('幂等') && !c.includes('已有') && !c.includes('existing') && !c.includes('idempotent')) {
    console.error('FAIL: 缺少 sprint_report 幂等性测试');
    process.exit(1);
  }
  console.log('PASS: sprint_report 幂等性测试存在');
"

# 边界：contract_review null result 守卫测试存在
node -e "
  const c = require('fs').readFileSync(
    'packages/brain/src/__tests__/harness-sprint-loop-v3.test.js', 'utf8'
  );
  // 查找关于 contract_review 且含 null 的测试
  const sections = c.split(/it\(/);
  const nullGuardTest = sections.find(s => s.includes('sprint_contract_review') && s.includes('null'));
  if (!nullGuardTest) {
    console.error('FAIL: 缺少 contract_review result=null 守卫测试');
    process.exit(1);
  }
  console.log('PASS: contract_review null 守卫测试存在');
"
```

---

## 技术实现方向（高层）

1. **Feature 1**: 仅验证 + 补全 SKILL.md 描述，不改 skill 实现（sprint-report 已存在）
2. **Feature 2**: 确认 sprint-contract-proposer SKILL.md Phase 3 含完整 git push 步骤；sprint-contract-reviewer SKILL.md Phase 1 含 git pull
3. **Feature 3**: 在 execution.js `sprint_contract_review` REVISION 分支添加 `result !== null` 守卫（1-2 行改动）
4. **Feature 4**: 在 `harness-sprint-loop-v3.test.js` 新增 2 个测试用例（contract_review null guard + sprint_report 幂等）

---

## 不在本次范围内

- 修改 sprint-report skill 的具体报告格式
- 添加 MAX_GAN_ROUNDS（GAN 无上限是刻意设计）
- 修改 Evaluator/Generator 的业务逻辑
- DB schema 变更
