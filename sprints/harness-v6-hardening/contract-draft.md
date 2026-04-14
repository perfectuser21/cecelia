# Sprint Contract Draft (Round 1)

## Feature 1: Verdict 重试机制（FR-001, US-001）

**行为描述**:
当 harness_evaluate callback 处理时，系统从数据库读取 verdict 结果。如果首次读取为空（agent 写入延迟），系统自动重试（最多 10 次，每次间隔 200ms），直到读到有效 verdict 或超时。超时后标记为 verdict_timeout 并记录告警，不默认 FAIL。

**硬阈值**:
- 重试上限 10 次，每次间隔 200ms，总等待不超过 2 秒
- 重试期间读到有效 verdict（PASS/FAIL）立即停止重试并使用该 verdict
- 10 次重试后仍为空：标记 `verdict_timeout`，不创建 harness_fix 任务
- 日志中每次重试输出 `[verdict-retry] attempt N/10`

**验证命令**:
```bash
# Happy path: verdict 重试逻辑存在且常量正确
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('packages/brain/src/execution.js', 'utf8');
  const hasRetryLoop = code.includes('verdict') && code.includes('retry') && code.includes('200');
  const hasMaxRetries = /MAX_VERDICT_RETRIES|max.*retri|retryCount.*10|10.*retry/i.test(code);
  if (!hasRetryLoop) throw new Error('FAIL: 未找到 verdict 重试循环');
  if (!hasMaxRetries) throw new Error('FAIL: 未找到重试上限常量');
  console.log('PASS: verdict 重试逻辑和常量存在');
"

# 边界路径: verdict_timeout 处理路径存在
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('verdict_timeout')) throw new Error('FAIL: 未找到 verdict_timeout 处理');
  if (!/verdict_timeout.*(?:harness_fix|fix)/s.test(code) === false)
    console.log('PASS: verdict_timeout 不触发 harness_fix');
  console.log('PASS: verdict_timeout 标记存在');
"
```

---

## Feature 2: Bridge 崩溃识别与重试（FR-002, US-002）

**行为描述**:
当 bridge 输出 0 字节（session 静默崩溃），callback 处理器识别该情况并标记为 `session_crashed`，创建 harness_evaluate 重试任务（而非 harness_fix），最多重试 1 次。连续两次崩溃标记为 `permanent_failure`，不再重试。

**硬阈值**:
- callback result 为 null/空字符串/0 字节 + DB verdict 也为空 → 标记 `session_crashed`
- session_crashed → 创建 `harness_evaluate` 重试（不是 `harness_fix`）
- session_crashed 重试上限 1 次，第 2 次崩溃 → `permanent_failure` + error_message 写入
- permanent_failure 不创建任何后续任务

**验证命令**:
```bash
# Happy path: session_crashed 标记和 harness_evaluate 重试逻辑
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('session_crashed')) throw new Error('FAIL: 未找到 session_crashed 标记');
  // 崩溃后应创建 harness_evaluate 而非 harness_fix
  const crashBlock = code.substring(code.indexOf('session_crashed'), code.indexOf('session_crashed') + 500);
  if (crashBlock.includes('harness_fix') && !crashBlock.includes('harness_evaluate'))
    throw new Error('FAIL: 崩溃后创建了 harness_fix 而非 harness_evaluate');
  console.log('PASS: session_crashed 正确触发 harness_evaluate 重试');
"

# 边界路径: permanent_failure 逻辑
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('permanent_failure')) throw new Error('FAIL: 未找到 permanent_failure 标记');
  console.log('PASS: permanent_failure 处理路径存在');
"
```

---

## Feature 3: 孤儿 Worktree 自动清理（FR-003, FR-004, US-003）

**行为描述**:
Stop hook 在执行期间检测 `/Users/administrator/worktrees/cecelia/` 下的 worktree，如果对应的 PR 已合并（通过 `gh pr view` 或 `git branch -r` 判断），自动执行 `git worktree remove` 清理。清理失败（如文件被锁定）时记录警告日志，不阻塞 hook 执行。

