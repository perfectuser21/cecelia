# Sprint Contract Draft (Round 9)

> 修订说明：基于 R4 草案 + R2 Reviewer 反馈全量整合。核心变更：
> ① Feature 1 覆盖 PRD 全部 5 条路径（2 条已有 ✅ + 4 条待补全，含 R4 新增的 harness_generate 最后WS→report 路径）；
> ② Feature 1 所有验证命令含来源验证 regex（拒绝硬编码，R2 反馈修复）；
> ③ Feature 3 retry_count 上限强制 `>=`（拒绝 `>`，R2 反馈修复）+ result===null 条件判断 + 去除单行+块注释后匹配；
> ④ Feature 2 删除"响应时间 < 2 秒"硬阈值（R2 可选建议采纳，本地 PG 查询无需限时）。

---

## Feature 1: contract_branch 全链路透传

**行为描述**:
当 Harness pipeline 中任意环节创建下游任务时，`contract_branch` 字段必须从上游 payload 完整透传到下游 payload。PRD 定义 5 条路径（其中 2 条已实现）：
1. Reviewer APPROVED → Generator（已有 ✅）
2. Generator → 下一个 WS Generator（已有 ✅）
3. harness-watcher.js CI通过 → harness_report（需补全）
4. harness-watcher.js CI失败 → harness_fix（需补全）
5. execution.js harness_fix → harness_report（需补全）
6. execution.js harness_generate（最后WS）→ harness_report（需补全）

所有下游任务的 `payload.contract_branch` 值来自上游 payload，不允许硬编码。

**硬阈值**:
- harness-watcher.js 中 CI通过（ci_passed）→ harness_report 的 createTask payload 包含 `contract_branch` 字段，值来自 `payload.contract_branch`
- harness-watcher.js 中 CI失败（ci_failed）→ harness_fix 的 createTask payload 包含 `contract_branch` 字段，值来自 `payload.contract_branch`
- execution.js 中 harness_fix → harness_report 的 createTask payload 包含 `contract_branch` 字段，且赋值来源为 `harnessPayload.contract_branch`（不允许硬编码字面量）
- execution.js 中 harness_generate（最后WS）→ harness_report 的 createTask payload 包含 `contract_branch` 字段，且赋值来源为 `harnessPayload.contract_branch`

**验证命令**:
```bash
# 路径3: CI通过→harness_report payload 中包含 contract_branch（精确定位 ci_passed 代码块）
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
  if (!/contract_branch:\s*payload\.contract_branch/.test(passedBlock)) {
    console.error('FAIL: contract_branch 未从 payload.contract_branch 取值（可能硬编码）');
    process.exit(1);
  }
  console.log('PASS: CI通过分支 payload 包含 contract_branch 且来源正确');
"

# 路径4: CI失败→harness_fix payload 中包含 contract_branch（精确定位 ci_failed 代码块）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const ciFailedIdx = code.indexOf(\"ciStatus === 'ci_failed'\");
  if (ciFailedIdx < 0) { console.error('FAIL: 找不到 ci_failed 分支'); process.exit(1); }
  const afterFailed = code.substring(ciFailedIdx, ciFailedIdx + 1500);
  if (!afterFailed.includes('contract_branch')) {
    console.error('FAIL: CI失败→harness_fix 的 createTask payload 中缺少 contract_branch');
    process.exit(1);
  }
  if (!/contract_branch:\s*payload\.contract_branch/.test(afterFailed)) {
    console.error('FAIL: contract_branch 未从 payload.contract_branch 取值（可能硬编码）');
    process.exit(1);
  }
  console.log('PASS: CI失败分支 payload 包含 contract_branch 且来源正确');
"

# 路径5: execution.js harness_fix→harness_report payload 中 contract_branch 来自 harnessPayload（拒绝硬编码）
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

# 路径6: execution.js harness_generate（最后WS）→harness_report payload 中 contract_branch 来自 harnessPayload
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const genIdx = code.indexOf(\"harnessType === 'harness_generate'\");
  if (genIdx < 0) { console.error('FAIL: 找不到 harness_generate 分支'); process.exit(1); }
  const afterGen = code.substring(genIdx);
  const lastWsIdx = afterGen.indexOf('currentWsIdx === totalWsCount');
  if (lastWsIdx < 0) { console.error('FAIL: 找不到最后WS判断逻辑'); process.exit(1); }
  const reportBlock = afterGen.substring(lastWsIdx, lastWsIdx + 600);
  if (!reportBlock.includes('harness_report')) {
    console.error('FAIL: 最后WS块内无 harness_report 创建');
    process.exit(1);
  }
  if (!/contract_branch:\s*harnessPayload\.contract_branch/.test(reportBlock)) {
    console.error('FAIL: contract_branch 未从 harnessPayload.contract_branch 取值');
    process.exit(1);
  }
  console.log('PASS: harness_generate(最后WS)→report payload 包含 contract_branch 且来源正确');
"
```

