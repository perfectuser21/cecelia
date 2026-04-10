# Contract Review Feedback (Round 1)

## 必须修改项

### 1. [命令太弱] Feature 1 — split/substring 定位不精确，注释即可蒙混

**原始命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const reportSection = code.split('harness_report')[1] || '';
  if (!reportSection.includes('contract_branch')) { process.exit(1); }
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 在 harness-watcher.js 文件末尾加一行注释就能通过：
// TODO: contract_branch support for harness_report
// 因为 split('harness_report')[1] 捕获第一个 'harness_report' 之后的全部文本
// 包括无关函数 _createHarnessReport（第332行）、注释、任何位置
```

**建议修复命令（3 条路径统一模式）**:
```bash
# 路径1: CI通过→harness_report payload 中包含 contract_branch
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 定位 CI通过分支：从 'ci_passed' 到下一个 'ci_failed' 之间
  const ciPassedIdx = code.indexOf(\"ciStatus === 'ci_passed'\");
  const ciFailedIdx = code.indexOf(\"ciStatus === 'ci_failed'\");
  if (ciPassedIdx < 0 || ciFailedIdx < 0) { console.error('FAIL: 找不到 CI 分支结构'); process.exit(1); }
  const passedBlock = code.substring(ciPassedIdx, ciFailedIdx);
  // 验证在 CI通过分支的 payload 对象中（含 createTask）有 contract_branch
  if (!passedBlock.includes('contract_branch')) {
    console.error('FAIL: CI通过→harness_report 的 createTask payload 中缺少 contract_branch');
    process.exit(1);
  }
  console.log('PASS');
"

# 路径2: CI失败→harness_fix payload 中包含 contract_branch
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 定位 CI失败分支：从 'ci_failed' 到 'ci_pending' 之间
  const ciFailedIdx = code.indexOf(\"ciStatus === 'ci_failed'\");
  const ciPendingIdx = code.indexOf(\"ciStatus === 'ci_pending'\");
  if (ciFailedIdx < 0 || ciPendingIdx < 0) { console.error('FAIL: 找不到 CI 分支结构'); process.exit(1); }
  const failedBlock = code.substring(ciFailedIdx, ciPendingIdx);
  if (!failedBlock.includes('contract_branch')) {
    console.error('FAIL: CI失败→harness_fix 的 createTask payload 中缺少 contract_branch');
    process.exit(1);
  }
  console.log('PASS');
"

# 路径3: execution.js harness_fix→harness_report payload 中包含 contract_branch
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 定位 harness_fix 分支，截取到下一个 if (harnessType
  const fixIdx = code.indexOf(\"harnessType === 'harness_fix'\");
  if (fixIdx < 0) { console.error('FAIL: 找不到 harness_fix 分支'); process.exit(1); }
  const afterFix = code.substring(fixIdx);
  const nextBranch = afterFix.indexOf('harnessType ===', 10);
  const fixBlock = nextBranch > 0 ? afterFix.substring(0, nextBranch) : afterFix.substring(0, 600);
  // 验证 payload 中有 contract_branch 且来自 harnessPayload
  if (!fixBlock.includes('contract_branch')) {
    console.error('FAIL: harness_fix→harness_report payload 缺少 contract_branch');
    process.exit(1);
  }
  console.log('PASS');
"
```

### 2. [缺失边界] Feature 1 — 缺少值正确性验证

**原始命令**: 所有 Feature 1 命令只检查 `contract_branch` 字符串存在

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：硬编码一个假值，所有原始命令都通过
payload: {
  sprint_dir: payload.sprint_dir,
  contract_branch: 'fake-branch-name',  // 不是来自上游 payload
  harness_mode: true,
}
```

**建议修复命令**:
```bash
# 验证 contract_branch 赋值来源是 payload（而非硬编码）
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 检查 contract_branch 赋值引用了 payload 变量
  const matches = code.match(/contract_branch:\s*payload\.contract_branch/g);
  if (!matches || matches.length < 2) {
    console.error('FAIL: contract_branch 应至少在 2 个路径中从 payload.contract_branch 取值，实际找到 ' + (matches ? matches.length : 0));
    process.exit(1);
  }
  console.log('PASS: 找到 ' + matches.length + ' 处 payload.contract_branch 赋值');
"
```

### 3. [命令太弱] Feature 3 Command 1 — includes 检查可被注释/空分支蒙混

**原始命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  if (!code.includes(\"harnessType === 'harness_report'\")) { process.exit(1); }
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：空分支，命令仍然通过
if (harnessType === 'harness_report') {
  // TODO: implement retry logic
}
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  if (idx < 0) { console.error('FAIL: 缺少 harness_report 分支'); process.exit(1); }
  const block = code.substring(idx, idx + 1500);
  // 验证分支内有实际的任务创建调用
  if (!block.includes('createTask') && !block.includes('createHarnessTask')) {
    console.error('FAIL: harness_report 分支内无 createTask/createHarnessTask 调用');
    process.exit(1);
  }
  console.log('PASS');
"
```

### 4. [命令太弱] Feature 3 Command 2 — regex 可匹配注释文本

**原始命令**:
```bash
# regex /retry_count.*>=?\s*3/ 可被注释 "// retry_count >= 3 means stop" 匹配
```

**假实现片段**（proof-of-falsification）:
```javascript
if (harnessType === 'harness_report') {
  // config: retry_count >= 3 means stop retrying
  const retry_count = 0;  // 实际永远不检查
  await createHarnessTask({ /* ... */ });
}
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  // 去除注释后再匹配
  const noComments = block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (!/retry_count.*>=?\s*3|retry_count\s*>=?\s*3/.test(noComments)) {
    console.error('FAIL: 去除注释后未找到 retry_count >= 3 检查');
    process.exit(1);
  }
  // 验证检查后有终止逻辑（return/console.error/throw）
  if (!noComments.includes('createTask') && !noComments.includes('createHarnessTask')) {
    console.error('FAIL: 去除注释后未找到重试任务创建逻辑');
    process.exit(1);
  }
  console.log('PASS');
"
```

### 5. [硬阈值不一致] Feature 3 Command 3 — required 数组缺少 pr_url

**原始命令**:
```bash
# required = ['sprint_dir', 'planner_task_id', 'retry_count']
# 但硬阈值明确要求："重试任务的 payload 包含完整的 sprint_dir、planner_task_id、pr_url"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：payload 缺少 pr_url，命令仍然通过
payload: {
  sprint_dir: harnessPayload.sprint_dir,
  planner_task_id: harnessPayload.planner_task_id,
  retry_count: (harnessPayload.retry_count || 0) + 1,
  // pr_url 遗漏 — 下游 report 拿不到 PR 链接
}
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '');
  const required = ['sprint_dir', 'planner_task_id', 'retry_count', 'pr_url'];
  for (const f of required) {
    if (!noComments.includes(f)) {
      console.error('FAIL: harness_report 重试 payload 缺少 ' + f);
      process.exit(1);
    }
  }
  console.log('PASS');
"
```

### 6. [缺失边界] Feature 3 — 缺少 retry_count >= 3 时「不重试」的负向验证

**原始命令**: 无（完全缺失此边界测试）

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：永远重试，忽略上限
if (harnessType === 'harness_report') {
  const retry_count = (harnessPayload.retry_count || 0);
  if (retry_count >= 3) { console.error('max retries'); } // 打印日志但不 return
  await createHarnessTask({ retry_count: retry_count + 1 }); // 永远执行
}
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const idx = code.indexOf(\"harnessType === 'harness_report'\");
  const block = code.substring(idx, idx + 1500);
  const noComments = block.replace(/\/\/.*$/gm, '');
  // 验证 >= 3 检查之后有 return/break 终止，而非继续执行 createTask
  const limitIdx = noComments.search(/retry_count.*>=?\s*3/);
  if (limitIdx < 0) { console.error('FAIL: 无上限检查'); process.exit(1); }
  const afterLimit = noComments.substring(limitIdx, limitIdx + 300);
  if (!/return|break|throw/.test(afterLimit.substring(0, 200))) {
    console.error('FAIL: retry_count >= 3 后无 return/break 终止语句');
    process.exit(1);
  }
  console.log('PASS');
"
```

## 可选改进

- Feature 2 可增加响应时间验证（硬阈值要求 < 2 秒，但验证命令未检查）
- Feature 2 可增加字段排序验证（行为描述要求"按链路顺序"，但未验证排序正确性）
- WS1 DoD Test 字段应与修复后的验证命令保持一致