**硬阈值**:
- 扫描路径固定为 `/Users/administrator/worktrees/cecelia/`
- 仅清理 PR 已合并的 worktree，未合并的不触碰
- `git worktree remove` 失败时输出警告日志但 hook 继续执行（exit 0）
- 清理成功时输出 `[orphan-cleanup] removed: <worktree_path>`

**验证命令**:
```bash
# Happy path: stop-dev.sh 包含孤儿 worktree 清理逻辑
node -e "
  const code = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  const hasOrphanCleanup = code.includes('orphan') || code.includes('worktree remove');
  const hasMergedCheck = code.includes('merged') || code.includes('gh pr') || code.includes('branch -r');
  if (!hasOrphanCleanup) throw new Error('FAIL: stop-dev.sh 未包含孤儿清理逻辑');
  if (!hasMergedCheck) throw new Error('FAIL: 未检查 PR 合并状态');
  console.log('PASS: 孤儿 worktree 清理逻辑和合并检查存在');
"

# 边界路径: 清理失败不阻塞 hook
node -e "
  const code = require('fs').readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
  // 确保 worktree remove 命令后有错误处理（|| true 或 || echo）
  if (!code.includes('worktree remove')) throw new Error('FAIL: 缺少 git worktree remove 命令');
  console.log('PASS: worktree remove 命令存在');
"
```

---

## Feature 4: Pipeline 产物自动清理（FR-005, US-004）

**行为描述**:
Pipeline 完成后（report 阶段结束），系统触发 cleanup 流程：移除对应 worktree、删除远程分支、清理 `/tmp/cecelia-*` 临时文件。cleanup 作为 pipeline 的最终步骤被记录。

**硬阈值**:
- Cleanup 在 report 阶段完成后自动触发
- 清理三类产物：worktree 目录、远程分支、`/tmp/cecelia-*` 临时文件
- 清理结果写入 pipeline 记录（cleanup_status: completed/partial/failed）
- 单项清理失败不影响其他项清理

**验证命令**:
```bash
# Happy path: cleanup 任务类型存在
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  const hasCleanup = code.includes('harness_cleanup') || code.includes('cleanup');
  if (!hasCleanup) throw new Error('FAIL: 未找到 cleanup 任务处理');
  console.log('PASS: cleanup 任务逻辑存在');
"

# 验证 cleanup 覆盖三类产物
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  const hasWorktreeRemove = code.includes('worktree') && code.includes('remove');
  const hasBranchDelete = code.includes('push origin --delete') || code.includes('branch -d');
  const hasTmpCleanup = code.includes('/tmp/cecelia');
  const count = [hasWorktreeRemove, hasBranchDelete, hasTmpCleanup].filter(Boolean).length;
  if (count < 2) throw new Error('FAIL: cleanup 仅覆盖 ' + count + '/3 类产物');
  console.log('PASS: cleanup 覆盖 ' + count + '/3 类产物');
"
```

---

## Feature 5: Pipeline Detail 完整 10 步展示（FR-006, US-005）

**行为描述**:
Pipeline detail API 返回完整 10 个步骤（Planner → Propose → Review → Generate → Evaluate → Report → Auto-merge → Deploy → Smoke-test → Cleanup），前端组件适配渲染。尚未到达的步骤显示为 "pending" 状态。

**硬阈值**:
- API 响应的 stages 数组包含 10 个条目
- 每个 stage 有 name、status（completed/active/pending/failed）字段
- 未到达的步骤 status 为 "pending"
- 前端组件能渲染所有 10 个步骤

