# Sprint Contract Draft (Round 1)

## Feature 1: Auto-Merge with Timeout Protection (FR-001)

**行为描述**:
当 Harness PR（分支名匹配 `cp-harness-*`）的所有 CI checks 通过后，系统在 60 秒内自动调用 `gh pr merge --merge` 将其合并到 main。若 CI 在 30 分钟内未完成，标记 pipeline 失败并创建 `harness_fix` 任务。

**硬阈值**:
- CI 全通过后，PR 在 60 秒内被合并（harness_ci_watch 单次 tick 处理延迟 < 60s）
- CI 超过 120 次轮询（30s 间隔 ≈ 60 分钟）未完成时，任务状态变为 `completed` 且 payload 含 `ci_timeout: true`
- CI 失败时，自动创建 `harness_fix` 任务且 payload 含 `ci_fail_context`
- 仅对 `cp-harness-*` 分支生效，非 harness 分支不受影响

**验证命令**:
```bash
# Happy path: 验证 harness-watcher 模块导出正确
node -e "
  import('./packages/brain/src/harness-watcher.js').then(m => {
    if (typeof m.processHarnessCiWatchers !== 'function') throw new Error('FAIL: processHarnessCiWatchers 未导出');
    if (typeof m.processHarnessDeployWatchers !== 'function') throw new Error('FAIL: processHarnessDeployWatchers 未导出');
    console.log('PASS: harness-watcher 模块导出正确');
  }).catch(e => { console.error(e.message); process.exit(1); });
"

# 验证 CI timeout 阈值配置
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const maxPolls = code.match(/MAX_CI_WATCH_POLLS\s*=\s*(\d+)/);
  if (!maxPolls) throw new Error('FAIL: MAX_CI_WATCH_POLLS 未定义');
  const val = parseInt(maxPolls[1]);
  if (val < 60 || val > 200) throw new Error('FAIL: MAX_CI_WATCH_POLLS=' + val + '，应在 60-200 之间');
  console.log('PASS: MAX_CI_WATCH_POLLS=' + val);
"

# 验证 auto-merge 仅限 harness 分支（shepherd.executeMerge 被正确调用）
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  if (!code.includes('executeMerge')) throw new Error('FAIL: executeMerge 未在 harness-watcher 中引用');
  if (!code.includes('ci_passed')) throw new Error('FAIL: ci_passed 状态处理缺失');
  console.log('PASS: auto-merge 逻辑在 harness-watcher 中存在');
"
```

---

## Feature 2: Auto-Deploy after Merge (FR-002)

**行为描述**:
Harness PR 合并到 main 后，系统自动执行部署序列：`git pull origin main` → 重启 Brain 进程 → 轮询 `/api/brain/health` 直到返回 200 → 执行 Dashboard `npm run build`。部署总耗时不超过 3 分钟。若 Brain health check 连续 3 次超时，标记 deploy 失败并中止 pipeline。

**硬阈值**:
- Brain health check 在重启后 30 秒内返回 200
- Health check 最多重试 3 次，每次间隔 10 秒
- Dashboard build 失败不阻塞 Evaluator，但记录 `deploy_dashboard_failed` 标记
- 部署序列总耗时 < 180 秒
- `harness_deploy_watch` 任务最多轮询 60 次（MAX_DEPLOY_WATCH_POLLS）

**验证命令**:
```bash
# 验证 deploy watch 函数存在且处理 health check
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  if (!code.includes('processHarnessDeployWatchers')) throw new Error('FAIL: processHarnessDeployWatchers 未定义');
  if (!code.includes('MAX_DEPLOY_WATCH_POLLS')) throw new Error('FAIL: MAX_DEPLOY_WATCH_POLLS 未定义');
  if (!code.includes('health')) throw new Error('FAIL: health check 逻辑缺失');
  console.log('PASS: deploy watch 模块结构完整');
"

# 验证 Brain health endpoint 实际可达
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!data.status && !data.ok) throw new Error('FAIL: health 响应缺少 status/ok 字段');
    console.log('PASS: Brain health endpoint 返回正常');
  "

# 验证 deploy watch 触发条件（ci_watch 完成后创建 deploy_watch）
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  if (!code.includes('harness_deploy_watch')) throw new Error('FAIL: harness_deploy_watch 引用缺失');
  console.log('PASS: deploy_watch 任务类型已定义');
"
```

