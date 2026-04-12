# Sprint Contract Draft (Round 2)

> Round 1 反馈总结：验证命令全部是静态 includes() 文本匹配，在 main 分支已 PASS（无法区分已有/新实现）；缺少边界场景覆盖；无运行时验证。Round 2 全面重写验证命令。

---

## Feature 1: Generator 完成后走 CI Watch 轮询链路（而非一次性 inline 检查）

**行为描述**:
Generator（harness_generate）执行完毕并 push PR 后，系统创建 harness_ci_watch 子任务交由 Brain tick 轮询。当前代码在 execution.js 的 harness_generate 回调中做一次性 `checkPrCiStatus()` 判断然后直接创建 harness_report/harness_fix，不经过 ci_watch。本 Feature 要求：harness_generate 最后一个 WS 完成时，创建 harness_ci_watch 任务（而非 inline CI 检查），由 harness-watcher.js 的 tick 轮询处理后续（auto-merge + harness_report/harness_fix）。

**硬阈值**:
- harness_generate 最后一个 WS 的回调**不再**直接调用 `checkPrCiStatus`，改为创建 harness_ci_watch 任务
- harness_ci_watch payload 包含 `pr_url`、`sprint_dir`、`workstream_index`、`workstream_count`
- CI 超时阈值 MAX_CI_WATCH_POLLS >= 60（至少覆盖 30 分钟）
- CI 超时后任务标记为 timeout，并传递给后续链路（不中断 pipeline）

**验证命令**:
```bash
# 1. 验证 execution.js 中 harness_generate 最后 WS 不再 inline 调 checkPrCiStatus，而是创建 ci_watch
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 定位 harness_generate 最后 WS 处理段（currentWsIdx === totalWsCount 之后）
  const lastWsIdx = c.indexOf('currentWsIdx === totalWsCount');
  if (lastWsIdx === -1) { console.log('FAIL: 未找到最后 WS 判断段'); process.exit(1); }
  const lastWsSection = c.substring(lastWsIdx, lastWsIdx + 2000);
  // 不应直接调 checkPrCiStatus（旧的 inline 检查）
  if (lastWsSection.includes('checkPrCiStatus')) {
    console.log('FAIL: 最后 WS 仍在做 inline CI 检查（checkPrCiStatus），应改为创建 harness_ci_watch');
    process.exit(1);
  }
  // 应创建 harness_ci_watch
  if (!lastWsSection.includes('harness_ci_watch')) {
    console.log('FAIL: 最后 WS 未创建 harness_ci_watch 任务');
    process.exit(1);
  }
  console.log('PASS: harness_generate 最后 WS → harness_ci_watch（非 inline CI 检查）');
"

# 2. 验证 ci_watch 创建时 payload 包含必要字段
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const lastWsIdx = c.indexOf('currentWsIdx === totalWsCount');
  const section = c.substring(lastWsIdx, lastWsIdx + 2000);
  // 从 harness_ci_watch 创建调用中提取 payload 段
  const ciWatchIdx = section.indexOf('harness_ci_watch');
  if (ciWatchIdx === -1) { console.log('FAIL: 无 harness_ci_watch 创建'); process.exit(1); }
  const payloadSection = section.substring(ciWatchIdx, ciWatchIdx + 800);
  const required = ['pr_url', 'sprint_dir', 'workstream_index', 'workstream_count'];
  const missing = required.filter(f => !payloadSection.includes(f));
  if (missing.length > 0) {
    console.log('FAIL: harness_ci_watch payload 缺少字段: ' + missing.join(', '));
    process.exit(1);
  }
  console.log('PASS: ci_watch payload 包含全部必要字段');
"

# 3. 验证 MAX_CI_WATCH_POLLS >= 60（30 分钟超时保障）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const match = c.match(/MAX_CI_WATCH_POLLS\s*=\s*(\d+)/);
  if (!match) { console.log('FAIL: 未找到 MAX_CI_WATCH_POLLS 常量'); process.exit(1); }
  const val = parseInt(match[1]);
  if (val < 60) { console.log('FAIL: MAX_CI_WATCH_POLLS=' + val + '，需 >= 60'); process.exit(1); }
  console.log('PASS: MAX_CI_WATCH_POLLS=' + val);
"

# 4. 验证 CI 超时不中断链路（timeout 后仍创建后续任务）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const timeoutIdx = c.indexOf('MAX_CI_WATCH_POLLS');
  const timeoutSection = c.substring(timeoutIdx, timeoutIdx + 1500);
  // 超时后应创建后续任务（harness_report 或 harness_post_merge），不能只标 completed 就结束
  if (!timeoutSection.includes('createTask') && !timeoutSection.includes('harness_report') && !timeoutSection.includes('harness_post_merge')) {
    console.log('FAIL: CI 超时后未创建后续任务，链路中断');
    process.exit(1);
  }
  console.log('PASS: CI 超时后链路不中断');
"
```