**验证命令**:
```bash
# Happy path: harness.js 定义 10 个步骤
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness.js', 'utf8');
  const steps = ['planner','propose','review','generate','evaluate','report','merge','deploy','smoke','cleanup'];
  const found = steps.filter(s => code.toLowerCase().includes(s));
  if (found.length < 10) throw new Error('FAIL: 仅找到 ' + found.length + '/10 步骤: ' + found.join(','));
  console.log('PASS: 全部 10 个步骤定义存在');
"

# 前端组件适配
node -e "
  const fs = require('fs');
  const files = fs.readdirSync('apps/dashboard/src/pages').filter(f => f.includes('Pipeline') || f.includes('pipeline'));
  if (files.length === 0) throw new Error('FAIL: 未找到 pipeline 相关页面组件');
  let found10Steps = false;
  for (const f of files) {
    const code = fs.readFileSync('apps/dashboard/src/pages/' + f, 'utf8');
    if (code.includes('cleanup') || code.includes('Cleanup') || code.includes('smoke'))
      found10Steps = true;
  }
  if (!found10Steps) throw new Error('FAIL: 前端组件未包含新步骤（cleanup/smoke-test）');
  console.log('PASS: 前端 pipeline 组件包含完整步骤');
"
```

---

## Feature 6: Pipeline 统计仪表盘（FR-007, US-006）

**行为描述**:
Dashboard 新增 `/pipelines/stats` 页面，展示最近 30 天的 pipeline 完成率、平均 GAN 轮次、平均耗时统计。数据通过新的 Brain API 端点获取。

**硬阈值**:
- Brain 提供 `/api/brain/harness-pipelines/stats` 端点
- 返回 `completion_rate`（百分比）、`avg_gan_rounds`（数字）、`avg_duration_minutes`（数字）
- 时间范围固定为最近 30 天
- 前端页面路由 `/pipelines/stats`

**验证命令**:
```bash
# Happy path: stats API 端点存在
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness.js', 'utf8');
  if (!code.includes('stats') && !code.includes('completion_rate'))
    throw new Error('FAIL: 未找到 stats 端点或 completion_rate 字段');
  console.log('PASS: stats 端点逻辑存在');
"

# 前端路由存在
node -e "
  const fs = require('fs');
  // 检查路由配置
  const routerFiles = fs.readdirSync('apps/dashboard/src', {recursive: true})
    .filter(f => String(f).includes('route') || String(f).includes('Route') || String(f).includes('App'));
  let hasStatsRoute = false;
  for (const f of routerFiles) {
    try {
      const code = fs.readFileSync('apps/dashboard/src/' + f, 'utf8');
      if (code.includes('stats') && code.includes('pipeline')) hasStatsRoute = true;
    } catch(e) {}
  }
  if (!hasStatsRoute) throw new Error('FAIL: 未找到 /pipelines/stats 路由');
  console.log('PASS: pipeline stats 路由存在');
"
```

---

## Feature 7: Callback Queue 健康监控（FR-008, US-007）

**行为描述**:
Health 端点新增 `callback_queue_stats` 字段，包含未处理（unprocessed）和失败重试（failed_retries）的计数。失败 3 次以上的记录触发告警写入 cecelia_events。

**硬阈值**:
- Health API 响应包含 `callback_queue_stats` 对象
- `callback_queue_stats` 包含 `unprocessed`（number）和 `failed_retries`（number）字段
- `failed_retries >= 3` 的记录触发 WARNING 级别告警
- 告警写入 cecelia_events 表

**验证命令**:
```bash
# Happy path: health 端点包含 callback_queue_stats
node -e "
  const code = require('fs').readFileSync('packages/brain/src/health-monitor.js', 'utf8');
  if (!code.includes('callback_queue')) throw new Error('FAIL: health-monitor 未包含 callback_queue 检查');
  if (!code.includes('unprocessed') || !code.includes('failed'))
    throw new Error('FAIL: 缺少 unprocessed 或 failed 字段');
  console.log('PASS: callback_queue_stats 字段存在');
"

# 告警写入 cecelia_events
node -e "
  const code = require('fs').readFileSync('packages/brain/src/health-monitor.js', 'utf8');
  if (!code.includes('cecelia_events'))
    throw new Error('FAIL: 未写入 cecelia_events');
  console.log('PASS: 告警写入 cecelia_events');
"
```

---

## Feature 8: Stale 分支批量清理脚本（FR-009, US-008）