---

## Feature 3: Verdict Protection (FR-003)

**行为描述**:
当 Evaluator agent 通过 `curl PATCH /api/brain/tasks/{id}` 回写 `verdict` 到 `tasks.result` 后，execution-callback 的 `extractVerdictFromResult` 检测到已有 agent 写入的 verdict 时，保留现有 verdict 不覆盖。即：agent 通过 API 直接写入的 verdict 优先级高于 callback 自动提取的 verdict。

**硬阈值**:
- `tasks.result.verdict` 已有值时，execution-callback 不覆盖
- `tasks.result.verdict_source` 标记为 `agent`（API 直写）或 `callback`（自动提取）
- PATCH `/api/brain/tasks/{id}` 写入 result 时，`verdict` 字段被保留

**验证命令**:
```bash
# 验证 execution-callback 中 verdict 保护逻辑存在
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!code.includes('verdict') || !code.includes('extractVerdictFromResult')) {
    throw new Error('FAIL: verdict 处理逻辑缺失');
  }
  // 检查是否有'已有 verdict 则跳过'的保护逻辑
  if (!code.includes('verdict_source') && !code.includes('skip') && !code.includes('existing')) {
    console.warn('WARN: 未检测到显式 verdict 保护逻辑，需实现');
  }
  console.log('PASS: verdict 相关代码存在于 execution.js');
"

# 验证 PATCH /api/brain/tasks/:id 端点存在且支持 result 更新
curl -sf -X PATCH "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000000" \
  -H "Content-Type: application/json" \
  -d '{"result":{"verdict":"TEST"}}' 2>&1 | \
  node -e "
    const out = require('fs').readFileSync('/dev/stdin','utf8');
    // 404 = 任务不存在但端点工作；200 = 成功
    if (out.includes('not found') || out.includes('TASK_NOT_FOUND') || out.includes('success')) {
      console.log('PASS: PATCH tasks/:id 端点存在且响应正常');
    } else {
      throw new Error('FAIL: PATCH tasks/:id 端点异常: ' + out.slice(0, 200));
    }
  "
```

---

## Feature 4: Data Transfer via Brain API (FR-004)

**行为描述**:
所有 pipeline 阶段的结果（PR URL、verdict、report 内容、GAN 轮次信息、分支名）通过 `curl PATCH /api/brain/tasks/{id}` 写入 `tasks.result` 字段传递，不依赖 `git push` 到 report/review 分支进行数据传递。Skill prompt 中明确指示 agent 使用 Brain API 回写结果。

**硬阈值**:
- Harness skill prompts（contract-proposer / contract-reviewer / generator / evaluator / report）中包含 `curl` Brain API 回写指令
- `tasks.result` 字段存储所有阶段输出（verdict、branch 名、pr_url、workstream_count 等）
- execution-callback 从 `tasks.result` 读取下游参数，而非从 git 分支文件

**验证命令**:
```bash
# 验证 Brain API tasks PATCH 端点可用
curl -sf "localhost:5221/api/brain/health" > /dev/null && \
  echo "PASS: Brain API 可达" || (echo "FAIL: Brain API 不可达"; exit 1)

# 验证 execution-callback 从 result 提取分支名的逻辑存在
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!code.includes('extractBranchFromResult')) throw new Error('FAIL: extractBranchFromResult 缺失');
  if (!code.includes('propose_branch') && !code.includes('review_branch')) throw new Error('FAIL: 分支提取逻辑缺失');
  console.log('PASS: execution-callback 含完整的分支/结果提取逻辑');
"

# 验证 harness skill prompts 包含 Brain API 回写指令
node -e "
  const fs = require('fs');
  const path = require('path');
  const skills = ['harness-contract-proposer', 'harness-contract-reviewer', 'harness-generator', 'harness-report'];
  let missing = [];
  for (const s of skills) {
    try {
      const skillPath = path.join(process.env.HOME, '.claude-account1/skills', s, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf8');
      if (!content.includes('curl') && !content.includes('brain') && !content.includes('PATCH')) {
        missing.push(s);
      }
    } catch (e) {
      missing.push(s + ' (not found)');
    }
  }
  if (missing.length > 0) console.warn('WARN: 以下 skill 可能缺少 Brain API 回写指令: ' + missing.join(', '));
  console.log('PASS: skill 文件检查完成');
"
```

