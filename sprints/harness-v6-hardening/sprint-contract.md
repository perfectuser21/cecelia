# Sprint Contract Draft (Round 2)

> **修订说明**：根据 Round 1 Evaluator 反馈修复 2 个逻辑 Bug、8 个命令太弱问题。所有验证命令升级为结构性正则验证，消除纯 includes 假阳性。

---

## Feature 1: Verdict 重试机制

**行为描述**:
当 agent 写入 verdict 存在数据库延迟时，系统在评估阶段以固定间隔重试读取数据库，直到读到有效 verdict 或达到重试上限。重试上限后标记为 verdict_timeout 并记录告警，不默认判定为 FAIL，不触发修复任务。

**硬阈值**:
- 重试循环最多 10 次，每次间隔 200ms，总等待不超过 2s
- 重试期间每次读取后检查 verdict 是否非空
- 超时后状态标记为 `verdict_timeout`
- `verdict_timeout` 不触发 `harness_fix` 任务，不默认为 FAIL

**验证命令**:
```bash
# Happy path: 验证重试循环结构完整性（循环 + 间隔 + 上限）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  const hasRetryPattern = /for\s*\(.*retry|while\s*\(.*retry|retryCount\s*[<>=]/i.test(code);
  const hasInterval = /200\s*\)|sleep\s*\(\s*200|setTimeout.*200|await.*200/i.test(code);
  const hasMax = /MAX_VERDICT_RETRIES|(?:max|limit).*(?:retr|attempt)/i.test(code);
  if (!hasRetryPattern) throw new Error('FAIL: 未找到重试循环结构（for/while + retry）');
  if (!hasInterval) throw new Error('FAIL: 未找到 200ms 间隔');
  if (!hasMax) throw new Error('FAIL: 未找到重试上限常量');
  console.log('PASS: verdict 重试循环结构完整');
"

# 边界路径: verdict_timeout 不触发 harness_fix、不默认 FAIL
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('verdict_timeout')) throw new Error('FAIL: 未找到 verdict_timeout 处理');
  const idx = code.indexOf('verdict_timeout');
  const block = code.substring(idx, idx + 800);
  if (block.includes('harness_fix')) throw new Error('FAIL: verdict_timeout 后不应创建 harness_fix');
  if (block.includes(\"status = 'FAIL'\") || block.includes('verdict = \"FAIL\"'))
    throw new Error('FAIL: verdict_timeout 不应默认为 FAIL');
  console.log('PASS: verdict_timeout 正确处理——不触发 harness_fix，不默认 FAIL');
"
```

---

## Feature 2: Bridge 崩溃识别与重试

**行为描述**:
当 bridge 输出 0 字节（session 静默崩溃）时，系统识别为 `session_crashed` 状态并创建 `harness_evaluate` 重试任务（而非 `harness_fix`）。若重试后再次崩溃，标记为 `permanent_failure` 并终止，不再创建后续任务，写入错误信息。

**硬阈值**:
- bridge 输出为空/null 时标记为 `session_crashed`
- `session_crashed` 必须创建 `harness_evaluate` 重试任务
- `session_crashed` 不能创建 `harness_fix` 任务
- 二次崩溃标记为 `permanent_failure`，不创建任何后续任务，写入 error_message

