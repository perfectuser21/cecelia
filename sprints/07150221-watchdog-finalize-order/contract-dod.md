# Contract DoD — 刀A2：watchdog 收口顺序 + _parseBaseRepo 修复

sprint: 07150221-watchdog-finalize-order
task_id: 5e9c0496-a7a9-4889-b536-8094c25da604
date: 2026-07-15

---

## [BEHAVIOR] 断言

### [BEHAVIOR-1] generator_done+pr_url 空+反查 MERGED → _finalizeMergedRun 被调，日志含 discovered_merged_via_fallback

**场景**：`task.payload.generator_done=true`，`run.pr_url=null`，`_discoverPrFromGithub` 返回 `{state:'MERGED', url:'https://github.com/perfectuser21/cecelia/pull/1'}`

**断言**：
- `spawnFn` 调用次数为 0
- `out.mergedPr === 1`
- `pool.query` 历史 SQL 中存在匹配 `/UPDATE initiative_runs/` 且含 `'done'` 的 SQL
- `pool.query` 历史 SQL 中存在匹配 `/UPDATE tasks/` 且含 `'completed'` 的 SQL
- `console.log` spy 捕获到含 `discovered_merged_via_fallback` 的调用

**测试文件**：`packages/brain/src/__tests__/harness-relay-watchdog.test.js`（新增 describe 块）

---

### [BEHAVIOR-2] _parseBaseRepo 支持宿主机绝对路径，返回 owner/repo 字符串

**场景**：直接调用 `_parseBaseRepo` 导出函数

**断言**：
- `_parseBaseRepo('/Users/administrator/perfect21/cecelia')` 严格等于 `'perfectuser21/cecelia'`
- `_parseBaseRepo('/workspace')` 严格等于 `'perfectuser21/cecelia'`
- `_parseBaseRepo('https://github.com/org/repo')` 严格等于 `'org/repo'`（原有行为不变）
- `_parseBaseRepo(null)` 严格等于 `null`
- `_parseBaseRepo('random-string')` 严格等于 `null`（不识别非映射路径）

**测试文件**：`packages/brain/src/__tests__/harness-relay-watchdog.test.js`（新增 describe 块）

---

### [BEHAVIOR-3] generator_done+pr_url 空+反查 OPEN → 回写 pr_url，跳过重点火

**场景**：`task.payload.generator_done=true`，`run.pr_url=null`，mock 反查返回 `{state:'OPEN', url:'https://github.com/x/y/pull/2'}`

**断言**：
- `spawnFn` 调用次数为 0（不二次 spawn）
- `out.resumed === 0`
- `pool.query` 历史 SQL 中存在匹配 `/UPDATE initiative_runs SET pr_url/` 的 SQL
- `pool.query` 历史 SQL 中参数含目标 PR URL

**测试文件**：`packages/brain/src/__tests__/harness-relay-watchdog.test.js`（新增 describe 块）

---

### [BEHAVIOR-4] generator_done=true + 超时兜底语义不变（GENERATOR_DONE_TIMEOUT_MS=6h）

**场景**：`task.payload.generator_done=true`，`doneAt` 早于 `Date.now() - GENERATOR_DONE_TIMEOUT_MS`，`run.pr_url=null`，无 PR 可查

**断言**：
- `pool.query` 历史 SQL 含 `UPDATE initiative_runs SET phase='failed'` 且 `failure_reason='generator_done_timeout'`
- `spawnFn` 调用次数为 0
- `out.capped === 1`（或通过现有 generator_done_timeout 测试路径验证）

**测试文件**：现有超时分支测试须通过（无回归），可新增边界验证

---

### [BEHAVIOR-5] 既有 watchdog 测试全部通过（GP-4 无回归）

**场景**：所有 `packages/brain/src/__tests__/harness-relay-watchdog.test.js` 既有 test case

**断言**：
- `pnpm --filter brain test --run` 退出码为 0
- 无 FAIL 行出现在输出中

---

## manual:bash 验收命令

### 步骤 1：安装依赖（首次）

```bash
cd /workspace && pnpm install --frozen-lockfile
```

### 步骤 2：运行 watchdog 单元测试

```bash
cd /workspace && pnpm --filter brain test --run 2>&1 | grep -E "(PASS|FAIL|✓|✗|×|harness-relay-watchdog)"
```

预期：无 `FAIL` 行；`harness-relay-watchdog` 测试套件全绿。

### 步骤 3：验证 [BEHAVIOR-1] — discovered_merged_via_fallback

```bash
cd /workspace && pnpm --filter brain test --run --reporter=verbose 2>&1 | grep -E "discovered_merged_via_fallback|BEHAVIOR-1|GP-1.*generator_done"
```

预期：含对应测试的绿色通过行。

### 步骤 4：验证 [BEHAVIOR-2] — _parseBaseRepo 路径映射

```bash
cd /workspace && node --input-type=module <<'EOF'
import { _parseBaseRepo } from './packages/brain/src/harness-relay-watchdog.js';
const cases = [
  ['/Users/administrator/perfect21/cecelia', 'perfectuser21/cecelia'],
  ['/workspace', 'perfectuser21/cecelia'],
  ['https://github.com/org/repo', 'org/repo'],
  [null, null],
];
let passed = 0;
for (const [input, expected] of cases) {
  const result = _parseBaseRepo(input);
  const ok = result === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} _parseBaseRepo(${JSON.stringify(input)}) = ${JSON.stringify(result)} (expected ${JSON.stringify(expected)})`);
  if (ok) passed++;
}
console.log(`\n${passed}/${cases.length} cases passed`);
if (passed !== cases.length) process.exit(1);
EOF
```

预期：`4/4 cases passed`，退出码 0。

### 步骤 5：验证 [BEHAVIOR-3] — generator_done+OPEN 回写 pr_url

```bash
cd /workspace && pnpm --filter brain test --run --reporter=verbose 2>&1 | grep -E "OPEN.*回写|pr_url.*OPEN|BEHAVIOR-3"
```

### 步骤 6：完整测试套件一次性通过（CI 等价命令）

```bash
cd /workspace && pnpm --filter brain test --run
echo "Exit code: $?"
```

预期：退出码 0，无 FAIL。

---

## 修改范围约束

**唯一允许修改的文件**：
1. `packages/brain/src/harness-relay-watchdog.js`
   - `_parseBaseRepo` 函数：新增路径→仓库名映射表 + `HARNESS_REPO_MAP` env 覆盖
   - `resumeStalledRelayRuns` 的 `generatorDone` 分支（第 279–305 行附近）：在 `continue` 前插入 `_discoverPrFromGithub` 调用逻辑
2. `packages/brain/src/__tests__/harness-relay-watchdog.test.js`
   - 新增 `describe('刀A2 — generator_done + pr_url 空 反查修复')` 块，含 GP-1/GP-2/GP-3 对应 test

**禁止修改**：
- `_finalizeMergedRun` 内部（签名、逻辑、日志）
- `_raiseUngatedMergeAlert`
- `_discoverPrFromGithub`（签名和过滤逻辑）
- `GENERATOR_DONE_TIMEOUT_MS` 值
- 任何 spawn/evaluator/judge 路径
