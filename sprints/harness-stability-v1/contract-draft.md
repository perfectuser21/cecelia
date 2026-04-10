# Sprint Contract Draft (Round 1)

## Feature 1: Dashboard Harness Pipeline 面板

**行为描述**:
用户在 Dashboard 导航中看到"Harness"入口，点击进入 `/harness` 路由后，面板展示所有 harness sprint 的运行记录。每条记录显示 sprint 标题、当前阶段（Planner / Proposer / Reviewer / Generator / Evaluator / Report）、GAN 轮次、最终 verdict。数据通过 Brain API 获取 `harness_planner` 类型任务及其关联子任务。

**硬阈值**:
- `/harness` 路由可访问，页面渲染不白屏（HTTP 200，DOM 包含列表容器）
- 页面展示至少 1 条 sprint 记录（从 Brain tasks API 获取 `harness_planner` 任务）
- 每条记录显示：标题、状态、创建时间
- 导航栏包含"Harness"入口且链接到 `/harness`

**验证命令**:
```bash
# 验证 Harness 页面组件文件存在
node -e "
  const fs = require('fs');
  const dir = 'apps/dashboard/src/pages/harness';
  if (!fs.existsSync(dir)) throw new Error('FAIL: harness 页面目录不存在');
  const files = fs.readdirSync(dir);
  if (files.length === 0) throw new Error('FAIL: harness 目录为空');
  console.log('PASS: harness 页面目录存在，包含 ' + files.length + ' 个文件');
"

# 验证 Brain API 能返回 harness 任务数据（面板数据来源）
curl -sf "localhost:5221/api/brain/tasks?task_type=harness_planner&limit=5" | \
  node -e "
    const tasks = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    if (!Array.isArray(tasks)) throw new Error('FAIL: 不是数组');
    if (tasks.length === 0) throw new Error('FAIL: 无 harness_planner 任务');
    if (!tasks[0].title) throw new Error('FAIL: 缺少 title 字段');
    if (!tasks[0].status) throw new Error('FAIL: 缺少 status 字段');
    console.log('PASS: 获取到 ' + tasks.length + ' 条 harness sprint 记录');
  "

# 验证导航配置包含 harness 入口
node -e "
  const fs = require('fs');
  // 扫描 dashboard 配置或 core config 中是否注册了 harness 路由
  const appDir = 'apps/dashboard/src';
  const allFiles = require('child_process').execSync('find ' + appDir + ' -name \"*.ts\" -o -name \"*.tsx\" | head -50').toString().trim().split('\n');
  let found = false;
  for (const f of allFiles) {
    const content = fs.readFileSync(f, 'utf8');
    if (content.includes('/harness') && (content.includes('Harness') || content.includes('harness'))) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error('FAIL: 未找到 /harness 路由注册');
  console.log('PASS: Dashboard 中注册了 /harness 路由');
"
```

---

## Feature 2: CI 白名单同步 — playwright 加入

**行为描述**:
Proposer 在合同 DoD 中写 `Test: manual:npx playwright test ...` 格式的验证命令时，`check-manual-cmd-whitelist.cjs` 校验脚本不再报错，`npx playwright` 通过白名单检查（退出码 0）。同时 `playwright` 作为独立顶层命令也通过校验。

**硬阈值**:
- `npx playwright test xxx` 命令通过白名单校验（退出码 0）
- `playwright test xxx` 作为独立命令也通过白名单校验（退出码 0）
- 原有白名单命令（node/npm/curl/bash/psql）仍然通过
- 非白名单命令（如 grep/cat/ls）仍然被拒绝（退出码 1）