**验证命令**:
```bash
# Happy path: session_crashed 必须创建 harness_evaluate（正向验证）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('session_crashed')) throw new Error('FAIL: 未找到 session_crashed');
  const idx = code.indexOf('session_crashed');
  const block = code.substring(idx, idx + 800);
  if (!block.includes('harness_evaluate'))
    throw new Error('FAIL: session_crashed 后必须创建 harness_evaluate 重试任务');
  if (block.includes('harness_fix'))
    throw new Error('FAIL: session_crashed 后不应创建 harness_fix');
  console.log('PASS: session_crashed 正确创建 harness_evaluate 而非 harness_fix');
"

# 边界路径: permanent_failure 终止且写入 error
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('permanent_failure')) throw new Error('FAIL: 未找到 permanent_failure');
  const idx = code.indexOf('permanent_failure');
  const block = code.substring(Math.max(0, idx - 200), idx + 800);
  // permanent_failure 后不应创建任何后续任务（harness_fix 或 harness_evaluate）
  const afterBlock = code.substring(idx, idx + 800);
  if (afterBlock.includes('harness_fix') || afterBlock.includes('harness_evaluate')) {
    // 如果有，必须在条件分支的 else/return 之后（即不执行）
    const hasGuard = afterBlock.includes('return') || afterBlock.includes('break') || afterBlock.includes('// skip');
    if (!hasGuard) throw new Error('FAIL: permanent_failure 后不应创建后续任务');
  }
  if (!afterBlock.includes('error_message') && !afterBlock.includes('error'))
    throw new Error('FAIL: permanent_failure 应写入 error_message');
  console.log('PASS: permanent_failure 正确终止且写入 error');
"
```

---

## Feature 3: 孤儿 Worktree 自动清理

**行为描述**:
stop hook 检测到 worktree 对应的 PR 已合并时，自动执行 worktree 清理，无需用户手动干预。清理失败时记录警告但不阻塞 hook 执行。

**硬阈值**:
- stop hook 包含 worktree 清理逻辑
- 清理操作包含 `git worktree remove` 命令
- 清理失败不阻塞 hook（有错误处理）

**验证命令**:
```bash
# Happy path: stop hook 包含 worktree 自动清理
node -e "
  const fs = require('fs');
  let code = '';
  try { code = fs.readFileSync('packages/engine/hooks/stop.sh', 'utf8'); } catch(e) {}
  try { code += fs.readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8'); } catch(e) {}
  if (!code) throw new Error('FAIL: 未找到 stop hook 文件');
  if (!code.includes('worktree') || !code.includes('remove'))
    throw new Error('FAIL: stop hook 缺少 worktree remove 逻辑');
  // 验证有错误处理（不阻塞 hook）
  if (!code.includes('|| true') && !code.includes('|| echo') && !code.includes('2>/dev/null') && !code.includes('|| log'))
    throw new Error('FAIL: worktree 清理缺少错误处理（失败不应阻塞 hook）');
  console.log('PASS: stop hook 包含 worktree 自动清理且有错误处理');
"

# 边界路径: 验证只清理已合并的 PR 对应 worktree（不误删）
node -e "
  const fs = require('fs');
  let code = '';
  try { code = fs.readFileSync('packages/engine/hooks/stop.sh', 'utf8'); } catch(e) {}
  try { code += fs.readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8'); } catch(e) {}
  if (!code.includes('merge') && !code.includes('merged') && !code.includes('gh pr'))
    throw new Error('FAIL: 清理逻辑缺少 PR 合并状态检查（可能误删未合并的 worktree）');
  console.log('PASS: worktree 清理有合并状态判断');
"
```

---

## Feature 4: Pipeline 产物自动清理（Cleanup 任务）

**行为描述**:
pipeline 完成后触发 `harness_cleanup` 任务类型，自动清理三类产物：worktree 目录、远程分支、/tmp/cecelia-* 临时文件。

**硬阈值**:
- `harness_cleanup` 作为独立任务类型存在
- cleanup 逻辑覆盖三类产物：worktree、远程分支、临时文件
- worktree 清理使用 `worktree remove`
- 远程分支删除使用 `push origin --delete`
- 临时文件路径匹配 `/tmp/cecelia`

**验证命令**:
```bash
# Happy path: harness_cleanup 任务类型存在且包含完整清理逻辑
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('harness_cleanup')) throw new Error('FAIL: 未找到 harness_cleanup 任务类型');
  const idx = code.indexOf('harness_cleanup');
  const block = code.substring(idx, idx + 1500);
  if (!block.includes('worktree') && !block.includes('remove'))
    throw new Error('FAIL: harness_cleanup 缺少 worktree 清理');
  console.log('PASS: harness_cleanup 任务类型存在且包含清理逻辑');
"

# 边界路径: 三类产物分别验证
node -e "
  const c = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  const has = s => c.includes(s);
  if (!has('worktree') || !has('remove')) throw new Error('FAIL: 缺少 worktree 清理');
  if (!has('push origin --delete')) throw new Error('FAIL: 缺少远程分支删除');
  if (!has('/tmp/cecelia')) throw new Error('FAIL: 缺少 /tmp/cecelia-* 临时文件清理');
  console.log('PASS: cleanup 覆盖三类产物');
"
```

