# 合同草案（第 1 轮）

**目标**：验证 PR #2118 的 `harness_contract_propose verdict=null → fallback→PROPOSED → R1 自动创建 → GAN 全链路` 修复已正确部署并生效，同时修复因此导致的测试文件过时问题。

---

## 本次实现的功能

- Feature A: `execution.js` fallback 逻辑静态验证（代码已部署且结构正确）
- Feature B: 测试文件更新（`harness-sprint-loop-v3.test.js` 测试 #11/#12 反映旧行为，需更新以匹配 PR #2118 新行为）
- Feature C: 动态链路验证（当前 harness 运行后 `harness_contract_review` 任务被自动创建）

---

## 验收标准（DoD）

### Feature A: execution.js fallback 逻辑已部署

**行为描述**：`harness_contract_propose` 任务完成后，若 agent 未输出 `PROPOSED` 关键字，`execution.js` 应强制将 `proposeVerdict` 设为 `PROPOSED` 并继续创建 review 任务，而非沉默卡死链路。

**硬阈值**：
- `execution.js` 中 fallback 分支紧随纯文本 PROPOSED 检测之后（行序正确）
- fallback 存在 `console.warn` 记录（可观测性）
- fallback 后 `proposeVerdict` 必为 `'PROPOSED'`

**验证命令**：
```bash
# Happy path: fallback 代码存在且位置正确
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
const fallbackIdx = c.indexOf('verdict=null，fallback→PROPOSED');
if (fallbackIdx === -1) { console.error('FAIL: fallback warn 日志不存在'); process.exit(1); }
// fallback 块必须包含 proposeVerdict = \"PROPOSED\"
const block = c.slice(fallbackIdx - 200, fallbackIdx + 300);
if (!block.includes(\"proposeVerdict = 'PROPOSED'\")) { console.error('FAIL: fallback 未赋值 PROPOSED'); process.exit(1); }
// fallback 必须在 proposeVerdict !== PROPOSED 检查之前
const fallbackAssignIdx = c.indexOf(\"proposeVerdict = 'PROPOSED'\", fallbackIdx - 50);
const guardIdx = c.indexOf(\"proposeVerdict !== 'PROPOSED'\");
if (fallbackAssignIdx > guardIdx) { console.error('FAIL: fallback 赋值在 guard 之后，链路仍会中断'); process.exit(1); }
console.log('PASS: fallback 逻辑已部署，位置正确');
"

# 边界: console.warn 日志可观测
node -e "
const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
if (!c.includes('console.warn') || !c.includes('fallback→PROPOSED')) { console.error('FAIL: warn 日志缺失'); process.exit(1); }
console.log('PASS: console.warn fallback 日志存在');
"
```

---

### Feature B: 测试文件更新（覆盖 fallback 新行为）

**行为描述**：`harness-sprint-loop-v3.test.js` 中测试 #11（`verdict=null → 不创建 review`）和 #12（`verdict=undefined → 不创建 review`）描述的是 PR #2118 **之前**的旧行为。新行为应是 `verdict=null` → fallback→PROPOSED → 创建 review 任务。测试必须更新以匹配新行为，否则会给后续开发者传递错误的期望。

**硬阈值**：
- 测试 #11 的期望必须从 `not.toHaveBeenCalled()` 改为 `toHaveBeenCalled()`（或测试整个被删除/重命名）
- `simulateHarnessCallback` 中的 `sprint_contract_propose` 处理逻辑需加入与 `execution.js` 对齐的 fallback 分支

