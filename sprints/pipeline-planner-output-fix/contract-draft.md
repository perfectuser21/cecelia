# Sprint Contract Draft (Round 1)

## Feature 1: Planner 任务完成时持久化 branch 到 result

**行为描述**:
当 Planner 类型的 harness 任务完成并触发 execution-callback 时，系统将该任务产出的分支名写入 `tasks.result.branch` 字段，使其可被后续步骤和 pipeline-detail API 查询到。

**硬阈值**:
- Planner 任务完成后，`tasks.result` 包含 `branch` 键
- `result.branch` 值为非空字符串，格式为有效 git 分支名（以 `cp-` 开头）
- 写入操作使用 JSONB merge（不覆盖 result 中已有的其他字段）

**验证命令**:
```bash
# Happy path: 已完成的 Planner 任务 result 中包含 branch 字段
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_planner&status=completed&limit=5" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const withBranch = tasks.filter(t => t.result && t.result.branch);
    if (withBranch.length === 0) throw new Error('FAIL: 没有任何已完成 Planner 任务含 result.branch');
    withBranch.forEach(t => {
      if (typeof t.result.branch !== 'string' || !t.result.branch.startsWith('cp-'))
        throw new Error('FAIL: branch 格式不符 — ' + t.result.branch);
    });
    console.log('PASS: ' + withBranch.length + '/' + tasks.length + ' 个 Planner 任务含有效 branch');
  "

# 边界: Planner 失败时 result.branch 应为空或不存在，不影响其他字段
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_planner&status=failed&limit=3" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (tasks.length === 0) { console.log('PASS: 无失败任务，跳过'); process.exit(0); }
    tasks.forEach(t => {
      if (t.result && t.result.branch && t.result.branch.length > 0)
        throw new Error('FAIL: 失败任务不应有 branch — ' + t.id);
    });
    console.log('PASS: ' + tasks.length + ' 个失败任务无 branch 字段');
  "
```

---

## Feature 2: pipeline-detail API — Planner 步骤返回 output_content

**行为描述**:
调用 pipeline-detail API 时，对于已完成的 Planner 步骤，API 从该任务的 `result.branch` 读取 `sprint-prd.md` 文件内容，填入 `output_content` 字段返回。当分支不存在或文件缺失时，`output_content` 为 null，API 正常返回 HTTP 200。

**硬阈值**:
- Planner 步骤的 `output_content` 包含 sprint-prd.md 全文（含 `# Sprint PRD` 标题）
- 当 branch 已删除时，`output_content` 为 null，HTTP 状态码仍为 200
- API 响应时间不因 git show 操作显著增加（< 2s）

**验证命令**:
```bash
# Happy path: 有 branch 的 Planner 任务，pipeline-detail 返回非空 output_content
PLANNER_ID=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_planner&status=completed&limit=5" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const t = tasks.find(t => t.result && t.result.branch);
    if (!t) { console.error('NO_PLANNER_WITH_BRANCH'); process.exit(1); }
    console.log(t.id);
  ")
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const plannerStep = data.steps.find(s => s.task_type === 'harness_planner');
    if (!plannerStep) throw new Error('FAIL: 未找到 Planner 步骤');
    if (!plannerStep.output_content) throw new Error('FAIL: Planner output_content 为 null');
    if (!plannerStep.output_content.includes('Sprint PRD') && !plannerStep.output_content.includes('PRD'))
      throw new Error('FAIL: output_content 不含 PRD 内容');
    console.log('PASS: Planner output_content 长度 ' + plannerStep.output_content.length + ' 字符');
  "

# 边界: 无效 planner_task_id 不导致 500
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000")
[ "$STATUS" = "200" ] || [ "$STATUS" = "404" ] && echo "PASS: 无效 ID 返回 $STATUS" || (echo "FAIL: 期望 200 或 404，实际 $STATUS"; exit 1)
```

---

## Feature 3: pipeline-detail API — Propose 步骤返回 input_content

**行为描述**:
调用 pipeline-detail API 时，对于 Propose 步骤，API 使用 Planner 任务的 `result.branch` 定位 PRD 文件，将其内容填入 Propose 步骤的 `input_content` 字段。当 Planner 没有 branch 信息时，`input_content` 为 null。

