# Contract Review Feedback (Round 1)

## 审查统计

| 指标 | 值 |
|------|-----|
| 总命令数 | 30（Feature 16 + DoD 14） |
| can_bypass: Y | 20 (67%) |
| can_bypass: N | 10 (33%) |
| 逻辑 Bug | 2 |
| 覆盖率 | 30/30 = 100% |

---

## 必须修改项

### 1. [逻辑 Bug] Feature 1 边界路径 — 命令永远 PASS

**原始命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('verdict_timeout')) throw new Error('FAIL: 未找到 verdict_timeout 处理');
  if (!/verdict_timeout.*(?:harness_fix|fix)/s.test(code) === false)
    console.log('PASS: verdict_timeout 不触发 harness_fix');
  console.log('PASS: verdict_timeout 标记存在');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：在 execution.js 任意位置加一行注释
// verdict_timeout → harness_fix（完全错误的行为）
function handleVerdict() {
  if (timeout) {
    status = 'verdict_timeout';
    createTask('harness_fix');  // 错误！应该是不创建任何任务
  }
}
// 命令中 `!/regex.test(code) === false` 等价于 `regex.test(code) === true`
// 但无论 regex 结果如何，代码都不 throw，永远到达最后的 console.log('PASS')
// 所以即使 verdict_timeout 后面跟着 harness_fix，命令仍然 PASS
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('verdict_timeout')) throw new Error('FAIL: 未找到 verdict_timeout 处理');
  // 找到 verdict_timeout 附近 800 字符，确认不创建 harness_fix
  const idx = code.indexOf('verdict_timeout');
  const block = code.substring(idx, idx + 800);
  if (block.includes('harness_fix')) throw new Error('FAIL: verdict_timeout 后不应创建 harness_fix');
  // 确认不默认 FAIL
  if (block.includes(\"status = 'FAIL'\") || block.includes('verdict = \"FAIL\"'))
    throw new Error('FAIL: verdict_timeout 不应默认为 FAIL');
  console.log('PASS: verdict_timeout 正确处理——不触发 harness_fix，不默认 FAIL');
"
```

---

### 2. [运算符优先级 Bug] WS2 DoD cleanup 命令 — 'branch' 单独满足

**原始命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/execution.js','utf8');const has=s=>c.includes(s);if(!(has('worktree')&&has('push origin --delete')||has('branch')))throw new Error('FAIL');console.log('PASS: cleanup 产物覆盖')"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：execution.js 中只要任何地方出现 'branch'（如 git branch 引用），命令就 PASS
// 因为 JS 运算符优先级：&& 高于 ||
// 实际解析为：(has('worktree') && has('push origin --delete')) || has('branch')
// 所以 has('branch') 为 true 时，整个表达式为 true，跳过 throw
function someOtherFunction() {
  const branch = getCurrentBranch();  // 'branch' 关键词已存在
  // 完全没有 cleanup 逻辑，但命令 PASS
}
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  const has = s => c.includes(s);
  // 三类产物分别验证
  if (!has('worktree') || !has('remove')) throw new Error('FAIL: 缺少 worktree 清理');
  if (!has('push origin --delete')) throw new Error('FAIL: 缺少远程分支删除');
  if (!has('/tmp/cecelia')) throw new Error('FAIL: 缺少 /tmp/cecelia-* 临时文件清理');
  console.log('PASS: cleanup 覆盖三类产物');
"
```

---

### 3. [命令太弱] Feature 1 Happy Path — 独立 includes 太松散

**原始命令**:
```bash
node -e "
  const code = fs.readFileSync('packages/brain/src/execution.js', 'utf8');
  const hasRetryLoop = code.includes('verdict') && code.includes('retry') && code.includes('200');
  ...
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// execution.js 大概率已有 'verdict'（现有业务逻辑）和 '200'（HTTP 状态码）
// 只需任意位置加一行注释即可通过：
// TODO: retry logic later
const VERDICT_FIELD = 'verdict';
res.status(200).json({ ok: true });
// 三个关键词分散在文件不同位置，毫无关联，但命令 PASS
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  // 验证重试循环的结构特征：循环 + 间隔 + 上限，在同一代码块内
  const hasRetryPattern = /for\s*\(.*retry|while\s*\(.*retry|retryCount\s*[<>=]/i.test(code);
  const hasInterval = /200\s*\)|sleep\s*\(\s*200|setTimeout.*200/i.test(code);
  const hasMax = /MAX_VERDICT_RETRIES|(?:max|limit).*(?:retr|attempt)/i.test(code);
  if (!hasRetryPattern) throw new Error('FAIL: 未找到重试循环结构（for/while + retry）');
  if (!hasInterval) throw new Error('FAIL: 未找到 200ms 间隔');
  if (!hasMax) throw new Error('FAIL: 未找到重试上限常量');
  console.log('PASS: verdict 重试循环结构完整');
"
```

---

### 4. [命令太弱] Feature 2 边界 + WS1 DoD #4 — permanent_failure 纯字符串检查

**原始命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('permanent_failure')) throw new Error('FAIL');
  console.log('PASS');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 在 execution.js 任意位置加一行注释即可通过
// TODO: handle permanent_failure case
// 或者一个空的 if 分支
if (status === 'permanent_failure') {
  // 什么都不做，但 'permanent_failure' 字符串已存在
  // 仍然创建后续任务（违反 PRD 要求），命令不会检测到
}
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('permanent_failure')) throw new Error('FAIL: 未找到 permanent_failure');
  const idx = code.indexOf('permanent_failure');
  const block = code.substring(Math.max(0, idx - 200), idx + 800);
  // permanent_failure 后不应创建任何任务
  if (block.includes('createTask') && !block.includes('// skip') && !block.includes('return'))
    throw new Error('FAIL: permanent_failure 后不应创建后续任务');
  // 应包含 error_message 写入
  if (!block.includes('error_message') && !block.includes('error'))
    throw new Error('FAIL: permanent_failure 应写入 error_message');
  console.log('PASS: permanent_failure 正确终止且写入 error');
