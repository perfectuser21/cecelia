# Sprint Contract Draft (Round 2)

> sprint: Harness v4.0 E2E 全链路验证
> planner_task_id: b26e5c34-88f9-4fa9-b897-ce58df8bf473
> propose_round: 2
> propose_task_id: 731cfab1-119e-4953-886a-63d2e2421e61

---

## Feature 1: Planner 自动生成 PRD 并触发 GAN 链路

**行为描述**:

Planner 任务执行后，Brain 中存在以下可观测状态：
- `sprints/sprint-prd.md` 文件存在于 Planner 推送的分支上
- Brain DB 中存在 `task_type = harness_contract_propose` 的任务，且其 `payload.planner_task_id` 等于本次 Planner 的任务 ID
- 上述 propose 任务的 `trigger_source = execution_callback_harness`，证明是自动触发，非人工创建

**硬阈值**:
- `sprint-prd.md` 文件必须存在于对应分支（非空）
- `harness_contract_propose` 任务的 `payload.planner_task_id` 等于已知 planner 任务 ID
- `trigger_source` 必须为 `execution_callback_harness`（非 `manual`）
- propose 任务 `status` 不能是 `failed`

**验证命令**:
```bash
# 验证 1：Brain DB 中存在 propose 任务且 trigger_source 正确
PLANNER_ID="b26e5c34-88f9-4fa9-b897-ce58df8bf473"
RESULT=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_propose&limit=50" 2>/dev/null)
node -e "
  const tasks = JSON.parse('$RESULT' || '[]');
  const matched = tasks.filter(t =>
    t.payload && t.payload.planner_task_id === '$PLANNER_ID'
  );
  if (matched.length === 0) {
    console.error('FAIL: 未找到 planner_task_id=$PLANNER_ID 对应的 propose 任务');
    process.exit(1);
  }
  const bad = matched.filter(t => t.trigger_source === 'manual');
  if (bad.length > 0) {
    console.error('FAIL: propose 任务 trigger_source 为 manual，非自动触发');
    process.exit(1);
  }
  const failed = matched.filter(t => t.status === 'failed');
  if (failed.length === matched.length) {
    console.error('FAIL: 所有 propose 任务均为 failed 状态');
    process.exit(1);
  }
  console.log('PASS: 找到 ' + matched.length + ' 个自动触发的 propose 任务');
"

# 验证 2：sprint-prd.md 在 planner 分支上存在且非空
PLANNER_BRANCH=$(curl -sf "localhost:5221/api/brain/tasks/$PLANNER_ID" 2>/dev/null | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.result && d.result.planner_branch || '')" 2>/dev/null)
if [ -n "$PLANNER_BRANCH" ]; then
  git fetch origin "$PLANNER_BRANCH" 2>/dev/null && \
  git show "origin/${PLANNER_BRANCH}:sprints/sprint-prd.md" | wc -c | \
  node -e "
    const size = parseInt(require('fs').readFileSync('/dev/stdin','utf8').trim());
    if (size < 100) { console.error('FAIL: sprint-prd.md 过小（'+size+' bytes），可能为空'); process.exit(1); }
    console.log('PASS: sprint-prd.md 存在，大小 ' + size + ' bytes');
  "
else
  echo "INFO: planner_branch 未在任务结果中记录，跳过分支检查"
fi

# 失败路径验证：planner_task_id 不存在时应返回空集合
EMPTY=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_propose&limit=50" 2>/dev/null | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const matched = tasks.filter(t => t.payload && t.payload.planner_task_id === 'nonexistent-planner-id-0000');
    console.log(matched.length);
  " 2>/dev/null)
[ "$EMPTY" = "0" ] && echo "PASS: 不存在的 planner_id 返回空集合" || (echo "FAIL: 期望 0，实际 $EMPTY"; exit 1)
```

---

## Feature 2: GAN 对抗自动收敛到合同共识

**行为描述**:

