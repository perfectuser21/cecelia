# Contract Review Feedback (Round 1)

## 致命缺陷：Feature 1 验证命令全部在当前 main 上已 PASS

Feature 1 声称要实现 "Generator 完成后自动创建 CI Watch 并轮询"，但 **main 分支上 harness_ci_watch、executeMerge、harness_fix 链路已完整实现**。合同的 3 条验证命令在不写一行新代码的情况下全部通过。这意味着合同无法区分"已实现"和"未实现"。

Generator 需要重新审视 PRD 意图：PRD 的核心问题是 "Generator 完成 push 后流程断裂"，但代码显示 ci_watch 链路已存在。**合同应聚焦于 PRD 中真正缺失的行为**（如 harness_post_merge 闭环），而非重复验证已有功能。

---

## 必须修改项

### 1. [命令已失效] Feature 1 全部 3 条命令 — 当前代码已满足，无法验证新实现

**原始命令**:
```bash
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/src/task-router.js', 'utf8');
  if (!content.includes('harness_ci_watch')) throw new Error('FAIL');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 零代码变更。main 分支 task-router.js 第 40 行已有：
//   'harness_ci_watch',         // Layer 3b: Brain tick 轮询 CI（内联，不派 agent）
// execution.js 第 2002 行已有：
//   if (harnessType === 'harness_generate') { ... createHarnessTask({ task_type: 'harness_ci_watch' ... })
// harness-watcher.js 已有 executeMerge() 和 harness_fix 创建逻辑
// 所有 3 条命令不写一行代码直接 PASS
```

**建议修复**:
Feature 1 应从合同中移除或重新定义。如果 PRD 意图是修复已有 ci_watch 链路中的 bug（如 "仅做一次 CI 状态查询就直接生成 report"），则验证命令应测试**修复后的行为差异**，例如：
```bash
# 验证 harness_generate 完成后不再一次性查 CI 就生成 report，而是走 ci_watch
node -e "
  const c = require('fs').readFileSync('packages/brain/src/routes/execution.js', 'utf8');
  // 定位 harness_generate 处理段
  const genIdx = c.indexOf('harnessType === \\'harness_generate\\'');
  const genSection = c.substring(genIdx, genIdx + 2000);
  // 不应直接创建 harness_report（应通过 ci_watch 间接创建）
  if (genSection.includes('harness_report') && !genSection.includes('harness_ci_watch'))
    process.exit(1);
  console.log('PASS');
"
```

### 2. [命令太弱] Feature 2 全部 4 条命令 — includes() 静态匹配可被注释蒙混

**原始命令**:
```bash
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/brain/src/task-router.js', 'utf8');
  if (!content.includes('harness_post_merge')) throw new Error('FAIL');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 在 task-router.js 任意位置加一行注释即通过：
// TODO: harness_post_merge 待实现
// 未注册到 VALID_TASK_TYPES 数组，运行时路由会失败
```