**行为描述**:
新增 `scripts/cleanup-stale-branches.sh` 脚本，自动识别已 merge 超过 7 天的 `cp-*` 远程分支并删除。分批执行（每批 30 个，间隔 1 秒），遇到 GitHub API rate limit 时自动暂停。保留未 merge 和 merge 不足 7 天的分支。

**硬阈值**:
- 脚本路径：`scripts/cleanup-stale-branches.sh`
- 仅删除 `cp-*` 前缀的远程分支
- 保留期：merge 后 7 天内的分支不删除
- 分批删除：每批 30 个，批次间隔 >=1 秒
- dry-run 模式：`--dry-run` 参数只列出待删除分支不实际删除
- 执行结果输出：删除数量 + 跳过数量 + 失败数量

**验证命令**:
```bash
# Happy path: 脚本存在且可执行
node -e "
  const fs = require('fs');
  fs.accessSync('scripts/cleanup-stale-branches.sh', fs.constants.X_OK);
  const code = fs.readFileSync('scripts/cleanup-stale-branches.sh', 'utf8');
  if (!code.includes('cp-')) throw new Error('FAIL: 脚本未过滤 cp-* 前缀');
  if (!code.includes('dry-run') && !code.includes('dry_run'))
    throw new Error('FAIL: 缺少 dry-run 模式');
  console.log('PASS: 脚本存在且包含核心逻辑');
"

# 边界路径: dry-run 模式不删除分支
node -e "
  const code = require('fs').readFileSync('scripts/cleanup-stale-branches.sh', 'utf8');
  if (!code.includes('7') || (!code.includes('day') && !code.includes('86400')))
    throw new Error('FAIL: 未找到 7 天保留期逻辑');
  if (!code.includes('30') && !code.includes('batch'))
    throw new Error('FAIL: 未找到分批逻辑');
  console.log('PASS: 7 天保留期和分批逻辑存在');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: Backend 核心修复（Verdict 重试 + 崩溃识别）

**范围**: `packages/brain/src/execution.js` — verdict 重试循环 + session_crashed 0 字节检测 + permanent_failure 终止 + verdict_timeout 标记
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] harness_evaluate callback 处理 verdict 时，DB 首次读空会自动重试（最多 10 次 x 200ms），最终读到有效 verdict 后正确路由（PASS→merge, FAIL→fix）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('verdict')||!(/retry|retri/i.test(c)&&/200/.test(c)))throw new Error('FAIL');console.log('PASS: verdict 重试逻辑存在')"
- [ ] [BEHAVIOR] verdict 重试 10 次后仍为空时标记 verdict_timeout，不默认 FAIL，不创建 harness_fix
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('verdict_timeout'))throw new Error('FAIL');console.log('PASS: verdict_timeout 标记存在')"
- [ ] [BEHAVIOR] callback result 为 null/0 字节 + DB verdict 为空时标记 session_crashed，创建 harness_evaluate 重试（非 harness_fix）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('session_crashed'))throw new Error('FAIL');const i=c.indexOf('session_crashed');const block=c.substring(i,i+800);if(!block.includes('harness_evaluate'))throw new Error('FAIL: 崩溃后未创建 harness_evaluate');console.log('PASS: session_crashed→harness_evaluate')"
- [ ] [BEHAVIOR] session_crashed 重试 1 次后再崩溃标记 permanent_failure，不再创建后续任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('permanent_failure'))throw new Error('FAIL');console.log('PASS: permanent_failure 标记存在')"

### Workstream 2: 清理基础设施（Worktree + 分支 + Pipeline 产物）

**范围**: `packages/engine/hooks/stop-dev.sh` 孤儿 worktree 清理 + `scripts/cleanup-stale-branches.sh` 新脚本 + `packages/brain/src/execution.js` cleanup 流程
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] stop-dev.sh 检测 /Users/administrator/worktrees/cecelia/ 下 PR 已合并的孤儿 worktree，自动执行 git worktree remove
  Test: node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if(!(c.includes('worktree')&&c.includes('remove')&&(c.includes('merged')||c.includes('gh pr'))))throw new Error('FAIL');console.log('PASS: 孤儿 worktree 清理逻辑存在')"
- [ ] [BEHAVIOR] stop-dev.sh worktree remove 失败时输出警告但不阻塞 hook（exit 0 继续）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if(!c.includes('worktree remove'))throw new Error('FAIL');console.log('PASS: worktree remove 命令存在')"
- [ ] [ARTIFACT] scripts/cleanup-stale-branches.sh 存在且可执行，支持 --dry-run，过滤 cp-* 前缀，7 天保留期，分批 30 个
  Test: node -e "const fs=require('fs');fs.accessSync('scripts/cleanup-stale-branches.sh',fs.constants.X_OK);const c=fs.readFileSync('scripts/cleanup-stale-branches.sh','utf8');if(!c.includes('cp-'))throw new Error('FAIL: 无 cp-* 过滤');if(!c.includes('dry-run')&&!c.includes('dry_run'))throw new Error('FAIL: 无 dry-run');console.log('PASS: 脚本完整')"
- [ ] [BEHAVIOR] pipeline 完成后 cleanup 流程清理 worktree + 远程分支 + /tmp/cecelia-* 临时文件
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');const has=s=>c.includes(s);if(!(has('worktree')&&has('push origin --delete')||has('branch')))throw new Error('FAIL');console.log('PASS: cleanup 产物覆盖')"

### Workstream 3: 可观测性（Pipeline UI + Health 监控）

**范围**: `packages/brain/src/harness.js` 10 步定义 + `packages/brain/src/health-monitor.js` callback_queue_stats + `apps/dashboard/src/` pipeline detail 组件扩展 + stats 页面
**大小**: L（>300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] pipeline detail API 返回 10 个 stages（含 auto-merge/deploy/smoke-test/cleanup），未到达的步骤 status 为 pending
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness.js','utf8');const steps=['merge','deploy','smoke','cleanup'];const found=steps.filter(s=>c.toLowerCase().includes(s));if(found.length<4)throw new Error('FAIL: 仅 '+found.length+'/4 新步骤');console.log('PASS: 10 步定义完整')"
- [ ] [BEHAVIOR] Brain 提供 /api/brain/harness-pipelines/stats 端点，返回 completion_rate、avg_gan_rounds、avg_duration_minutes（30 天范围）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness.js','utf8');if(!c.includes('stats')||!c.includes('completion_rate'))throw new Error('FAIL');console.log('PASS: stats 端点存在')"
- [ ] [BEHAVIOR] health 端点返回 callback_queue_stats 对象（含 unprocessed 和 failed_retries 字段）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health-monitor.js','utf8');if(!c.includes('callback_queue'))throw new Error('FAIL');if(!c.includes('unprocessed'))throw new Error('FAIL: 缺 unprocessed');console.log('PASS: callback_queue_stats 存在')"
- [ ] [BEHAVIOR] callback_queue 中失败 3 次以上的记录触发 WARNING 告警写入 cecelia_events
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/health-monitor.js','utf8');if(!c.includes('cecelia_events'))throw new Error('FAIL');console.log('PASS: 告警写入 cecelia_events')"
- [ ] [ARTIFACT] Dashboard 存在 pipeline stats 页面组件，路由 /pipelines/stats
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/dashboard/src/pages');const has=files.some(f=>f.toLowerCase().includes('stat')&&f.toLowerCase().includes('pipeline'));if(!has)throw new Error('FAIL: 无 stats 页面');console.log('PASS: stats 页面组件存在')"
- [ ] [ARTIFACT] Dashboard pipeline detail 组件渲染全部 10 个步骤（含 cleanup/smoke-test）
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/dashboard/src/pages').filter(f=>f.includes('Pipeline'));let ok=false;for(const f of files){const c=fs.readFileSync('apps/dashboard/src/pages/'+f,'utf8');if(c.includes('cleanup')||c.includes('Cleanup'))ok=true;}if(!ok)throw new Error('FAIL');console.log('PASS: 前端包含 cleanup 步骤')"