"
```

---

### 5. [命令太弱] Feature 2 Happy Path — 空处理也能通过

**原始命令**:
```bash
node -e "
  ...
  const crashBlock = code.substring(code.indexOf('session_crashed'), code.indexOf('session_crashed') + 500);
  if (crashBlock.includes('harness_fix') && !crashBlock.includes('harness_evaluate'))
    throw new Error('FAIL');
  ...
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 假实现：session_crashed 后什么都不做
const status = 'session_crashed';
log.warn('Session crashed, doing nothing');
// crashBlock 中既无 harness_fix 也无 harness_evaluate
// 条件 `includes('harness_fix') && !includes('harness_evaluate')` 为 false
// 不 throw，命令 PASS
// 但 PRD 要求必须创建 harness_evaluate 重试任务！
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  if (!code.includes('session_crashed')) throw new Error('FAIL: 未找到 session_crashed');
  const idx = code.indexOf('session_crashed');
  const block = code.substring(idx, idx + 800);
  // 必须包含 harness_evaluate（正向验证，不只是排除 harness_fix）
  if (!block.includes('harness_evaluate'))
    throw new Error('FAIL: session_crashed 后必须创建 harness_evaluate 重试任务');
  if (block.includes('harness_fix'))
    throw new Error('FAIL: session_crashed 后不应创建 harness_fix');
  console.log('PASS: session_crashed 正确创建 harness_evaluate 而非 harness_fix');
"
```

---

### 6. [命令太弱] Feature 4 Happy Path — 'cleanup' 太通用

**原始命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  const hasCleanup = code.includes('harness_cleanup') || code.includes('cleanup');
  if (!hasCleanup) throw new Error('FAIL');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// execution.js 中任何现有变量/注释含 'cleanup' 即可
function handleCallback(task) {
  // cleanup old references  ← 这行注释就让命令 PASS
  delete task._cache;
}
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/execution.js', 'utf8');
  // 验证 harness_cleanup 任务类型存在（精确匹配，非通用 cleanup）
  if (!code.includes('harness_cleanup')) throw new Error('FAIL: 未找到 harness_cleanup 任务类型');
  // 验证 cleanup 有处理逻辑（不只是定义）
  const idx = code.indexOf('harness_cleanup');
  const block = code.substring(idx, idx + 1000);
  if (!block.includes('worktree') && !block.includes('remove'))
    throw new Error('FAIL: harness_cleanup 处理中缺少 worktree 清理逻辑');
  console.log('PASS: harness_cleanup 任务类型存在且包含清理逻辑');
"
```

---

### 7. [命令太弱] Feature 6 Happy Path — OR 连接太松

**原始命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness.js', 'utf8');
  if (!code.includes('stats') && !code.includes('completion_rate'))
    throw new Error('FAIL');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// harness.js 中如果已有任何 'stats' 字符串（如 pipeline_stats 变量），命令直接 PASS
// 无需实现 completion_rate、avg_gan_rounds、avg_duration_minutes
const pipeline_stats = {};  // 空对象
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/harness.js', 'utf8');
  // AND 连接：三个统计字段必须全部存在
  if (!code.includes('completion_rate')) throw new Error('FAIL: 缺少 completion_rate');
  if (!code.includes('avg_gan_rounds')) throw new Error('FAIL: 缺少 avg_gan_rounds');
  if (!code.includes('avg_duration')) throw new Error('FAIL: 缺少 avg_duration');
  // 验证有 SQL 查询或数据聚合逻辑
  if (!code.includes('SELECT') && !code.includes('COUNT') && !code.includes('AVG'))
    throw new Error('FAIL: stats 缺少数据库聚合查询');
  console.log('PASS: stats 端点包含完整统计字段和聚合查询');
"
```

---

### 8. [命令太弱] Feature 7 — callback_queue_stats 三个独立 includes

**原始命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/health-monitor.js', 'utf8');
  if (!code.includes('callback_queue')) throw new Error('FAIL');
  if (!code.includes('unprocessed') || !code.includes('failed')) throw new Error('FAIL');
"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 三个关键词分散在文件不同位置
const TABLES = ['callback_queue', 'tasks'];  // callback_queue ✓
// Check for unprocessed items in main queue
let failed = 0;  // failed ✓, unprocessed ✓（在注释中）
// 没有实际的 callback_queue_stats 对象，但命令 PASS
```

