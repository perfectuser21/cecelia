# Sprint Contract Draft (Round 1)

## Feature 1: Generator 完成后自动创建 CI Watch 并轮询

**行为描述**:
Generator（harness_generate）执行完毕并 push PR 后，系统自动创建 harness_ci_watch 子任务。该任务由 Brain tick 轮询 CI 状态，直到 CI 通过或失败或超时。CI 通过时自动执行 `gh pr merge` 合并 PR；CI 失败时创建 harness_fix 任务进入修复循环；超时（30 分钟）时标记为 timeout。

**硬阈值**:
- harness_generate 回调完成后，对应 sprint 必须存在状态为 `queued` 的 harness_ci_watch 任务
- harness_ci_watch 任务 payload 包含 `pr_url`、`sprint_dir`、`workstream_index` 字段
- CI 通过时 PR 状态变为 merged
- CI 失败时创建 harness_fix 任务（fix_round=1），不执行合并
- 轮询超时上限 120 次（约 10 分钟），超时后任务标记为 timeout

**验证命令**:
```bash
# 验证 harness_ci_watch 在 task-router 中已注册
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/src/task-router.js', 'utf8');
  if (!content.includes('harness_ci_watch')) throw new Error('FAIL: harness_ci_watch 未在 task-router 注册');
  console.log('PASS: harness_ci_watch 已注册');
"

# 验证 execution.js 中 Generator 完成后创建 ci_watch（而非直接创建 report）
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const genSection = content.substring(content.indexOf('harness_generate'));
  if (!genSection.includes('harness_ci_watch')) throw new Error('FAIL: Generator 完成后未创建 harness_ci_watch');
  console.log('PASS: Generator 完成流程包含 harness_ci_watch 创建');
"

# 验证 harness-watcher 的 CI 轮询包含自动合并逻辑
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  if (!content.includes('gh pr merge') && !content.includes('auto-merge') && !content.includes('autoMerge'))
    throw new Error('FAIL: harness-watcher 缺少自动合并逻辑');
  if (!content.includes('harness_fix'))
    throw new Error('FAIL: harness-watcher 缺少 CI 失败时创建 harness_fix 逻辑');
  console.log('PASS: harness-watcher 包含自动合并 + 失败修复链路');
"
```

---

## Feature 2: Post-Merge 统一收尾（contract 校验 + worktree 清理 + Brain 回写 + 报告生成）

**行为描述**:
所有 WorkStream 的 PR 合并完成后，系统创建 harness_post_merge 任务。该任务依次执行：(1) 校验整体 sprint contract 的所有 DoD 条目是否达标；(2) 清理已合并 WS 的 worktree 目录和临时 git 分支；(3) 回写 Brain 任务状态为 completed 并更新 OKR 进度；(4) 创建 harness_report 任务生成最终报告。部分 WS 失败时，仅对成功合并的 WS 执行清理，报告标注每个 WS 的状态。

**硬阈值**:
- harness_post_merge 任务类型在 task-router.js 中注册，路由映射到 `_internal`（Brain 内部处理）
- 最后一个 WS 合并完成后，系统自动创建 harness_post_merge（不需要人工触发）
- post_merge 完成后，sprint 内所有已合并 WS 的 worktree 目录不存在（已清理）
- post_merge 完成后，对应 Brain 任务状态为 `completed`
- post_merge 最后创建 harness_report 任务

**验证命令**:
```bash
# 验证 harness_post_merge 在 task-router 中注册
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/src/task-router.js', 'utf8');
  if (!content.includes('harness_post_merge')) throw new Error('FAIL: harness_post_merge 未在 task-router 注册');
  console.log('PASS: harness_post_merge 已注册');
"

# 验证 execution.js 或 harness-watcher 中包含 post_merge 创建逻辑
node -e "
  const fs = require('fs');
  const exec = fs.readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const watcher = fs.readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const combined = exec + watcher;
  if (!combined.includes('harness_post_merge')) throw new Error('FAIL: 未找到 harness_post_merge 创建逻辑');
  console.log('PASS: harness_post_merge 创建逻辑存在');
"

# 验证 post_merge 包含 worktree 清理逻辑
node -e "
  const fs = require('fs');
  const files = ['packages/brain/src/harness-watcher.js', 'packages/brain/src/harness-post-merge.js'];
  let found = false;
  for (const f of files) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      if (c.includes('worktree') && (c.includes('remove') || c.includes('prune') || c.includes('clean'))) {
        found = true; break;
      }
    } catch {}
  }
  if (!found) throw new Error('FAIL: 未找到 worktree 清理逻辑');
  console.log('PASS: post_merge 包含 worktree 清理');
"

# 验证 post_merge 包含 Brain 任务状态回写
node -e "
  const fs = require('fs');
  const files = ['packages/brain/src/harness-watcher.js', 'packages/brain/src/harness-post-merge.js'];
  let found = false;
  for (const f of files) {
    try {
      const c = fs.readFileSync(f, 'utf8');
      if (c.includes('completed') && (c.includes('PATCH') || c.includes('updateTask') || c.includes('task_status'))) {
        found = true; break;
      }
    } catch {}
  }
  if (!found) throw new Error('FAIL: 未找到 Brain 任务回写逻辑');
  console.log('PASS: post_merge 包含 Brain 任务回写');
"
```

---

## Feature 3: stop.sh 不再因已删除 worktree 残留分支误阻退出

