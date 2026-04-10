# Sprint Contract Draft (Round 3)

> 修订说明：针对 Round 2 Reviewer 反馈（can_bypass: 3/11）全部修复。
> 主要变更：①Feature 1 Command 1.3 增加 contract_branch 来源验证（拒绝硬编码）；②Feature 3 Command 3.2 收紧 regex 为强制 `>=`（拒绝 `>`）；③Feature 2 删除不可验证的"响应时间 < 2 秒"硬阈值；④Feature 3 Command 3.3 统一去除块注释。

---

## Feature 1: contract_branch 全链路透传

**行为描述**:
当 Harness pipeline 中任意环节创建下游任务时，`contract_branch` 字段必须从上游 payload 完整透传到下游 payload。具体覆盖：harness_ci_watch 创建的 harness_report（CI通过路径）、harness_ci_watch 创建的 harness_fix（CI失败路径）、harness_fix 完成后创建的 harness_report。所有下游任务的 `payload.contract_branch` 值来自上游 `payload.contract_branch`，不允许硬编码。

**硬阈值**:
- harness-watcher.js 中 CI通过（ci_passed）分支的 createTask payload 包含 `contract_branch` 字段
- harness-watcher.js 中 CI失败（ci_failed）分支的 createTask payload 包含 `contract_branch` 字段
- execution.js 中 harness_fix→harness_report 的 createTask payload 包含 `contract_branch` 字段，且赋值来源为 `harnessPayload.contract_branch`（不允许硬编码字面量）
- 至少 2 处赋值使用 `payload.contract_branch` 模式

**验证命令**:
```bash
# 路径1: CI通过→harness_report payload 中包含 contract_branch（精确定位 ci_passed 代码块）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const ciPassedIdx = code.indexOf(\"ciStatus === 'ci_passed'\");
  const ciFailedIdx = code.indexOf(\"ciStatus === 'ci_failed'\");
  if (ciPassedIdx < 0 || ciFailedIdx < 0) { console.error('FAIL: 找不到 CI 分支结构'); process.exit(1); }
  const passedBlock = code.substring(ciPassedIdx, ciFailedIdx);
  if (!passedBlock.includes('contract_branch')) {
    console.error('FAIL: CI通过→harness_report 的 createTask payload 中缺少 contract_branch');
    process.exit(1);
  }
  console.log('PASS: CI通过分支 payload 包含 contract_branch');
"

# 路径2: CI失败→harness_fix payload 中包含 contract_branch（精确定位 ci_failed 代码块）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const ciFailedIdx = code.indexOf(\"ciStatus === 'ci_failed'\");
  const ciPendingIdx = code.indexOf(\"ciStatus === 'ci_pending'\");
  if (ciFailedIdx < 0 || ciPendingIdx < 0) { console.error('FAIL: 找不到 CI 分支结构'); process.exit(1); }
  const failedBlock = code.substring(ciFailedIdx, ciPendingIdx);
  if (!failedBlock.includes('contract_branch')) {
    console.error('FAIL: CI失败→harness_fix 的 createTask payload 中缺少 contract_branch');
    process.exit(1);
  }
  console.log('PASS: CI失败分支 payload 包含 contract_branch');
"

# 路径3: execution.js harness_fix→harness_report payload 中 contract_branch 来自 harnessPayload（拒绝硬编码）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const fixIdx = code.indexOf(\"harnessType === 'harness_fix'\");
  if (fixIdx < 0) { console.error('FAIL: 找不到 harness_fix 分支'); process.exit(1); }
  const afterFix = code.substring(fixIdx);
  const nextBranch = afterFix.indexOf('harnessType ===', 10);
  const fixBlock = nextBranch > 0 ? afterFix.substring(0, nextBranch) : afterFix.substring(0, 800);
  if (!fixBlock.includes('contract_branch')) {
    console.error('FAIL: harness_fix→harness_report payload 缺少 contract_branch');
    process.exit(1);
  }
  if (!/contract_branch:\s*harnessPayload\.contract_branch/.test(fixBlock)) {
    console.error('FAIL: contract_branch 未从 harnessPayload.contract_branch 取值（可能硬编码）');
    process.exit(1);
  }
  console.log('PASS: harness_fix→report payload 包含 contract_branch 且来源正确');
"

# 赋值来源验证: contract_branch 来自 payload（非硬编码）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const matches = code.match(/contract_branch:\s*payload\.contract_branch/g);
  if (!matches || matches.length < 2) {
    console.error('FAIL: contract_branch 应至少在 2 个路径中从 payload.contract_branch 取值，实际找到 ' + (matches ? matches.length : 0));
    process.exit(1);
  }
  console.log('PASS: 找到 ' + matches.length + ' 处 payload.contract_branch 赋值');
"
```