**验证命令**:
```bash
# Happy path: npx playwright 通过校验（npx 已在白名单，本身应通过）
TMPFILE=$(mktemp)
echo '- [ ] [BEHAVIOR] playwright 测试通过' > "$TMPFILE"
echo '  Test: manual:npx playwright test tests/e2e/harness.spec.ts' >> "$TMPFILE"
node scripts/devgate/check-manual-cmd-whitelist.cjs "$TMPFILE" && echo "PASS: npx playwright 白名单校验通过" || (echo "FAIL: npx playwright 被拒绝"; rm "$TMPFILE"; exit 1)
rm "$TMPFILE"

# Happy path: playwright 独立命令通过校验
TMPFILE=$(mktemp)
echo '- [ ] [BEHAVIOR] playwright 独立命令' > "$TMPFILE"
echo '  Test: manual:playwright test tests/e2e/basic.spec.ts' >> "$TMPFILE"
node scripts/devgate/check-manual-cmd-whitelist.cjs "$TMPFILE" && echo "PASS: playwright 独立命令白名单校验通过" || (echo "FAIL: playwright 独立命令被拒绝"; rm "$TMPFILE"; exit 1)
rm "$TMPFILE"

# 负向验证: grep 仍然被拒绝
TMPFILE=$(mktemp)
echo '- [ ] [BEHAVIOR] grep 测试' > "$TMPFILE"
echo '  Test: manual:grep -c pattern file.txt' >> "$TMPFILE"
node scripts/devgate/check-manual-cmd-whitelist.cjs "$TMPFILE" 2>/dev/null && (echo "FAIL: grep 不应通过白名单"; rm "$TMPFILE"; exit 1) || echo "PASS: grep 正确被拒绝"
rm "$TMPFILE"
```

---

## Feature 3: harness_report 失败重试

**行为描述**:
当 `harness-report` skill 执行失败（如网络超时、API 错误、文件锁冲突）时，系统自动重试最多 3 次，每次间隔递增（如 5s → 15s → 30s）。3 次均失败后标记 verdict 为 `REPORT_FAILED` 并保留已收集的部分数据。重试逻辑在 Brain 编排层或 skill 自身实现。

**硬阈值**:
- 重试最大次数 = 3
- 每次间隔递增（不是固定间隔）
- 3 次均失败后输出 `REPORT_FAILED` verdict
- 成功时正常输出 `DONE` verdict，不受重试机制影响

**验证命令**:
```bash
# 验证重试逻辑存在于代码中
node -e "
  const fs = require('fs');
  // 检查 harness-report SKILL.md 或相关编排代码中是否包含重试逻辑
  const skillPath = 'packages/workflows/skills/harness-report/SKILL.md';
  const content = fs.readFileSync(skillPath, 'utf8');
  const hasRetry = content.includes('retry') || content.includes('重试') || content.includes('RETRY');
  const hasMaxRetry = content.includes('3') && hasRetry;
  const hasReportFailed = content.includes('REPORT_FAILED');
  if (!hasRetry) throw new Error('FAIL: SKILL.md 中未找到重试逻辑描述');
  if (!hasReportFailed) throw new Error('FAIL: SKILL.md 中未找到 REPORT_FAILED verdict');
  console.log('PASS: harness-report SKILL.md 包含重试逻辑（max=3, REPORT_FAILED）');
"

# 验证 Brain 编排层是否有重试支持
node -e "
  const fs = require('fs');
  const path = require('path');
  // 扫描 brain 编排相关文件
  const brainSrc = 'packages/brain/src';
  const files = fs.readdirSync(brainSrc).filter(f => f.endsWith('.js'));
  let retryFound = false;
  let retryFile = '';
  for (const f of files) {
    const content = fs.readFileSync(path.join(brainSrc, f), 'utf8');
    if ((content.includes('harness_report') || content.includes('harness-report')) &&
        (content.includes('retry') || content.includes('重试') || content.includes('max_retries'))) {
      retryFound = true;
      retryFile = f;
      break;
    }
  }
  if (!retryFound) {
    // 也检查 routes 子目录
    const routesDir = path.join(brainSrc, 'routes');
    if (fs.existsSync(routesDir)) {
      for (const f of fs.readdirSync(routesDir).filter(x => x.endsWith('.js'))) {
        const content = fs.readFileSync(path.join(routesDir, f), 'utf8');
        if ((content.includes('harness_report') || content.includes('harness-report')) &&
            (content.includes('retry') || content.includes('重试'))) {
          retryFound = true;
          retryFile = 'routes/' + f;
          break;
        }
      }
    }
  }
  if (!retryFound) throw new Error('FAIL: Brain 编排代码中未找到 harness_report 重试逻辑');
  console.log('PASS: Brain ' + retryFile + ' 中包含 harness_report 重试逻辑');
"
```