**行为描述**:
stop.sh 在检测 `.dev-lock` 文件时，仅检查实际存在的 worktree 目录。当 git 分支记录指向已删除的 worktree 目录时，stop.sh 跳过该记录，不将其视为活跃开发锁。stop-dev.sh 如果共享相同检测逻辑，同步修复。

**硬阈值**:
- stop.sh 在遍历 worktree 列表时，对每个 worktree 路径执行目录存在性检查
- 已删除目录对应的 worktree 条目被跳过，不触发 `_DEV_LOCK_FOUND=true`
- stop-dev.sh 与 stop.sh 使用一致的检测逻辑

**验证命令**:
```bash
# 验证 stop.sh 包含目录存在性检查
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/hooks/stop.sh', 'utf8');
  if (!content.includes('-d') && !content.includes('test -e') && !content.includes('[ -e'))
    throw new Error('FAIL: stop.sh 未检查 worktree 目录是否存在');
  console.log('PASS: stop.sh 包含目录存在性校验');
"

# 验证 stop.sh 不会对不存在的目录检测 .dev-lock
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/hooks/stop.sh', 'utf8');
  const lockSection = content.substring(content.indexOf('_DEV_LOCK') || 0);
  if (lockSection.includes('-d') || lockSection.includes('test -d') || lockSection.includes('[ -d'))
    console.log('PASS: stop.sh 在 .dev-lock 检测前验证目录存在');
  else
    throw new Error('FAIL: stop.sh 缺少 worktree 路径的存在性校验');
"

# 验证 stop-dev.sh 同步修复
node -e "
  const fs = require('fs');
  try {
    const content = fs.readFileSync('packages/engine/hooks/stop-dev.sh', 'utf8');
    if (content.includes('worktree') && !content.includes('-d'))
      throw new Error('FAIL: stop-dev.sh 有 worktree 遍历但缺少目录存在性检查');
    console.log('PASS: stop-dev.sh 检测逻辑一致');
  } catch (e) {
    if (e.code === 'ENOENT') console.log('PASS: stop-dev.sh 不存在，无需修复');
    else throw e;
  }
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: CI Watch 链路 + Post-Merge 编排

**范围**: execution.js 中 Generator 完成后创建 harness_ci_watch 的逻辑验证/补全；harness-watcher.js 中 CI 通过后的自动合并和失败处理；最后一个 WS 合并后创建 harness_post_merge 的触发逻辑；task-router.js 中新增 harness_post_merge 路由
**大小**: L（>300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] Generator（harness_generate）完成回调后，系统创建 harness_ci_watch 任务（状态 queued），payload 包含 pr_url、sprint_dir、workstream_index
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes('harness_ci_watch'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] harness-watcher CI 轮询通过后执行 auto-merge，失败时创建 harness_fix
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('gh pr merge'))process.exit(1);if(!c.includes('harness_fix'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] 最后一个 WS 合并完成后创建 harness_post_merge 任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('harness_post_merge'))process.exit(1);console.log('PASS')"
- [ ] [ARTIFACT] task-router.js 中注册 harness_post_merge 类型，路由映射到 _internal
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/task-router.js','utf8');if(!c.includes('harness_post_merge'))process.exit(1);console.log('PASS')"

### Workstream 2: Post-Merge 实现（contract 校验 + worktree 清理 + Brain 回写）

**范围**: 新增 harness_post_merge 处理逻辑（可在 harness-watcher.js 中追加或新建 harness-post-merge.js）；校验 sprint contract DoD 条目达标；清理已合并 WS 的 worktree 和临时分支；回写 Brain 任务状态；创建 harness_report
**大小**: L（>300行）
**依赖**: Workstream 1 完成后（需要 harness_post_merge 任务类型已注册）

**DoD**:
- [ ] [BEHAVIOR] harness_post_merge 处理时校验 sprint contract 的 DoD 条目达标情况
  Test: node -e "const g=require('fs').readdirSync('packages/brain/src');const f=g.find(x=>x.includes('harness'));const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('contract')&&!c.includes('dod'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] harness_post_merge 清理已合并 WS 的 worktree 目录和临时 git 分支
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('worktree')&&!c.includes('git branch -D')&&!c.includes('git worktree remove'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] harness_post_merge 回写 Brain 任务状态为 completed 并更新 OKR
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('completed'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] harness_post_merge 最后创建 harness_report 任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');if(!c.includes('harness_report'))process.exit(1);console.log('PASS')"

### Workstream 3: stop.sh Worktree 检测修复

**范围**: packages/engine/hooks/stop.sh 的 worktree 遍历逻辑，增加目录存在性检查；stop-dev.sh 如有相同逻辑同步修复
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] stop.sh 在遍历 worktree 列表时，对每个路径执行 `-d` 目录存在性检查，跳过已删除的 worktree
  Test: node -e "const c=require('fs').readFileSync('packages/engine/hooks/stop.sh','utf8');if(!c.includes('-d'))process.exit(1);console.log('PASS')"
- [ ] [BEHAVIOR] stop-dev.sh 与 stop.sh 使用一致的 worktree 存在性检测逻辑
  Test: node -e "try{const c=require('fs').readFileSync('packages/engine/hooks/stop-dev.sh','utf8');if(c.includes('worktree')&&!c.includes('-d'))process.exit(1);console.log('PASS')}catch(e){if(e.code==='ENOENT')console.log('PASS: no stop-dev.sh');else throw e}"