---

## Feature 2: Pipeline 状态可视化 API

**行为描述**:
系统提供 `GET /api/brain/harness/pipeline/:planner_task_id` 端点。调用后返回结构化 JSON，按链路顺序列出该 pipeline 运行中所有 harness 任务（planner→proposer→reviewer→generator→ci_watch→fix→report），每个节点包含 task_id、task_type、status、耗时等关键字段。

**硬阈值**:
- 端点返回 HTTP 200 + JSON 对象（含 tasks 数组或直接返回数组）
- 每个节点至少包含 `task_id`、`task_type`、`status` 字段
- 存在的 planner_task_id 返回非空数组
- 不存在的 planner_task_id 返回空数组（不是 404）
- 任务按链路创建时间顺序排列（created_at ASC）
- 返回的任务类型均为 harness_* 或 sprint_* 前缀

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

# task_type 验证: 返回的任务类型均为 harness_* 或 sprint_* 前缀
curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const tasks = data.tasks || data;
    for (const t of tasks) {
      if (!/^(harness_|sprint_)/.test(t.task_type)) {
        throw new Error('FAIL: 非 harness/sprint 类型混入: ' + t.task_type);
      }
    }
    console.log('PASS: 全部 ' + tasks.length + ' 个任务均为 harness/sprint 类型');
  "