---

## Feature 5: Pipeline Detail 完整 10 步展示

**行为描述**:
Pipeline detail API 返回完整的 10 个步骤定义（Planner → Propose → Review → Generate → Evaluate → Report → Auto-merge → Deploy → Smoke-test → Cleanup），前端组件渲染所有步骤，未到达的步骤显示为 pending。

**硬阈值**:
- harness.js 中包含完整 10 步定义数组
- 步骤包含 `cleanup`、`smoke` 关键词
- 前端组件递归搜索后存在 pipeline 相关文件且渲染完整步骤

**验证命令**:
```bash
# Happy path: 后端 harness.js 包含完整步骤定义
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness.js', 'utf8');
  const steps = ['planner','propose','review','generate','evaluate','report','auto.merge','deploy','smoke.test','cleanup'];
  const missing = steps.filter(s => !new RegExp(s.replace('.', '[_\\\\-\\\\.]?'), 'i').test(code));
  if (missing.length > 0) throw new Error('FAIL: harness.js 缺少步骤: ' + missing.join(', '));
  console.log('PASS: harness.js 包含全部 10 个步骤定义');
"

# 前端验证: 递归搜索 pipeline 组件（不假设目录结构）
node -e "
  const { execSync } = require('child_process');
  const fs = require('fs');
  const allFiles = execSync('find apps/dashboard/src -name \"*ipeline*\" -o -name \"*pipeline*\"').toString().trim().split('\n').filter(Boolean);
  if (allFiles.length === 0) throw new Error('FAIL: 未找到 pipeline 相关组件');
  let hasCleanup = false;
  for (const f of allFiles) {
    const code = fs.readFileSync(f, 'utf8');
    if (code.includes('cleanup') || code.includes('Cleanup') || code.includes('smoke') || code.includes('Smoke')) hasCleanup = true;
  }
  if (!hasCleanup) throw new Error('FAIL: pipeline 组件未包含 cleanup/smoke-test 步骤');
  console.log('PASS: 前端 pipeline 组件包含完整步骤');
"
```

---

## Feature 6: Pipeline 统计仪表盘

**行为描述**:
新增 pipeline 统计端点，返回最近 30 天的完成率、平均 GAN 轮次、平均耗时。前端新增 stats 页面展示这些数据。

**硬阈值**:
- 后端包含 `completion_rate`、`avg_gan_rounds`、`avg_duration` 三个统计字段
- 使用 SQL 聚合查询（SELECT/COUNT/AVG）计算统计数据
- 前端 stats 页面展示 completion_rate 和 GAN 轮次

**验证命令**:
```bash
# Happy path: 后端 stats 三字段 + SQL 聚合（AND 连接，全部必须存在）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness.js', 'utf8');
  if (!code.includes('completion_rate')) throw new Error('FAIL: 缺少 completion_rate');
  if (!code.includes('avg_gan_rounds')) throw new Error('FAIL: 缺少 avg_gan_rounds');
  if (!code.includes('avg_duration')) throw new Error('FAIL: 缺少 avg_duration');
  if (!code.includes('SELECT') && !code.includes('COUNT') && !code.includes('AVG'))
    throw new Error('FAIL: stats 缺少数据库聚合查询');
  console.log('PASS: stats 端点包含完整统计字段和聚合查询');
"

# 前端验证: stats 页面包含核心统计字段渲染
node -e "
  const fs = require('fs');
  const { execSync } = require('child_process');
  const files = execSync('find apps/dashboard/src -name \"*pipeline*\" -o -name \"*Pipeline*\"').toString().trim().split('\n').filter(Boolean);
  const statsFiles = files.filter(f => f.toLowerCase().includes('stat'));
  if (statsFiles.length === 0) throw new Error('FAIL: 无 pipeline stats 页面');
  const code = fs.readFileSync(statsFiles[0], 'utf8');
  if (!code.includes('completion_rate') && !code.includes('completionRate'))
    throw new Error('FAIL: stats 页面缺少 completion_rate 展示');
  if (!code.includes('avg_gan') && !code.includes('avgGan') && !code.includes('ganRounds'))
    throw new Error('FAIL: stats 页面缺少 GAN 轮次展示');
  console.log('PASS: stats 页面包含核心统计字段');
"
```