**验证命令**：
```bash
# Happy path: 测试文件已包含 fallback 覆盖
node -e "
const c = require('fs').readFileSync('packages/brain/src/__tests__/harness-sprint-loop-v3.test.js', 'utf8');
// 应包含 fallback 场景描述
if (!c.includes('fallback') && !c.includes('verdict=null.*PROPOSED') && !c.includes('null.*fallback')) {
  // 检查是否至少更新了 test #11 期望
  const t11Block = c.match(/11[\s\S]{0,50}verdict=null[\s\S]{0,400}/);
  if (t11Block && t11Block[0].includes('not.toHaveBeenCalled')) {
    console.error('FAIL: 测试 #11 仍描述旧行为（not.toHaveBeenCalled），需更新'); process.exit(1);
  }
}
console.log('PASS: 测试文件已更新或不含矛盾描述');
"

# 边界: simulateHarnessCallback 包含 fallback 分支
node -e "
const c = require('fs').readFileSync('packages/brain/src/__tests__/harness-sprint-loop-v3.test.js', 'utf8');
const simFn = c.match(/simulateHarnessCallback[\s\S]{0,5000}sprint_contract_propose[\s\S]{0,2000}/);
if (!simFn) { console.log('WARN: 未找到 simulateHarnessCallback，跳过'); process.exit(0); }
// 如果还没加 fallback 则失败
if (!simFn[0].includes('fallback') && !simFn[0].includes('proposeVerdict = .PROPOSED')) {
  console.error('FAIL: simulateHarnessCallback 未同步 fallback 逻辑'); process.exit(1);
}
console.log('PASS: simulateHarnessCallback 已同步 fallback 分支');
"
```

---

### Feature C: 当前 harness 链路 — harness_contract_review 任务已被创建

**行为描述**：本次 `harness_contract_propose` 任务（`e1662ee4-74d7-4e3c-94dc-208f8c3f56e2`）完成后，fallback 应触发创建一个 `harness_contract_review` 任务（R1）。可通过 Brain API 查询验证链路正常触通。

**硬阈值**：
- Brain 数据库中存在 `task_type = 'harness_contract_review'`、`payload.propose_task_id = 'e1662ee4-...'` 的任务
- 该 review 任务状态非 `failed`（允许 pending/in_progress/completed）

**验证命令**：
```bash
# Happy path: review 任务已存在
REVIEW_TASK=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_review&limit=5" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const t = tasks.find(t => t.payload && t.payload.propose_task_id && t.payload.propose_task_id.startsWith('e1662ee4'));
    if (!t) { console.error('FAIL: 未找到关联 harness_contract_review 任务'); process.exit(1); }
    console.log('PASS: review 任务已创建，id=' + t.id + '，status=' + t.status);
  ")
echo "$REVIEW_TASK"

# 边界: review 任务未处于 failed 状态
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_review&limit=5" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const t = tasks.find(t => t.payload && t.payload.propose_task_id && t.payload.propose_task_id.startsWith('e1662ee4'));
    if (!t) { console.error('FAIL: 未找到 review 任务'); process.exit(1); }
    if (t.status === 'failed') { console.error('FAIL: review 任务已 failed，链路中断'); process.exit(1); }
    console.log('PASS: review 任务 status=' + t.status + '，链路未中断');
  "
```

---

## 技术实现方向（高层）

- **Feature A**：静态验证，无需代码变更（PR #2118 已完成）
- **Feature B**：更新 `packages/brain/src/__tests__/harness-sprint-loop-v3.test.js`：
  1. 在 `simulateHarnessCallback` 的 `sprint_contract_propose` 处理块末尾加入 fallback 分支（与 `execution.js` 对齐）
  2. 测试 #11 改为验证 fallback 行为（`verdict=null → 应创建 review 任务`）
  3. 测试 #12 改为验证 `error: auth_failed` 仍走 fallback（因为 result 不含 FAILED 明确拒绝）
  4. 新增测试 #N：`verdict=null + AI Done → fallback→PROPOSED，review 任务已创建`
- **Feature C**：动态验证，在 Generator 执行验证脚本时通过 Brain API 检查

## 不在本次范围内

- 完整端到端 GAN 对抗循环验证（Evaluator/Generator 后续阶段）
- harness_contract_review 任务的具体执行结果
- 其他 harness task_type 的 fallback 逻辑（仅验证 `harness_contract_propose`）