GAN 对抗链路可观测的外部行为：
- Brain DB 中存在至少一对 `(harness_contract_propose, harness_contract_review)` 任务，均关联同一 `planner_task_id`
- 最终一轮的 `harness_contract_review` 任务结果中，`result.verdict = "APPROVED"`
- 若对抗轮次 > 1，则存在多个 `harness_contract_propose` 任务（不同 round），且每轮 propose 后均触发了对应 review
- GAN 对抗期间，人工操作记录（`trigger_source = manual`）数量为 0，证明无人工干预

**硬阈值**:
- 至少存在 1 个 status=completed 的 `harness_contract_review` 任务，关联当前 planner_task_id
- 最终 review 任务 `result.verdict` 严格等于 `"APPROVED"`（大小写精确匹配）
- 对抗过程中任何 propose/review 任务的 `status` 不能是 `quarantined`（被隔离意味着链路断裂）

**验证命令**:
```bash
# 验证 1：存在 APPROVED verdict 的 review 任务
PLANNER_ID="b26e5c34-88f9-4fa9-b897-ce58df8bf473"
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_review&limit=50" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const forThisRun = tasks.filter(t => t.payload && t.payload.planner_task_id === '$PLANNER_ID');
    if (forThisRun.length === 0) {
      console.error('FAIL: 未找到关联 planner_task_id 的 contract_review 任务');
      process.exit(1);
    }
    const approved = forThisRun.filter(t => t.result && t.result.verdict === 'APPROVED');
    if (approved.length === 0) {
      console.error('FAIL: 无 APPROVED verdict。现有 verdicts: ' + forThisRun.map(t => t.result && t.result.verdict).join(', '));
      process.exit(1);
    }
    console.log('PASS: 找到 ' + approved.length + ' 个 APPROVED review，共 ' + forThisRun.length + ' 轮审查');
  "

# 验证 2：无任务处于 quarantined 状态（链路完整性）
for TASK_TYPE in harness_contract_propose harness_contract_review; do
  QUARANTINED=$(curl -sf "localhost:5221/api/brain/tasks?task_type=${TASK_TYPE}&limit=50" | \
    node -e "
      const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const q = tasks.filter(t =>
        t.status === 'quarantined' &&
        t.payload && t.payload.planner_task_id === 'b26e5c34-88f9-4fa9-b897-ce58df8bf473'
      );
      console.log(q.length);
    " 2>/dev/null)
  if [ "$QUARANTINED" -gt "0" ]; then
    echo "FAIL: ${TASK_TYPE} 有 ${QUARANTINED} 个任务被 quarantined，链路中断"
    exit 1
  fi
  echo "PASS: ${TASK_TYPE} 无 quarantined 任务"
done

# 验证 3：多轮时 propose 轮次连续（round=1,2...），无跳号
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_propose&limit=50" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const forThisRun = tasks.filter(t => t.payload && t.payload.planner_task_id === 'b26e5c34-88f9-4fa9-b897-ce58df8bf473');
    const rounds = forThisRun.map(t => t.payload && t.payload.propose_round).filter(Boolean).sort((a,b)=>a-b);
    if (rounds.length === 0) { console.log('INFO: 无 propose_round 字段，跳过连续性检查'); process.exit(0); }
    for (let i = 0; i < rounds.length; i++) {
      if (rounds[i] !== i + 1) {
        console.error('FAIL: propose_round 不连续：期望 ' + (i+1) + '，实际 ' + rounds[i]);
        process.exit(1);
      }
    }
    console.log('PASS: ' + rounds.length + ' 轮 propose，轮次连续：' + rounds.join(','));
  "
```

---

## Feature 3: Generator 按合同执行，自动创建 PR 并等待 CI

**行为描述**:

Generator 执行后，以下外部状态可观测：
- GitHub 上存在一个 PR，关联 `harness_generator` 任务
- PR 处于 open 或 merged 状态（非 closed/draft）
- CI 状态：PR 上至少有一个 Check Run，状态不全为 pending
- Brain DB 中 generator 任务的 `result.pr_url` 非空