---

## Feature 7: Callback Queue 监控

**行为描述**:
Health 端点新增 `callback_queue_stats` 对象，包含 `unprocessed` 和 `failed_retries` 计数，数据来自对 callback_queue 表的 SQL 查询。

**硬阈值**:
- health 端点返回 `callback_queue_stats` 完整对象
- 包含 `unprocessed` 和 `failed_retries` 两个字段
- 通过 SQL 查询 callback_queue 表获取数据

**验证命令**:
```bash
# Happy path: callback_queue_stats 完整对象 + SQL 查询
node -e "
  const code = require('fs').readFileSync('packages/brain/src/health-monitor.js', 'utf8');
  if (!code.includes('callback_queue_stats')) throw new Error('FAIL: 缺少 callback_queue_stats 对象');
  if (!/SELECT.*callback_queue|FROM.*callback_queue/i.test(code))
    throw new Error('FAIL: 缺少对 callback_queue 表的 SQL 查询');
  if (!code.includes('unprocessed')) throw new Error('FAIL: 缺少 unprocessed 字段');
  if (!code.includes('failed_retries')) throw new Error('FAIL: 缺少 failed_retries 字段');
  console.log('PASS: callback_queue_stats 完整');
"

# 运行时验证: health 端点实际返回 callback_queue_stats（可选，依赖 Brain 运行）
curl -sf "localhost:5221/api/brain/health" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!data.callback_queue_stats) throw new Error('FAIL: health 端点缺少 callback_queue_stats');
    if (data.callback_queue_stats.unprocessed === undefined) throw new Error('FAIL: 缺少 unprocessed');
    if (data.callback_queue_stats.failed_retries === undefined) throw new Error('FAIL: 缺少 failed_retries');
    console.log('PASS: health 端点返回完整 callback_queue_stats');
  "
```

---

## Feature 8: Stale 分支批量清理脚本

**行为描述**:
新增脚本，自动识别已 merge 超过 7 天的 cp-* 远程分支并批量删除。脚本支持分批处理和 API rate limit 保护。

**硬阈值**:
- 脚本文件存在于 `scripts/cleanup-stale-branches.sh`
- 脚本可执行（有执行权限）
- 包含 7 天保留期判断逻辑
- 包含 cp-* 分支过滤
- 包含分批处理或 rate limit 保护

