# Sprint Contract Draft (Round 3)

> Round 2 反馈总结：4 条可绕过命令（1.2/1.4/2.3/2.4），Feature 3 命令质量高无需修改。
> Round 3 修复：(1) 1.4 搜索窗口从常量定义处改为实际超时判断处 (2) 1.2 payload 字段检查加正则排除注释 (3) 2.3 新增负向检查确认旧 harness_report 直接创建已移除 (4) 2.4 exec worktree 检查限定到 post_merge 段内

---

## Feature 1: Generator 完成后走 CI Watch 轮询链路（而非一次性 inline 检查）

**行为描述**:
Generator（harness_generate）执行完毕并 push PR 后，系统创建 harness_ci_watch 子任务交由 Brain tick 轮询。当前代码在 execution.js 的 harness_generate 回调中做一次性 `checkPrCiStatus()` 判断然后直接创建 harness_report/harness_fix，不经过 ci_watch。本 Feature 要求：harness_generate 最后一个 WS 完成时，创建 harness_ci_watch 任务（而非 inline CI 检查），由 harness-watcher.js 的 tick 轮询处理后续（auto-merge + harness_report/harness_fix）。

**硬阈值**:
- harness_generate 最后一个 WS 的回调**不再**直接调用 `checkPrCiStatus`，改为创建 harness_ci_watch 任务
- harness_ci_watch payload 包含 `pr_url`、`sprint_dir`、`workstream_index`、`workstream_count`（作为对象属性赋值，非注释中的字段名）
- CI 超时阈值 MAX_CI_WATCH_POLLS >= 60（至少覆盖 30 分钟）
- CI 超时后（pollCount >= MAX_CI_WATCH_POLLS）创建后续任务，不中断 pipeline

**验证命令**:
```bash
# 1.1 验证 execution.js 中 harness_generate 最后 WS 不再 inline 调 checkPrCiStatus，而是创建 ci_watch
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const lastWsIdx = c.indexOf('currentWsIdx === totalWsCount');
  if (lastWsIdx === -1) { console.log('FAIL: 未找到最后 WS 判断段'); process.exit(1); }
  const lastWsSection = c.substring(lastWsIdx, lastWsIdx + 2000);
  if (lastWsSection.includes('checkPrCiStatus')) {
    console.log('FAIL: 最后 WS 仍在做 inline CI 检查（checkPrCiStatus），应改为创建 harness_ci_watch');
    process.exit(1);
  }
  if (!lastWsSection.includes('harness_ci_watch')) {
    console.log('FAIL: 最后 WS 未创建 harness_ci_watch 任务');
    process.exit(1);
  }
  console.log('PASS: harness_generate 最后 WS → harness_ci_watch（非 inline CI 检查）');
"

# 1.2 验证 ci_watch payload 包含必要字段（排除纯注释，要求 key: value 赋值格式）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const lastWsIdx = c.indexOf('currentWsIdx === totalWsCount');
  const section = c.substring(lastWsIdx, lastWsIdx + 2000);
  const ciWatchIdx = section.indexOf('harness_ci_watch');
  if (ciWatchIdx === -1) { console.log('FAIL: 无 harness_ci_watch 创建'); process.exit(1); }
  const payloadSection = section.substring(ciWatchIdx, ciWatchIdx + 800);
  const required = ['pr_url', 'sprint_dir', 'workstream_index', 'workstream_count'];
  const missing = required.filter(f => {
    const re = new RegExp(f + '\\\\s*[:=,]');
    return !re.test(payloadSection);
  });
  if (missing.length > 0) {
    console.log('FAIL: payload 缺少字段（需 key: value 格式）: ' + missing.join(', '));
    process.exit(1);
  }
  console.log('PASS: ci_watch payload 含全部必要字段（非注释）');
"

# 1.3 验证 MAX_CI_WATCH_POLLS >= 60（30 分钟超时保障）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const match = c.match(/MAX_CI_WATCH_POLLS\s*=\s*(\d+)/);
  if (!match) { console.log('FAIL: 未找到 MAX_CI_WATCH_POLLS 常量'); process.exit(1); }
  const val = parseInt(match[1]);
  if (val < 60) { console.log('FAIL: MAX_CI_WATCH_POLLS=' + val + '，需 >= 60'); process.exit(1); }
  console.log('PASS: MAX_CI_WATCH_POLLS=' + val);
"

# 1.4 验证 CI 超时后链路不中断（定位实际超时判断处，而非常量定义处）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const timeoutMatch = c.match(/(?:retry_count|poll_count|polls?)\s*>=?\s*MAX_CI_WATCH_POLLS/);
  if (!timeoutMatch) {
    console.log('FAIL: 未找到超时判断逻辑（poll_count >= MAX_CI_WATCH_POLLS）');
    process.exit(1);
  }
  const timeoutIdx = timeoutMatch.index;
  const section = c.substring(timeoutIdx, timeoutIdx + 1500);
  if (!section.includes('createTask') && !section.includes('harness_post_merge')) {
    console.log('FAIL: 超时处理段未创建后续任务（链路中断）');
    process.exit(1);
  }
  console.log('PASS: 超时后创建后续任务，链路不中断');
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
- CI passed 段不再直接创建 harness_report（应由 post_merge 中转）
- post_merge 处理段中包含实际的 `git worktree remove` 执行调用（execSync/exec），且调用位于 post_merge 段内而非文件其他位置
- post_merge 处理段中包含 planner 任务状态回写逻辑
- post_merge 最后创建 harness_report 任务

**验证命令**:
```bash
# 2.1 验证 harness_post_merge 在 VALID_TASK_TYPES 数组内注册（非注释）
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