---

## Feature 2: Post-Merge 统一收尾（contract 校验 + worktree 清理 + Brain 回写 + 报告生成）

**行为描述**:
所有 WorkStream PR 合并后，系统创建 harness_post_merge 任务。该任务依次执行：(1) 校验整体 sprint contract 的 DoD 条目是否达标；(2) 清理已合并 WS 的 worktree 目录和临时 git 分支；(3) 回写 Brain planner 任务状态为 completed；(4) 创建 harness_report 任务生成最终报告。部分 WS 失败时，仅对成功合并的 WS 执行清理，报告标注每个 WS 的状态。

**硬阈值**:
- `harness_post_merge` 在 VALID_TASK_TYPES 数组中注册（非注释、非字符串片段）
- LOCATION_MAP 和 SKILL_MAP 中有对应路由映射
- 最后一个 WS 的 ci_watch 通过（或 merge 完成）后，自动创建 harness_post_merge（不需人工触发）
- post_merge 处理段中包含实际的 `git worktree remove` 执行调用（execSync/exec）
- post_merge 处理段中包含 planner 任务状态回写逻辑
- post_merge 最后创建 harness_report 任务

**验证命令**:
```bash
# 1. 验证 harness_post_merge 在 VALID_TASK_TYPES 数组内注册（非注释）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/task-router.js', 'utf8');
  const arrStart = c.indexOf('VALID_TASK_TYPES');
  const bracketStart = c.indexOf('[', arrStart);
  const bracketEnd = c.indexOf('];', bracketStart);
  const arrContent = c.substring(bracketStart, bracketEnd);
  if (!arrContent.includes(\"'harness_post_merge'\")) {
    console.log('FAIL: harness_post_merge 未在 VALID_TASK_TYPES 数组中注册');
    process.exit(1);
  }
  console.log('PASS: harness_post_merge 已在 VALID_TASK_TYPES 注册');
"

# 2. 验证 LOCATION_MAP 中有 harness_post_merge 路由
node -e "
  const c = require('fs').readFileSync('packages/brain/src/task-router.js', 'utf8');
  const locIdx = c.indexOf('LOCATION_MAP');
  if (locIdx === -1) { console.log('FAIL: 未找到 LOCATION_MAP'); process.exit(1); }
  const locSection = c.substring(locIdx, locIdx + 3000);
  if (!locSection.includes('harness_post_merge')) {
    console.log('FAIL: harness_post_merge 未在 LOCATION_MAP 注册');
    process.exit(1);
  }
  console.log('PASS: harness_post_merge 已在 LOCATION_MAP 注册');
"

# 3. 验证 ci_watch 通过/merge 后触发 harness_post_merge（而非直接 harness_report）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 定位 CI 通过段（ci_passed/merged 处理）
  const passedIdx = c.indexOf('ci_passed');
  if (passedIdx === -1) { console.log('FAIL: 未找到 CI passed 处理段'); process.exit(1); }
  const passedSection = c.substring(passedIdx, passedIdx + 2000);
  // 应创建 harness_post_merge 而非直接 harness_report
  if (!passedSection.includes('harness_post_merge')) {
    console.log('FAIL: CI 通过后未创建 harness_post_merge');
    process.exit(1);
  }
  console.log('PASS: CI passed → harness_post_merge');
"

# 4. 验证 post_merge 处理段有实际的 worktree remove exec 调用（非注释）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 验证有 execSync/exec 调用包含 worktree remove（不接受纯注释）
  const hasExecWorktreeRemove = /exec(?:Sync)?\s*\([^)]*worktree\s+remove/s.test(c)
    || /exec(?:Sync)?\s*\([^)]*git\s+worktree/s.test(c);
  if (!hasExecWorktreeRemove) {
    console.log('FAIL: 无 worktree remove 的 exec 调用（需要实际执行清理，非注释）');
    process.exit(1);
  }
  console.log('PASS: 有实际 exec 调用进行 worktree 清理');
"

# 5. 验证 post_merge 段有 planner 任务状态回写（定位到 post_merge 函数/段落内）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const postMergeIdx = c.indexOf('post_merge');
  if (postMergeIdx === -1) { console.log('FAIL: 无 post_merge 处理段'); process.exit(1); }
  const postMergeSection = c.substring(postMergeIdx, postMergeIdx + 3000);
  // 回写应包含 planner 任务（非自身）状态更新
  if (!postMergeSection.includes('planner_task_id') || !postMergeSection.includes('completed')) {
    console.log('FAIL: post_merge 段无 planner 任务状态回写');
    process.exit(1);
  }
  console.log('PASS: post_merge 含 planner 任务回写');
"

# 6. 运行时验证：harness_post_merge 可被 Brain 正确路由（非 unknown_type）
curl -sf localhost:5221/api/brain/tasks -X POST \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_post_merge","title":"[test] post_merge routing validation","status":"queued","priority":"P2"}' \
  | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try {
        const r=JSON.parse(d);
        if(!r.task_id){console.log('FAIL: harness_post_merge 路由失败，响应: '+d);process.exit(1)}
        console.log('PASS: task created '+r.task_id);
      } catch(e) { console.log('FAIL: JSON 解析失败: '+d); process.exit(1); }
    })
  "
```

