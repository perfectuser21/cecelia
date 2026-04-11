# Sprint Contract Draft (Round 8)

> 修订说明：基于 R3 草案 + 代码实际状态全面重新校验。
> 关键改进：①所有验证命令都基于当前 main 分支代码结构重新编写，消除对不存在代码结构的假设；②harness-watcher.js 验证命令不再假设 ci_passed/ci_failed 按顺序排列，改用函数级别定位；③Feature 3 验证命令适配无 harness_report 回调分支的现状（验证新增而非修改）。

---

## Feature 1: contract_branch 全链路透传

**行为描述**:
当 Harness pipeline 中 harness_ci_watch 或 harness_fix 环节创建下游任务时，`contract_branch` 字段必须从上游 payload 完整透传到下游 payload。具体覆盖 3 条当前缺失的路径：
1. harness-watcher.js CI 通过 → harness_report 的 createTask payload
2. harness-watcher.js CI 失败 → harness_fix 的 createTask payload
3. execution.js harness_fix 完成 → harness_report 的 createTask payload

所有下游任务的 `payload.contract_branch` 值来自上游 `payload.contract_branch`，不允许硬编码字面量。

**硬阈值**:
- harness-watcher.js 中 CI 通过路径的 createTask payload 包含 `contract_branch` 字段，值来自 `payload.contract_branch`
- harness-watcher.js 中 CI 失败路径的 createTask payload 包含 `contract_branch` 字段，值来自 `payload.contract_branch`
- execution.js 中 harness_fix → harness_report 的 createTask payload 包含 `contract_branch` 字段，值来自 `harnessPayload.contract_branch`
- harness-watcher.js 中至少有 2 处 `contract_branch: payload.contract_branch` 赋值

**验证命令**:
```bash
# 路径1: harness-watcher.js CI 通过 → harness_report payload 包含 contract_branch
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 定位 harness_report 创建块（CI 通过路径）
  const reportIdx = code.indexOf(\"task_type: 'harness_report'\");
  if (reportIdx < 0) { console.error('FAIL: 找不到 harness_report createTask'); process.exit(1); }
  // 取 harness_report 前后 500 字符的 payload 块
  const block = code.substring(Math.max(0, reportIdx - 400), reportIdx + 200);
  if (!block.includes('contract_branch')) {
    console.error('FAIL: CI 通过 → harness_report payload 缺少 contract_branch');
    process.exit(1);
  }
  if (!block.includes('payload.contract_branch')) {
    console.error('FAIL: contract_branch 未从 payload.contract_branch 取值');
    process.exit(1);
  }
  console.log('PASS: CI 通过 → harness_report payload 包含 contract_branch 且来源正确');
"

# 路径2: harness-watcher.js CI 失败 → harness_fix payload 包含 contract_branch
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 定位 harness_fix 创建块（CI 失败路径）
  const fixIdx = code.indexOf(\"task_type: 'harness_fix'\");
  if (fixIdx < 0) { console.error('FAIL: 找不到 harness_fix createTask'); process.exit(1); }
  const block = code.substring(Math.max(0, fixIdx - 400), fixIdx + 200);
  if (!block.includes('contract_branch')) {
    console.error('FAIL: CI 失败 → harness_fix payload 缺少 contract_branch');
    process.exit(1);
  }
  if (!block.includes('payload.contract_branch')) {
    console.error('FAIL: contract_branch 未从 payload.contract_branch 取值');
    process.exit(1);
  }
  console.log('PASS: CI 失败 → harness_fix payload 包含 contract_branch 且来源正确');
"

# 路径3: execution.js harness_fix → harness_report payload 包含 contract_branch
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const fixIdx = code.indexOf(\"harnessType === 'harness_fix'\");
  if (fixIdx < 0) { console.error('FAIL: 找不到 harness_fix 分支'); process.exit(1); }
  // 取 harness_fix 分支后 1200 字符
  const block = code.substring(fixIdx, fixIdx + 1200);
  if (!block.includes('contract_branch')) {
    console.error('FAIL: harness_fix → harness_report payload 缺少 contract_branch');
    process.exit(1);
  }
  if (!/contract_branch:\s*harnessPayload\.contract_branch/.test(block) &&
      !block.includes('contract_branch: harnessPayload.contract_branch')) {
    console.error('FAIL: contract_branch 未从 harnessPayload.contract_branch 取值');
    process.exit(1);
  }
  console.log('PASS: harness_fix → harness_report payload 包含 contract_branch 且来源正确');
"

# 全局验证: harness-watcher.js 中至少 2 处 payload.contract_branch 赋值
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const matches = code.match(/contract_branch:\s*payload\.contract_branch/g);
  if (!matches || matches.length < 2) {
    console.error('FAIL: 应至少 2 处 payload.contract_branch 赋值，实际 ' + (matches ? matches.length : 0));
    process.exit(1);
  }
  console.log('PASS: 找到 ' + matches.length + ' 处 payload.contract_branch 赋值');
"
```