# 2.2 验证 LOCATION_MAP 中有 harness_post_merge 路由
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

# 2.3 验证 CI passed 段创建 harness_post_merge 且不再直接创建 harness_report（负向检查）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const passedIdx = c.indexOf(\"ciStatus === 'ci_passed'\");
  if (passedIdx === -1) { console.log('FAIL: 未找到 CI passed 处理段'); process.exit(1); }
  const section = c.substring(passedIdx, passedIdx + 2000);
  if (!section.includes('harness_post_merge')) {
    console.log('FAIL: CI passed 段未创建 harness_post_merge');
    process.exit(1);
  }
  const reportMatch = section.match(/createTask[^}]*harness_report/s);
  if (reportMatch) {
    console.log('FAIL: CI passed 段仍直接创建 harness_report（应改为 harness_post_merge 中转）');
    process.exit(1);
  }
  console.log('PASS: CI passed → harness_post_merge（无直接 harness_report）');
"

# 2.4 验证 post_merge 段内有 worktree 清理 exec 调用（限定到 post_merge 处理段内）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const pmIdx = c.indexOf('post_merge');
  if (pmIdx === -1) { console.log('FAIL: 无 post_merge 段'); process.exit(1); }
  const pmSection = c.substring(pmIdx, pmIdx + 3000);
  if (!/exec(?:Sync)?\s*\([^)]*worktree\s*remove/s.test(pmSection)
      && !/exec(?:Sync)?\s*\([^)]*git\s+worktree/s.test(pmSection)) {
    console.log('FAIL: post_merge 段内无 worktree 清理 exec 调用');
    process.exit(1);
  }
  console.log('PASS: post_merge 段含 worktree 清理 exec 调用');
"

# 2.5 验证 post_merge 段有 planner 任务状态回写（定位到 post_merge 函数/段落内）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const postMergeIdx = c.indexOf('post_merge');
  if (postMergeIdx === -1) { console.log('FAIL: 无 post_merge 处理段'); process.exit(1); }
  const postMergeSection = c.substring(postMergeIdx, postMergeIdx + 3000);
  if (!postMergeSection.includes('planner_task_id') || !postMergeSection.includes('completed')) {
    console.log('FAIL: post_merge 段无 planner 任务状态回写');
    process.exit(1);
  }
  console.log('PASS: post_merge 含 planner 任务回写');
