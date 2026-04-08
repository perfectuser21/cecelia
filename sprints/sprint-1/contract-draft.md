# 合同草案（第 2 轮）

**Generator**: sprint-contract-proposer
**Sprint 目标**: Harness v3.1 管道稳固 — 认证故障隔离 + 测试补全
**基准**: Round 1 审查反馈（REVISION 原因：auth 失败导致文件缺失）
**提案轮次**: R2

---

## 本次实现的功能

- Feature 1: ✅ 已存在，仅验证 — sprint-report skill 端到端可执行
- Feature 2: ✅ 已存在，仅验证 — Contract Draft 持久化（git push/pull）
- Feature 3: 🔧 需实现 — execution.js `sprint_contract_review result=null` 守卫（auth 失败不触发 REVISION 循环）
- Feature 4: 🔧 需实现 — harness-sprint-loop-v3.test.js 补全 contract_review null 守卫测试

> **设计约束**: GAN 对抗轮次「无上限」是刻意设计（`harness-gan-design.md`），Feature 3 修复的是「auth error 被误判为 REVISION」，不引入 MAX_GAN_ROUNDS。

---

## 验收标准（DoD）

### Feature 1: sprint-report Skill 端到端可执行（验证现有实现）

**行为描述**: sprint-report skill 已部署，task-router 映射存在，skill 含 sprint_dir / planner_task_id 参数定义。

**硬阈值**:
- skill 已部署到 `~/.claude-account1/skills/sprint-report/SKILL.md`
- `packages/brain/src/task-router.js` 含 `sprint_report: '/sprint-report'` 映射
- SKILL.md 含 `sprint_dir` 和 `planner_task_id` 输入参数定义

**验证命令**:
```bash
# Happy path: skill 已部署
node -e "
  require('fs').accessSync(
    require('os').homedir() + '/.claude-account1/skills/sprint-report/SKILL.md'
  );
  console.log('PASS: sprint-report skill 已部署');
"

# task-router 映射存在
node -e "
  const c = require('fs').readFileSync('packages/brain/src/task-router.js', 'utf8');
  if (!c.includes(\"'sprint_report': '/sprint-report'\") && !c.includes('\"sprint_report\": \"/sprint-report\"')) {
    console.error('FAIL: task-router 缺少 sprint_report 映射'); process.exit(1);
  }
  console.log('PASS: task-router sprint_report 映射存在');
"

# skill 含必要参数定义
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/sprint-report/SKILL.md', 'utf8'
  );
  if (!c.includes('sprint_dir')) { console.error('FAIL: 缺少 sprint_dir 参数'); process.exit(1); }
  if (!c.includes('planner_task_id')) { console.error('FAIL: 缺少 planner_task_id 参数'); process.exit(1); }
  console.log('PASS: sprint-report skill 含必要参数定义');
"

# 边界：SKILL.md 含执行步骤（不是空壳）
node -e "
  const c = require('fs').readFileSync(
    'packages/workflows/skills/sprint-report/SKILL.md', 'utf8'
  );
  const stepCount = (c.match(/###\s+(?:Step|Phase|阶段)\s+\d/g) || []).length;
  if (stepCount < 1) { console.error('FAIL: skill 内容不足，无执行步骤'); process.exit(1); }
  console.log('PASS: sprint-report skill 包含 ' + stepCount + ' 个执行步骤');
"
```

---

### Feature 2: Contract Draft 持久化（验证现有实现）

**行为描述**: `sprint-contract-proposer` SKILL.md 含 git push 步骤；`sprint-contract-reviewer` SKILL.md 含 git pull/fetch 步骤，确保跨 worktree 可读。

**硬阈值**:
- proposer SKILL.md 含 `git push origin HEAD`
- reviewer SKILL.md 含 `git fetch origin` 或 `git pull`

**验证命令**:
```bash
# proposer skill 含 git push
node -e "
  const c = require('fs').readFileSync(
    require('os').homedir() + '/.claude-account1/skills/sprint-contract-proposer/SKILL.md', 'utf8'
  );
  if (!c.includes('git push origin HEAD')) {
    console.error('FAIL: sprint-contract-proposer 缺少 git push origin HEAD'); process.exit(1);
  }
  console.log('PASS: proposer skill 含 git push 步骤');
"

# reviewer skill 含 git fetch/pull（跨 worktree 同步）
node -e "
  const c = require('fs').readFileSync(
    require('os').homedir() + '/.claude-account1/skills/sprint-contract-reviewer/SKILL.md', 'utf8'
  );
  if (!c.includes('git fetch') && !c.includes('git pull')) {
    console.error('FAIL: sprint-contract-reviewer 缺少 git pull/fetch，无法跨 worktree 读取 contract-draft.md'); process.exit(1);
  }
  console.log('PASS: reviewer skill 含 git fetch/pull 同步步骤');
"

# 边界：git push 顺序正确（add → commit → push）
node -e "
  const c = require('fs').readFileSync(
    require('os').homedir() + '/.claude-account1/skills/sprint-contract-proposer/SKILL.md', 'utf8'
  );
  const addIdx = c.indexOf('git add');
  const pushIdx = c.indexOf('git push origin HEAD');
  if (addIdx === -1 || pushIdx === -1) { console.error('FAIL: 缺少 git add 或 git push'); process.exit(1); }
  if (pushIdx < addIdx) { console.error('FAIL: git push 在 git add 之前，顺序错误'); process.exit(1); }
  console.log('PASS: git push 顺序正确（add→commit→push）');
"
```

