# Contract Review Feedback (Round 9)

> Triple 覆盖率: 14/14 = 100%（Feature 1: 4, Feature 2: 4, Feature 3: 6）
> Feature 2 命令质量高，无需修改。

## 必须修改项

### 1. [命令窗口不足] Feature 1 Path 6 — 600 字符窗口导致正确实现 FAIL

**原始命令**:
```javascript
const reportBlock = afterGen.substring(lastWsIdx, lastWsIdx + 600);
// ... regex 检查 contract_branch
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：把 contract_branch 放在注释里（位于 431 字符内），regex 命中
// 但实际 payload 字段不含 contract_branch
if (currentWsIdx === totalWsCount) {
  // contract_branch: harnessPayload.contract_branch (TODO)
  await createHarnessTask({
    payload: {
      sprint_dir: harnessPayload.sprint_dir,
      harness_mode: true
      // contract_branch 不在这里
    }
  });
}
```

**逐字符计算证明**:
- `currentWsIdx === totalWsCount` 到 `payload: {` = ~431 字符
- `planner_task_id` 字段结尾 = ~616 字符（已超 600）
- `harness_mode: true` = ~803 字符
- `contract_branch` 自然放置位置 = ~858 字符

**建议修复命令**（两处：Feature 验证命令 + WS1 DoD 最后一条 Test）:
```javascript
// 方案 A: 增大窗口到 1200
const reportBlock = afterGen.substring(lastWsIdx, lastWsIdx + 1200);

// 方案 B（更健壮）: 用块结束符定界
const reportBlock = afterGen.substring(lastWsIdx);
const blockEnd = reportBlock.indexOf('} else {') || reportBlock.indexOf('console.log');
const scopedBlock = blockEnd > 0 ? reportBlock.substring(0, blockEnd) : reportBlock.substring(0, 1200);
```

**影响范围**: Feature 1 验证命令 Path 6 + Workstream 1 DoD 第 4 条 Test（两处均用 600 字符窗口）

---

### 2. [逻辑验证缺失] Feature 3 Command 2 — result null 检查只验证存在，不验证条件守护

**原始命令**:
```javascript
if (!/result\s*(===?\s*null|==\s*null|!==?\s*null)/.test(noComments)) {
  console.error('FAIL: 未找到 result null 判断');
  process.exit(1);
}
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：null 检查只用于日志，createTask 无条件执行
// 通过全部 6 条 Feature 3 验证命令！
if (harnessType === 'harness_report') {
  if (result === null) console.log('session crashed');  // 3.2 regex 命中
  // 无条件重试 — 正常完成也被重试（错误行为）
  const retryCount = (harnessPayload.retry_count || 0) + 1;
  if (retryCount >= 3) { console.log('max retries'); return; }  // 3.3 命中
  await createTask({
    payload: {
      sprint_dir: harnessPayload.sprint_dir,       // 3.4 命中
      planner_task_id: harnessPayload.planner_task_id,
      retry_count: retryCount,
      pr_url: harnessPayload.pr_url
    }
  });
}
```

**建议修复命令**:
```javascript
// 验证 createTask 在 result null 条件块内（result===null 到 createTask 之间无其他 if 层级）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  const nc = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // 验证 result === null（或 !result）出现在 createTask 之前，且 createTask 在其条件块内
  const nullIdx = nc.search(/result\s*===?\s*null|!\s*result/);
  const createIdx = nc.search(/createTask|createHarnessTask/);
  if (nullIdx < 0) { console.error('FAIL: 无 result null 判断'); process.exit(1); }
  if (createIdx < 0) { console.error('FAIL: 无 createTask 调用'); process.exit(1); }
  if (createIdx < nullIdx) {
    console.error('FAIL: createTask 出现在 result null 判断之前（重试未被条件守护）');
    process.exit(1);
  }
  console.log('PASS: createTask 在 result null 条件判断之后');
"
```

## 可选改进

- Feature 1 Path 3/4/5 验证命令未去除注释（Feature 3 一致地去除了），建议统一加注释剥离以防万一
- Feature 3 ARTIFACT 检查（测试文件）只验证文件存在，可加 `readFileSync` 检查文件含 `describe` 或 `test` 关键字
