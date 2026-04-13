# Contract Review Feedback (Round 1)

## 审查摘要

- **Feature 验证命令**: 19 条，其中 13 条 can_bypass=Y（68% 可被假实现蒙混）
- **DoD Test 命令**: 12 条，其中 9 条 can_bypass=Y（75%），6 条不改代码即 PASS
- **致命缺陷**: 3 条命令用 `console.warn` 代替 `throw`，永远返回 exit 0
- **判定**: REVISION

---

## 必须修改项

### 1. [致命缺陷] Feature 3 — verdict 保护命令永远 PASS（console.warn 不 throw）

**原始命令**:
```bash
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!code.includes('verdict') || !code.includes('extractVerdictFromResult')) {
    throw new Error('FAIL: verdict 处理逻辑缺失');
  }
  if (!code.includes('verdict_source') && !code.includes('skip') && !code.includes('existing')) {
    console.warn('WARN: 未检测到显式 verdict 保护逻辑，需实现');
  }
  console.log('PASS: verdict 相关代码存在于 execution.js');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：不做任何 verdict 保护，execution.js 维持原样
// extractVerdictFromResult 照常覆盖 agent verdict
// 但命令只 console.warn，照样输出 "PASS" 并 exit 0
// 实测已验证：当前代码无 verdict_source，此命令返回 PASS
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!code.includes('verdict_source')) throw new Error('FAIL: verdict_source 字段未实现');
  // 验证保护逻辑：当 verdict_source=agent 时跳过覆盖
  if (!code.match(/verdict_source\s*===?\s*['\"]agent['\"]/)) throw new Error('FAIL: 缺少 verdict_source===agent 判断');
  if (!code.match(/existing.*verdict|verdict.*existing|skip.*overwrite|already.*verdict/i)) throw new Error('FAIL: 缺少已有 verdict 保护分支');
  console.log('PASS: verdict 保护逻辑完整（verdict_source + agent 判断 + 跳过覆盖）');
"
```

---

### 2. [致命缺陷] Feature 4 — skill prompts 检查命令永远 PASS（console.warn 不 throw）

**原始命令**:
```bash
node -e "
  const fs = require('fs');
  const path = require('path');
  const skills = ['harness-contract-proposer', 'harness-contract-reviewer', 'harness-generator', 'harness-report'];
  let missing = [];
  for (const s of skills) {
    try { ... if (!content.includes('curl') && !content.includes('brain') && !content.includes('PATCH')) { missing.push(s); } }
    catch (e) { missing.push(s + ' (not found)'); }
  }
  if (missing.length > 0) console.warn('WARN: ...');
  console.log('PASS: skill 文件检查完成');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：所有 skill 文件都不含 curl/brain/PATCH 指令
// missing 数组非空，但命令只 console.warn
// 仍然输出 "PASS: skill 文件检查完成" 并 exit 0
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const path = require('path');
  const skills = ['harness-contract-proposer', 'harness-contract-reviewer', 'harness-generator', 'harness-report'];
  let missing = [];
  for (const s of skills) {
    const skillPath = path.join(process.env.HOME, '.claude-account1/skills', s, 'SKILL.md');
    if (!fs.existsSync(skillPath)) { missing.push(s + ' (not found)'); continue; }
    const content = fs.readFileSync(skillPath, 'utf8');
    if (!content.includes('curl') && !content.includes('PATCH')) missing.push(s);
  }
  if (missing.length > 0) throw new Error('FAIL: 以下 skill 缺少 Brain API 回写指令: ' + missing.join(', '));
  console.log('PASS: 所有 harness skill 均含 Brain API 回写指令');
"
```

---

### 3. [致命缺陷] Feature 5 — evaluator skill 质量检查命令永远 PASS（console.warn 不 throw）