---

## Feature 2: Pipeline 状态可视化 API

**行为描述**:
系统提供 `GET /api/brain/harness/pipeline/:planner_task_id` 端点。调用后返回结构化 JSON，按链路顺序列出该 pipeline 运行中所有 harness 任务（planner→proposer→reviewer→generator→ci_watch→fix→report），每个节点包含 task_id、task_type、status、耗时、pr_url 等关键字段。

**硬阈值**:
- 端点返回 HTTP 200 + JSON 对象（含 tasks 数组或直接返回数组）
- 每个节点至少包含 `task_id`、`task_type`、`status` 字段
- 存在的 planner_task_id 返回非空数组
- 不存在的 planner_task_id 返回空数组（不是 404）
- 任务按链路创建时间顺序排列

**验证命令**:
```bash
# Happy path: 用已知的 planner_task_id 查询，验证结构和字段
curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const tasks = data.tasks || data;
    if (!Array.isArray(tasks)) throw new Error('FAIL: 返回值不是数组');
    if (tasks.length === 0) throw new Error('FAIL: 已知 pipeline 返回空数组');
    const required = ['task_id', 'task_type', 'status'];
    const first = tasks[0];
    for (const f of required) {
      if (!(f in first)) throw new Error('FAIL: 缺少字段 ' + f);
    }
    console.log('PASS: pipeline API 返回 ' + tasks.length + ' 个节点，字段完整');
  "

# 边界: 不存在的 planner_task_id 返回空数组
curl -sf "localhost:5221/api/brain/harness/pipeline/00000000-0000-0000-0000-000000000000" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const tasks = data.tasks || data;
    if (!Array.isArray(tasks)) throw new Error('FAIL: 返回值不是数组');
    if (tasks.length !== 0) throw new Error('FAIL: 不存在的 ID 应返回空数组');
    console.log('PASS: 不存在 ID 返回空数组');
  "

# 排序验证: 任务按 created_at 升序排列
curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const tasks = data.tasks || data;
    if (tasks.length < 2) { console.log('PASS: 不足 2 个节点，跳过排序检查'); process.exit(0); }
    for (let i = 1; i < tasks.length; i++) {
      const prev = new Date(tasks[i-1].created_at || tasks[i-1].createdAt || 0);
      const curr = new Date(tasks[i].created_at || tasks[i].createdAt || 0);
      if (curr < prev) throw new Error('FAIL: 任务未按时间顺序排列，索引 ' + (i-1) + ' > ' + i);
    }
    console.log('PASS: ' + tasks.length + ' 个任务按创建时间升序排列');
  "
```

---

## Feature 3: Report 失败自动重试

**行为描述**:
当 harness_report 任务完成回调时 result 为 null（session 崩溃/无输出），系统自动创建一个新的 harness_report 重试任务。重试次数上限 3 次，超过则标记 pipeline 失败并记录日志，不再创建重试任务。重试任务的 payload 携带递增的 `retry_count` 字段。

**硬阈值**:
- execution.js 中存在 `harnessType === 'harness_report'` 回调处理分支
- 分支内有实际的 createTask/createHarnessTask 调用（不是空分支）
- result=null 时创建新的 harness_report 任务（retry_count+1）
- retry_count >= 3 时**不再重试**，必须用 `>=` 运算符（拒绝 `>`），且之后有 return/break/throw 终止语句阻止后续 createTask 执行
- 重试任务的 payload 包含完整的 `sprint_dir`、`planner_task_id`、`pr_url`、`retry_count`