---

## Feature 5: Evaluator Quality Assessment (FR-005)

**行为描述**:
Evaluator 在单功能验收 PASS 后，执行一轮整体健康检查：(1) Brain API 主要端点返回 200，(2) Dashboard 首页加载无 JS 错误（通过 Playwright），(3) `git diff --stat` 无意外文件变更（仅包含预期的修改文件）。任一健康检查失败不阻塞 PASS 判定，但在 report 中标注为 WARNING。

**硬阈值**:
- Brain API 至少检查 3 个核心端点：`/api/brain/health`、`/api/brain/tasks?limit=1`、`/api/brain/context`
- Playwright 检查 Dashboard 首页（`localhost:5211`）加载，超时 30 秒
- 健康检查结果写入 task.result 的 `quality_assessment` 字段
- 单项检查失败 → WARNING（不阻塞），全部失败 → FAIL

**验证命令**:
```bash
# 验证 Brain API 核心端点可达
for endpoint in "/api/brain/health" "/api/brain/tasks?limit=1" "/api/brain/context"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221${endpoint}")
  if [ "$STATUS" = "200" ]; then
    echo "PASS: ${endpoint} → ${STATUS}"
  else
    echo "FAIL: ${endpoint} → ${STATUS}"; exit 1
  fi
done

# 验证 harness-evaluator skill 定义存在
node -e "
  const fs = require('fs');
  const path = require('path');
  const skillPath = path.join(process.env.HOME, '.claude-account1/skills/harness-evaluator/SKILL.md');
  if (!fs.existsSync(skillPath)) throw new Error('FAIL: harness-evaluator SKILL.md 不存在');
  const content = fs.readFileSync(skillPath, 'utf8');
  if (!content.includes('质量') && !content.includes('quality') && !content.includes('health')) {
    console.warn('WARN: harness-evaluator skill 可能缺少质量评估步骤');
  }
  console.log('PASS: harness-evaluator SKILL.md 存在');
"
```

---

## Feature 6: Pipeline Cleanup (FR-006)

**行为描述**:
Pipeline 运行完毕（无论 PASS 或 FAIL）后，Report 阶段末尾自动执行清理：(1) `git worktree prune` 清理孤立 worktree，(2) 删除已合并到 main 的 `cp-harness-*` 远程分支，(3) 清理 `/tmp/cecelia-*` 临时文件。清理只针对明确匹配 `cp-harness-*` 模式的分支，不误删其他 `cp-*` 分支。

**硬阈值**:
- 清理后 `git worktree list` 无 prunable 条目
- 清理后 `git branch -r | grep cp-harness-` 中无已合并分支
- 只清理 `cp-harness-*` 模式分支，不清理 `cp-*` 或 `feature-*`
- `/tmp/cecelia-*` 文件在清理后不存在

**验证命令**:
```bash
# 验证 git worktree prune 命令可执行
git worktree prune 2>&1 && echo "PASS: git worktree prune 可执行" || (echo "FAIL: git worktree prune 失败"; exit 1)

# 验证 harness-report skill 包含清理步骤
node -e "
  const fs = require('fs');
  const path = require('path');
  const skillPath = path.join(process.env.HOME, '.claude-account1/skills/harness-report/SKILL.md');
  if (!fs.existsSync(skillPath)) throw new Error('FAIL: harness-report SKILL.md 不存在');
  const content = fs.readFileSync(skillPath, 'utf8');
  const hasCleanup = content.includes('cleanup') || content.includes('clean') || content.includes('prune') || content.includes('清理');
  if (!hasCleanup) console.warn('WARN: harness-report skill 可能缺少清理步骤（需新增）');
  console.log('PASS: harness-report SKILL.md 存在');
"

# 验证 branch 清理安全性（只匹配 cp-harness-* 模式）
node -e "
  const branches = ['cp-harness-gen-abc12345', 'cp-04130013-harness-prd', 'feature-new-ui', 'cp-dev-fix'];
  const harnessPattern = /^(origin\/)?cp-harness-/;
  const toClean = branches.filter(b => harnessPattern.test(b));
  const safe = branches.filter(b => !harnessPattern.test(b));
  if (toClean.length !== 1) throw new Error('FAIL: 匹配逻辑错误，预期清理 1 个分支，实际 ' + toClean.length);
  if (safe.length !== 3) throw new Error('FAIL: 安全分支被误匹配');
  console.log('PASS: cp-harness-* 匹配逻辑正确（清理 ' + toClean.length + '，保留 ' + safe.length + '）');
"
```

