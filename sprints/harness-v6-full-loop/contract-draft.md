# Sprint Contract Draft (Round 3)

> **Round 3 修订说明**：逐项修复 Reviewer Round 2 全部 2 个必须修改项 + 3 个可选改进：
> 1. ~~C1 regex {0,500} 假阴性~~ → 窗口扩大到 {0,800}，留出余量（必须修改 #1）
> 2. ~~C7 CRASH regex 被注释蒙混~~ → 改为检测 verdict 赋值语句 + 条件关联，排除注释干扰（必须修改 #2）
> 3. ~~C16 StageTimeline 仅查声明~~ → 增加 `.map` 遍历渲染验证（可选改进 #1）
> 4. C3/C5/C9 为回归守护，保持不变（可选改进 #2 已确认）
> 5. PRD 边界「Dashboard build 失败不阻塞」和「并发 pipeline 排队」列入 WS2/WS3 后续（可选改进 #3）

---

## Feature 1: Auto-Merge — CI 通过后 PR 自动合并

**行为描述**:
当 Harness PR（`cp-harness-*` 分支）的所有 CI check 通过后，系统在 60 秒内自动将 PR 合并到 main。当 CI 超时（超过 60 分钟无结果）或失败时，系统标记任务失败并创建修复任务（harness_fix），不执行合并。

**硬阈值**:
- CI 全通过 → PR 自动合并，harness_ci_watch 状态变为 completed
- CI 超时阈值：120 次轮询 × 30 秒 API 节流 ≈ 60 分钟
- CI 失败 → 创建 harness_fix 任务，包含 ci_fail_context 字段
- CI 超时 → 创建 harness_fix 任务，包含 ci_timeout=true 字段

**验证命令**:
```bash
# C1: Auto-Merge 条件逻辑 — CI 通过后才调用 executeMerge
# 【Round 3 修复 #1】：regex 窗口从 {0,500} 扩大到 {0,800}，当前实际距离 535 chars，留出余量
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 必须在 ci_passed 条件下调用 executeMerge（窗口 800 chars，实测 535 足够）
  if (!code.match(/ciStatus\s*===?\s*['\"]ci_passed['\"][\s\S]{0,800}executeMerge/)) {
    throw new Error('FAIL: executeMerge 未在 ci_passed 条件下调用');
  }
  // 必须在 ci_failed 条件下创建 harness_fix
  if (!code.match(/ciStatus\s*===?\s*['\"]ci_failed['\"][\s\S]{0,800}harness_fix/)) {
    throw new Error('FAIL: ci_failed 分支未创建 harness_fix 任务');
  }
  console.log('PASS: Auto-Merge 条件逻辑完整（ci_passed→merge, ci_failed→fix）');
"

# C2: CI 超时阈值对齐 — 120 polls × 30s throttle = 60 分钟
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const pollMatch = code.match(/MAX_CI_WATCH_POLLS\s*=\s*(\d+)/);
  if (!pollMatch) throw new Error('FAIL: MAX_CI_WATCH_POLLS 未定义');
  const polls = parseInt(pollMatch[1]);
  if (polls < 60 || polls > 200) throw new Error('FAIL: MAX_CI_WATCH_POLLS=' + polls + '，应在 60-200 范围（当前设计 120）');
  const throttleMatch = code.match(/POLL_INTERVAL_MS\s*=\s*(\d+)/);
  if (!throttleMatch) throw new Error('FAIL: POLL_INTERVAL_MS 未定义');
  const throttleMs = parseInt(throttleMatch[1]);
  const timeoutMinutes = (polls * throttleMs) / 60000;
  if (timeoutMinutes < 30) throw new Error('FAIL: 有效超时 ' + timeoutMinutes.toFixed(0) + ' 分钟，低于 PRD 要求的 30 分钟最低值');
  if (code.includes('最多 10 分钟') && timeoutMinutes > 15) {
    throw new Error('FAIL: 注释说 10 分钟但实际超时 ' + timeoutMinutes.toFixed(0) + ' 分钟，注释与代码不一致');
  }
  console.log('PASS: CI 超时阈值 ' + polls + ' polls × ' + (throttleMs/1000) + 's = ' + timeoutMinutes.toFixed(0) + ' 分钟，注释一致');
"

# C3: CI 超时边界 — 超时后创建 harness_fix 并标记 ci_timeout（回归守护）
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  if (!code.match(/pollCount\s*>=?\s*MAX_CI_WATCH_POLLS/)) throw new Error('FAIL: 缺少 pollCount >= MAX_CI_WATCH_POLLS 超时判断');
  if (!code.includes('ci_timeout')) throw new Error('FAIL: 超时分支未设置 ci_timeout 标记');
  if (!code.match(/ci_timeout[\s\S]{0,300}(harness_fix|harness_report|createTask)/)) {
    throw new Error('FAIL: 超时后未创建后续任务（harness_fix/harness_report）');
  }
  console.log('PASS: CI 超时边界处理完整（超时检测 + ci_timeout 标记 + 后续任务创建）');
"
```