**验证命令**:
```bash
# 验证 harness_report 分支存在且有实际任务创建（不是空分支）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  if (idx < 0) { console.error('FAIL: 缺少 harness_report 分支'); process.exit(1); }
  const block = code.substring(idx, idx + 1500);
  if (!block.includes('createTask') && !block.includes('createHarnessTask')) {
    console.error('FAIL: harness_report 分支内无 createTask/createHarnessTask 调用');
    process.exit(1);
  }
  console.log('PASS: harness_report 分支含任务创建调用');
"

# 验证 retry_count >= 3 上限检查（去除单行+块注释后匹配，强制 >=，拒绝 >）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!/retry_count\s*>=\s*3/.test(noComments)) {
    console.error('FAIL: 未找到 retry_count >= 3 检查（必须用 >= 不允许 >）');
    process.exit(1);
  }
  const limitIdx = noComments.search(/retry_count\s*>=\s*3/);
  const afterLimit = noComments.substring(limitIdx, limitIdx + 300);
  if (!/return|break|throw/.test(afterLimit.substring(0, 200))) {
    console.error('FAIL: retry_count >= 3 后无 return/break/throw 终止语句');
    process.exit(1);
  }
  if (!noComments.includes('createTask') && !noComments.includes('createHarnessTask')) {
    console.error('FAIL: 去除注释后未找到重试任务创建逻辑');
    process.exit(1);
  }
  console.log('PASS: retry_count >= 3 上限检查 + 终止语句 + createTask 均存在');
"

# 验证重试 payload 包含 4 个必要字段（去除单行+块注释后检查）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const required = ['sprint_dir', 'planner_task_id', 'retry_count', 'pr_url'];
  for (const f of required) {
    if (!noComments.includes(f)) {
      console.error('FAIL: harness_report 重试 payload 缺少 ' + f);
      process.exit(1);
    }
  }
  console.log('PASS: 重试 payload 包含全部 4 个必要字段');
"

# 负向验证: retry_count >= 3 后有 return/break/throw 终止（去除单行+块注释后检查）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const limitIdx = noComments.search(/retry_count\s*>=\s*3/);
  if (limitIdx < 0) { console.error('FAIL: 无上限检查'); process.exit(1); }
  const afterLimit = noComments.substring(limitIdx, limitIdx + 300);
  if (!/return|break|throw/.test(afterLimit.substring(0, 200))) {
    console.error('FAIL: retry_count >= 3 后无 return/break/throw 终止语句');
    process.exit(1);
  }
  console.log('PASS: retry_count >= 3 后有终止语句，不会继续重试');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: contract_branch 全链路透传

**范围**: harness-watcher.js 的 CI通过→report 和 CI失败→fix 两条路径补全 contract_branch；execution.js 的 harness_fix→report 路径补全 contract_branch。仅修改 payload 构建对象，不改变业务逻辑。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] harness-watcher.js CI通过（ci_passed）分支的 createTask payload 包含 contract_branch，值来自 payload.contract_branch
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const ciPassedIdx=code.indexOf(\"ciStatus === 'ci_passed'\");const ciFailedIdx=code.indexOf(\"ciStatus === 'ci_failed'\");if(ciPassedIdx<0||ciFailedIdx<0){console.error('FAIL: 找不到 CI 分支结构');process.exit(1)}const passedBlock=code.substring(ciPassedIdx,ciFailedIdx);if(!passedBlock.includes('contract_branch')){console.error('FAIL: CI通过→harness_report payload 缺少 contract_branch');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] harness-watcher.js CI失败（ci_failed）分支的 createTask payload 包含 contract_branch，值来自 payload.contract_branch
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const ciFailedIdx=code.indexOf(\"ciStatus === 'ci_failed'\");const ciPendingIdx=code.indexOf(\"ciStatus === 'ci_pending'\");if(ciFailedIdx<0||ciPendingIdx<0){console.error('FAIL: 找不到 CI 分支结构');process.exit(1)}const failedBlock=code.substring(ciFailedIdx,ciPendingIdx);if(!failedBlock.includes('contract_branch')){console.error('FAIL: CI失败→harness_fix payload 缺少 contract_branch');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] execution.js harness_fix→harness_report 的 createTask payload 包含 contract_branch，且赋值来源为 harnessPayload.contract_branch（拒绝硬编码）
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const fixIdx=code.indexOf(\"harnessType === 'harness_fix'\");if(fixIdx<0){console.error('FAIL');process.exit(1)}const afterFix=code.substring(fixIdx);const nextBranch=afterFix.indexOf('harnessType ===',10);const fixBlock=nextBranch>0?afterFix.substring(0,nextBranch):afterFix.substring(0,800);if(!fixBlock.includes('contract_branch')){console.error('FAIL: payload 缺少 contract_branch');process.exit(1)}if(!/contract_branch:\s*harnessPayload\.contract_branch/.test(fixBlock)){console.error('FAIL: contract_branch 未从 harnessPayload.contract_branch 取值');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] contract_branch 赋值来源为 payload.contract_branch（至少 2 处），不允许硬编码
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const m=code.match(/contract_branch:\s*payload\.contract_branch/g);if(!m||m.length<2){console.error('FAIL: 需至少 2 处 payload.contract_branch 赋值，找到 '+(m?m.length:0));process.exit(1)}console.log('PASS: '+m.length+' 处')"

### Workstream 2: Pipeline 状态可视化 API

**范围**: 新增 `GET /api/brain/harness/pipeline/:planner_task_id` 路由。查询 tasks 表中 planner_task_id 匹配的所有 harness 任务，按创建时间排序返回结构化 JSON。可在 execution.js 或独立路由文件中实现。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] GET /api/brain/harness/pipeline/:planner_task_id 返回 HTTP 200 + JSON，包含该 pipeline 所有 harness 任务
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length===0)throw new Error('FAIL');console.log('PASS: '+t.length+' tasks')"
- [ ] [BEHAVIOR] 每个节点包含 task_id、task_type、status 三个必填字段
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=(d.tasks||d)[0];['task_id','task_type','status'].forEach(f=>{if(!(f in t))throw new Error('FAIL: missing '+f)});console.log('PASS')"
- [ ] [BEHAVIOR] 不存在的 planner_task_id 返回空数组（不是 404）
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/00000000-0000-0000-0000-000000000000" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length!==0)throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 返回的任务按创建时间升序排列
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(t.length<2){console.log('PASS: skip');process.exit(0)}for(let i=1;i<t.length;i++){if(new Date(t[i].created_at||t[i].createdAt)<new Date(t[i-1].created_at||t[i-1].createdAt))throw new Error('FAIL: 未按时间排序')}console.log('PASS')"

### Workstream 3: Report 失败自动重试

**范围**: execution.js 中新增 `harnessType === 'harness_report'` 回调分支。当 result 为 null 且 retry_count < 3 时创建重试任务；retry_count >= 3 时记录错误日志并 return 终止。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] execution.js 中存在 harness_report 回调处理分支，且分支内有实际 createTask/createHarnessTask 调用
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");if(idx<0){console.error('FAIL: 缺少 harness_report 分支');process.exit(1)}const block=code.substring(idx,idx+1500);if(!block.includes('createTask')&&!block.includes('createHarnessTask')){console.error('FAIL: 无 createTask 调用');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 去除单行+块注释后 retry_count >= 3 上限检查存在（强制 >=，拒绝 >），且之后有 return/break/throw 终止语句
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');if(!/retry_count\s*>=\s*3/.test(nc)){console.error('FAIL: 未找到 retry_count >= 3（必须 >=，拒绝 >）');process.exit(1)}const li=nc.search(/retry_count\s*>=\s*3/);const after=nc.substring(li,li+300);if(!/return|break|throw/.test(after.substring(0,200))){console.error('FAIL: 无终止语句');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 重试 payload 包含 sprint_dir、planner_task_id、retry_count、pr_url 四个必要字段（去除注释后检查）
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');for(const f of['sprint_dir','planner_task_id','retry_count','pr_url']){if(!nc.includes(f)){console.error('FAIL: 缺少 '+f);process.exit(1)}}console.log('PASS')"
- [ ] [ARTIFACT] 测试文件覆盖 contract_branch 透传 + report 重试逻辑
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-pipeline.test.ts');console.log('PASS')"