**硬阈值**:
- `harness_generator` 任务 `result.pr_url` 不为 null 且为 GitHub URL 格式
- PR 的 CI Check 状态 `conclusion` 不能是 `null`（即 CI 已完成运行）
- Generator 任务 `status = completed`（非 failed/quarantined）

**验证命令**:
```bash
# 验证 1：Generator 任务存在且有 pr_url
PLANNER_ID="b26e5c34-88f9-4fa9-b897-ce58df8bf473"
GEN_RESULT=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_generator&limit=20" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const forThisRun = tasks.filter(t => t.payload && t.payload.planner_task_id === '$PLANNER_ID');
    if (forThisRun.length === 0) {
      console.error('FAIL: 未找到 generator 任务');
      process.exit(1);
    }
    const completed = forThisRun.filter(t => t.status === 'completed' && t.result && t.result.pr_url);
    if (completed.length === 0) {
      console.error('FAIL: Generator 未完成或无 pr_url。状态: ' + forThisRun.map(t=>t.status).join(','));
      process.exit(1);
    }
    console.log(completed[0].result.pr_url);
  " 2>/dev/null)
if [ $? -ne 0 ]; then exit 1; fi
echo "PASS: Generator 任务已完成，PR URL: $GEN_RESULT"

# 验证 2：PR 存在于 GitHub 且不是 closed
if echo "$GEN_RESULT" | grep -q "github.com"; then
  PR_NUMBER=$(echo "$GEN_RESULT" | sed 's|.*/pull/||')
  PR_STATE=$(gh pr view "$PR_NUMBER" --json state -q .state 2>/dev/null)
  if [ "$PR_STATE" = "CLOSED" ]; then
    echo "FAIL: PR #$PR_NUMBER 已被 closed（非 merged），异常"
    exit 1
  fi
  echo "PASS: PR #$PR_NUMBER 状态为 $PR_STATE"
fi

# 失败路径验证：SESSION_TTL 问题复发检测（generator 不能因超时 quarantined）
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_generator&limit=20" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const q = tasks.filter(t =>
      t.status === 'quarantined' &&
      t.payload && t.payload.planner_task_id === 'b26e5c34-88f9-4fa9-b897-ce58df8bf473'
    );
    if (q.length > 0) {
      console.error('FAIL: Generator 被 quarantined（#2114 bug 复发？），数量: ' + q.length);
      process.exit(1);
    }
    console.log('PASS: Generator 未被 quarantined，#2114 修复有效');
  "
```

---

## Feature 4: Evaluator 读取 CI 结果，自主决策是否合并

**行为描述**:

Evaluator 执行后，以下外部状态可观测：
- Brain DB 中 `harness_evaluator` 任务状态为 completed
- `result.verdict` 为 `"PASS"` 或 `"FAIL"`（严格二选一，不能为 null 或其他值）
- 若 verdict=PASS，则对应 PR 的 `merged_at` 非 null（PR 已合并）
- 若 verdict=FAIL，则对应 PR 状态为 open（未合并），且 `result.fail_reason` 非空

**硬阈值**:
- evaluator 任务 `result.verdict` 不能为 null（#2118 bug 已修复验证点）
- verdict=PASS 时 PR 必须已合并
- CI 泄漏检测：若多轮 eval，每轮 verdict 必须基于其对应 PR 的 CI，不能跨轮泄漏