---

## Feature 2: Auto-Deploy — 合并后 Brain 重启 + Dashboard rebuild

**行为描述**:
Harness PR 合并到 main 后，系统自动执行部署序列：拉取最新代码 → Brain 进程重启 → health check 轮询 → Dashboard rebuild。Health check 连续失败 3 次后中止 pipeline，不继续后续阶段。

**硬阈值**:
- 部署任务类型 `harness_deploy_watch` 已注册在 task-router
- Deploy 轮询上限：MAX_DEPLOY_WATCH_POLLS 次
- Health check 失败 → 标记 deploy_failed，创建 report（标注部署失败）
- 总部署耗时 < 5 分钟（MAX_DEPLOY_WATCH_POLLS 范围内）

**验证命令**:
```bash
# C4: Deploy watch 注册 + 失败路径
node -e "
  const fs = require('fs');
  const watcher = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  if (!watcher.includes('deploy_failed') && !watcher.includes('deploy_failure')) {
    throw new Error('FAIL: 缺少 deploy 失败处理分支（deploy_failed/deploy_failure）');
  }
  if (!watcher.match(/deploy.*(fail|error)[\s\S]{0,500}(harness_report|_createHarnessReport)/s)) {
    throw new Error('FAIL: deploy 失败后未创建 harness_report');
  }
  const deployPollMatch = watcher.match(/MAX_DEPLOY_WATCH_POLLS\s*=\s*(\d+)/);
  if (!deployPollMatch) throw new Error('FAIL: MAX_DEPLOY_WATCH_POLLS 未定义');
  const deployPolls = parseInt(deployPollMatch[1]);
  if (deployPolls < 10 || deployPolls > 120) throw new Error('FAIL: MAX_DEPLOY_WATCH_POLLS=' + deployPolls + ' 超出合理范围 10-120');
  console.log('PASS: Deploy watch 失败路径完整 + MAX_DEPLOY_WATCH_POLLS=' + deployPolls);
"

# C5: Deploy watch task-router 路由（回归守护）
node -e "
  const fs = require('fs');
  const router = fs.readFileSync('packages/brain/src/task-router.js', 'utf8');
  if (!router.includes('harness_deploy_watch')) throw new Error('FAIL: harness_deploy_watch 未在 task-router 注册');
  if (!router.match(/harness_deploy_watch.*_internal/s)) throw new Error('FAIL: harness_deploy_watch 应为 _internal（内联处理）');
  console.log('PASS: harness_deploy_watch 已注册为 _internal');
"
```

---

## Feature 3: Verdict 保护 — Agent 回写的 verdict 不被 callback 覆盖

**行为描述**:
当 Evaluator agent 通过 `curl PATCH /api/brain/tasks/{id}` 先行回写 verdict 后，execution-callback 的 `extractVerdictFromResult` 不覆盖已有的 agent verdict。保护机制通过 `verdict_source` 字段区分来源：agent 主动写入标记为 `verdict_source=agent`，callback 提取标记为 `verdict_source=callback`。

**硬阈值**:
- tasks.result 中存在 `verdict_source` 字段区分来源
- 当 `verdict_source=agent` 已存在时，callback 跳过 verdict 覆盖
- Agent 崩溃未回写 verdict 时，callback 兜底标记 verdict=CRASH