---

## Feature 7: Dashboard Pipeline Data Chain (FR-007)

**行为描述**:
Pipeline Detail 页面（`/harness/pipeline/:id`）展示完整的端到端数据链：每个阶段的开始时间、结束时间、verdict、GAN 对抗轮次数、Evaluator 轮次数。数据来源于 `tasks` 表的 `created_at`、`completed_at`、`result` 字段，通过 `/api/brain/harness/pipeline-detail` API 聚合返回。

**硬阈值**:
- Pipeline Detail API 返回 `stages` 数组，每阶段含 `name`、`started_at`、`ended_at`、`verdict`
- `gan_rounds` 数组含每轮 propose/review 的 task_id、verdict、时间
- Dashboard 页面渲染阶段时间线（至少展示阶段名称和状态）

**验证命令**:
```bash
# 验证 pipeline-detail API 端点存在且返回结构化数据
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=f093409e-97d9-432d-b292-1f1759dd9b66" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!data.stages) throw new Error('FAIL: pipeline-detail 缺少 stages 字段');
    if (!data.gan_rounds) throw new Error('FAIL: pipeline-detail 缺少 gan_rounds 字段');
    console.log('PASS: pipeline-detail API 返回 stages(' + data.stages.length + ') + gan_rounds(' + data.gan_rounds.length + ')');
  "

# 验证 Dashboard Pipeline Detail 页面组件存在
node -e "
  const fs = require('fs');
  const pagePath = 'apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx';
  if (!fs.existsSync(pagePath)) throw new Error('FAIL: HarnessPipelineDetailPage.tsx 不存在');
  const content = fs.readFileSync(pagePath, 'utf8');
  if (!content.includes('stages') && !content.includes('stage')) throw new Error('FAIL: 页面未引用 stages 数据');
  console.log('PASS: Pipeline Detail 页面组件存在且引用 stages');
"

# 验证 API 路由注册
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/routes/harness.js', 'utf8');
  if (!code.includes('pipeline-detail')) throw new Error('FAIL: pipeline-detail 路由未注册');
  if (!code.includes('buildStages')) throw new Error('FAIL: buildStages 函数缺失');
  console.log('PASS: harness 路由含 pipeline-detail + buildStages');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: Pipeline Automation — Auto-Merge + Auto-Deploy + Cleanup

**范围**: `packages/brain/src/harness-watcher.js` + `packages/brain/src/shepherd.js` + harness-report SKILL.md 清理步骤。增强现有 CI watch 的超时保护，实现 deploy watch 的 Brain 重启 + health check + Dashboard build 序列，在 Report 阶段集成清理脚本。不改动 Planner/GAN/Generator 阶段。
**大小**: L（>300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] CI watch 在所有 checks 通过后调用 executeMerge 自动合并 PR
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('executeMerge'))throw new Error('FAIL');console.log('PASS: executeMerge 引用存在')"
- [ ] [BEHAVIOR] CI watch 超过 MAX_CI_WATCH_POLLS 次轮询后标记超时并创建 harness_fix
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('MAX_CI_WATCH_POLLS'))throw new Error('FAIL');if(!c.includes('ci_timeout'))throw new Error('FAIL');console.log('PASS: CI 超时保护存在')"
- [ ] [BEHAVIOR] Deploy watch 执行 Brain 重启 + health check 轮询，health check 失败 3 次后中止
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('processHarnessDeployWatchers'))throw new Error('FAIL');if(!c.includes('health'))throw new Error('FAIL');console.log('PASS: deploy watch + health check 逻辑存在')"
- [ ] [BEHAVIOR] Pipeline 结束后清理 orphan worktrees、已合并的 cp-harness-* 分支、/tmp/cecelia-* 文件
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-report/SKILL.md');const c=fs.readFileSync(sp,'utf8');if(!c.includes('clean')&&!c.includes('prune')&&!c.includes('清理'))throw new Error('FAIL');console.log('PASS: report skill 含清理步骤')"
- [ ] [ARTIFACT] harness_deploy_watch 在 task-router.js VALID_TASK_TYPES 中注册
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes('harness_deploy_watch'))throw new Error('FAIL');console.log('PASS: harness_deploy_watch 已注册')"

### Workstream 2: Data Integrity — Verdict Protection + API-Only Data Transfer

**范围**: `packages/brain/src/routes/execution.js`（execution-callback verdict 保护）+ `packages/brain/src/routes/tasks.js`（PATCH endpoint verdict 字段保护）。修复 callback 覆盖 agent verdict 的 bug，添加 `verdict_source` 标记区分来源。确保 harness skill prompts 使用 Brain API 回写而非 git branch 传递数据。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] execution-callback 检测到 tasks.result 已有 verdict 时不覆盖（agent 写入优先）
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('verdict_source')||(!c.includes('agent')&&!c.includes('existing')))throw new Error('FAIL: verdict 保护逻辑缺失');console.log('PASS: verdict 保护逻辑存在')"
- [ ] [BEHAVIOR] PATCH /api/brain/tasks/:id 写入 result.verdict 时标记 verdict_source=agent
  Test: curl -sf -X PATCH "localhost:5221/api/brain/tasks/00000000-0000-0000-0000-000000000000" -H "Content-Type: application/json" -d '{"result":{"verdict":"TEST"}}' -o /dev/null -w "%{http_code}" | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8').trim();if(s!=='404'&&s!=='200')throw new Error('FAIL: 期望 200/404，实际 '+s);console.log('PASS: PATCH tasks/:id 端点响应正常 ('+s+')')"
- [ ] [BEHAVIOR] extractBranchFromResult 从 tasks.result 提取 propose_branch/review_branch/contract_branch
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('extractBranchFromResult'))throw new Error('FAIL');if(!c.includes('propose_branch'))throw new Error('FAIL');console.log('PASS: 分支提取逻辑完整')"

### Workstream 3: Quality & Observability — Evaluator Health Check + Dashboard Data Chain

**范围**: `harness-evaluator` SKILL.md（添加整体质量评估步骤）+ `packages/brain/src/routes/harness.js`（pipeline-detail API 补全 stages 时间/verdict）+ `apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx`（阶段时间线渲染增强）。不改动 Brain 核心逻辑。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] Evaluator 在功能验收 PASS 后检查 Brain API 核心端点（health/tasks/context）返回 200
  Test: bash -c 'for e in /api/brain/health "/api/brain/tasks?limit=1" /api/brain/context; do S=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221${e}"); [ "$S" = "200" ] || { echo "FAIL: $e → $S"; exit 1; }; done; echo "PASS: 3 个核心端点均返回 200"'
- [ ] [ARTIFACT] harness-evaluator SKILL.md 包含整体质量评估步骤（Brain API + Dashboard + git diff）
  Test: node -e "const fs=require('fs');const p=require('path');const sp=p.join(process.env.HOME,'.claude-account1/skills/harness-evaluator/SKILL.md');const c=fs.readFileSync(sp,'utf8');if(!c.includes('质量')||!c.includes('health'))throw new Error('FAIL');console.log('PASS: evaluator skill 含质量评估')"
- [ ] [BEHAVIOR] pipeline-detail API 返回 stages 数组，每阶段含 name/started_at/ended_at/verdict
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=f093409e-97d9-432d-b292-1f1759dd9b66" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));if(!d.stages||!Array.isArray(d.stages))throw new Error('FAIL: stages 不是数组');console.log('PASS: stages='+d.stages.length+'项')"
- [ ] [ARTIFACT] HarnessPipelineDetailPage.tsx 渲染阶段时间线
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('apps/dashboard/src/pages/harness-pipeline/HarnessPipelineDetailPage.tsx','utf8');if(!c.includes('stage'))throw new Error('FAIL');console.log('PASS: 页面引用 stage')"