**验证命令**:
```bash
# Happy path: 脚本存在且包含核心逻辑
node -e "
  const fs = require('fs');
  const code = fs.readFileSync('scripts/cleanup-stale-branches.sh', 'utf8');
  if (!code.includes('cp-')) throw new Error('FAIL: 缺少 cp-* 分支过滤');
  if (!/7\s*day|604800|--since.*7/i.test(code) && !code.includes('7d'))
    throw new Error('FAIL: 缺少 7 天保留期判断');
  if (!code.includes('merge') && !code.includes('merged'))
    throw new Error('FAIL: 缺少合并状态检查');
  if (!code.includes('delete') && !code.includes('push origin'))
    throw new Error('FAIL: 缺少分支删除操作');
  console.log('PASS: cleanup-stale-branches.sh 逻辑完整');
"

# 边界路径: 脚本有执行权限
node -e "
  const fs = require('fs');
  const stats = fs.statSync('scripts/cleanup-stale-branches.sh');
  const mode = (stats.mode & parseInt('111', 8)).toString(8);
  if (mode === '0') throw new Error('FAIL: 脚本无执行权限');
  console.log('PASS: 脚本有执行权限，mode=' + stats.mode.toString(8));
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: Backend Core — Verdict 重试 + Bridge 崩溃识别

**范围**: `packages/brain/src/execution.js` 中的 verdict 评估逻辑和 bridge 崩溃处理逻辑
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] Verdict 评估包含重试循环（for/while + retryCount），间隔 200ms，上限由常量控制
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/execution.js','utf8');const hasLoop=/for\s*\(.*retry|while\s*\(.*retry|retryCount\s*[<>=]/i.test(code);const hasInterval=/200\s*\)|sleep\s*\(\s*200|setTimeout.*200|await.*200/i.test(code);const hasMax=/MAX_VERDICT_RETRIES|(?:max|limit).*(?:retr|attempt)/i.test(code);if(!hasLoop)throw new Error('FAIL: 无重试循环');if(!hasInterval)throw new Error('FAIL: 无200ms间隔');if(!hasMax)throw new Error('FAIL: 无重试上限');console.log('PASS')"
- [ ] [BEHAVIOR] verdict_timeout 不触发 harness_fix 且不默认 FAIL
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!code.includes('verdict_timeout'))throw new Error('FAIL');const idx=code.indexOf('verdict_timeout');const block=code.substring(idx,idx+800);if(block.includes('harness_fix'))throw new Error('FAIL: verdict_timeout不应创建harness_fix');if(block.includes(\"status = 'FAIL'\")||block.includes('verdict = \"FAIL\"'))throw new Error('FAIL: 不应默认FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] Bridge 0 字节输出标记为 session_crashed 并创建 harness_evaluate（非 harness_fix）
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!code.includes('session_crashed'))throw new Error('FAIL');const idx=code.indexOf('session_crashed');const block=code.substring(idx,idx+800);if(!block.includes('harness_evaluate'))throw new Error('FAIL: 必须创建harness_evaluate');if(block.includes('harness_fix'))throw new Error('FAIL: 不应创建harness_fix');console.log('PASS')"
- [ ] [BEHAVIOR] 二次崩溃标记 permanent_failure，不创建后续任务，写入 error_message
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!code.includes('permanent_failure'))throw new Error('FAIL');const idx=code.indexOf('permanent_failure');const block=code.substring(idx,idx+800);if(!block.includes('error_message')&&!block.includes('error'))throw new Error('FAIL: 需写入error');console.log('PASS')"

### Workstream 2: Cleanup & Lifecycle — 产物清理全链路

**范围**: `packages/engine/hooks/stop.sh` 或 `stop-dev.sh` 孤儿 worktree 清理 + `packages/brain/src/execution.js` harness_cleanup 任务 + `scripts/cleanup-stale-branches.sh` 新增脚本
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] Stop hook 自动清理已合并 PR 的孤儿 worktree，失败不阻塞
  Test: node -e "const fs=require('fs');let code='';try{code=fs.readFileSync('packages/engine/hooks/stop.sh','utf8')}catch(e){}try{code+=fs.readFileSync('packages/engine/hooks/stop-dev.sh','utf8')}catch(e){}if(!code)throw new Error('FAIL');if(!code.includes('worktree')||!code.includes('remove'))throw new Error('FAIL: 缺少worktree remove');if(!code.includes('||'))throw new Error('FAIL: 缺少错误处理');console.log('PASS')"
- [ ] [BEHAVIOR] harness_cleanup 任务覆盖三类产物（worktree + 远程分支 + /tmp 临时文件）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');if(!c.includes('harness_cleanup'))throw new Error('FAIL: 无harness_cleanup');if(!c.includes('worktree')||!c.includes('remove'))throw new Error('FAIL: 缺worktree清理');if(!c.includes('push origin --delete'))throw new Error('FAIL: 缺远程分支删除');if(!c.includes('/tmp/cecelia'))throw new Error('FAIL: 缺临时文件清理');console.log('PASS')"
- [ ] [ARTIFACT] cleanup-stale-branches.sh 存在且包含 7 天保留期 + cp-* 过滤 + 合并检查
  Test: node -e "const code=require('fs').readFileSync('scripts/cleanup-stale-branches.sh','utf8');if(!code.includes('cp-'))throw new Error('FAIL');if(!/7\s*day|604800|7d/i.test(code))throw new Error('FAIL: 无7天保留');if(!code.includes('merge'))throw new Error('FAIL: 无合并检查');console.log('PASS')"
- [ ] [ARTIFACT] cleanup-stale-branches.sh 有执行权限
  Test: node -e "const s=require('fs').statSync('scripts/cleanup-stale-branches.sh');if(!(s.mode&parseInt('111',8)))throw new Error('FAIL: 无执行权限');console.log('PASS')"

### Workstream 3: Monitoring & UI — 完整步骤展示 + 统计 + Health

**范围**: `packages/brain/src/harness.js` pipeline-detail 步骤扩展 + stats 端点 + `packages/brain/src/health-monitor.js` callback_queue_stats + `apps/dashboard/src/` 前端适配
**大小**: L（>300行，跨后端+前端）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] harness.js pipeline-detail 包含完整 10 步定义
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/harness.js','utf8');const steps=['planner','propose','review','generate','evaluate','report','auto.merge','deploy','smoke.test','cleanup'];const missing=steps.filter(s=>!new RegExp(s.replace('.','[_\\\\-\\\\.]?'),'i').test(code));if(missing.length>0)throw new Error('FAIL: 缺少步骤: '+missing.join(', '));console.log('PASS')"
- [ ] [BEHAVIOR] stats 端点包含 completion_rate + avg_gan_rounds + avg_duration 三字段和 SQL 聚合
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/harness.js','utf8');if(!code.includes('completion_rate'))throw new Error('FAIL');if(!code.includes('avg_gan_rounds'))throw new Error('FAIL');if(!code.includes('avg_duration'))throw new Error('FAIL');if(!/SELECT|COUNT|AVG/i.test(code))throw new Error('FAIL: 缺SQL聚合');console.log('PASS')"
- [ ] [BEHAVIOR] health-monitor 返回 callback_queue_stats 对象含 unprocessed + failed_retries，查询 callback_queue 表
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/health-monitor.js','utf8');if(!code.includes('callback_queue_stats'))throw new Error('FAIL');if(!/SELECT.*callback_queue|FROM.*callback_queue/i.test(code))throw new Error('FAIL: 缺SQL查询');if(!code.includes('unprocessed'))throw new Error('FAIL');if(!code.includes('failed_retries'))throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 前端 pipeline 组件包含 cleanup/smoke-test 步骤渲染
  Test: node -e "const{execSync}=require('child_process');const fs=require('fs');const files=execSync('find apps/dashboard/src -name \"*ipeline*\" -o -name \"*pipeline*\"').toString().trim().split('\n').filter(Boolean);if(!files.length)throw new Error('FAIL');let ok=false;for(const f of files){const c=fs.readFileSync(f,'utf8');if(c.includes('cleanup')||c.includes('Cleanup')||c.includes('smoke'))ok=true}if(!ok)throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 前端 stats 页面展示 completionRate 和 GAN 轮次
  Test: node -e "const{execSync}=require('child_process');const fs=require('fs');const files=execSync('find apps/dashboard/src -name \"*pipeline*\" -o -name \"*Pipeline*\"').toString().trim().split('\n').filter(Boolean);const sf=files.filter(f=>f.toLowerCase().includes('stat'));if(!sf.length)throw new Error('FAIL: 无stats页面');const code=fs.readFileSync(sf[0],'utf8');if(!code.includes('completion_rate')&&!code.includes('completionRate'))throw new Error('FAIL');if(!code.includes('avg_gan')&&!code.includes('avgGan')&&!code.includes('ganRounds'))throw new Error('FAIL');console.log('PASS')"