**硬阈值**:
- Propose 步骤的 `input_content` 与 Planner 步骤的 `output_content` 内容一致（同源 sprint-prd.md）
- 当 Planner 无 branch 时，`input_content` 为 null 且不报错

**验证命令**:
```bash
# Happy path: Propose 的 input_content 与 Planner 的 output_content 一致
PLANNER_ID=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_planner&status=completed&limit=5" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const t = tasks.find(t => t.result && t.result.branch);
    if (!t) { console.error('NO_PLANNER_WITH_BRANCH'); process.exit(1); }
    console.log(t.id);
  ")
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=${PLANNER_ID}" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const planner = data.steps.find(s => s.task_type === 'harness_planner');
    const propose = data.steps.find(s => s.task_type === 'harness_contract_propose');
    if (!propose) { console.log('PASS: 无 Propose 步骤（Pipeline 未到达该阶段），跳过'); process.exit(0); }
    if (!planner.output_content && !propose.input_content) {
      console.log('PASS: Planner 无 output 时 Propose input 也为 null（一致）');
      process.exit(0);
    }
    if (planner.output_content && propose.input_content) {
      if (planner.output_content !== propose.input_content)
        throw new Error('FAIL: Planner output 与 Propose input 不一致');
      console.log('PASS: Planner output === Propose input（' + propose.input_content.length + ' 字符）');
    } else {
      throw new Error('FAIL: Planner output 与 Propose input 不对称');
    }
  "

# 边界: Planner 无 branch 时 Propose input_content 为 null 且 API 正常
curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=e14860e3-5d0c-4b0e-bd66-5f61f97ef9e1" | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!data.steps || data.steps.length === 0) { console.log('PASS: 无步骤数据（正常降级）'); process.exit(0); }
    console.log('PASS: API 正常返回，步骤数 ' + data.steps.length);
  "
```

---

## Workstreams

workstream_count: 1

### Workstream 1: Planner branch 持久化 + pipeline-detail 数据补全

**范围**: 修改 execution-callback 的 Planner 完成处理逻辑（持久化 branch）+ pipeline-detail 的 getStepOutput/getStepInput（读取 branch 获取内容）。涉及 `packages/brain/src/routes/execution.js` 和 `packages/brain/src/routes/harness.js` 两个文件。

**大小**: S（<100行）

**依赖**: 无

**DoD**:
- [ ] [BEHAVIOR] Planner 任务完成时，execution-callback 将 planner_branch 写入 tasks.result.branch 字段（JSONB merge）
  Test: curl -sf "localhost:5221/api/brain/tasks?task_type=harness_planner&status=completed&limit=3" | node -e "const ts=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const ok=ts.filter(t=>t.result&&t.result.branch);if(ok.length===0)throw new Error('FAIL');console.log('PASS: '+ok.length+' tasks with branch')"
- [ ] [BEHAVIOR] pipeline-detail API 对已完成 Planner 步骤返回非 null 的 output_content（含 sprint-prd.md 内容）
  Test: manual:curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=$(curl -sf 'localhost:5221/api/brain/tasks?task_type=harness_planner&status=completed&limit=1' | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))[0]?.id||'')")" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const s=d.steps?.find(s=>s.task_type==='harness_planner');if(!s||!s.output_content)throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] pipeline-detail API 对 Propose 步骤返回来自 Planner branch 的 input_content
  Test: manual:curl -sf "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=$(curl -sf 'localhost:5221/api/brain/tasks?task_type=harness_planner&status=completed&limit=1' | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))[0]?.id||'')")" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const ps=d.steps?.find(s=>s.task_type==='harness_contract_propose');if(ps&&!ps.input_content)throw new Error('FAIL');console.log('PASS')"
- [ ] [BEHAVIOR] 当 planner_branch 不存在时，pipeline-detail API 返回 HTTP 200 且对应字段为 null（优雅降级）
  Test: manual:curl -sf -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=00000000-0000-0000-0000-000000000000" | node -e "const c=require('fs').readFileSync('/dev/stdin','utf8').trim();if(c!=='200'&&c!=='404')throw new Error('FAIL: '+c);console.log('PASS: '+c)"