**原始命令**:
```bash
node -e "
  ...
  if (!content.includes('质量') && !content.includes('quality') && !content.includes('health')) {
    console.warn('WARN: harness-evaluator skill 可能缺少质量评估步骤');
  }
  console.log('PASS: harness-evaluator SKILL.md 存在');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：harness-evaluator SKILL.md 存在但不含任何质量评估步骤
// console.warn 不阻止 PASS 输出，exit 0
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const path = require('path');
  const sp = path.join(process.env.HOME, '.claude-account1/skills/harness-evaluator/SKILL.md');
  if (!fs.existsSync(sp)) throw new Error('FAIL: harness-evaluator SKILL.md 不存在');
  const c = fs.readFileSync(sp, 'utf8');
  if (!c.includes('health') && !c.includes('/api/brain/health')) throw new Error('FAIL: 缺少 health check 步骤');
  if (!c.includes('quality') && !c.includes('质量')) throw new Error('FAIL: 缺少质量评估步骤');
  if (!c.includes('git diff')) throw new Error('FAIL: 缺少 git diff 意外变更检查');
  console.log('PASS: evaluator skill 含完整质量评估（health + quality + git diff）');
"
```

---

### 4. [测错东西] Feature 4 — 命令 C9 用 health check 测 "数据传递去 git 依赖"

**原始命令**:
```bash
curl -sf "localhost:5221/api/brain/health" > /dev/null && echo "PASS: Brain API 可达" || (echo "FAIL"; exit 1)
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：Brain 正常运行（health 200），但所有数据仍通过 git push 传递
// 命令只检查 Brain 是否活着，完全不验证数据传递方式
// 任何正在运行的 Brain 都能通过此命令
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 验证 callback 从 task.result 提取数据，而非从 git branch 文件读取
  if (!code.includes('extractBranchFromResult')) throw new Error('FAIL: extractBranchFromResult 缺失');
  // 验证不再依赖 git clone/checkout 读取分支文件
  const gitClonePattern = /git\s+clone.*report_branch|git\s+checkout.*review_branch/;
  if (gitClonePattern.test(code)) throw new Error('FAIL: execution-callback 仍依赖 git 读取分支文件');
  // 验证 result 字段用于传递 PR URL
  if (!code.includes('pr_url') && !code.includes('prUrl')) throw new Error('FAIL: 缺少从 result 提取 pr_url 逻辑');
  console.log('PASS: 数据传递统一走 Brain API（无 git 依赖）');
"
```

---

### 5. [不改代码即 PASS] 8 条命令在当前代码上就已通过

**实测验证**（本次审查中已执行确认）:

| 命令 | 当前代码已通过 | 原因 |
|------|---------------|------|
| WS1-D1 | ✅ `executeMerge` 已存在 | harness-watcher.js 已有此引用 |
| WS1-D2 | ✅ `MAX_CI_WATCH_POLLS` + `ci_timeout` 已存在 | harness-watcher.js 已有 |
| WS1-D5 | ✅ `harness_deploy_watch` 已注册 | task-router.js 已有 |
| WS2-D3 | ✅ `extractBranchFromResult` + `propose_branch` 已存在 | execution.js 已有 |
| WS3-D4 | ✅ `stage` 出现 12 次 | HarnessPipelineDetailPage.tsx 已有 |
| F2-C6 | ✅ `harness_deploy_watch` 已在 task-router | 同 WS1-D5 |
| F4-C10 | ✅ 分支提取逻辑已存在 | 同 WS2-D3 |
| F7-C18, F7-C19 | ✅ `stage`/`pipeline-detail`/`buildStages` 已存在 | 当前代码已有 |

**问题**: 这些命令无法区分"功能已存在"和"功能被新增/增强"。Generator 可以不写任何新代码，所有这些 DoD 都已满足。

**建议修复方向**: 每条 DoD 必须测试本次 sprint 新增的具体行为，而非已有代码中的字符串。例如：
- WS1-D1: 不应只测 `includes('executeMerge')`，应测 CI 全通过后 executeMerge 被调用的条件逻辑（如 `code.match(/all.*checks.*pass.*executeMerge|ci_passed.*executeMerge/s)` 或测试具体的函数签名变更）
- WS1-D2: 当前 `MAX_CI_WATCH_POLLS=120`（注释说 10 分钟），但 PRD 要求 30 分钟超时、合同硬阈值说 60 分钟。需对齐阈值并测试具体值
- WS1-D5: 已存在，不应作为 DoD 条目
- WS2-D3: 已存在，不应作为 DoD 条目
- WS3-D4: 已存在，应改为验证新增的时间线渲染组件

