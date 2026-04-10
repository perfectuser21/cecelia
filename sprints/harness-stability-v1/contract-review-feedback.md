# Contract Review Feedback (Round 2)

> **审查人**: Evaluator (harness_contract_review)
> **草案来源**: cp-harness-propose-r2-bf644cc8
> **覆盖率**: 8/8 命令已分析 (100%)
> **can_bypass 统计**: 4/8 (F2-C1, F3-C1, F3-C2, F3-C3)

---

## 必须修改项

### 1. [命令太弱] Feature 3 — F3-C1/C2/C3 非递归扫描遗漏子目录（CRITICAL）

**影响**: F3 全部 3 条验证命令均受影响

**原始命令** (以 F3-C1 为例):
```javascript
for (const f of fs.readdirSync('packages/brain/src').filter(x => x.endsWith('.js'))) {
  // 只扫描顶层 .js 文件
}
```

**假实现片段** (proof-of-falsification):
```javascript
// Generator 在 packages/brain/src/routes/execution.js 中添加重试逻辑（合理选择，因为该文件已有 8 处 harness_report 引用）：
// --- packages/brain/src/routes/execution.js ---
const REPORT_MAX_RETRIES = 3;
const REPORT_RETRY_DELAYS = [5000, 15000, 30000];

async function executeHarnessReport(taskId, attempt = 0) {
  try {
    await runReport(taskId);
  } catch (err) {
    if (attempt < REPORT_MAX_RETRIES) {
      await sleep(REPORT_RETRY_DELAYS[attempt]);
      return executeHarnessReport(taskId, attempt + 1);
    }
    return { verdict: 'REPORT_FAILED', partial_data: err.collected };
  }
}
// 实现完全正确，但 F3-C1/C2/C3 的 readdirSync('packages/brain/src') 只扫描顶层
// routes/execution.js 在子目录 routes/ 中 → 全部 3 条命令报 FAIL
```

**事实依据**: `packages/brain/src/routes/execution.js` 当前已包含 harness_report 核心逻辑（第 2032-2200 行：任务创建、WS 计数、callback 处理），是 Generator 添加重试逻辑最自然的位置。

**建议修复命令** (对 F3-C1/C2/C3 统一修复):
```javascript
// 将 readdirSync 替换为递归 walk 函数：
const walk = (dir) => {
  const results = [];
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '__tests__') walk(full).forEach(f => results.push(f));
    else if (e.name.endsWith('.js')) results.push(full);
  }
  return results;
};
for (const f of walk('packages/brain/src')) {
  const c = fs.readFileSync(f, 'utf8');
  // ... 后续检查逻辑不变
}
```

同时 DoD (Workstream 3) 的 3 条 Test 命令也需要同步修复为递归扫描。

---

### 2. [命令太弱] Feature 2 — F2-C1 未过滤注释行

**原始命令**:
```javascript
const c = require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs', 'utf8');
if (!c.includes("'playwright'") && !c.includes('"playwright"')) {
  // FAIL
}
```

**假实现片段** (proof-of-falsification):
```javascript
// 假实现：只在注释中提到 playwright，实际未加入白名单
// --- scripts/devgate/check-manual-cmd-whitelist.cjs ---
// TODO: add 'playwright' to ALLOWED_COMMANDS
const ALLOWED_COMMANDS = new Set(['node', 'npm', 'npx', 'curl', 'bash', 'psql']);
// c.includes("'playwright'") → true（注释中有 'playwright'）
// 但 playwright 实际未在 Set 中 → npx playwright 仍然被拒绝
```

**建议修复命令**:
```bash
node -e "
  const c = require('fs').readFileSync('scripts/devgate/check-manual-cmd-whitelist.cjs', 'utf8');
  const lines = c.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const code = lines.join('\n');
  if (!code.includes(\"'playwright'\") && !code.includes('\"playwright\"')) {
    console.log('FAIL: ALLOWED_COMMANDS 非注释代码中未找到 playwright');
    process.exit(1);
  }
  console.log('PASS: ALLOWED_COMMANDS 包含 playwright');
"
```

同时 DoD (Workstream 1) 的 ARTIFACT Test 命令也需要同步修复。

---

## 可选改进

### A. F2-C1 可用更强验证：require 模块后直接检查 Set

```bash
node -e "
  const { ALLOWED_COMMANDS } = require('./scripts/devgate/check-manual-cmd-whitelist.cjs');
  if (!ALLOWED_COMMANDS.has('playwright')) { console.log('FAIL'); process.exit(1); }
  console.log('PASS: ALLOWED_COMMANDS.has(playwright)');
"
```

这比文本匹配更强——直接运行时检查 Set 内容。但需要确认 CI 环境下 require 路径正确。

### B. F1-C2 注释过滤可增强

当前过滤 `//` 和 `*` 开头的行，但不覆盖 `/* comment */` 单行块注释。实际影响极低（React 组件罕见此格式），但如需完美可改用简单的块注释剥离：
```javascript
allCode = allCode.replace(/\/\*[\s\S]*?\*\//g, '');
```