---

### Feature 3: execution.js — sprint_contract_review result=null 守卫

**行为描述**: 当 `sprint_contract_review` 任务的 `result === null`（AI 失败 / 认证失败）时，execution callback 不应创建新的 `sprint_contract_propose` 任务（否则 auth 失败会触发无限 REVISION 循环）。应将任务归入 quarantine 等待人工干预，与现有 `sprint_contract_propose` null guard（测试 11-13）保持一致。

**硬阈值**:
- `packages/brain/src/routes/execution.js` 中 `sprint_contract_review` 的 REVISION 分支在 `result === null` 时不创建新 propose 任务
- 修改量：1-3 行（在现有代码的 `reviewVerdict = 'REVISION'` 默认赋值处加 null 守卫）

**验证命令**:
```bash
# Happy path: execution.js sprint_contract_review 含 result null 守卫
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const reviewSection = c.slice(c.indexOf('sprint_contract_review'));
  const revisionIdx = reviewSection.indexOf('REVISION');
  if (revisionIdx === -1) { console.error('FAIL: 找不到 REVISION 分支'); process.exit(1); }
  // 检查 null 守卫在 REVISION 路由前存在
  const before = reviewSection.slice(0, revisionIdx + 200);
  const hasNullGuard = before.includes('result === null') || before.includes('result == null') ||
    before.includes('!result') || before.includes('result !== null');
  if (!hasNullGuard) {
    console.error('FAIL: sprint_contract_review REVISION 分支缺少 result null 守卫');
    process.exit(1);
  }
  console.log('PASS: sprint_contract_review 含 result null 守卫');
"

# 边界：null 守卫在 REVISION 创建新任务之前（逻辑顺序正确）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const start = c.indexOf(\"harnessType === 'sprint_contract_review'\");
  if (start === -1) { console.error('FAIL: 找不到 sprint_contract_review handler'); process.exit(1); }
  const section = c.slice(start, start + 1500);
  const nullGuardIdx = Math.max(section.indexOf('result === null'), section.indexOf('result == null'));
  const createIdx = section.indexOf('sprint_contract_propose');
  if (nullGuardIdx === -1) { console.error('FAIL: 无 result null 检查'); process.exit(1); }
  if (createIdx !== -1 && nullGuardIdx > createIdx) {
    console.error('FAIL: null 守卫在创建任务之后，顺序错误'); process.exit(1);
  }
  console.log('PASS: null 守卫在 sprint_contract_propose 创建之前');
"

# psql 验证：查询 sprint_contract_review 任务的完成状态分布
psql cecelia -c "
  SELECT result->>'verdict' as verdict, count(*) 
  FROM tasks 
  WHERE task_type = 'sprint_contract_review' 
  GROUP BY result->>'verdict';
"
```

---

### Feature 4: harness-sprint-loop-v3.test.js — contract_review null 守卫测试

**行为描述**: 在现有 17 个测试基础上，新增 1 个测试：`sprint_contract_review result=null → 不创建 sprint_contract_propose`（与测试 10 sprint_evaluate null、测试 11-13 sprint_contract_propose null 系列保持一致）。

**硬阈值**:
- 测试文件包含 `sprint_contract_review` + `result = null` 的测试用例
- 测试用例验证：null result 时不调用 createHarnessTask（或 createTask）

**验证命令**:
```bash
# Happy path: 测试文件含 contract_review null 测试
node -e "
  const c = require('fs').readFileSync(
    'packages/brain/src/__tests__/harness-sprint-loop-v3.test.js', 'utf8'
  );
  const sections = c.split(/\bit\(/);
  const nullGuardTest = sections.find(s => 
    s.includes('sprint_contract_review') && (s.includes('null') || s.includes('= null'))
  );
  if (!nullGuardTest) {
    console.error('FAIL: 缺少 sprint_contract_review result=null 守卫测试'); process.exit(1);
  }
  console.log('PASS: sprint_contract_review null 守卫测试存在');
"

# 测试总数 >= 18（原 17 + 新增至少 1）
node -e "
  const c = require('fs').readFileSync(
    'packages/brain/src/__tests__/harness-sprint-loop-v3.test.js', 'utf8'
  );
  const itCount = (c.match(/^\s+it\(/gm) || []).length;
  if (itCount < 18) {
    console.error('FAIL: 测试用例数不足，当前 ' + itCount + '，期望 >= 18'); process.exit(1);
  }
  console.log('PASS: 测试用例数量 = ' + itCount);
"

# 边界：运行 v3 harness 测试全部通过
npm test -- --testPathPattern=harness-sprint-loop-v3 --reporter=verbose 2>&1 | tail -15
```

---

## 技术实现方向（高层）

1. **Feature 1 & 2**: 仅验证，不改代码（已实现）
2. **Feature 3**: `packages/brain/src/routes/execution.js` — 在 `sprint_contract_review` handler 开头添加 `if (result === null) { return; }` 或等效 null guard（约 3 行改动）
3. **Feature 4**: `packages/brain/src/__tests__/harness-sprint-loop-v3.test.js` — 新增测试用例 "18. sprint_contract_review result=null → 不创建 sprint_contract_propose"

---

## 不在本次范围内

- 修改 sprint-report skill 内容格式
- 引入 MAX_GAN_ROUNDS（GAN 无上限是刻意设计）
- 修改 Planner/Evaluator/Generator 业务逻辑
- DB schema 变更
- sprint_planner 认证失败处理（不同路径）