---

## Feature 2: Pipeline 状态可视化 API

**行为描述**:
系统提供 `GET /api/brain/harness/pipeline/:planner_task_id` 端点。调用后返回结构化 JSON，包含该 pipeline 运行中所有 harness_* 类型任务，按创建时间升序排列。每个节点包含 task_id、task_type、status 等关键字段，可直观看到整条链路状态。不存在的 planner_task_id 返回空数组。

**硬阈值**:
- 端点注册在 Brain server 中，路径为 `/api/brain/harness/pipeline/:planner_task_id`
- 存在的 planner_task_id 返回 HTTP 200 + JSON（含 tasks 数组），每个元素至少有 `task_id`、`task_type`、`status`
- 不存在的 planner_task_id 返回 HTTP 200 + 空 tasks 数组（不是 404）
- 任务按 created_at 升序排列

**验证命令**:
```bash
# Happy path: 用已知 planner_task_id 查询，验证结构
curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const tasks = data.tasks || data;
    if (!Array.isArray(tasks)) throw new Error('FAIL: 返回值不包含数组');
    if (tasks.length === 0) throw new Error('FAIL: 已知 pipeline 返回空数组');
    const required = ['task_id', 'task_type', 'status'];
    for (const t of tasks) {
      for (const f of required) {
        if (!(f in t)) throw new Error('FAIL: 节点缺少字段 ' + f + ' (task_id=' + t.task_id + ')');
      }
    }
    console.log('PASS: pipeline API 返回 ' + tasks.length + ' 个节点，字段完整');
  "

# 边界: 不存在的 planner_task_id 返回空数组
curl -sf "localhost:5221/api/brain/harness/pipeline/00000000-0000-0000-0000-000000000000" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const tasks = data.tasks || data;
    if (!Array.isArray(tasks)) throw new Error('FAIL: 返回值不包含数组');
    if (tasks.length !== 0) throw new Error('FAIL: 不存在 ID 应返回空数组，实际 ' + tasks.length);
    console.log('PASS: 不存在 ID 返回空数组');
  "

# 排序验证: 按 created_at 升序
curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const tasks = data.tasks || data;
    if (tasks.length < 2) { console.log('PASS: 不足 2 个节点，跳过排序检查'); process.exit(0); }
    for (let i = 1; i < tasks.length; i++) {
      const prev = new Date(tasks[i-1].created_at);
      const curr = new Date(tasks[i].created_at);
      if (curr < prev) throw new Error('FAIL: 任务未按时间排列，索引 ' + (i-1) + ' > ' + i);
    }
    console.log('PASS: ' + tasks.length + ' 个任务按 created_at 升序排列');
  "
```

---

## Feature 3: Report 失败自动重试

**行为描述**:
当 harness_report 任务完成回调时 result 为 null（session 崩溃/无输出），系统自动创建新的 harness_report 重试任务。重试次数上限 3 次（retry_count >= 3 时停止），超过则记录日志不再重试。重试任务 payload 携带递增的 `retry_count`。

**硬阈值**:
- execution.js 中存在 `harnessType === 'harness_report'` 回调处理分支
- result=null 时创建新的 harness_report 任务（task_type 为 'harness_report'）
- retry_count >= 3 时不再重试，使用 `>=` 运算符（不允许 `>`），且之后有 return/break/throw 阻止后续 createTask
- 重试 payload 包含 `sprint_dir`、`planner_task_id`、`pr_url`、`retry_count` 四个字段