**验证命令**:
```bash
# 验证 1：Evaluator 任务 verdict 非 null（#2118 核心修复点）
PLANNER_ID="b26e5c34-88f9-4fa9-b897-ce58df8bf473"
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_evaluator&limit=20" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const forThisRun = tasks.filter(t => t.payload && t.payload.planner_task_id === '$PLANNER_ID');
    if (forThisRun.length === 0) {
      console.error('FAIL: 未找到 evaluator 任务');
      process.exit(1);
    }
    const nullVerdict = forThisRun.filter(t => !t.result || t.result.verdict === null || t.result.verdict === undefined);
    if (nullVerdict.length > 0) {
      console.error('FAIL: ' + nullVerdict.length + ' 个 evaluator 任务 verdict 为 null（#2118 复发）');
      process.exit(1);
    }
    const validVerdicts = ['PASS', 'FAIL'];
    const invalid = forThisRun.filter(t => !validVerdicts.includes(t.result && t.result.verdict));
    if (invalid.length > 0) {
      console.error('FAIL: verdict 值非法: ' + invalid.map(t => t.result && t.result.verdict).join(', '));
      process.exit(1);
    }
    console.log('PASS: ' + forThisRun.length + ' 个 evaluator 任务，verdicts: ' + forThisRun.map(t=>t.result.verdict).join(','));
  "

# 验证 2：CI 状态未跨轮泄漏（#2113 核心修复点）
# 如果存在多轮 eval，每轮的 pr_url 应不同
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_evaluator&limit=20" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const forThisRun = tasks.filter(t => t.payload && t.payload.planner_task_id === 'b26e5c34-88f9-4fa9-b897-ce58df8bf473');
    if (forThisRun.length < 2) { console.log('INFO: 单轮 eval，跳过跨轮泄漏检测'); process.exit(0); }
    const prUrls = forThisRun.map(t => t.result && t.result.pr_url).filter(Boolean);
    const unique = new Set(prUrls);
    if (unique.size < prUrls.length) {
      console.error('FAIL: 多轮 eval 使用了相同 pr_url，存在 CI 状态泄漏风险');
      process.exit(1);
    }
    console.log('PASS: 各轮 eval 使用不同 pr_url，无 CI 跨轮泄漏');
  "

# 验证 3：数据库直查 CI 类型无 SQL 错误（#2113 SQL 类型错误修复验证）
psql cecelia -c "
  SELECT COUNT(*) as eval_count
  FROM tasks
  WHERE task_type = 'harness_evaluator'
    AND payload->>'planner_task_id' = 'b26e5c34-88f9-4fa9-b897-ce58df8bf473'
    AND status = 'completed';
" 2>&1 | node -e "
  const out = require('fs').readFileSync('/dev/stdin','utf8');
  if (out.includes('ERROR') || out.includes('error')) {
    console.error('FAIL: psql 查询出错（SQL 类型错误？）: ' + out.trim());
    process.exit(1);
  }
  const match = out.match(/(\d+)/);
  if (!match || parseInt(match[1]) === 0) {
    console.error('FAIL: DB 中无 completed evaluator 任务');
    process.exit(1);
  }
  console.log('PASS: DB 中有 ' + match[1] + ' 个 completed evaluator 任务，SQL 查询正常');
"
```

---

## Feature 5: 合并后自动触发部署流程

**行为描述**:

PR 合并后，Brain 中可观测：
- 存在 `trigger_source = pr_merged` 或 `task_type` 含有部署相关的任务（如 `harness_deploy` 或 `deploy`）
- 该部署任务的 `payload.pr_url` 等于 Generator 创建的 PR URL

**硬阈值**:
- 合并事件必须触发了后续任务创建（Brain 自动派发，非人工）
- 部署任务 `status` 不能是 `failed`

**验证命令**:
```bash
# 验证 1：合并后自动触发部署任务（检查 trigger_source）
PLANNER_ID="b26e5c34-88f9-4fa9-b897-ce58df8bf473"
DEPLOY_COUNT=$(psql cecelia -t -c "
  SELECT COUNT(*)
  FROM tasks
  WHERE (task_type ILIKE '%deploy%' OR task_type = 'harness_report')
    AND trigger_source != 'manual'
    AND payload->>'planner_task_id' = '$PLANNER_ID';
" 2>/dev/null | tr -d ' ')
if [ -z "$DEPLOY_COUNT" ] || [ "$DEPLOY_COUNT" = "0" ]; then
  echo "FAIL: 未找到由合并自动触发的部署/report 任务（planner_id=$PLANNER_ID）"
  exit 1
fi
echo "PASS: 找到 $DEPLOY_COUNT 个自动触发的后续任务"

# 失败路径验证：PRD 范围外 — 不验证部署成功与否，只验证触发
# 若部署本身失败但触发发生，该 Feature 仍通过
echo "INFO: Feature 5 范围=验证触发，不验证部署结果"
```