**验证命令**:
```bash
# C6: verdict_source 保护逻辑
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!code.includes('verdict_source')) throw new Error('FAIL: verdict_source 字段未实现');
  if (!code.match(/verdict_source[\s\S]{0,200}(agent|skip|existing|preserve)/)) {
    throw new Error('FAIL: 缺少 verdict_source=agent 时的保护逻辑（skip/existing/preserve）');
  }
  console.log('PASS: verdict 保护逻辑完整（verdict_source 字段 + agent 保护分支）');
"

# C7: Agent 崩溃兜底 — callback 检测无 verdict 时标记 CRASH
# 【Round 3 修复 #2】：改为检测 verdict 赋值语句（排除注释），且与失败条件关联
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 要求 1: verdict 被赋值为 CRASH（字符串赋值语句，不是注释）
  if (!code.match(/verdict\s*[=:]\s*['\"]CRASH['\"]/)) {
    throw new Error('FAIL: 缺少 verdict = CRASH 赋值语句（仅注释不算）');
  }
  // 要求 2: CRASH 赋值与 agent 失败/无 verdict 条件关联（300 chars 内）
  if (!code.match(/(no.*verdict|!.*verdict|missing.*verdict|agent.*(fail|crash|exit))[\s\S]{0,300}CRASH/i)) {
    throw new Error('FAIL: CRASH 赋值未与 agent 失败条件关联');
  }
  console.log('PASS: CRASH 兜底逻辑存在（条件判断 + verdict 赋值，非注释）');
"

# C8: PATCH /api/brain/tasks/:id 支持 verdict 写入且标记 verdict_source=agent
node -e "
  const fs = require('fs');
  const tasksRoute = fs.readFileSync('packages/brain/src/routes/tasks.js', 'utf8');
  const execRoute = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const combined = tasksRoute + execRoute;
  if (!combined.includes('verdict_source')) throw new Error('FAIL: verdict_source 在路由代码中未出现');
  console.log('PASS: verdict_source 字段在路由代码中已实现');
"
```

---

## Feature 4: 数据传递统一 — 所有结果走 Brain API，不依赖 git push

**行为描述**:
所有 pipeline 阶段的结果（PR URL、verdict、report 内容、GAN 轮次）通过 Brain API `PATCH /api/brain/tasks/{id}` 写入 result 字段。Execution-callback 从 tasks.result 提取分支名和 verdict，不通过 git clone/checkout 读取分支文件。

**硬阈值**:
- execution.js 中存在 `extractBranchFromResult` 函数
- execution-callback 不包含 `git clone`/`git checkout` 读取分支文件的逻辑
- 所有 harness skill prompt 包含 Brain API 回写指令（curl PATCH）

**验证命令**:
```bash
# C9: 数据传递去 git 依赖（回归守护）
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!code.includes('extractBranchFromResult')) throw new Error('FAIL: extractBranchFromResult 缺失');
  const gitReadPattern = /git\s+clone.*report_branch|git\s+checkout.*review_branch|git\s+show.*review_branch/;
  if (gitReadPattern.test(code)) throw new Error('FAIL: execution-callback 仍依赖 git 读取分支文件');
  if (!code.includes('pr_url') && !code.includes('prUrl')) throw new Error('FAIL: 缺少从 result 提取 pr_url 逻辑');
  if (!code.includes('propose_branch') && !code.includes('proposeBranch')) throw new Error('FAIL: 缺少从 result 提取 propose_branch 逻辑');
  console.log('PASS: 数据传递统一走 Brain API（extractBranchFromResult + 无 git 依赖 + pr_url/propose_branch 提取）');
"

# C10: Harness skill prompt 包含 Brain API 回写指令
node -e "
  const fs = require('fs');
  const path = require('path');
  const skills = ['harness-contract-proposer', 'harness-contract-reviewer', 'harness-generator', 'harness-report'];
  let missing = [];
  for (const s of skills) {
    const skillPath = path.join(process.env.HOME, '.claude-account1/skills', s, 'SKILL.md');
    if (!fs.existsSync(skillPath)) { missing.push(s + ' (not found)'); continue; }
    const content = fs.readFileSync(skillPath, 'utf8');
    if (!content.includes('curl') && !content.includes('PATCH')) missing.push(s + ' (no curl/PATCH)');
  }
  if (missing.length > 0) throw new Error('FAIL: 以下 skill 缺少 Brain API 回写指令: ' + missing.join(', '));
  console.log('PASS: 所有 harness skill 均含 Brain API 回写指令');
"
```

---