---

## Feature 3: stop.sh 不再因已删除 worktree 残留分支误阻退出

**行为描述**:
stop.sh 在遍历 `git worktree list --porcelain` 输出时，对每个 worktree 路径执行目录存在性检查（`-d`）。当 worktree 目录已被物理删除但 git 记录残留时，跳过该条目，不检测其 .dev-lock 文件。stop-dev.sh 如果共享相同检测逻辑，同步修复。

**硬阈值**:
- stop.sh worktree 遍历段（`_wt_path=` 到 `done <` 之间）包含 `test -d` 或 `[ -d` 检查
- 已删除目录的 worktree 条目被跳过，不触发 `_DEV_LOCK_FOUND=true`
- stop-dev.sh 与 stop.sh 使用一致的检测逻辑

**验证命令**:
```bash
# 1. 验证 stop.sh worktree 遍历段内有 -d 目录存在性检查
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop.sh', 'utf8');
  const wtStart = c.indexOf('_wt_path=');
  const wtEnd = c.indexOf('done <', wtStart);
  if (wtStart === -1 || wtEnd === -1) { console.log('FAIL: 未找到 worktree 遍历段'); process.exit(1); }
  const wtSection = c.substring(wtStart, wtEnd);
  if (!wtSection.includes('-d') && !wtSection.includes('test -d')) {
    console.log('FAIL: worktree 遍历段缺少 -d 目录存在性检查');
    process.exit(1);
  }
  console.log('PASS: worktree 遍历段含 -d 检查');
"

# 2. 验证 -d 检查在 .dev-lock 检测之前（先检查目录存在，再检查锁文件）
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop.sh', 'utf8');
  const wtStart = c.indexOf('_wt_path=');
  const wtEnd = c.indexOf('done <', wtStart);
  const wtSection = c.substring(wtStart, wtEnd);
  const dirCheckIdx = Math.max(wtSection.indexOf('-d'), wtSection.indexOf('test -d'));
  const lockCheckIdx = wtSection.indexOf('.dev-lock');
  if (dirCheckIdx === -1) { console.log('FAIL: 遍历段无 -d 检查'); process.exit(1); }
  if (lockCheckIdx === -1) { console.log('FAIL: 遍历段无 .dev-lock 检查'); process.exit(1); }
  if (dirCheckIdx > lockCheckIdx) {
    console.log('FAIL: -d 检查在 .dev-lock 之后（应先检查目录存在）');
    process.exit(1);
  }
  console.log('PASS: -d 检查在 .dev-lock 之前');
"

# 3. 验证 stop-dev.sh 同步修复（如果有 worktree 遍历）
node -e "
  const fs = require('fs');
  try {
    const c = fs.readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
    if (c.includes('_wt_path') || c.includes('worktree list')) {
      const wtStart = c.indexOf('_wt_path=');
      if (wtStart !== -1) {
        const wtEnd = c.indexOf('done', wtStart);
        const section = c.substring(wtStart, wtEnd);
        if (!section.includes('-d')) {
          console.log('FAIL: stop-dev.sh 有 worktree 遍历但缺少 -d 检查');
          process.exit(1);
        }
      }
    }
    console.log('PASS: stop-dev.sh 检测逻辑一致');
  } catch (e) {
    if (e.code === 'ENOENT') console.log('PASS: stop-dev.sh 不存在');
    else throw e;
  }
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: CI Watch 链路修复 + Post-Merge 全实现

**范围**: (1) execution.js 中 harness_generate 最后 WS 回调从 inline CI 检查改为创建 harness_ci_watch；(2) task-router.js 注册 harness_post_merge；(3) harness-watcher.js 中 ci_watch 通过后创建 harness_post_merge（替代直接创建 harness_report）；(4) harness-watcher.js 新增 post_merge 处理函数（contract 校验 + worktree 清理 + Brain 回写 + harness_report 创建）
**大小**: L（>300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] harness_generate 最后 WS 回调不再 inline 调 checkPrCiStatus，改为创建 harness_ci_watch 任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=c.indexOf('currentWsIdx === totalWsCount');const s=c.substring(idx,idx+2000);if(s.includes('checkPrCiStatus')){console.log('FAIL: 仍有 inline CI 检查');process.exit(1)}if(!s.includes('harness_ci_watch')){console.log('FAIL: 未创建 ci_watch');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] harness_ci_watch 通过后创建 harness_post_merge（而非直接 harness_report）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const i=c.indexOf('ci_passed');const s=c.substring(i,i+2000);if(!s.includes('harness_post_merge')){console.log('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] post_merge 清理已合并 WS 的 worktree（实际 exec 调用，非注释）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!/exec(?:Sync)?\s*\([^)]*worktree/s.test(c)){console.log('FAIL: 无 worktree 清理 exec 调用');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] post_merge 回写 planner 任务状态为 completed 并创建 harness_report
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const i=c.indexOf('post_merge');if(i===-1){console.log('FAIL: 无 post_merge 段');process.exit(1)}const s=c.substring(i,i+3000);if(!s.includes('planner_task_id')||!s.includes('completed')){console.log('FAIL: 缺 planner 回写');process.exit(1)}if(!s.includes('harness_report')){console.log('FAIL: 缺 report 创建');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] harness_post_merge 在 VALID_TASK_TYPES 数组中注册且有 LOCATION_MAP 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');const a=c.substring(c.indexOf('['),c.indexOf('];'));if(!a.includes(\"'harness_post_merge'\")){console.log('FAIL: VALID_TASK_TYPES 未注册');process.exit(1)}if(!c.substring(c.indexOf('LOCATION_MAP')).includes('harness_post_merge')){console.log('FAIL: LOCATION_MAP 未注册');process.exit(1)}console.log('PASS')"

### Workstream 2: stop.sh Worktree 检测修复

**范围**: packages/engine/hooks/stop.sh 的 worktree 遍历逻辑，在 .dev-lock 检测前增加 `-d` 目录存在性检查；stop-dev.sh 如有相同逻辑同步修复
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] stop.sh worktree 遍历段在 .dev-lock 检测前验证目录存在（-d 检查）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop.sh','utf8');const s=c.substring(c.indexOf('_wt_path='),c.indexOf('done <',c.indexOf('_wt_path=')));const di=Math.max(s.indexOf('[ -d'),s.indexOf('test -d'),s.indexOf('[[ -d'));const li=s.indexOf('.dev-lock');if(di===-1){console.log('FAIL: 无 -d 检查');process.exit(1)}if(di>li){console.log('FAIL: -d 在 .dev-lock 之后');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] stop-dev.sh 与 stop.sh 使用一致的 worktree 存在性检测逻辑
  Test: node -e "try{const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if((c.includes('_wt_path')||c.includes('worktree list'))&&!c.includes('-d')){console.log('FAIL');process.exit(1)}console.log('PASS')}catch(e){if(e.code==='ENOENT')console.log('PASS');else throw e}"