**建议修复命令**:
```bash
node -e "
  const code = require('fs').readFileSync('packages/brain/src/health-monitor.js', 'utf8');
  // 验证 callback_queue_stats 作为完整对象存在
  if (!code.includes('callback_queue_stats')) throw new Error('FAIL: 缺少 callback_queue_stats 对象');
  // 验证包含 SQL 查询 callback_queue 表
  if (!/SELECT.*callback_queue|FROM.*callback_queue/i.test(code))
    throw new Error('FAIL: 缺少对 callback_queue 表的 SQL 查询');
  if (!code.includes('unprocessed')) throw new Error('FAIL: 缺少 unprocessed 字段');
  if (!code.includes('failed_retries')) throw new Error('FAIL: 缺少 failed_retries 字段');
  console.log('PASS: callback_queue_stats 完整');
"
```

---

### 9. [前端验证可能误报] Feature 5 前端命令 — 目录结构假设

**原始命令**:
```bash
node -e "
  const files = fs.readdirSync('apps/dashboard/src/pages').filter(f => f.includes('Pipeline'));
  ...
"
```

**假实现片段**（proof-of-falsification）:
```
// 如果 pipeline 组件在子目录中（如 apps/dashboard/src/pages/pipelines/Detail.tsx）
// readdirSync 不递归，返回 ['pipelines'] 目录名
// 'pipelines'.includes('Pipeline') === false（大小写不匹配）
// 命令 FAIL，但实现其实是正确的 → 假阴性
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const { execSync } = require('child_process');
  // 用 find 等价逻辑递归搜索
  const allFiles = execSync('find apps/dashboard/src -name \"*ipeline*\" -o -name \"*pipeline*\"').toString().trim().split('\n').filter(Boolean);
  if (allFiles.length === 0) throw new Error('FAIL: 未找到 pipeline 相关组件');
  let hasCleanup = false;
  for (const f of allFiles) {
    const code = fs.readFileSync(f, 'utf8');
    if (code.includes('cleanup') || code.includes('Cleanup') || code.includes('smoke')) hasCleanup = true;
  }
  if (!hasCleanup) throw new Error('FAIL: pipeline 组件未包含 cleanup/smoke-test 步骤');
  console.log('PASS: 前端 pipeline 组件包含完整步骤');
"
```

---

### 10. [WS3 DoD 太弱] WS3 DoD #5 — Stats 页面只检查文件名

**原始命令**:
```bash
node -e "const fs=require('fs');const files=fs.readdirSync('apps/dashboard/src/pages');const has=files.some(f=>f.toLowerCase().includes('stat')&&f.toLowerCase().includes('pipeline'));if(!has)throw new Error('FAIL: 无 stats 页面');console.log('PASS: stats 页面组件存在')"
```

**假实现片段**（proof-of-falsification）:
```javascript
// 创建一个空文件 PipelineStats.tsx
// export default function PipelineStats() { return null; }
// 文件名匹配 'stat' + 'pipeline'，命令 PASS
// 但页面无任何统计功能
```

**建议修复命令**:
```bash
node -e "
  const fs = require('fs');
  const { execSync } = require('child_process');
  const files = execSync('find apps/dashboard/src -name \"*pipeline*\" -o -name \"*Pipeline*\"').toString().trim().split('\n').filter(Boolean);
  const statsFiles = files.filter(f => f.toLowerCase().includes('stat'));
  if (statsFiles.length === 0) throw new Error('FAIL: 无 pipeline stats 页面');
  const code = fs.readFileSync(statsFiles[0], 'utf8');
  if (!code.includes('completion_rate') && !code.includes('completionRate'))
    throw new Error('FAIL: stats 页面缺少 completion_rate 展示');
  if (!code.includes('avg_gan') && !code.includes('avgGan') && !code.includes('ganRounds'))
    throw new Error('FAIL: stats 页面缺少 GAN 轮次展示');
  console.log('PASS: stats 页面包含核心统计字段');
"
```

---

## 可选改进

1. **考虑运行时验证**：当前全部是静态代码分析（readFileSync + includes），无法验证运行时行为。建议对 Brain API 端点（stats、health）增加 curl 运行时测试（DoD manual: 格式）。
2. **WS1 DoD #1 的重试验证**：建议用正则匹配循环结构（for/while + retry）而非独立 includes，更能区分真实实现和注释。
3. **Feature 3 边界路径应验证错误处理**：当前只检查 `worktree remove` 存在，建议增加检查 `|| true` 或 `|| echo` 或 `2>/dev/null` 确保失败不阻塞。

---

## 审查结论

**Verdict: REVISION**

核心问题：
1. **2 个逻辑 Bug**（Feature 1 边界命令永远 PASS、WS2 DoD 运算符优先级）
2. **67% 命令可被假实现绕过**（20/30），严格性严重不足
3. **所有检查都是静态 includes**，缺乏结构性验证（正则匹配代码模式）和运行时行为验证

每个 issue 都提供了建议修复命令，Generator 可直接采用。
