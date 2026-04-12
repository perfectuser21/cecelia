# Contract Review Feedback (Round 2)

> Triple 分析覆盖率：13/13 = 100%。可绕过命令：4/13（1.2, 1.4, 2.3, 2.4）。
> Feature 3 命令质量高，无需修改。

---

## 必须修改项

### 1. [搜索窗口致命错误] Feature 1 — 命令 1.4 超时→链路延续性验证完全失效

**原始命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const timeoutIdx = c.indexOf('MAX_CI_WATCH_POLLS');
  const timeoutSection = c.substring(timeoutIdx, timeoutIdx + 1500);
  if (!timeoutSection.includes('createTask') && !timeoutSection.includes('harness_report') && !timeoutSection.includes('harness_post_merge')) {
    console.log('FAIL: CI 超时后未创建后续任务，链路中断');
    process.exit(1);
  }
  console.log('PASS: CI 超时后链路不中断');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 无需任何假实现——当前 main 分支已 PASS
// MAX_CI_WATCH_POLLS 在文件第 19 行（顶部常量区）
// substring(19处, +1500) 覆盖第 19-50 行，命中第 6 行注释：
//   "CI 全通过 → executeMerge(prUrl) + 创建 harness_report（CI 即 Evaluator）"
// 注释中的 "harness_report" 触发 PASS，实际超时处理逻辑（for 循环深处 ~line 100+）完全未被验证
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 定位实际超时处理段：retry_count >= MAX 或 poll_count >= MAX
  const timeoutMatch = c.match(/(?:retry_count|poll_count|polls?)\s*>=?\s*MAX_CI_WATCH_POLLS/);
  if (!timeoutMatch) {
    console.log('FAIL: 未找到超时判断逻辑（retry/poll >= MAX_CI_WATCH_POLLS）');
    process.exit(1);
  }
  // 从超时判断处往后 1500 字符，验证创建后续任务
  const timeoutIdx = timeoutMatch.index;
  const section = c.substring(timeoutIdx, timeoutIdx + 1500);
  if (!section.includes('createTask') && !section.includes('harness_post_merge')) {
    console.log('FAIL: 超时处理段未创建后续任务（链路中断）');
    process.exit(1);
  }
  console.log('PASS: 超时后创建后续任务，链路不中断');
"
```

---

### 2. [命令太弱] Feature 1 — 命令 1.2 payload 字段检查可被注释蒙混

**原始命令**:
```bash
node -e "
  ...
  const required = ['pr_url', 'sprint_dir', 'workstream_index', 'workstream_count'];
  const missing = required.filter(f => !payloadSection.includes(f));
  ...
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 注释中列举字段名，实际 payload 为空对象
// harness_ci_watch: payload fields: pr_url, sprint_dir, workstream_index, workstream_count
await createTask({ task_type: 'harness_ci_watch', payload: {} });
// 命令对 800 字符窗口做 includes → PASS，但 payload 无任何字段
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  const lastWsIdx = c.indexOf('currentWsIdx === totalWsCount');
  const section = c.substring(lastWsIdx, lastWsIdx + 2000);
  const ciWatchIdx = section.indexOf('harness_ci_watch');
  if (ciWatchIdx === -1) { console.log('FAIL: 无 harness_ci_watch'); process.exit(1); }
  const payloadSection = section.substring(ciWatchIdx, ciWatchIdx + 800);
  // 检查字段名后跟冒号或逗号（排除纯注释）
  const required = ['pr_url', 'sprint_dir', 'workstream_index', 'workstream_count'];
  const missing = required.filter(f => {
    // 字段名后跟 : 或 , 或在对象字面量内（排除纯注释行）
    const re = new RegExp(f + '\\s*[:=,]');
    return !re.test(payloadSection);
  });
  if (missing.length > 0) {
    console.log('FAIL: payload 缺少字段（需 key: value 格式）: ' + missing.join(', '));
    process.exit(1);
  }
  console.log('PASS: ci_watch payload 含全部必要字段（非注释）');
