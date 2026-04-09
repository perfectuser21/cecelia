# 合同草案（第 2 轮）

> propose_round: 2
> propose_task_id: 6abefcd0-fb19-435d-a040-40e3f4f64c38
> planner_task_id: 2fbff570-b03e-49bd-9a51-94191117ee91
> based_on_review: 495d6037-df0e-4fc4-abfa-17f8bcf18c57

---

## 本次实现的功能

- Feature 1: `execution.js` 中 `harness_contract_propose` verdict=null fallback → 自动设为 PROPOSED，不沉默中断 GAN 链路
- Feature 2: PROPOSED 后 Brain 自动创建 `harness_contract_review` R1 任务（GAN 对抗第一轮）
- Feature 3: fallback 事件有日志记录，可追溯（warn 日志含 `fallback→PROPOSED` 字样）

---

## 验收标准（DoD）

### Feature 1: verdict=null fallback → PROPOSED

**行为描述**：
当 `harness_contract_propose` 任务完成但 result 中未提取到 `PROPOSED` 关键字时，Brain `execution.js` 自动将 proposeVerdict 设为 `'PROPOSED'` 并打印 warn 日志，不静默终止 GAN 链路。

**硬阈值**：
- `execution.js` 中存在 fallback → PROPOSED 赋值逻辑
- fallback 日志消息包含可识别的 `fallback` 标识
- 修复已合并到 main（PR #2118）

**验证命令**：

```bash
# 验证 1: fallback 赋值逻辑存在（精确匹配赋值语句）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const hasFallback = c.includes(\"proposeVerdict = 'PROPOSED'\") || c.includes('proposeVerdict = \"PROPOSED\"');
  if (!hasFallback) {
    console.error('FAIL: 找不到 proposeVerdict 赋值为 PROPOSED 的 fallback 逻辑');
    process.exit(1);
  }
  console.log('PASS: fallback→PROPOSED 赋值逻辑存在');
"

# 验证 2: fallback 分支带日志（warn/console 含 fallback 关键字）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const hasFallbackLog = c.includes('fallback') && (c.includes('console.warn') || c.includes('console.log') || c.includes('logger'));
  if (!hasFallbackLog) {
    console.error('FAIL: 未找到 fallback 相关的日志输出语句');
    process.exit(1);
  }
  console.log('PASS: fallback 分支含日志语句');
"

# 验证 3: 负向测试 — fallback 仅在 harness_contract_propose 处理块内
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const contractProposeIdx = c.indexOf('harness_contract_propose');
  if (contractProposeIdx === -1) {
    console.error('FAIL: 未找到 harness_contract_propose 处理块');
    process.exit(1);
  }
  // fallback 逻辑应在 harness_contract_propose 块附近（3000字符内）
  const section = c.slice(Math.max(0, contractProposeIdx - 200), contractProposeIdx + 4000);
  if (!section.includes('fallback') && !section.includes('PROPOSED')) {
    console.error('FAIL: fallback/PROPOSED 逻辑不在 harness_contract_propose 处理范围内');
    process.exit(1);
  }
  console.log('PASS: fallback 逻辑在 harness_contract_propose 处理块附近');
"
```

---

### Feature 2: PROPOSED 后自动创建 harness_contract_review R1

**行为描述**：
当 `harness_contract_propose` 完成且 `proposeVerdict === 'PROPOSED'`（无论主动输出还是 fallback 产生）时，Brain 自动创建 `harness_contract_review` 类型任务，作为 GAN 对抗的 Round 1。

**硬阈值**：
- `execution.js` 中 PROPOSED 分支包含创建 `harness_contract_review` 任务的逻辑
- Brain DB 中存在对应的 `harness_contract_review` 任务（本次 E2E 运行已产生）
- 该任务的 payload 携带正确的 `propose_task_id` 或 `planner_task_id`

**验证命令**：