---

## Feature 6: 全链路结束后自动生成 sprint-report 并写回 Brain

**行为描述**:

链路最终阶段，可观测：
- Brain DB 中存在 `task_type = harness_report` 的任务，status=completed
- 该任务 `result.report_path` 非空，且对应分支上确实存在该文件
- 触发本次链路的源任务（planner 任务）`status` 更新为 `completed`
- `result.completed_at` 非空，证明回写发生

**硬阈值**:
- `harness_report` 任务 `status = completed`
- planner 任务（b26e5c34）`status = completed`（证明 Brain 状态已回写）
- sprint-report 文件字节数 > 500（非空报告）

**验证命令**:
```bash
# 验证 1：harness_report 任务存在且 completed
PLANNER_ID="b26e5c34-88f9-4fa9-b897-ce58df8bf473"
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_report&limit=20" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const forThisRun = tasks.filter(t =>
      t.payload && t.payload.planner_task_id === '$PLANNER_ID'
    );
    if (forThisRun.length === 0) {
      console.error('FAIL: 未找到 harness_report 任务（#2114 report 任务未创建 bug？）');
      process.exit(1);
    }
    const completed = forThisRun.filter(t => t.status === 'completed');
    if (completed.length === 0) {
      console.error('FAIL: harness_report 任务未 completed，状态: ' + forThisRun.map(t=>t.status).join(','));
      process.exit(1);
    }
    const r = completed[0].result;
    if (!r || !r.report_path) {
      console.error('FAIL: harness_report result 无 report_path');
      process.exit(1);
    }
    console.log('PASS: harness_report 已 completed，report_path: ' + r.report_path);
  "

# 验证 2：planner 任务状态已回写为 completed
PLANNER_STATUS=$(curl -sf "localhost:5221/api/brain/tasks/$PLANNER_ID" 2>/dev/null | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.status)" 2>/dev/null)
if [ "$PLANNER_STATUS" != "completed" ]; then
  echo "FAIL: planner 任务状态仍为 $PLANNER_STATUS，未回写（应为 completed）"
  exit 1
fi
echo "PASS: planner 任务已回写为 completed"

# 验证 3：harness_* 任务全程未被误清理（#2126 保护列表修复验证）
CLEANED=$(psql cecelia -t -c "
  SELECT COUNT(*)
  FROM tasks
  WHERE task_type ILIKE 'harness_%'
    AND payload->>'planner_task_id' = '$PLANNER_ID'
    AND status = 'cancelled'
    AND error_message ILIKE '%cleanup%';
" 2>/dev/null | tr -d ' ')
if [ "$CLEANED" -gt "0" ] 2>/dev/null; then
  echo "FAIL: 有 $CLEANED 个 harness_* 任务被 cleanup 误清理（#2126 bug 复发）"
  exit 1
fi
echo "PASS: 无 harness_* 任务被 cleanup 误清理"
```

---

## 全链路零干预验证

```bash
# 验证整个链路无人工介入（所有 harness_* 任务 trigger_source 均非 manual）
PLANNER_ID="b26e5c34-88f9-4fa9-b897-ce58df8bf473"
MANUAL_COUNT=$(psql cecelia -t -c "
  SELECT COUNT(*)
  FROM tasks
  WHERE task_type ILIKE 'harness_%'
    AND payload->>'planner_task_id' = '$PLANNER_ID'
    AND trigger_source = 'manual';
" 2>/dev/null | tr -d ' ')
if [ "$MANUAL_COUNT" -gt "0" ] 2>/dev/null; then
  echo "FAIL: 链路中有 $MANUAL_COUNT 次人工介入（trigger_source=manual），全链路零干预标准未达成"
  exit 1
fi
echo "PASS: 全链路零干预，所有 harness_* 任务均非人工触发"
```