"
```

---

### 3. [缺失负向检查] Feature 2 — 命令 2.3 未验证旧 harness_report 直接创建已移除

**原始命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const passedIdx = c.indexOf('ci_passed');
  ...
  if (!passedSection.includes('harness_post_merge')) { ... }
  ...
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// CI passed 处理段——添加了 harness_post_merge 但未移除旧的 harness_report
if (prInfo.ciStatus === 'ci_passed') {
  await createTask({ task_type: 'harness_post_merge', payload: { ... } });  // 新增
  await createTask({ task_type: 'harness_report', payload: { ... } });      // 旧代码未删
}
// 命令只正向检查 harness_post_merge 存在 → PASS
// 结果：CI 通过后同时创建两个任务，链路分叉，harness_report 绕过 post_merge 的清理逻辑
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 定位 CI passed 处理段（ci_passed 状态判断处）
  const passedIdx = c.indexOf(\"ciStatus === 'ci_passed'\");
  if (passedIdx === -1) { console.log('FAIL: 未找到 CI passed 处理段'); process.exit(1); }
  const section = c.substring(passedIdx, passedIdx + 2000);
  // 正向：必须创建 harness_post_merge
  if (!section.includes('harness_post_merge')) {
    console.log('FAIL: CI passed 段未创建 harness_post_merge');
    process.exit(1);
  }
  // 负向：不应在此段直接创建 harness_report（应由 post_merge 创建）
  const reportMatch = section.match(/createTask[^}]*harness_report/s);
  if (reportMatch) {
    console.log('FAIL: CI passed 段仍直接创建 harness_report（应改为 harness_post_merge 中转）');
    process.exit(1);
  }
  console.log('PASS: CI passed → harness_post_merge（无直接 harness_report）');
"
```

---

### 4. [未限定范围] Feature 2 — 命令 2.4 exec worktree 检查搜全文而非 post_merge 段

**原始命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const hasExecWorktreeRemove = /exec(?:Sync)?\s*\([^)]*worktree\s+remove/s.test(c)
    || /exec(?:Sync)?\s*\([^)]*git\s+worktree/s.test(c);
  ...
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// exec + worktree 出现在无关的调试函数中
async function debugListWorktrees() {
  execSync('git worktree list');  // 正则命中 → PASS
}
// post_merge handler 实际无任何清理：
async function handlePostMerge(pool, task) {
  await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', ['completed', task.id]);
  // 无 worktree 清理
}
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 定位 post_merge 处理段
  const pmIdx = c.indexOf('post_merge');
  if (pmIdx === -1) { console.log('FAIL: 无 post_merge 段'); process.exit(1); }
  const pmSection = c.substring(pmIdx, pmIdx + 3000);
  // 在 post_merge 段内搜索 exec + worktree remove
  if (!/exec(?:Sync)?\s*\([^)]*worktree\s*remove/s.test(pmSection)
      && !/exec(?:Sync)?\s*\([^)]*git\s+worktree/s.test(pmSection)) {
    console.log('FAIL: post_merge 段内无 worktree 清理 exec 调用');
    process.exit(1);
  }
  console.log('PASS: post_merge 段含 worktree 清理 exec 调用');
"
```

---

## 可选改进

- **命令 1.3**（MAX_CI_WATCH_POLLS >= 60）：当前 main 值已为 120，此命令 PASS 不代表新实现正确。建议保留作为阈值守卫，但不依赖它作为 Feature 1 唯一的超时验证。
- **命令 2.6**（运行时路由验证）：创建了真实测试任务但未清理。建议在验证后追加删除命令，或用 `status: 'cancelled'` 标记避免被 tick 处理。
- **Workstream 1 DoD 第 3 条**：同命令 2.4 问题，Test 字段的正则搜全文——建议同步修复。