```

---

## Feature 3: Report 失败自动重试

**行为描述**:
当 harness_report 任务完成回调时 result 为 null（session 崩溃/无输出），系统自动创建一个新的 harness_report 重试任务。重试次数上限 3 次，超过则标记 pipeline 失败并记录日志，不再创建重试任务。重试任务的 payload 携带递增的 `retry_count` 字段。正常完成（result 非 null）不触发重试。

**硬阈值**:
- execution.js 中存在 `harnessType === 'harness_report'` 回调处理分支
- 分支内有实际的 createTask/createHarnessTask 调用（不是空分支）
- result===null 判断存在（确保只在崩溃时重试，正常完成不重试）
- retry_count >= 3 时**不再重试**，必须用 `>=` 运算符（拒绝 `>`），且之后有 return/break/throw 终止语句阻止后续 createTask 执行
- 重试任务的 payload 包含完整的 `sprint_dir`、`planner_task_id`、`pr_url`、`retry_count`
- retry_count >= 3 到 return/break/throw 之间不允许出现 createTask/createHarnessTask 调用

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

# 验证 result===null 条件存在（去除单行+块注释后匹配，确保正常完成不触发重试）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!/result\s*(===?\s*null|==\s*null|!==?\s*null)/.test(noComments)) {
    console.error('FAIL: 未找到 result null 判断（重试应仅在 session 崩溃时触发）');
    process.exit(1);
  }
  console.log('PASS: 存在 result null 条件判断');
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
  console.log('PASS: retry_count >= 3 上限检查 + 终止语句均存在');
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

# 负向验证: retry_count >= 3 后 createTask/createHarnessTask 不可达
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const limitIdx = noComments.search(/retry_count\s*>=\s*3/);
  if (limitIdx < 0) { console.error('FAIL: 无上限检查'); process.exit(1); }
  const afterLimit = noComments.substring(limitIdx, limitIdx + 300);
  const terminatorIdx = afterLimit.search(/return|break|throw/);
  if (terminatorIdx < 0 || terminatorIdx > 200) {
    console.error('FAIL: retry_count >= 3 后无及时终止语句');
    process.exit(1);
  }
  const betweenLimitAndTerminator = afterLimit.substring(0, terminatorIdx);
  if (/createTask|createHarnessTask/.test(betweenLimitAndTerminator)) {
    console.error('FAIL: retry_count >= 3 到 return 之间不应有 createTask 调用');
    process.exit(1);
  }
  console.log('PASS: retry_count >= 3 后终止，不会继续创建重试任务');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: contract_branch 全链路透传

**范围**: harness-watcher.js 的 CI通过→report 和 CI失败→fix 两条路径补全 contract_branch；execution.js 的 harness_fix→report 和 harness_generate(最后WS)→report 两条路径补全 contract_branch。仅修改 payload 构建对象，不改变业务逻辑。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] harness-watcher.js CI通过（ci_passed）分支的 createTask payload 包含 contract_branch，值来自 payload.contract_branch
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const a=code.indexOf(\"ciStatus === 'ci_passed'\");const b=code.indexOf(\"ciStatus === 'ci_failed'\");if(a<0||b<0){console.error('FAIL');process.exit(1)}const bl=code.substring(a,b);if(!/contract_branch:\s*payload\.contract_branch/.test(bl)){console.error('FAIL: CI通过→report 缺少 contract_branch');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] harness-watcher.js CI失败（ci_failed）分支的 createTask payload 包含 contract_branch，值来自 payload.contract_branch
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/harness-watcher.js','utf8');const a=code.indexOf(\"ciStatus === 'ci_failed'\");if(a<0){console.error('FAIL');process.exit(1)}const bl=code.substring(a,a+1500);if(!/contract_branch:\s*payload\.contract_branch/.test(bl)){console.error('FAIL: CI失败→fix 缺少 contract_branch');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] execution.js harness_fix→harness_report 的 createTask payload 包含 contract_branch，且赋值来源为 harnessPayload.contract_branch
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=code.indexOf(\"harnessType === 'harness_fix'\");if(i<0){console.error('FAIL');process.exit(1)}const af=code.substring(i);const n=af.indexOf('harnessType ===',10);const bl=n>0?af.substring(0,n):af.substring(0,800);if(!/contract_branch:\s*harnessPayload\.contract_branch/.test(bl)){console.error('FAIL');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] execution.js harness_generate(最后WS)→harness_report 的 createTask payload 包含 contract_branch，且赋值来源为 harnessPayload.contract_branch
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=code.indexOf(\"harnessType === 'harness_generate'\");if(i<0){console.error('FAIL');process.exit(1)}const af=code.substring(i);const ws=af.indexOf('currentWsIdx === totalWsCount');if(ws<0){console.error('FAIL: 无最后WS逻辑');process.exit(1)}const bl=af.substring(ws,ws+600);if(!/contract_branch:\s*harnessPayload\.contract_branch/.test(bl)){console.error('FAIL');process.exit(1)}console.log('PASS')"

### Workstream 2: Pipeline 状态可视化 API

**范围**: 新增 `GET /api/brain/harness/pipeline/:planner_task_id` 路由。查询 tasks 表中 planner_task_id 匹配的所有 harness/sprint 任务，按创建时间排序返回结构化 JSON。可在独立路由文件或 server.js 中实现。
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
  Test: curl -sf "localhost:5221/api/brain/harness/pipeline/21c4ad50-fbc5-4ea5-aafd-49deb286b42c" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const t=d.tasks||d;if(t.length<2){console.log('PASS: skip');process.exit(0)}for(let i=1;i<t.length;i++){if(new Date(t[i].created_at||t[i].createdAt)<new Date(t[i-1].created_at||t[i-1].createdAt))throw new Error('FAIL')}console.log('PASS')"

### Workstream 3: Report 失败自动重试

**范围**: execution.js 中新增 `harnessType === 'harness_report'` 回调分支。当 result 为 null 且 retry_count < 3 时创建重试任务；retry_count >= 3 时记录错误日志并 return 终止。正常完成（result 非 null）不触发重试。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] execution.js 中存在 harness_report 回调处理分支，且分支内有实际 createTask/createHarnessTask 调用
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");if(idx<0){console.error('FAIL: 缺少 harness_report 分支');process.exit(1)}const block=code.substring(idx,idx+1500);if(!block.includes('createTask')&&!block.includes('createHarnessTask')){console.error('FAIL: 无 createTask 调用');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 存在 result null 条件判断（去除单行+块注释后匹配，确保重试仅在崩溃时触发）
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');if(!/result\s*(===?\s*null|!==?\s*null)/.test(nc)){console.error('FAIL: 无 result null 判断');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 去除注释后 retry_count >= 3 上限检查存在（强制 >=），且之后有 return/break/throw 终止语句
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');if(!/retry_count\s*>=\s*3/.test(nc)){console.error('FAIL');process.exit(1)}const li=nc.search(/retry_count\s*>=\s*3/);const af=nc.substring(li,li+300);if(!/return|break|throw/.test(af.substring(0,200))){console.error('FAIL: 无终止语句');process.exit(1)}console.log('PASS')"
- [ ] [BEHAVIOR] 重试 payload 包含 sprint_dir、planner_task_id、retry_count、pr_url 四个必要字段
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');for(const f of['sprint_dir','planner_task_id','retry_count','pr_url']){if(!nc.includes(f)){console.error('FAIL: 缺少 '+f);process.exit(1)}}console.log('PASS')"
- [ ] [BEHAVIOR] retry_count >= 3 到 return/break/throw 之间不允许出现 createTask/createHarnessTask 调用
  Test: node -e "const code=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const idx=code.indexOf(\"harnessType === 'harness_report'\");const block=code.substring(idx,idx+1500);const nc=block.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');const li=nc.search(/retry_count\s*>=\s*3/);if(li<0){console.error('FAIL');process.exit(1)}const af=nc.substring(li,li+300);const ti=af.search(/return|break|throw/);if(ti<0||ti>200){console.error('FAIL');process.exit(1)}if(/createTask|createHarnessTask/.test(af.substring(0,ti))){console.error('FAIL: >= 3 到 return 间有 createTask');process.exit(1)}console.log('PASS')"
- [ ] [ARTIFACT] 测试文件覆盖 contract_branch 透传 + report 重试逻辑
  Test: node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-pipeline.test.ts');console.log('PASS')"