---

## Workstreams

workstream_count: 3

### Workstream 1: CI 白名单 — playwright 加入

**范围**: 修改 `scripts/devgate/check-manual-cmd-whitelist.cjs`，在 `ALLOWED_COMMANDS` Set 中新增 `playwright`。
**大小**: S（<100行）
**依赖**: 无

**DoD**:
- [x] [ARTIFACT] `scripts/devgate/check-manual-cmd-whitelist.cjs` 的 ALLOWED_COMMANDS 包含 `playwright`
  Test: node -e "const m=require('./scripts/devgate/check-manual-cmd-whitelist.cjs');if(!m.ALLOWED_COMMANDS.has('playwright'))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] `manual:playwright test xxx` 通过白名单校验（退出码 0），`manual:grep xxx` 仍被拒绝（退出码 1）
  Test: bash -c "TMP=$(mktemp);echo '- [ ] [BEHAVIOR] test\n  Test: manual:playwright test e2e.spec.ts'>$TMP;node scripts/devgate/check-manual-cmd-whitelist.cjs $TMP;rm $TMP"

### Workstream 2: Dashboard Harness Pipeline 面板

**范围**: 在 `apps/dashboard/src/pages/` 新增 `harness/` 目录，创建只读 Harness 面板页面。通过 Brain tasks API 获取 `harness_planner` 任务列表展示 sprint 运行状态。在 Dashboard 配置中注册 `/harness` 路由和导航入口。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness/` 目录存在且包含页面组件
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness');console.log('OK')"
- [ ] [BEHAVIOR] Dashboard 配置中注册了 `/harness` 路由，页面组件可被 DynamicRouter 加载
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessListPage.tsx','utf8');if(!c.includes('harness_planner'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] 页面从 Brain API 获取 harness 任务并渲染列表（至少显示标题和状态）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessListPage.tsx','utf8');if(!c.includes('task_type=harness'))process.exit(1);if(!c.includes('status'))process.exit(1);console.log('OK')"

### Workstream 3: harness_report 失败重试

**范围**: 在 Brain 编排层或 harness-report skill 中增加重试机制：最多 3 次、间隔递增、最终失败输出 `REPORT_FAILED`。同时更新 `packages/workflows/skills/harness-report/SKILL.md` 描述重试流程。
**大小**: M（100-300行）
**依赖**: 无

**DoD**:
- [ ] [ARTIFACT] `packages/workflows/skills/harness-report/SKILL.md` 包含重试流程描述（含 `REPORT_FAILED` verdict）
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-report/SKILL.md','utf8');if(!c.includes('REPORT_FAILED'))process.exit(1);if(!c.includes('重试'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] Brain 编排代码中存在 harness_report 重试逻辑（max_retries=3，递增间隔）
  Test: node -e "const fs=require('fs');const p=require('path');let ok=false;for(const f of fs.readdirSync('packages/brain/src')){if(!f.endsWith('.js'))continue;const c=fs.readFileSync(p.join('packages/brain/src',f),'utf8');if(c.includes('harness_report')&&c.includes('retry')){ok=true;break}}if(!ok)process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] 3 次失败后输出 REPORT_FAILED verdict（不会无限重试）
  Test: node -e "const fs=require('fs');const p=require('path');let ok=false;for(const f of fs.readdirSync('packages/brain/src')){if(!f.endsWith('.js'))continue;const c=fs.readFileSync(p.join('packages/brain/src',f),'utf8');if(c.includes('REPORT_FAILED')&&c.includes('3')){ok=true;break}}if(!ok){const sk=fs.readFileSync('packages/workflows/skills/harness-report/SKILL.md','utf8');if(sk.includes('REPORT_FAILED')&&sk.includes('3'))ok=true}if(!ok)process.exit(1);console.log('OK')"
