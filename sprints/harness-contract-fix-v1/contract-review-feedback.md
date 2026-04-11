# Contract Review Feedback (Round 8)

> Feature 1 和 Feature 2 验证命令质量高，无需改动。
> 问题集中在 Feature 3：3 条命令均未验证 `result === null` 触发条件。

## 必须修改项

### 1. [命令太弱] Feature 3 — 缺少 result === null 条件验证（P0）

**问题**: Feature 3 的 3 条验证命令均未检查 harness_report 重试是否以 `result === null` 为前提条件。一个无条件重试的实现能通过全部命令，却会在每次 harness_report 正常完成时也触发重试，造成无限循环。

**原始命令**:
```bash
# 命令 3.1: 只检查 createTask 存在，不检查触发条件
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  if (!block.includes('createTask') && !block.includes('createHarnessTask')) { process.exit(1); }
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：不管 result 是什么都重试 → 通过全部 3 条 Feature 3 验证命令
if (harnessType === 'harness_report') {
  const retryCount = (harnessPayload.retry_count || 0);
  if (retryCount >= 3) { return; }
  await createHarnessTask({
    task_type: 'harness_report',
    payload: {
      sprint_dir: harnessPayload.sprint_dir,
      planner_task_id: harnessPayload.planner_task_id,
      pr_url: prUrl,
      retry_count: retryCount + 1
    }
  });
}
// ↑ 每次 harness_report 成功完成也会触发重试，3轮后才停
// ↑ 但通过了所有验证命令（有 createTask、有 >= 3、有 4 个字段）
```

**建议修复命令**（新增一条，插入 Feature 3 验证命令序列中）:
```bash
# 验证 result === null / !result 条件存在（重试必须是条件触发）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  if (idx < 0) { console.error('FAIL: 缺少 harness_report 回调分支'); process.exit(1); }
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '');
  // 必须存在 null 检查条件（result === null / result == null / !result / result === undefined）
  if (!/result\s*===?\s*null/.test(noComments) && !/!\s*result/.test(noComments) && !/result\s*===?\s*undefined/.test(noComments)) {
    console.error('FAIL: harness_report 重试未以 result === null 为条件，可能导致无条件重试');
    process.exit(1);
  }
  console.log('PASS: harness_report 重试有 result null 检查');
"
```

同时建议将此条件加入 DoD（Workstream 1）:
```
- [ ] [BEHAVIOR] harness_report 重试仅在 result === null 时触发，result 有值时不重试
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/execution.js','utf8');const i=c.indexOf(\"harnessType === 'harness_report'\");if(i<0)process.exit(1);const b=c.substring(i,i+1500).replace(/\/\/.*$/gm,'');if(!/result\s*===?\s*null/.test(b)&&!/!\s*result/.test(b)){console.error('FAIL');process.exit(1)}console.log('PASS')"
```

### 2. [命令太弱] Feature 3 — retry_count >= 3 块可能先 createTask 再 return

**原始命令**:
```bash
# 命令 3.2: 只检查 >= 3 后有 return，不检查 return 前是否有 createTask
const afterLimit = noComments.substring(limitIdx, limitIdx + 300);
if (!/return|break|throw/.test(afterLimit.substring(0, 200))) { ... }
```

**假实现片段**（proof-of-falsification）:
```javascript
if (retryCount >= 3) {
  // 超限但仍然创建任务（bug），然后 return
  await createHarnessTask({ task_type: 'harness_report', payload: {...} });
  console.log('max retries reached');
  return; // ← return 存在 → 命令 PASS，但任务已经创建了
}
```

**建议修复命令**（替换原命令 3.2 的终止语句检查部分）:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  if (idx < 0) { console.error('FAIL: 缺少 harness_report 回调分支'); process.exit(1); }
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!/retry_count\s*>=\s*3/.test(noComments)) {
    console.error('FAIL: 未找到 retry_count >= 3 检查');
    process.exit(1);
  }
  // 提取 >= 3 到 return 之间的代码，确保无 createTask
  const limitIdx = noComments.search(/retry_count\s*>=\s*3/);
  const afterLimit = noComments.substring(limitIdx, limitIdx + 300);
  const returnIdx = afterLimit.search(/return|break|throw/);
  if (returnIdx < 0) {
    console.error('FAIL: retry_count >= 3 后无 return/break/throw');
    process.exit(1);
  }
  const beforeReturn = afterLimit.substring(0, returnIdx);
  if (/create(Harness)?Task/.test(beforeReturn)) {
    console.error('FAIL: retry_count >= 3 块内在 return 前调用了 createTask');
    process.exit(1);
  }
  console.log('PASS: >= 3 检查 + 终止语句 + 无越界 createTask');
"
```

## 可选改进

- Feature 3 命令 3.1 未去注释（`block.includes('createTask')` 会匹配注释中的 createTask），建议加 `.replace(/\/\/.*$/gm, '')`。影响低，不阻塞。
- Feature 2 命令 2.1 未验证返回的 task_type 值以 `harness_` 开头。影响低，真实 DB 数据自然满足。