**验证命令**:
```bash
# 验证 harness_report 回调分支存在且不为空
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  if (idx < 0) { console.error('FAIL: 缺少 harness_report 回调分支'); process.exit(1); }
  const block = code.substring(idx, idx + 1500);
  if (!block.includes('createTask') && !block.includes('createHarnessTask')) {
    console.error('FAIL: harness_report 分支内无 createTask/createHarnessTask 调用');
    process.exit(1);
  }
  console.log('PASS: harness_report 回调分支存在且含任务创建');
"

# 验证 retry_count >= 3 上限检查（去除注释后匹配，强制 >=）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  if (idx < 0) { console.error('FAIL: 缺少 harness_report 回调分支'); process.exit(1); }
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '').replace(/\/\\*[\\s\\S]*?\\*\\//g, '');
  if (!/retry_count\s*>=\s*3/.test(noComments)) {
    console.error('FAIL: 未找到 retry_count >= 3 检查（必须用 >=）');
    process.exit(1);
  }
  // 验证 >= 3 后有终止语句
  const limitIdx = noComments.search(/retry_count\s*>=\s*3/);
  const afterLimit = noComments.substring(limitIdx, limitIdx + 300);
  if (!/return|break|throw/.test(afterLimit.substring(0, 200))) {
    console.error('FAIL: retry_count >= 3 后无 return/break/throw 终止语句');
    process.exit(1);
  }
  console.log('PASS: retry_count >= 3 上限检查 + 终止语句均存在');
"

# 验证重试 payload 包含 4 个必要字段
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  if (idx < 0) { console.error('FAIL: 缺少 harness_report 回调分支'); process.exit(1); }
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '').replace(/\/\\*[\\s\\S]*?\\*\\//g, '');
  const required = ['sprint_dir', 'planner_task_id', 'retry_count', 'pr_url'];
  for (const f of required) {
    if (!noComments.includes(f)) {
      console.error('FAIL: harness_report 重试 payload 缺少 ' + f);
      process.exit(1);
    }
  }
  console.log('PASS: 重试 payload 包含全部 4 个必要字段');
"
```

---

## Workstreams

workstream_count: 2

### Workstream 1: contract_branch 透传 + Report 重试

**范围**: harness-watcher.js 的 2 条 createTask payload 补充 contract_branch 字段；execution.js 的 harness_fix→harness_report payload 补充 contract_branch 字段；execution.js 新增 harness_report 完成回调处理分支（result=null 重试逻辑）
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] harness-watcher.js CI 通过路径的 harness_report payload 包含 `contract_branch: payload.contract_branch`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const i=c.indexOf(\"task_type: 'harness_report'\");if(i<0)process.exit(1);const b=c.substring(Math.max(0,i-400),i+200);if(!b.includes('contract_branch: payload.contract_branch')){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] harness-watcher.js CI 失败路径的 harness_fix payload 包含 `contract_branch: payload.contract_branch`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const i=c.indexOf(\"task_type: 'harness_fix'\");if(i<0)process.exit(1);const b=c.substring(Math.max(0,i-400),i+200);if(!b.includes('contract_branch: payload.contract_branch')){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] execution.js harness_fix→harness_report payload 包含 `contract_branch: harnessPayload.contract_branch`
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=c.indexOf(\"harnessType === 'harness_fix'\");if(i<0)process.exit(1);const b=c.substring(i,i+1200);if(!/contract_branch:\s*harnessPayload\.contract_branch/.test(b)){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] execution.js 存在 `harnessType === 'harness_report'` 回调分支，result=null 时创建重试任务，retry_count >= 3 时终止
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=c.indexOf(\"harnessType === 'harness_report'\");if(i<0){console.error('FAIL: no branch');process.exit(1)}const b=c.substring(i,i+1500).replace(/\/\/.*$/gm,'');if(!/retry_count\s*>=\s*3/.test(b)){console.error('FAIL: no >= 3');process.exit(1)}if(!b.includes('createTask')&&!b.includes('createHarnessTask')){console.error('FAIL: no create');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] harness_report 重试 payload 包含 sprint_dir、planner_task_id、pr_url、retry_count
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=c.indexOf(\"harnessType === 'harness_report'\");if(i<0)process.exit(1);const b=c.substring(i,i+1500);for(const f of['sprint_dir','planner_task_id','retry_count','pr_url']){if(!b.includes(f)){console.error('FAIL: missing '+f);process.exit(1)}}console.log('PASS')"

### Workstream 2: Pipeline 可视化 API

**范围**: 新增 `GET /api/brain/harness/pipeline/:planner_task_id` 端点，查询 DB 中所有关联 harness 任务并按创建时间排序返回
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] `GET /api/brain/harness/pipeline/:planner_task_id` 端点存在并返回 HTTP 200 + JSON
  Test: bash -c "STATUS=$(curl -s -o /dev/null -w '%{http_code}' 'localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c'); [ \"$STATUS\" = '200' ] && echo PASS || (echo FAIL: $STATUS; exit 1)"
- [ ] [BEHAVIOR] 返回数组中每个节点包含 task_id、task_type、status 字段
  Test: bash -c "curl -sf 'localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c' | node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length===0)throw new Error('FAIL: empty');for(const f of['task_id','task_type','status']){if(!(f in t[0]))throw new Error('FAIL: missing '+f)}console.log('PASS: '+t.length+' nodes')\""
- [ ] [BEHAVIOR] 不存在的 planner_task_id 返回空 tasks 数组
  Test: bash -c "curl -sf 'localhost:5221/api/brain/harness/pipeline/00000000-0000-0000-0000-000000000000' | node -e \"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(!Array.isArray(t)||t.length!==0)throw new Error('FAIL');console.log('PASS')\""
