# Contract Review Feedback (Round 2)

> Triple 覆盖率：11/11 = 100%
> can_bypass: 3/11（Feature 1 ×2, Feature 3 ×1）

---

## 必须修改项

### 1. [命令太弱] Feature 1 — execution.js contract_branch 来源零验证

**原始命令**（Command 1.3 + 1.4 联合缺陷）:
```bash
# Command 1.3: 只检查 'contract_branch' 字符串存在
node -e "...fixBlock.includes('contract_branch')..."

# Command 1.4: 只查 harness-watcher.js，完全不查 execution.js
node -e "...readFileSync('packages/brain/src/harness-watcher.js')...match(/contract_branch:\s*payload\.contract_branch/g)..."
```

**假实现片段**（proof-of-falsification）:
```javascript
// execution.js harness_fix 分支 — 硬编码 contract_branch 通过所有检查
await createHarnessTask({
  task_type: 'harness_report',
  payload: {
    sprint_dir: harnessPayload.sprint_dir,
    contract_branch: 'main',  // 硬编码！includes('contract_branch') → true
    // Command 1.4 不查 execution.js → 不会发现
  }
});
```

**建议修复命令**（替换 Command 1.3，增加来源验证）:
```bash
# 路径3: execution.js harness_fix→harness_report payload 中 contract_branch 来自 harnessPayload
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
```

同时更新 WS1 DoD item 3 的 Test 字段，增加来源验证 regex。

---

### 2. [命令太弱] Feature 3 — retry_count 上限 regex 允许 `> 3` 蒙混

**原始命令**（Command 3.2 中的 regex）:
```bash
# regex: retry_count.*>=?\s*3
# >=? 表示 > 或 >=，也匹配 "retry_count > 3"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 用 > 3 代替 >= 3：retry_count=3 时不 return，继续创建第 4 次重试
const retryCount = (harnessPayload.retry_count || 0);
if (retryCount > 3) {    // regex >=? 匹配，但 count=3 时不终止
  console.error('[harness] max retries exceeded');
  return;
}
// count=0,1,2,3 都会到这里 → 共 4 次重试，超过 3 次上限
await createHarnessTask({ payload: { retry_count: retryCount + 1 } });
```

**建议修复命令**（收紧 regex 为强制 `>=`）:
```bash
# 验证 retry_count >= 3 上限检查（强制 >=，拒绝 >）
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
  if (!noComments.includes('createTask') && !noComments.includes('createHarnessTask')) {
    console.error('FAIL: 去除注释后未找到重试任务创建逻辑');
    process.exit(1);
  }
  console.log('PASS: retry_count >= 3 上限检查 + 终止语句 + createTask 均存在');
"
```

同时更新 WS3 DoD item 2 的 Test 字段，使用相同的收紧 regex。

---

## 可选改进

- **Feature 2 硬阈值写了"响应时间 < 2 秒"但无验证命令**：建议要么加 `time curl` 检查，要么删除该硬阈值（本地 PostgreSQL 查询不太可能超 2 秒，验证价值低）。
- **Feature 3 Command 3.3 只去除单行注释 `//`**：建议同 Command 3.2 一样也去除块注释 `/* */`，保持一致性。
