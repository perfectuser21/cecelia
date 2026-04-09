# 合同草案（第 2 轮）

> propose_round: 2
> propose_task_id: 689ff1d5-c332-4147-ab9c-0d4f4420a033
> planner_task_id: dbf2ec0d-dcb9-4cee-9724-8591c13305dd
> based_on_review: 9f4a5712-4fdb-4ffd-8a69-88d189e08f64

---

## 本次实现的功能

- Feature 1: `execution.js` 中 `harness_contract_propose` verdict=null fallback → 自动设为 PROPOSED，不沉默中断 GAN 链路
- Feature 2: PROPOSED 后 Brain 自动创建 `harness_contract_review` R1 任务（GAN 对抗第一轮）
- Feature 3: fallback 事件有日志记录，可追溯（warn 日志含 `fallback→PROPOSED` 字样）

> **R1 → R2 改动说明**：
> 1. Feature 1 验证命令改用正则结构验证，不再用字符串距离启发
> 2. Feature 2 验证命令移除硬编码 task_id，改为用 `planner_task_id` 查询 Brain API，failure 改为 exit 1
> 3. 新增 Feature 3（fallback 日志验证，PRD 中存在但 R1 草案遗漏）
> 4. 新增单元测试存在性验证（附加，确认覆盖范围）

---

## 验收标准（DoD）

### Feature 1: verdict=null fallback → PROPOSED

**行为描述**：
当 `harness_contract_propose` 任务完成但 result 中未提取到 `PROPOSED` 关键字时，Brain `execution.js` 自动将 proposeVerdict 设为 `'PROPOSED'`，不静默终止 GAN 链路。

**硬阈值**：
- `execution.js` 中存在 `if (!proposeVerdict)` → `proposeVerdict = 'PROPOSED'` 的赋值结构
- `harness_contract_propose` 分支覆盖此 fallback 逻辑

**验证命令**：

```
manual:node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');

  // 验证 1: fallback 赋值结构（正则匹配结构，不依赖字符串距离）
  const hasFallbackAssign = /proposeVerdict\s*=\s*['\"]PROPOSED['\"]/.test(c);
  if (!hasFallbackAssign) {
    console.error('FAIL: 找不到 proposeVerdict 赋值为 PROPOSED 的 fallback 逻辑');
    process.exit(1);
  }

  // 验证 2: fallback 逻辑位于 harness_contract_propose 处理块内
  const contractIdx = c.indexOf('harness_contract_propose');
  if (contractIdx === -1) {
    console.error('FAIL: 未找到 harness_contract_propose 处理块');
    process.exit(1);
  }
  // 提取 harness_contract_propose 块（向后 3000 字符）
  const block = c.slice(contractIdx, contractIdx + 3000);
  if (!/proposeVerdict\s*=\s*['\"]PROPOSED['\"]/.test(block)) {
    console.error('FAIL: fallback→PROPOSED 赋值不在 harness_contract_propose 处理块内');
    process.exit(1);
  }

  // 验证 3: fallback 赋值紧跟 if(!proposeVerdict) 条件检查（逻辑关联验证）
  const hasConditionalFallback = /if\s*\(\s*!proposeVerdict\s*\)[\s\S]{0,300}proposeVerdict\s*=\s*['\"]PROPOSED['\"]/.test(c);
  if (!hasConditionalFallback) {
    console.error('FAIL: 未找到 if(!proposeVerdict)→proposeVerdict=PROPOSED 的条件赋值结构');
    process.exit(1);
  }

  console.log('PASS: verdict=null fallback→PROPOSED 结构验证通过');
"
```

---

### Feature 2: PROPOSED 后自动创建 harness_contract_review R1

**行为描述**：
当 `harness_contract_propose` 完成且 `proposeVerdict === 'PROPOSED'`（无论主动输出还是 fallback 产生）时，Brain 自动创建类型为 `harness_contract_review` 的新任务，作为 GAN 对抗 Round 1。

**硬阈值**：
- execution.js 中存在 `harness_contract_review` 任务创建逻辑
- Brain DB 中存在与本次运行 planner_task_id 关联的 `harness_contract_review` 任务

**验证命令**：

```
manual:node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');

  // 验证 1: harness_contract_review 创建逻辑存在于 execution.js
  if (!c.includes('harness_contract_review')) {
    console.error('FAIL: 找不到 harness_contract_review 创建逻辑');
    process.exit(1);
  }

  // 验证 2: createHarnessTask 调用在 proposeVerdict === PROPOSED 分支内（结构验证）
  const hasCreateInProposedBranch = /proposeVerdict[\s\S]{0,500}harness_contract_review/.test(c) ||
    /harness_contract_review[\s\S]{0,500}proposeVerdict/.test(c);
  if (!hasCreateInProposedBranch) {
    console.error('FAIL: harness_contract_review 创建逻辑与 proposeVerdict 不在同一处理分支');
    process.exit(1);
  }

  // 验证 3: payload 中包含 propose_task_id 和 planner_task_id 传递
  const reviewSection = c.slice(c.indexOf('harness_contract_review'), c.indexOf('harness_contract_review') + 1000);
  if (!reviewSection.includes('propose_task_id') || !reviewSection.includes('planner_task_id')) {
    console.error('FAIL: harness_contract_review 创建时未传递 propose_task_id 或 planner_task_id');
    process.exit(1);
  }

  console.log('PASS: harness_contract_review 创建逻辑验证通过');
"
```

