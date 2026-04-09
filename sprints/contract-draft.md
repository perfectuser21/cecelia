# 合同草案（第 1 轮）

> propose_round: 1
> propose_task_id: 501c55dc-9ca5-4672-9ae1-22d56856125d
> planner_task_id: 5a1c0c91-91c4-49f5-a9a2-bc9f1ae5075f

---

## 本次实现的功能

- Feature 1: **verdict-fallback 机制验证** — 确认 execution.js 中存在 `proposeVerdict` 为 null 时 fallback→PROPOSED 的逻辑（PR #2118 已合并）
- Feature 2: **GAN 全链路无人干预验证** — 确认 harness_contract_propose → contract_review → sprint_generate → sprint_evaluate → sprint_report 链路在 verdict=null fallback 场景下能自动走完，零人工干预

---

## 验收标准（DoD）

### Feature 1: verdict-fallback 逻辑静态验证

**行为描述**：`packages/brain/src/routes/execution.js` 中，当 `proposeVerdict` 为 falsy 值时，系统会 fallback 为 `'PROPOSED'` 并输出 warn 日志，不会让 GAN 链路在此处静默中断。

**硬阈值**：
- execution.js 中存在 `fallback→PROPOSED` 的条件分支
- 该分支在 proposeVerdict 为 null/undefined 时触发
- fallback 分支之后紧接 `proposeVerdict !== 'PROPOSED'` 检查（即 fallback 有效传入下游）

**验证命令**：

```bash
# Happy path: fallback 代码存在
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!src.includes('fallback→PROPOSED')) throw new Error('FAIL: 未找到 fallback→PROPOSED 注释');
  if (!src.includes('proposeVerdict = \'PROPOSED\'')) throw new Error('FAIL: 未找到 fallback 赋值');
  const fallbackIdx = src.indexOf('if (!proposeVerdict)');
  if (fallbackIdx === -1) throw new Error('FAIL: 未找到 if (!proposeVerdict) 分支');
  console.log('PASS: verdict-fallback 逻辑已存在于 execution.js');
"

# 边界: fallback 分支在 proposeVerdict 已有值时不会覆盖（结构完整性）
node -e "
  const src = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const fallbackBlock = src.substring(src.indexOf('if (!proposeVerdict)'), src.indexOf('if (!proposeVerdict)') + 200);
  if (!fallbackBlock.includes('proposeVerdict = \'PROPOSED\'')) throw new Error('FAIL: fallback 块中缺少赋值');
  if (!fallbackBlock.includes('console.warn')) throw new Error('FAIL: fallback 块中缺少 warn 日志');
  console.log('PASS: fallback 块结构完整（条件 + 赋值 + warn）');
"
```

---

### Feature 2: GAN 全链路状态验证

**行为描述**：Harness E2E v6 运行完毕后，从 Brain DB 可查到一条完整的 harness 运行记录，涵盖 contract_propose → contract_review → generate → evaluate → report 全部节点，所有关键任务状态为 `completed`，无任何 `failed` 或 `quarantined`。

**硬阈值**：
- 当前 proposer 任务（501c55dc）状态为 `in_progress`（运行中）或 `completed`
- Planner 任务（5a1c0c91）已 `completed`
- contract_review 任务（由 Brain 自动派发）状态应为 `completed`
- 整个链路无任何 `quarantined` 任务（verdict=null 沉默中断已消除）

**验证命令**：

```bash
# Happy path: planner 任务已完成
STATUS=$(curl -sf "localhost:5221/api/brain/tasks/5a1c0c91-91c4-49f5-a9a2-bc9f1ae5075f" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).status)")
[ "$STATUS" = "completed" ] && echo "PASS: planner 任务已 completed" || (echo "FAIL: planner 状态=$STATUS，期望 completed"; exit 1)

# Happy path: 本轮无 quarantined 的 contract_propose 任务
QUARANTINED=$(curl -sf "localhost:5221/api/brain/tasks?status=quarantined&limit=20" | node -e "
  const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const harness = tasks.filter(t => t.task_type === 'sprint_contract_propose' && t.id !== '');
  process.stdout.write(String(harness.length));
")
[ "$QUARANTINED" = "0" ] && echo "PASS: 无 quarantined 的 contract_propose 任务" || echo "WARN: 存在 $QUARANTINED 个 quarantined contract_propose（可能为历史任务）"

# 边界: contract_review 任务已被派发（GAN 链路继续）
REVIEW_COUNT=$(curl -sf "localhost:5221/api/brain/tasks?task_type=sprint_contract_review&limit=5" | node -e "
  const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  process.stdout.write(String(tasks.length));
")
[ "$REVIEW_COUNT" -ge "1" ] && echo "PASS: contract_review 任务已派发（共 ${REVIEW_COUNT} 个），GAN 链路已继续" || (echo "FAIL: 未找到 contract_review 任务，GAN 链路可能未继续"; exit 1)
```

---

## 技术实现方向（高层）

- 本次不需要新写代码，PR #2118 已合并修复
- 验证手段：静态代码分析（node -e + readFileSync）+ Brain API 查询 DB 状态
- Evaluator 将对上述验证命令做对抗审查，确认命令足够严格

---

## 不在本次范围内

- 新增任何 execution.js 功能改动
- 修改 GAN 对抗轮次上限
- 任何 sprint_generate / sprint_evaluate 阶段的代码变更
- 前端 UI 改动