---

### 6. [无失败路径] PRD 7 个边界场景全部缺失

PRD 明确列出以下边界场景，合同中没有任何对应的验证命令或 DoD：

1. **CI 永不完成**（30 分钟超时）— 无测试
2. **Brain 重启后 health check 失败**（重试 3 次后中止）— 无测试
3. **Dashboard build 失败**（记录但不阻塞 Evaluator）— 无测试
4. **并发 pipeline**（同时只允许一个 deploy）— 无测试
5. **Evaluator Playwright 超时**（30 秒超时，FAIL 不阻塞）— 无测试
6. **清理误删**（只清理 cp-harness-* 不清理其他 cp-*）— F6-C16 覆盖了模式匹配，✅
7. **Agent 崩溃未回写 verdict**（callback 兜底标记 CRASH）— 无测试

**建议**: 至少为 1、2、7 三个 P0 边界添加验证命令（即使是代码结构检查而非集成测试）。

---

### 7. [命令太弱] Feature 7 — pipeline-detail API 不验 stage 对象结构

**原始命令**:
```bash
curl -sf ".../pipeline-detail?..." | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (!data.stages) throw new Error('FAIL: stages 缺失');
  if (!data.gan_rounds) throw new Error('FAIL: gan_rounds 缺失');
  console.log('PASS: stages(' + data.stages.length + ') + gan_rounds(' + data.gan_rounds.length + ')');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：返回空数组，命令仍然 PASS
router.get('/pipeline-detail', (req, res) => {
  res.json({ stages: [], gan_rounds: [] });
});
```

**建议修复命令**:
```bash
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=f093409e-97d9-432d-b292-1f1759dd9b66" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (!Array.isArray(d.stages)) throw new Error('FAIL: stages 不是数组');
  if (d.stages.length === 0) throw new Error('FAIL: stages 为空数组（应至少含 planner 阶段）');
  const required = ['name', 'started_at', 'verdict'];
  for (const stage of d.stages) {
    for (const key of required) {
      if (!(key in stage)) throw new Error('FAIL: stage 缺少字段 ' + key + '，实际: ' + JSON.stringify(Object.keys(stage)));
    }
  }
  if (!Array.isArray(d.gan_rounds)) throw new Error('FAIL: gan_rounds 不是数组');
  console.log('PASS: stages(' + d.stages.length + '项，结构完整) + gan_rounds(' + d.gan_rounds.length + ')');
"
```

---

### 8. [阈值矛盾] MAX_CI_WATCH_POLLS 数值与 PRD/合同不一致

- **PRD 说**: "Auto-Merge 等待超时 30 分钟"
- **合同硬阈值说**: "CI 超过 120 次轮询（30s 间隔 ≈ 60 分钟）"
- **当前代码说**: `MAX_CI_WATCH_POLLS = 120`，注释 "最多 10 分钟"（5s tick × 120 = 10 分钟）
- **合同验证命令说**: 范围 60-200

三处说法互相矛盾。Proposer 需明确：tick 间隔是 5s 还是 30s？超时是 10 分钟、30 分钟还是 60 分钟？验证命令的范围校验需对齐。

---

## 可选改进

- Feature 5 的 Playwright 检查在合同中只在行为描述中提到，但验证命令完全没涉及 Playwright。如果 Playwright 是 FR-005 的核心组成部分，应至少有一条验证命令检查 Playwright 依赖安装状态（`npx playwright --version`）
- Workstream 边界总体清晰，但 WS2 的 "确保 harness skill prompts 使用 Brain API 回写" 与 WS1/WS3 的 skill 文件修改有潜在交叉，建议明确哪个 WS 负责修改哪些 skill 文件
- F6-C14 `git worktree prune` 只测命令可用性，建议改为验证 harness-report skill 或 pipeline cleanup 脚本中实际调用了 prune