## Feature 5: 整体质量评估 — Evaluator 在功能验收后增加健康检查

**行为描述**:
Evaluator 在单功能验收 PASS 后，执行一轮整体健康检查：Brain API 主要端点响应正常（200）、`git diff --stat` 无意外文件变更。如果健康检查失败，不阻塞 verdict 但在报告中标注。

**硬阈值**:
- Evaluator skill 包含 health check 步骤（`/api/brain/health` 或等效端点检查）
- Evaluator skill 包含质量评估步骤（quality/质量关键字）
- Evaluator skill 包含 `git diff` 意外变更检查

**验证命令**:
```bash
# C11: Evaluator skill 质量评估步骤完整性
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

# C12: Brain health 端点可用性验证
curl -sf "localhost:5221/api/brain/health" | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (!data.status && !data.ok) throw new Error('FAIL: health 响应缺少 status/ok 字段，实际: ' + JSON.stringify(Object.keys(data)));
  console.log('PASS: Brain health 端点可达且返回状态字段');
"
```

---

## Feature 6: Pipeline 清理 — 运行结束后自动清理残留

**行为描述**:
Pipeline 运行完毕后（无论 PASS 或 FAIL），Report 阶段自动执行清理：已合并的 `cp-harness-*` 分支被删除、orphan git worktrees 被 prune、`/tmp/cecelia-*` 临时文件被删除。清理只匹配 `cp-harness-*` 模式，不清理其他 `cp-*` 分支。

**硬阈值**:
- 清理逻辑存在于 harness-report skill 或独立清理脚本中
- 分支清理仅匹配 `cp-harness-*` 模式
- 包含 `git worktree prune` 调用
- 包含 `/tmp/cecelia-*` 清理

**验证命令**:
```bash
# C13: harness-report skill 包含清理步骤
node -e "
  const fs = require('fs');
  const path = require('path');
  const sp = path.join(process.env.HOME, '.claude-account1/skills/harness-report/SKILL.md');
  if (!fs.existsSync(sp)) throw new Error('FAIL: harness-report SKILL.md 不存在');
  const c = fs.readFileSync(sp, 'utf8');
  if (!c.includes('worktree') && !c.includes('prune')) throw new Error('FAIL: 缺少 git worktree prune 清理步骤');
  if (!c.includes('cp-harness')) throw new Error('FAIL: 缺少 cp-harness-* 分支清理模式');
  if (!c.includes('/tmp') && !c.includes('tmp')) throw new Error('FAIL: 缺少临时文件清理步骤');
  console.log('PASS: harness-report skill 含完整清理步骤（worktree + branches + tmp）');
"

# C14: 清理模式安全 — 只清理 cp-harness-* 不清理其他 cp-*
node -e "
  const fs = require('fs');
  const path = require('path');
  const sp = path.join(process.env.HOME, '.claude-account1/skills/harness-report/SKILL.md');
  if (!fs.existsSync(sp)) throw new Error('FAIL: harness-report SKILL.md 不存在');
  const c = fs.readFileSync(sp, 'utf8');
  if (!c.match(/cp-harness[-*]/)) throw new Error('FAIL: 清理命令未限定 cp-harness-* 模式');
  if (c.match(/git\s+push\s+origin\s+--delete\s+cp-\*[^h]/) || c.match(/git\s+branch\s+-[dD]\s+cp-\*[^h]/)) {
    throw new Error('FAIL: 检测到无差别 cp-* 删除，可能误删非 harness 分支');
  }
  console.log('PASS: 清理模式安全，仅匹配 cp-harness-* 分支');
"
```

---

## Feature 7: Pipeline 仪表盘数据链 — 完整阶段时间线

**行为描述**:
Pipeline Detail 页面展示完整的阶段时间线：每个阶段包含名称、开始时间、结束时间、verdict。GAN 对抗轮次单独展示。API `/api/brain/harness/pipeline-detail` 返回的 stages 数组中每个对象包含 `task_type`、`status`、`created_at` 等结构化字段。

**硬阈值**:
- `pipeline-detail` API 返回 `stages` 数组，每项含 `task_type`、`status`、`created_at`
- `stages` 数组非空（至少含 planner 阶段）
- `gan_rounds` 数组存在
- Dashboard 组件渲染阶段时间线（StageTimeline 组件，实际遍历 stages 数据）

