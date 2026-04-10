# Sprint Contract Draft (Round 1)

## Feature 1: contract_branch 全链路透传

**行为描述**:
当 Harness pipeline 中任意环节创建下游任务时，`contract_branch` 字段必须从上游 payload 完整透传到下游 payload。具体覆盖：harness_ci_watch 创建的 harness_report、harness_ci_watch 创建的 harness_fix、harness_fix 创建的 harness_report。所有下游任务的 `payload.contract_branch` 不为 null（前提是上游 payload 含有该字段）。

**硬阈值**:
- harness-watcher.js 中 CI 通过→harness_report 的 payload 包含 `contract_branch` 字段
- harness-watcher.js 中 CI 失败→harness_fix 的 payload 包含 `contract_branch` 字段
- execution.js 中 harness_fix→harness_report 的 payload 包含 `contract_branch` 字段
- 所有 3 条路径中 `contract_branch` 值与上游 payload 中的值一致

**验证命令**:
```bash
# 验证 harness-watcher.js CI通过→harness_report 路径包含 contract_branch
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const reportSection = code.split('harness_report')[1] || '';
  if (!reportSection.includes('contract_branch')) {
    console.error('FAIL: harness-watcher.js CI通过→harness_report 路径缺少 contract_branch');
    process.exit(1);
  }
  console.log('PASS: harness-watcher CI通过→report 路径包含 contract_branch');
"

# 验证 harness-watcher.js CI失败→harness_fix 路径包含 contract_branch
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const fixSection = code.split('harness_fix')[1] || '';
  if (!fixSection.includes('contract_branch')) {
    console.error('FAIL: harness-watcher.js CI失败→harness_fix 路径缺少 contract_branch');
    process.exit(1);
  }
  console.log('PASS: harness-watcher CI失败→fix 路径包含 contract_branch');
"

# 验证 execution.js harness_fix→harness_report 路径包含 contract_branch
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const fixBlock = code.substring(code.indexOf(\"harnessType === 'harness_fix'\"));
  const reportPayload = fixBlock.substring(0, fixBlock.indexOf('console.log'));
  if (!reportPayload.includes('contract_branch')) {
    console.error('FAIL: execution.js harness_fix→harness_report 路径缺少 contract_branch');
    process.exit(1);
  }
  console.log('PASS: execution.js harness_fix→report 路径包含 contract_branch');
"
```

---

## Feature 2: Pipeline 状态可视化 API

**行为描述**:
系统提供 `GET /api/brain/harness/pipeline/:planner_task_id` 端点。调用后返回结构化 JSON，按链路顺序列出该 pipeline 运行中所有 harness 任务（planner→proposer→reviewer→generator→ci_watch→fix→report），每个节点包含 task_id、task_type、status、耗时、pr_url 等关键字段。

**硬阈值**:
- 端点返回 HTTP 200 + JSON 数组
- 每个节点至少包含 `task_id`、`task_type`、`status` 字段
- 存在的 planner_task_id 返回非空数组
- 不存在的 planner_task_id 返回空数组（不是 404）
- 响应时间 < 2 秒

**验证命令**:
```bash
# Happy path: 用已知的 planner_task_id 查询
curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(data.tasks || data)) throw new Error('FAIL: 返回值不是数组');
    const tasks = data.tasks || data;
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
```

---

## Feature 3: Report 失败自动重试

**行为描述**:
当 harness_report 任务完成回调时 result 为 null（session 崩溃/无输出），系统自动创建一个新的 harness_report 重试任务。重试次数上限 3 次，超过则标记 pipeline 失败并记录日志。重试任务的 payload 携带 `retry_count` 字段。

**硬阈值**:
- execution.js 中存在 harness_report 回调处理分支
- result=null 时创建新的 harness_report 任务（retry_count+1）
- retry_count >= 3 时不再重试，输出错误日志
- 重试任务的 payload 包含完整的 sprint_dir、planner_task_id、pr_url

**验证命令**:
```bash
# 验证 execution.js 包含 harness_report 回调处理
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!code.includes(\"harnessType === 'harness_report'\")) {
    console.error('FAIL: execution.js 缺少 harness_report 回调处理分支');
    process.exit(1);
  }
  console.log('PASS: harness_report 回调处理分支存在');
"

# 验证重试逻辑包含 retry_count 上限检查
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const reportBlock = code.substring(code.indexOf(\"harnessType === 'harness_report'\"));
  if (!reportBlock.includes('retry_count')) {
    console.error('FAIL: harness_report 重试逻辑缺少 retry_count');
    process.exit(1);
  }
  if (!/retry_count.*>=?\s*3|3.*<=?\s*retry_count/.test(reportBlock.substring(0, 800))) {
    console.error('FAIL: 未找到 retry_count >= 3 的上限检查');
    process.exit(1);
  }
  console.log('PASS: harness_report 重试逻辑含 retry_count 上限(3)');
"

# 验证重试任务 payload 包含必要字段
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const reportBlock = code.substring(code.indexOf(\"harnessType === 'harness_report'\"));
  const payloadBlock = reportBlock.substring(0, 1200);
  const required = ['sprint_dir', 'planner_task_id', 'retry_count'];
  for (const f of required) {
    if (!payloadBlock.includes(f)) {
      console.error('FAIL: harness_report 重试 payload 缺少 ' + f);
      process.exit(1);
    }
  }
  console.log('PASS: harness_report 重试 payload 字段完整');
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
- [ ] [BEHAVIOR] harness-watcher.js CI通过→harness_report 的 payload 包含 contract_branch（值来自上游 payload）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const s=c.split('harness_report')[1]||'';if(!s.includes('contract_branch')){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] harness-watcher.js CI失败→harness_fix 的 payload 包含 contract_branch（值来自上游 payload）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const s=c.split('harness_fix')[1]||'';if(!s.includes('contract_branch')){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] execution.js harness_fix→harness_report 的 payload 包含 contract_branch（值来自 harnessPayload）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const b=c.substring(c.indexOf(\"harnessType === 'harness_fix'\"));const p=b.substring(0,b.indexOf('console.log'));if(!p.includes('contract_branch')){console.error('FAIL');process.exit(1)}console.log('PASS')"

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

### Workstream 3: Report 失败自动重试

**范围**: execution.js 中新增 `harnessType === 'harness_report'` 回调分支。当 result 为 null 且 retry_count < 3 时创建重试任务；retry_count >= 3 时记录错误日志并终止。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] execution.js 中存在 harness_report 回调处理分支，result=null 时创建重试任务
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');if(!c.includes(\"harnessType === 'harness_report'\")){console.error('FAIL: no harness_report handler');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 重试任务 payload 包含 retry_count 且上限为 3（超过不再重试）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const b=c.substring(c.indexOf(\"harnessType === 'harness_report'\"));if(!b.includes('retry_count')){console.error('FAIL: no retry_count');process.exit(1)}if(!/retry_count.*>=?\s*3/.test(b.substring(0,800))){console.error('FAIL: no limit check');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] 测试文件覆盖 contract_branch 透传 + report 重试逻辑
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-pipeline.test.ts');console.log('PASS')"