**建议修复命令**（验证实际注册到 VALID_TASK_TYPES 数组）:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/task-router.js', 'utf8');
  // 提取 VALID_TASK_TYPES 数组内容
  const start = c.indexOf('VALID_TASK_TYPES');
  const arrStart = c.indexOf('[', start);
  const arrEnd = c.indexOf('];', arrStart);
  const arrContent = c.substring(arrStart, arrEnd);
  // 验证 harness_post_merge 在数组内（非注释）
  if (!arrContent.includes(\"'harness_post_merge'\"))
    { console.log('FAIL: harness_post_merge 未在 VALID_TASK_TYPES 数组中注册'); process.exit(1); }
  console.log('PASS');
"
```

### 3. [命令太弱] Feature 2 — worktree 清理只查字符串，不验证清理逻辑

**原始命令**:
```bash
node -e "
  ...
  if (c.includes('worktree') && (c.includes('remove') || c.includes('prune') || c.includes('clean'))) {
    found = true; break;
  }
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 在 harness-watcher.js 加注释：
// TODO: worktree remove after merge, need to clean/prune branches
// 命令通过，但零实际功能
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 验证有实际的 execSync/exec 调用包含 worktree remove
  const hasExecWorktreeRemove = /exec(?:Sync)?\s*\([^)]*worktree\s+remove/s.test(c)
    || /exec(?:Sync)?\s*\([^)]*git\s+worktree/s.test(c);
  if (!hasExecWorktreeRemove) { console.log('FAIL: 无 worktree remove 的 exec 调用'); process.exit(1); }
  console.log('PASS');
"
```

### 4. [命令已失效] Feature 2 — Brain 回写验证命令在当前代码已 PASS

**原始命令**:
```bash
node -e "
  ...
  if (c.includes('completed') && (c.includes('PATCH') || c.includes('updateTask') || c.includes('task_status'))) {
    found = true; break;
  }
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// harness-watcher.js 第 71 行已有: SET status = 'completed'
// 第 114 行已有: UPDATE tasks SET status = 'completed'
// 第 253 行已有: UPDATE tasks SET status = 'completed'
// 零代码变更，命令已 PASS
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  // 验证有专门的 post_merge 函数/段落，且其中包含状态回写
  const postMergeIdx = c.indexOf('post_merge');
  if (postMergeIdx === -1) { console.log('FAIL: 无 post_merge 处理段'); process.exit(1); }
  const postMergeSection = c.substring(postMergeIdx, postMergeIdx + 3000);
  if (!postMergeSection.includes('completed')) { console.log('FAIL: post_merge 段无状态回写'); process.exit(1); }
  console.log('PASS');
"
```

### 5. [命令太弱] Feature 3 — stop.sh 全文检查 `-d`，可被其他位置匹配

**原始命令**:
```bash
node -e "
  const fs = require('fs');
  const content = fs.readFileSync('packages/engine/hooks/stop.sh', 'utf8');
  if (!content.includes('-d') && !content.includes('test -e') && !content.includes('[ -e'))
    throw new Error('FAIL');
"
```

**假实现片段**（proof-of-falsification）:
```bash
# stop.sh 其他位置可能已有 -d 标志（如 mkdir -d、test -d /tmp 等）
# 不在 worktree 遍历循环中，但命令仍 PASS
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/engine/hooks/stop.sh', 'utf8');
  // 定位 worktree 遍历段（_wt_path 赋值到 done < 之间）
  const wtStart = c.indexOf('_wt_path=');
  const wtEnd = c.indexOf('done <', wtStart);
  if (wtStart === -1 || wtEnd === -1) { console.log('FAIL: 未找到 worktree 遍历段'); process.exit(1); }
  const wtSection = c.substring(wtStart, wtEnd);
  if (!wtSection.includes('-d') && !wtSection.includes('test -d'))
    { console.log('FAIL: worktree 遍历段缺少 -d 目录存在性检查'); process.exit(1); }
  console.log('PASS');
"
```

### 6. [PRD 遗漏] 边界场景零覆盖

PRD 明确列出的边界情况在合同中完全没有对应验证命令：
- **CI 长时间 pending（超时 30 分钟）**：合同没有验证超时机制
- **auto-merge 冲突**：合同没有验证冲突处理
- **部分 WS 失败**：合同没有验证"仅对成功 WS 执行清理，报告标注失败 WS"
- **Brain API 回写失败重试**：合同没有验证重试逻辑

建议至少增加：
```bash
# 验证超时常量存在且值合理
node -e "
  const c = require('fs').readFileSync('packages/brain/src/harness-watcher.js', 'utf8');
  const match = c.match(/MAX_CI_WATCH_POLLS\s*=\s*(\d+)/);
  if (!match || parseInt(match[1]) < 60) { console.log('FAIL: 超时阈值不合理'); process.exit(1); }
  console.log('PASS: MAX_CI_WATCH_POLLS=' + match[1]);
"
```

### 7. [工具不对] 全部命令只有 fs.readFileSync — 无运行时验证

合同的 10 条验证命令全部是 `node -e "fs.readFileSync..."` 静态文本匹配。对于涉及 DB 操作（任务创建、状态更新）和 API 调用（Brain 回写、OKR 更新）的 Feature 2，应包含至少一条运行时验证：

```bash
# 验证 harness_post_merge task_type 可被 Brain 正确路由（非 unknown_type 报错）
curl -sf localhost:5221/api/brain/tasks -X POST \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_post_merge","title":"[test] post_merge routing","status":"queued"}' \
  | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      const r=JSON.parse(d);
      if(!r.task_id){console.log('FAIL: harness_post_merge 路由失败');process.exit(1)}
      console.log('PASS: task created '+r.task_id);
    })
  "
```

### 8. [WS DoD 命令已失效] WS1 DoD 全部 4 条中 3 条在 main 已 PASS

WS1 DoD 中前 3 条 Test 命令检查 `harness_ci_watch`、`gh pr merge`+`harness_fix`、`harness_post_merge`：
- 前 2 条在 main 分支当前代码已 PASS（同 Feature 1 问题）
- 仅第 3 条（`harness_post_merge` in watcher）和第 4 条（task-router 注册）需要新代码

WS2 DoD 中 4 条：
- `contract`/`dod` 检查：harness-watcher.js 第 142 行已有 `contract_branch`，命令通过
- `completed` 检查：已有多处 `completed`，命令通过
- `harness_report` 检查：已有（第 136 行），命令通过
- 仅 `worktree` 检查可能需新代码

**WS2 有 4 条 DoD，但 3 条在当前代码已 PASS。这意味着 WS2 实现者可以只加一行 `// worktree` 注释就通过所有 DoD。**

---

## 可选改进

1. Feature 1 建议整体重新评估：如果 ci_watch 链路已完整，该 Feature 可能应该缩减为"验证现有链路正确性"而非"实现新功能"，或者聚焦于链路中真正缺失的环节
2. 考虑用 `npm test -- packages/brain/src/__tests__/harness-watcher.test.ts` 来验证运行时行为（如果已有测试文件）
3. Workstream 边界问题：WS1 和 WS2 都改 harness-watcher.js，交叉风险高。建议合并为一个 WS 或明确划分文件中的修改区域