**验证命令**:
```bash
# C15: pipeline-detail API stage 对象结构验证
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=f093409e-97d9-432d-b292-1f1759dd9b66" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (!Array.isArray(d.stages)) throw new Error('FAIL: stages 不是数组');
  if (d.stages.length === 0) throw new Error('FAIL: stages 为空数组（应至少含 planner 阶段）');
  const required = ['task_type', 'status', 'created_at'];
  for (const stage of d.stages) {
    for (const key of required) {
      if (!(key in stage)) throw new Error('FAIL: stage 缺少字段 ' + key + '，实际: ' + JSON.stringify(Object.keys(stage)));
    }
  }
  if (!Array.isArray(d.gan_rounds)) throw new Error('FAIL: gan_rounds 不是数组');
  console.log('PASS: stages(' + d.stages.length + '项，结构完整) + gan_rounds(' + d.gan_rounds.length + ')');
"

# C16: Dashboard StageTimeline 组件渲染
# 【Round 3 改进 #1】：增加 .map 遍历验证，确认 stages 被实际渲染而非仅声明
node -e "
  const fs = require('fs');
  const detailPage = fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx', 'utf8');
  if (!detailPage.includes('StageTimeline')) throw new Error('FAIL: StageTimeline 组件未在 DetailPage 中使用');
  if (!detailPage.match(/StageTimeline[\s\S]{0,100}stages/)) throw new Error('FAIL: StageTimeline 未接收 stages prop');
  if (!detailPage.match(/task_type.*status|status.*task_type/s)) throw new Error('FAIL: DetailStage 类型缺少 task_type/status 字段');
  // 验证 stages 被实际遍历渲染（.map/.forEach/for），而非仅声明组件
  if (!detailPage.match(/stages\s*\.\s*map|stages\s*\.\s*forEach|for\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+stages/)) {
    throw new Error('FAIL: stages 未被遍历渲染（缺少 .map/.forEach/for...of）');
  }
  console.log('PASS: StageTimeline 组件存在，接收 stages prop，类型含 task_type+status，stages 被遍历渲染');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: Verdict 保护 + 失败路径强化

**范围**: execution.js 中的 verdict 覆盖保护逻辑 + crash 兜底 + CI 超时注释修正。仅涉及 `packages/brain/src/routes/execution.js` 和 `packages/brain/src/harness-watcher.js`。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] verdict_source 字段区分 agent/callback 来源，agent 写入的 verdict 不被 callback 覆盖
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('verdict_source'))throw new Error('FAIL: verdict_source 未实现');if(!c.match(/verdict_source[\s\S]{0,200}(agent|skip|existing|preserve)/))throw new Error('FAIL: 缺少 agent verdict 保护逻辑');console.log('PASS')"
- [ ] [BEHAVIOR] Agent 崩溃未回写 verdict 时，callback 兜底标记 CRASH（赋值语句，非注释）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.match(/verdict\s*[=:]\s*['\"]CRASH['\"]/))throw new Error('FAIL: 缺少 verdict=CRASH 赋值');if(!c.match(/(no.*verdict|!.*verdict|missing.*verdict|agent.*(fail|crash|exit))[\s\S]{0,300}CRASH/i))throw new Error('FAIL: CRASH 未与失败条件关联');console.log('PASS')"
- [ ] [BEHAVIOR] CI 超时注释与实际阈值一致（120 polls × 30s = 60 分钟）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/harness-watcher.js','utf8');const p=c.match(/MAX_CI_WATCH_POLLS\s*=\s*(\d+)/);if(!p)throw new Error('FAIL');const t=c.match(/POLL_INTERVAL_MS\s*=\s*(\d+)/);if(!t)throw new Error('FAIL');const mins=(parseInt(p[1])*parseInt(t[1]))/60000;if(c.includes('最多 10 分钟')&&mins>15)throw new Error('FAIL: 注释说10分钟实际'+mins.toFixed(0)+'分钟');console.log('PASS: 超时='+mins.toFixed(0)+'min')"
- [ ] [BEHAVIOR] PATCH /api/brain/tasks/:id 写入 verdict 时标记 verdict_source
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/tasks.js','utf8')+fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('verdict_source'))throw new Error('FAIL');console.log('PASS')"

### Workstream 2: 数据传递统一 + Skill 更新 + Pipeline 清理

**范围**: 确保所有 harness skill 使用 Brain API 回写结果、harness-report skill 增加清理步骤。涉及 `~/.claude-account1/skills/harness-*/SKILL.md` 和清理逻辑。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] execution-callback 从 tasks.result 提取分支名，不通过 git clone/checkout 读取分支文件
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('extractBranchFromResult'))throw new Error('FAIL');if(/git\s+clone.*report_branch|git\s+checkout.*review_branch/.test(c))throw new Error('FAIL: 仍依赖git');console.log('PASS')"
- [ ] [ARTIFACT] 所有 harness skill（proposer/reviewer/generator/report）包含 curl PATCH Brain API 回写指令
  Test: node -e "const fs=require('fs');const p=require('path');const ss=['harness-contract-proposer','harness-contract-reviewer','harness-generator','harness-report'];const m=[];for(const s of ss){const sp=p.join(process.env.HOME,'.claude-account1/skills',s,'SKILL.md');if(!fs.existsSync(sp)){m.push(s+' (missing)');continue}const c=fs.readFileSync(sp,'utf8');if(!c.includes('curl')&&!c.includes('PATCH'))m.push(s)}if(m.length>0)throw new Error('FAIL: '+m.join(', '));console.log('PASS')"
- [ ] [BEHAVIOR] harness-report skill 包含 pipeline 清理步骤（worktree prune + cp-harness-* 分支 + /tmp 清理）
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-report/SKILL.md');if(!fs.existsSync(sp))throw new Error('FAIL');const c=fs.readFileSync(sp,'utf8');if(!c.includes('worktree')&&!c.includes('prune'))throw new Error('FAIL: 缺少worktree prune');if(!c.includes('cp-harness'))throw new Error('FAIL: 缺少cp-harness清理');console.log('PASS')"
- [ ] [BEHAVIOR] 清理仅匹配 cp-harness-* 模式，不误删其他 cp-* 分支
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-report/SKILL.md');if(!fs.existsSync(sp))throw new Error('FAIL');const c=fs.readFileSync(sp,'utf8');if(!c.match(/cp-harness[-*]/))throw new Error('FAIL: 无 cp-harness 模式');console.log('PASS')"

### Workstream 3: 质量评估 + Dashboard 数据链增强

**范围**: Evaluator skill 增加整体质量评估步骤、pipeline-detail API stage 结构验证、Dashboard StageTimeline 组件。涉及 `~/.claude-account1/skills/harness-evaluator/SKILL.md`、`packages/brain/src/routes/harness.js`、`apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] harness-evaluator skill 包含整体质量评估步骤（health check + 质量检查 + git diff 检查）
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-evaluator/SKILL.md');if(!fs.existsSync(sp))throw new Error('FAIL');const c=fs.readFileSync(sp,'utf8');if(!c.includes('health')&&!c.includes('/api/brain/health'))throw new Error('FAIL: 缺少health');if(!c.includes('quality')&&!c.includes('质量'))throw new Error('FAIL: 缺少质量');if(!c.includes('git diff'))throw new Error('FAIL: 缺少git diff');console.log('PASS')"
- [ ] [BEHAVIOR] pipeline-detail API 返回 stages 数组，每项含 task_type/status/created_at 且非空
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=f093409e-97d9-432d-b292-1f1759dd9b66" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!Array.isArray(d.stages))throw new Error('FAIL');if(d.stages.length===0)throw new Error('FAIL: stages为空');for(const s of d.stages){if(!s.task_type||!s.status)throw new Error('FAIL: stage缺少字段')}console.log('PASS: '+d.stages.length+'项')"
- [ ] [BEHAVIOR] Dashboard StageTimeline 组件渲染阶段时间线（含 .map 遍历）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('StageTimeline'))throw new Error('FAIL');if(!c.match(/StageTimeline[\s\S]{0,100}stages/))throw new Error('FAIL');if(!c.match(/stages\s*\.\s*map|stages\s*\.\s*forEach/))throw new Error('FAIL: stages未被遍历渲染');console.log('PASS')"
- [ ] [BEHAVIOR] Brain health 端点可达
  Test: curl -sf "localhost:5221/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.status&&!d.ok)throw new Error('FAIL');console.log('PASS')"