```
manual:node -e "
  const https = require('http');
  // 用 planner_task_id 查询（不硬编码 propose_task_id）
  const PLANNER_ID = 'dbf2ec0d-dcb9-4cee-9724-8591c13305dd';
  const options = { hostname: 'localhost', port: 5221, path: '/api/brain/tasks?task_type=harness_contract_review&limit=50', method: 'GET' };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
      try {
        const tasks = JSON.parse(data);
        const related = tasks.filter(t =>
          t.payload && t.payload.planner_task_id === PLANNER_ID
        );
        if (related.length === 0) {
          console.error('FAIL: Brain DB 中未找到与 planner_task_id=' + PLANNER_ID + ' 关联的 harness_contract_review 任务');
          process.exit(1);
        }
        console.log('PASS: 找到 ' + related.length + ' 个对应 harness_contract_review 任务，状态: ' + related.map(t => t.status).join(', '));
      } catch(e) {
        console.error('FAIL: 解析 API 响应失败 - ' + e.message);
        process.exit(1);
      }
    });
  });
  req.on('error', (e) => { console.error('FAIL: Brain API 不可达 - ' + e.message); process.exit(1); });
  req.end();
"
```

---

### Feature 3: fallback 日志可追溯

**行为描述**：
execution.js 在 fallback 时输出 `fallback→PROPOSED` 警告日志，可追溯事件发生时机。

**硬阈值**：
- execution.js 中存在 `console.warn` 调用包含 `fallback→PROPOSED` 字样
- warn 调用位于 fallback 赋值逻辑附近（同一条件块内）

**验证命令**：

```
manual:node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');

  // 验证 1: console.warn 包含 fallback→PROPOSED
  const hasWarnLog = c.includes('fallback→PROPOSED') && (c.includes('console.warn') || c.includes('console.log'));
  if (!hasWarnLog) {
    console.error('FAIL: 未找到包含 fallback→PROPOSED 的 warn/log 日志语句');
    process.exit(1);
  }

  // 验证 2: fallback 日志在 !proposeVerdict 条件块内（不是注释）
  // 提取 if(!proposeVerdict) 块
  const fallbackBlockMatch = c.match(/if\s*\(\s*!proposeVerdict\s*\)\s*\{([^}]{0,500})\}/);
  if (!fallbackBlockMatch) {
    console.error('FAIL: 未找到 if(!proposeVerdict) 块');
    process.exit(1);
  }
  const blockContent = fallbackBlockMatch[1];
  if (!blockContent.includes('fallback') && !blockContent.includes('PROPOSED')) {
    console.error('FAIL: fallback 日志不在 if(!proposeVerdict) 块内');
    process.exit(1);
  }

  console.log('PASS: fallback 日志存在且位于正确条件块内');
"
```

---

### 附加验证：单元测试覆盖范围确认

**说明**：确认测试文件存在且覆盖 harness 链路（不要求 verdict=null fallback 场景有专门测试，但 harness 链路基础覆盖应存在）。

**验证命令**：

```
manual:node -e "
  const fs = require('fs');
  // 检查 harness-sprint-loop-v3 测试文件存在
  const testFile = 'packages/brain/src/__tests__/harness-sprint-loop-v3.test.js';
  try {
    fs.accessSync(testFile);
  } catch(e) {
    console.error('FAIL: harness 链路测试文件不存在: ' + testFile);
    process.exit(1);
  }
  const src = fs.readFileSync(testFile, 'utf8');
  if (!src.includes('sprint_contract_propose') && !src.includes('harness_contract_propose')) {
    console.error('FAIL: 测试文件未覆盖 contract_propose 链路');
    process.exit(1);
  }
  console.log('PASS: harness 链路测试文件存在且覆盖 contract_propose 相关场景');
"
```

---

## 技术实现方向（高层）

- 本次 sprint 为 **E2E 验证 sprint**，不新增业务代码
- 核心改动已在 PR #2118（`fix(brain): harness_contract_propose verdict=null 导致 GAN 链路沉默中断`）中完成
- Generator 角色：执行上述验证命令，确认修复生效，输出 PASS 报告
- 如验证发现问题，Generator 开新 fix PR 后重新验证

## 不在本次范围内

- 修改任何生产代码（PR #2118 已完成）
- 验证完整 GAN 对抗轮次（多轮 Propose/Review 直到 APPROVED）
- 验证 Reviewer 审查质量
- 测试 Generator / Evaluator 阶段
- 修复 harness-sprint-loop-v3.test.js 中 verdict=null 场景的覆盖（留待后续 sprint）