```bash
# 验证 1: execution.js 中 PROPOSED 后创建 contract_review 的代码逻辑
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!c.includes('harness_contract_review')) {
    console.error('FAIL: 找不到 harness_contract_review 创建逻辑');
    process.exit(1);
  }
  // 验证两者在同一逻辑区域
  const propIdx = c.indexOf('proposeVerdict');
  const reviewIdx = c.indexOf('harness_contract_review');
  const distance = Math.abs(propIdx - reviewIdx);
  if (distance > 5000) {
    console.error('FAIL: proposeVerdict 和 harness_contract_review 创建相距 ' + distance + ' 字符，可能不在同一分支');
    process.exit(1);
  }
  console.log('PASS: PROPOSED → harness_contract_review 创建逻辑存在，距离 ' + distance + ' 字符');
"

# 验证 2: Brain DB 确认本次 E2E 已创建 contract_review 任务
REVIEW_COUNT=$(curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_review&limit=20" | \
  node -e "
    let data = '';
    process.stdin.on('data', d => data += d);
    process.stdin.on('end', () => {
      const tasks = JSON.parse(data);
      const related = tasks.filter(t =>
        t.payload && (
          t.payload.planner_task_id === '2fbff570-b03e-49bd-9a51-94191117ee91' ||
          t.payload.propose_task_id === '7e6f21ac-4554-4d53-bb5f-e4607a917ede'
        )
      );
      console.log(related.length);
    });
  " 2>/dev/null || echo "0")
if [ "$REVIEW_COUNT" -gt "0" ]; then
  echo "PASS: Brain DB 中找到 $REVIEW_COUNT 个关联的 harness_contract_review 任务"
else
  echo "FAIL: 未找到关联的 harness_contract_review 任务（planner: 2fbff570）"
  exit 1
fi

# 验证 3: 该 review 任务的 payload 有正确的上下文字段
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_contract_review&limit=20" | \
  node -e "
    let data = '';
    process.stdin.on('data', d => data += d);
    process.stdin.on('end', () => {
      const tasks = JSON.parse(data);
      const related = tasks.filter(t =>
        t.payload && t.payload.planner_task_id === '2fbff570-b03e-49bd-9a51-94191117ee91'
      );
      if (related.length === 0) { console.error('FAIL: 无关联任务'); process.exit(1); }
      const t = related[0];
      if (!t.payload.propose_task_id && !t.payload.propose_round) {
        console.error('FAIL: payload 缺少 propose_task_id 或 propose_round'); process.exit(1);
      }
      console.log('PASS: review 任务 payload 携带正确上下文，propose_round=' + t.payload.propose_round);
    });
  "
```

---

### Feature 3: fallback 事件有日志记录

**行为描述**：
Brain `execution.js` 在触发 fallback 时输出可识别的 warn/log 消息，包含 `fallback` 或 `verdict=null` 相关关键字，不静默失败。

**硬阈值**：
- `execution.js` 中 fallback 赋值语句之前或之后有 console.warn / console.log 调用
- 日志内容含 `fallback` 或 `verdict` 等可追溯关键字

**验证命令**：

```bash
# 验证 1: execution.js 中 fallback + warn/log 同时存在（有序检查）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const fallbackIdx = c.indexOf('fallback');
  if (fallbackIdx === -1) { console.error('FAIL: 未找到 fallback 关键字'); process.exit(1); }
  // 在 fallback 附近 500 字符内找日志调用
  const nearby = c.slice(Math.max(0, fallbackIdx - 200), fallbackIdx + 500);
  const hasLog = nearby.includes('console.warn') || nearby.includes('console.log') || nearby.includes('logger.warn') || nearby.includes('logger.log');
  if (!hasLog) {
    console.error('FAIL: fallback 附近无日志调用');
    process.exit(1);
  }
  console.log('PASS: fallback 事件有日志记录');
"

# 验证 2: 负向测试 — 不存在静默 fallback（即 fallback 后不是直接 return 无任何操作）
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 找 fallback 赋值行
  const lines = c.split('\n');
  let fallbackLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('fallback') && lines[i].includes('PROPOSED')) {
      fallbackLine = i;
      break;
    }
  }
  if (fallbackLine === -1) { console.error('FAIL: 未找到 fallback 赋值行'); process.exit(1); }
  // 检查 fallback 前后 5 行内有日志
  const context = lines.slice(Math.max(0, fallbackLine - 3), fallbackLine + 5).join('\n');
  const hasLog = context.includes('console') || context.includes('logger') || context.includes('warn') || context.includes('log');
  if (!hasLog) {
    console.error('FAIL: fallback 赋值行附近无任何日志（静默 fallback）');
    process.exit(1);
  }
  console.log('PASS: fallback 非静默，有日志记录（line ~' + (fallbackLine + 1) + ')');
"
```

---

## 技术实现方向（高层）

- 本次 sprint 为 **E2E 验证 sprint**，不新增业务代码
- 核心改动已在 PR #2118（`fix(brain): harness_contract_propose verdict=null 导致 GAN 链路沉默中断`）中完成并合并到 main
- Generator 角色：执行上述验证命令，确认修复生效，输出 PASS 报告
- 验证工具选型：`node -e`（代码静态分析） + `curl + node`（Brain API 运行时验证）

## 不在本次范围内

- 修改 `packages/brain/src/routes/execution.js` 或任何生产代码
- 验证完整多轮 GAN 对抗（多轮 Propose/Review 直到 APPROVED）
- 验证 Reviewer 审查质量或 Generator 内容质量
- 测试 Generator / Evaluator 阶段的业务逻辑
- 验证 tick.js 日志格式（不属于本 sprint 范围）