"

# 2.6 运行时验证：harness_post_merge 可被 Brain 正确路由
curl -sf localhost:5221/api/brain/tasks -X POST \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_post_merge","title":"[test] post_merge routing validation","status":"cancelled","priority":"P2"}' \
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
# 3.1 验证 stop.sh worktree 遍历段内有 -d 目录存在性检查
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

# 3.2 验证 -d 检查在 .dev-lock 检测之前（先检查目录存在，再检查锁文件）
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop.sh', 'utf8');
  const wtStart = c.indexOf('_wt_path=');
  const wtEnd = c.indexOf('done <', wtStart);
  const wtSection = c.substring(wtStart, wtEnd);
  const dirCheckIdx = Math.max(wtSection.indexOf('[ -d'), wtSection.indexOf('test -d'), wtSection.indexOf('[[ -d'));
  const lockCheckIdx = wtSection.indexOf('.dev-lock');
  if (dirCheckIdx === -1) { console.log('FAIL: 遍历段无 -d 检查'); process.exit(1); }
  if (lockCheckIdx === -1) { console.log('FAIL: 遍历段无 .dev-lock 检查'); process.exit(1); }
  if (dirCheckIdx > lockCheckIdx) {
    console.log('FAIL: -d 检查在 .dev-lock 之后（应先检查目录存在）');
    process.exit(1);
  }
  console.log('PASS: -d 检查在 .dev-lock 之前');
"

# 3.3 验证 stop-dev.sh 同步修复（如果有 worktree 遍历）
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
- [ ] [BEHAVIOR] harness_ci_watch payload 含全部必要字段（key: value 赋值格式，排除纯注释）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=c.indexOf('currentWsIdx === totalWsCount');const s=c.substring(idx,idx+2000);const ci=s.indexOf('harness_ci_watch');if(ci===-1){console.log('FAIL');process.exit(1)}const p=s.substring(ci,ci+800);const r=['pr_url','sprint_dir','workstream_index','workstream_count'];const m=r.filter(f=>!new RegExp(f+'\\s*[:=,]').test(p));if(m.length){console.log('FAIL: 缺字段(需key:value): '+m.join(', '));process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] CI 超时后（pollCount >= MAX）创建后续任务，链路不中断
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const m=c.match(/(?:poll_count|pollCount)\s*>=?\s*MAX_CI_WATCH_POLLS/);if(!m){console.log('FAIL: 未找到超时判断');process.exit(1)}const s=c.substring(m.index,m.index+1500);if(!s.includes('createTask')&&!s.includes('harness_post_merge')){console.log('FAIL: 超时未创建后续任务');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] CI passed 段创建 harness_post_merge 且不再直接创建 harness_report
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const i=c.indexOf(\"ciStatus === 'ci_passed'\");if(i===-1){console.log('FAIL: 无 ci_passed 段');process.exit(1)}const s=c.substring(i,i+2000);if(!s.includes('harness_post_merge')){console.log('FAIL: 未创建 post_merge');process.exit(1)}if(/createTask[^}]*harness_report/s.test(s)){console.log('FAIL: 仍直接创建 harness_report');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] post_merge 段内清理已合并 WS 的 worktree（exec 调用限定在 post_merge 段内）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const i=c.indexOf('post_merge');if(i===-1){console.log('FAIL');process.exit(1)}const s=c.substring(i,i+3000);if(!/exec(?:Sync)?\s*\([^)]*worktree\s*remove/s.test(s)&&!/exec(?:Sync)?\s*\([^)]*git\s+worktree/s.test(s)){console.log('FAIL: post_merge 段内无 worktree 清理');process.exit(1)}console.log('PASS')"
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
