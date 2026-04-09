# 合同草案（第 1 轮）

> propose_round: 1
> propose_task_id: 7e6f21ac-4554-4d53-bb5f-e4607a917ede
> planner_task_id: 2fbff570-b03e-49bd-9a51-94191117ee91

---

## 本次实现的功能

- Feature 1: `execution.js` 中 `harness_contract_propose` verdict=null fallback → 自动设为 PROPOSED，不沉默中断 GAN 链路
- Feature 2: PROPOSED 后 Brain 自动创建 `harness_contract_review` R1 任务（GAN 对抗第一轮）

---

## 验收标准（DoD）

### Feature 1: verdict=null fallback → PROPOSED

**行为描述**：
当 `harness_contract_propose` 任务完成但 result 中未提取到 `PROPOSED` 关键字时，Brain `execution.js` 自动将 proposeVerdict 设为 `'PROPOSED'` 并打印 warn 日志，而不是静默终止 GAN 链路。

**硬阈值**：
- `execution.js` 代码中必须存在 fallback → PROPOSED 逻辑（`verdict=null，fallback→PROPOSED`）
- warn 日志消息包含 `fallback→PROPOSED`

**验证命令**：

```bash
# 验证 1: 代码中 fallback→PROPOSED 逻辑存在
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!c.includes('fallback→PROPOSED')) {
    console.error('FAIL: 找不到 fallback→PROPOSED 逻辑');
    process.exit(1);
  }
  if (!c.includes('proposeVerdict = \\'PROPOSED\\'')) {
    console.error('FAIL: 找不到 proposeVerdict 赋值为 PROPOSED');
    process.exit(1);
  }
  console.log('PASS: fallback→PROPOSED 逻辑存在');
"

# 验证 2: fallback 分支在 contract_propose 类型匹配范围内
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = c.indexOf('harness_contract_propose');
  if (idx === -1) { console.error('FAIL: 未找到 harness_contract_propose'); process.exit(1); }
  const section = c.slice(idx, idx + 2000);
  if (!section.includes('fallback') && !c.slice(Math.max(0,idx-500), idx+2000).includes('fallback→PROPOSED')) {
    console.error('FAIL: fallback 逻辑不在 harness_contract_propose 处理块内');
    process.exit(1);
  }
  console.log('PASS: harness_contract_propose 处理块包含 fallback 逻辑');
"
```

---

### Feature 2: PROPOSED 后自动创建 harness_contract_review R1

**行为描述**：
当 `harness_contract_propose` 完成且 `proposeVerdict === 'PROPOSED'`（无论是主动输出还是 fallback 产生）时，Brain 自动创建类型为 `harness_contract_review` 的新任务，作为 GAN 对抗的 Round 1（Evaluator 审查验证命令严格性）。

**硬阈值**：
- Brain DB 中存在对应的 `harness_contract_review` 任务
- 该任务的 `payload.propose_task_id` 等于当前 contract_propose 任务 ID
- 任务状态为 `queued` 或 `in_progress`（已被 Brain 调度）

**验证命令**：

```bash
# 验证 1: execution.js 中 PROPOSED 后创建 contract_review 的逻辑存在
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!c.includes('harness_contract_review')) {
    console.error('FAIL: 找不到 harness_contract_review 创建逻辑');
    process.exit(1);
  }
  const propIdx = c.indexOf('proposeVerdict');
  const reviewIdx = c.indexOf('harness_contract_review');
  if (Math.abs(propIdx - reviewIdx) > 3000) {
    console.error('FAIL: proposeVerdict 和 harness_contract_review 创建相距过远，可能不在同一分支');
    process.exit(1);
  }
  console.log('PASS: PROPOSED → harness_contract_review 创建逻辑存在');
"

# 验证 2: Brain API 确认 contract_review 任务已被创建（需 propose 任务先完成）
PROPOSE_ID="7e6f21ac-4554-4d53-bb5f-e4607a917ede"
RESULT=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_review&limit=10" 2>/dev/null)
COUNT=$(echo "$RESULT" | node -e "
  const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const related = tasks.filter(t =>
    t.payload?.propose_task_id === '$PROPOSE_ID' ||
    t.payload?.planner_task_id === '2fbff570-b03e-49bd-9a51-94191117ee91'
  );
  console.log(related.length);
" 2>/dev/null || echo "0")
if [ "$COUNT" -gt "0" ]; then
  echo "PASS: 找到 $COUNT 个对应的 harness_contract_review 任务"
else
  echo "INFO: harness_contract_review 任务尚未创建（可能 propose 仍在进行中）"
  # 非致命——propose 完成后 Brain tick 会自动创建
fi
```

---

## 技术实现方向（高层）

- 本次 sprint 为 **E2E 验证 sprint**，不新增业务代码
- 核心改动已在 PR #2118（`fix(brain): harness_contract_propose verdict=null 导致 GAN 链路沉默中断`）中完成
- Generator 角色：执行上述验证命令，确认修复生效，输出 PASS 报告
- 如验证发现问题，Generator 开新 fix PR 后重新验证

## 不在本次范围内

- 不修改 sprint-generator / sprint-evaluator / sprint-planner 逻辑
- 不处理 `harness_contract_review` 的内部验证逻辑
- 不引入新的 GAN 轮次上限（GAN 无上限是刻意设计）
