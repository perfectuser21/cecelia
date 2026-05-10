# Sprint Contract Draft (Round 1)

> **Initiative**: Brain LangGraph 5 节点流水线最小闭环验证
> **Child task**: `fe91ce26-6f78-4f2e-93f5-d7cb6267fe56`
> **journey_type**: autonomous
> **Workstream count**: 1（minimal-but-real change）

---

## 选定的"最小可观测目标"

PRD 把"最小可观测目标"的具体形态留给 Proposer 决定。本合同选定：

**新增模块** `packages/brain/src/harness-happy-path-marker.js`，导出：

- `HARNESS_HAPPY_PATH_MARKER`（常量，值为 `fe91ce26-5nodes-verified`）
- `verifyHarnessHappyPath()`（函数，返回该常量）

**理由**：
1. 真实代码 import 一个新模块，**非空 commit**——`grep`/`node -e` 都能机械验证存在性
2. 文件 < 10 行，几乎不可能引入回归
3. 常量值含 child task short id（`fe91ce26`），证明改动与本任务对应，杜绝复用旧 PR 的伪验证
4. 不依赖任何运行时副作用（DB/网络）——Evaluator 在 PR CI 里能 100% 离线验证
5. 失败/通过 完全由文件存在 + 内容 + vitest 测试决定，无歧义

---

## Golden Path

```
[Brain 派发 child harness_initiative fe91ce26]
  → [Generator commit 1 (Red): 在 packages/brain/tests/ws1/ 落 BEHAVIOR 测试]
  → [Generator commit 2 (Green): 落实现 packages/brain/src/harness-happy-path-marker.js]
  → [PR push 到 GitHub]
  → [Evaluator contract-verify 在 PR HEAD 跑全部验证命令 → 全 PASS]
  → [auto-merge 进 main]
  → [出口: brain.tasks.status=completed + result.merged=true]
```

下面 5 个 Step 是 Evaluator 在 PR HEAD（merge 前）能机械验证的子集。Step 6 为 post-merge 出口验证（journey_type 决定是否纳入 E2E 必验集）。

---

### Step 1: Generator commit 1 (Red) 已落地——测试文件存在于 PR HEAD

**可观测行为**：在 PR 分支 HEAD 上，`packages/brain/tests/ws1/harness-happy-path-marker.test.js` 存在，且文件首 50 行内含 `vitest` import 与至少一个 `it(` block；该 test 内部的 import 指向的目标文件如果不存在，跑 vitest 时该测试会失败（commit 1 的 Red 证据）。

**验证命令**：
```bash
# Step 1 验证：测试文件存在 + 内容真实是 vitest BEHAVIOR 测试，不是空壳
node -e "
const fs = require('fs');
const p = 'packages/brain/tests/ws1/harness-happy-path-marker.test.js';
if (!fs.existsSync(p)) { console.error('FAIL: missing ' + p); process.exit(1); }
const c = fs.readFileSync(p, 'utf8');
const head = c.split('\n').slice(0, 60).join('\n');
if (!/from ['\"]vitest['\"]/.test(head)) { console.error('FAIL: not a vitest test (no import from vitest)'); process.exit(1); }
const itCount = (c.match(/\bit\s*\(/g) || []).length;
if (itCount < 2) { console.error('FAIL: expected >=2 it() blocks, got ' + itCount); process.exit(1); }
if (!c.includes('HARNESS_HAPPY_PATH_MARKER')) { console.error('FAIL: test does not reference HARNESS_HAPPY_PATH_MARKER'); process.exit(1); }
console.log('PASS Step 1: test file exists with ' + itCount + ' it() blocks');
"
```

**硬阈值**：测试文件存在；内含 `from 'vitest'` import；`it(` 块数 ≥ 2；显式引用 `HARNESS_HAPPY_PATH_MARKER` 标识符。

---

### Step 2: Generator commit 2 (Green) 实现模块存在

**可观测行为**：`packages/brain/src/harness-happy-path-marker.js` 存在，且导出 `HARNESS_HAPPY_PATH_MARKER` 与 `verifyHarnessHappyPath` 两个具名 export。

**验证命令**：
```bash
# Step 2 验证：实现文件存在 + 含两个具名 export 的源码模式
node -e "
const fs = require('fs');
const p = 'packages/brain/src/harness-happy-path-marker.js';
if (!fs.existsSync(p)) { console.error('FAIL: missing ' + p); process.exit(1); }
const c = fs.readFileSync(p, 'utf8');
if (!/export\s+const\s+HARNESS_HAPPY_PATH_MARKER\b/.test(c)) {
  console.error('FAIL: missing named export HARNESS_HAPPY_PATH_MARKER'); process.exit(1);
}
if (!/export\s+function\s+verifyHarnessHappyPath\b/.test(c)) {
  console.error('FAIL: missing named export verifyHarnessHappyPath'); process.exit(1);
}
console.log('PASS Step 2: implementation file with both named exports');
"
```

**硬阈值**：文件存在；正则 `/export\s+const\s+HARNESS_HAPPY_PATH_MARKER/` 命中；正则 `/export\s+function\s+verifyHarnessHappyPath/` 命中。

---

### Step 3: 模块运行时行为正确——常量值含 child task 签名

**可观测行为**：`import` 该模块后，`HARNESS_HAPPY_PATH_MARKER` 严格等于 `'fe91ce26-5nodes-verified'`，`verifyHarnessHappyPath()` 返回相同字符串。常量值含 child task short id (`fe91ce26`) 是关键防造假约束——即使 attacker 复用旧 PR 也无法通过此项。

**验证命令**：
```bash
# Step 3 验证：动态 import 跑实际 ESM 模块，断言值逐字相符
node --input-type=module -e "
const m = await import('./packages/brain/src/harness-happy-path-marker.js');
const expected = 'fe91ce26-5nodes-verified';
if (m.HARNESS_HAPPY_PATH_MARKER !== expected) {
  console.error('FAIL: HARNESS_HAPPY_PATH_MARKER=' + JSON.stringify(m.HARNESS_HAPPY_PATH_MARKER) + ' expected=' + JSON.stringify(expected));
  process.exit(1);
}
if (typeof m.verifyHarnessHappyPath !== 'function') {
  console.error('FAIL: verifyHarnessHappyPath is not a function (got ' + typeof m.verifyHarnessHappyPath + ')');
  process.exit(1);
}
const ret = m.verifyHarnessHappyPath();
if (ret !== expected) {
  console.error('FAIL: verifyHarnessHappyPath() returned ' + JSON.stringify(ret) + ' expected ' + JSON.stringify(expected));
  process.exit(1);
}
console.log('PASS Step 3: marker=' + m.HARNESS_HAPPY_PATH_MARKER + ', function returns same');
"
```

**硬阈值**：常量严格等于 `fe91ce26-5nodes-verified`；函数存在且返回相同字符串。

---

### Step 4: vitest BEHAVIOR 测试通过

**可观测行为**：在 `packages/brain` 工作区跑 vitest，仅运行本 workstream 的测试，返回 `0 failed`。

**验证命令**：
```bash
# Step 4 验证：跑 BEHAVIOR 测试。--silent 也要 reporter=default 否则 grep 不到结果
set -e
cd packages/brain
NODE_OPTIONS="--max-old-space-size=2048" npx vitest run tests/ws1/harness-happy-path-marker.test.js --reporter=default 2>&1 | tee /tmp/ws1-vitest.log
grep -qE "Tests\s+[0-9]+\s+passed.*0\s+failed|✓.*HARNESS_HAPPY_PATH_MARKER" /tmp/ws1-vitest.log || \
  grep -qE "Test Files\s+1 passed" /tmp/ws1-vitest.log || \
  { echo "FAIL Step 4: vitest did not report all-passed"; exit 1; }
grep -qE "FAIL|failed" /tmp/ws1-vitest.log && grep -vqE "0\s+failed" /tmp/ws1-vitest.log && \
  { echo "FAIL Step 4: vitest output mentions FAIL/failed (and not '0 failed')"; exit 1; } || true
echo "PASS Step 4: vitest tests/ws1/ all passed"
```

**硬阈值**：vitest 输出含 `Test Files 1 passed` 或等价的 `0 failed`；不含未抵消的 `FAIL`/`failed` 标记。

---

### Step 5: 测试套件不被本 PR 打破——回归保护

**可观测行为**：跑 packages/brain 的全量已启用单元测试集，通过率不低于 main 基线（本 PR 不引入新失败）。本步骤是 Evaluator 的「不破坏现状」验证。

**验证命令**：
```bash
# Step 5 验证：跑 brain 子集 vitest（仅本 PR 涉及目录），确认无新增失败
# 范围限定到 ws1 目录避免 OOM（main 上 brain 全量需 3GB+）
set -e
cd packages/brain
NODE_OPTIONS="--max-old-space-size=2048" npx vitest run tests/ws1/ --reporter=default 2>&1 | tee /tmp/ws1-regression.log
PASSED=$(grep -oE "Tests\s+[0-9]+\s+passed" /tmp/ws1-regression.log | grep -oE "[0-9]+" | head -1)
FAILED=$(grep -oE "Tests\s+.*?[0-9]+\s+failed" /tmp/ws1-regression.log | grep -oE "[0-9]+" | tail -1)
[ -z "$FAILED" ] && FAILED=0
[ -z "$PASSED" ] && PASSED=0
if [ "$FAILED" -gt 0 ]; then
  echo "FAIL Step 5: $FAILED test(s) failed in ws1/ scope"
  exit 1
fi
if [ "$PASSED" -lt 2 ]; then
  echo "FAIL Step 5: expected >=2 passed tests, got $PASSED"
  exit 1
fi
echo "PASS Step 5: $PASSED passed / $FAILED failed in ws1 scope"
```

**硬阈值**：`failed = 0`，`passed ≥ 2`（两个 it block 至少一一映射）。

---

### Step 6 (post-merge 出口验证 / 仅供参考)

**可观测行为**：PR 合入 main 后，brain.tasks 中本 task 的 `status='completed'` 且 `result.merged=true`。**本步骤由 harness-final-e2e 节点（journey_type=autonomous）在 merge 后回写阶段验证，不进入 contract-verify 在 PR HEAD 的强制集**——因为 PR 还没合时无法验。Evaluator 在 PR HEAD 只跑 Step 1-5。

**参考命令**（post-merge 由 brain 主进程自行验证）：
```bash
# Step 6 (post-merge 验证): 父任务回执 + brain 状态回写
# 不在 contract-verify 集合内，由 harness-final-e2e 节点在 main 合并后跑
TASK_ID="fe91ce26-6f78-4f2e-93f5-d7cb6267fe56"
RESULT=$(curl -fsS "http://localhost:5221/api/brain/tasks/${TASK_ID}")
echo "$RESULT" | node -e "
let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>{
  const t = JSON.parse(s);
  if (t.status !== 'completed') { console.error('FAIL: status=' + t.status); process.exit(1); }
  if (!t.result || t.result.merged !== true) { console.error('FAIL: result.merged !== true'); process.exit(1); }
  if (!t.result.pr_url || !/github\.com.*\/pull\//.test(t.result.pr_url)) { console.error('FAIL: pr_url missing or malformed'); process.exit(1); }
  console.log('PASS Step 6: completed + merged + pr_url ok');
});
"
```

---

## E2E 验收（Evaluator 在 PR HEAD 跑的完整脚本）

**journey_type**: `autonomous`（Brain 自主闭环验证，不依赖 dashboard / 外部 agent）

**完整验证脚本**（顺序执行 Step 1-5；Step 6 由 harness-final-e2e 节点 post-merge 验）：

```bash
#!/usr/bin/env bash
# E2E happy-path verification — runs in PR HEAD via contract-verify
set -e
set -o pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR" || cd "$(git rev-parse --show-toplevel)"

echo "=== Step 1: Red test file exists with vitest signature ==="
node -e "
const fs = require('fs');
const p = 'packages/brain/tests/ws1/harness-happy-path-marker.test.js';
if (!fs.existsSync(p)) { console.error('FAIL: missing ' + p); process.exit(1); }
const c = fs.readFileSync(p, 'utf8');
if (!/from ['\"]vitest['\"]/.test(c.split('\n').slice(0, 60).join('\n'))) { console.error('FAIL: not a vitest test'); process.exit(1); }
const itCount = (c.match(/\bit\s*\(/g) || []).length;
if (itCount < 2) { console.error('FAIL: expected >=2 it() blocks, got ' + itCount); process.exit(1); }
if (!c.includes('HARNESS_HAPPY_PATH_MARKER')) { console.error('FAIL: test does not reference HARNESS_HAPPY_PATH_MARKER'); process.exit(1); }
console.log('OK Step 1');
"

echo "=== Step 2: implementation file exists with both named exports ==="
node -e "
const fs = require('fs');
const p = 'packages/brain/src/harness-happy-path-marker.js';
if (!fs.existsSync(p)) { console.error('FAIL: missing ' + p); process.exit(1); }
const c = fs.readFileSync(p, 'utf8');
if (!/export\s+const\s+HARNESS_HAPPY_PATH_MARKER\b/.test(c)) { console.error('FAIL'); process.exit(1); }
if (!/export\s+function\s+verifyHarnessHappyPath\b/.test(c)) { console.error('FAIL'); process.exit(1); }
console.log('OK Step 2');
"

echo "=== Step 3: runtime values match child task signature ==="
node --input-type=module -e "
const m = await import('./packages/brain/src/harness-happy-path-marker.js');
const expected = 'fe91ce26-5nodes-verified';
if (m.HARNESS_HAPPY_PATH_MARKER !== expected) { console.error('FAIL: marker=' + JSON.stringify(m.HARNESS_HAPPY_PATH_MARKER)); process.exit(1); }
if (typeof m.verifyHarnessHappyPath !== 'function') { console.error('FAIL: not a function'); process.exit(1); }
if (m.verifyHarnessHappyPath() !== expected) { console.error('FAIL: function return mismatch'); process.exit(1); }
console.log('OK Step 3');
"

echo "=== Step 4: vitest BEHAVIOR test passes ==="
(cd packages/brain && NODE_OPTIONS="--max-old-space-size=2048" npx vitest run tests/ws1/harness-happy-path-marker.test.js --reporter=default 2>&1 | tee /tmp/ws1-vitest.log)
grep -qE "Test Files\s+1 passed" /tmp/ws1-vitest.log || { echo "FAIL Step 4: not '1 passed'"; exit 1; }
grep -qE "Tests\s+[0-9]+\s+passed.*\(.*\)" /tmp/ws1-vitest.log || true
echo "OK Step 4"

echo "=== Step 5: ws1 scope no regressions (failed=0, passed>=2) ==="
(cd packages/brain && NODE_OPTIONS="--max-old-space-size=2048" npx vitest run tests/ws1/ --reporter=default 2>&1 | tee /tmp/ws1-regression.log) || true
FAILED=$(grep -oE "Tests\s+[^,]*?[0-9]+\s+failed" /tmp/ws1-regression.log | grep -oE "[0-9]+" | tail -1)
PASSED=$(grep -oE "Tests\s+[0-9]+\s+passed" /tmp/ws1-regression.log | grep -oE "[0-9]+" | head -1)
[ -z "$FAILED" ] && FAILED=0
[ -z "$PASSED" ] && PASSED=0
if [ "$FAILED" -gt 0 ]; then echo "FAIL Step 5: failed=$FAILED"; exit 1; fi
if [ "$PASSED" -lt 2 ]; then echo "FAIL Step 5: passed=$PASSED < 2"; exit 1; fi
echo "OK Step 5: passed=$PASSED failed=$FAILED"

echo "✅ Golden Path E2E 验证通过 (Steps 1-5)"
```

**通过标准**：脚本以 exit 0 结束。

---

## Workstreams

workstream_count: 1

### Workstream 1: harness happy path marker module + BEHAVIOR test

**范围**：
- 新增 `packages/brain/src/harness-happy-path-marker.js`，导出 `HARNESS_HAPPY_PATH_MARKER` 常量与 `verifyHarnessHappyPath()` 函数
- 新增 `packages/brain/tests/ws1/harness-happy-path-marker.test.js`，覆盖两个 BEHAVIOR
- 不改动其他文件、不改 vitest config、不动 brain server

**大小**：S（实现 + 测试合计 < 30 行）
**依赖**：无

**BEHAVIOR 覆盖测试文件**：`packages/brain/tests/ws1/harness-happy-path-marker.test.js`（Generator 从 `sprints/tests/ws1/harness-happy-path-marker.test.js` 原样复制；commit 1 之后不可修改）。

---

## Test Contract

| Workstream | Test File (PR HEAD)                                          | BEHAVIOR 覆盖                                                                                  | 预期 Red 证据（commit 1，无实现时） |
|------------|--------------------------------------------------------------|------------------------------------------------------------------------------------------------|--------------------------------------|
| WS1        | `packages/brain/tests/ws1/harness-happy-path-marker.test.js` | (1) 模块导出 `HARNESS_HAPPY_PATH_MARKER === 'fe91ce26-5nodes-verified'`<br>(2) `verifyHarnessHappyPath()` 返回相同字符串 | 2 failures（import 失败 → 整文件 fail） |

---

## 防造假说明（Reviewer 重点审查）

| 验证维度       | 防造假手段                                                                                                                                                          |
|----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 文件存在性     | `fs.existsSync` 直读 PR HEAD checkout 的 working tree                                                                                                               |
| 内容真实性     | 正则 `/export\s+const\s+HARNESS_HAPPY_PATH_MARKER/` + `/export\s+function\s+verifyHarnessHappyPath/`，仅 export 声明能命中（注释/字符串字面量不能命中）           |
| 运行时正确性   | 动态 `import()` 真实 ESM module（不 mock），断言值逐字符等于 `fe91ce26-5nodes-verified`——含 child task short id，旧 PR / 不相关分支无法复用                       |
| BEHAVIOR 强约束| vitest `Test Files 1 passed` + `Tests N passed` 同时满足，单点失败 grep 直接命中                                                                                    |
| 回归保护       | Step 5 限定 ws1 目录全量 vitest，`failed=0` & `passed>=2` 双约束，单测 it 数量 ≥ 2 防"删 it 让套件假绿"                                                              |
| 时间戳/造假    | 不依赖 `count(*)` / 数据库——纯文件 + 模块行为，不存在时间窗口绕过；marker 字符串含 `fe91ce26` 防跨 PR 重放                                                          |

---

## 假设与边界

- **vitest 可执行**：`packages/brain/package.json` 已声明 vitest 依赖；CI 跑 `npm ci` 后 `npx vitest` 即可运行。
- **ESM import 路径**：测试文件用 `../../src/harness-happy-path-marker.js`（从 `packages/brain/tests/ws1/` 出发，2 层上溯 + `src/`）。Generator 必须把 sprints 下测试**原样复制**到 `packages/brain/tests/ws1/`，**不要改 import 路径**。
- **vitest config 兼容**：`packages/brain/vitest.config.js` 的 include 已含 `'tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'`，新测试自动被收录，无需改 config。
- **不引入 db/网络依赖**：模块纯 const + 纯函数，避免触发 brain DB 集成测试 exclude 名单。
- **不影响其他 sprint**：本 PR 只新增两个文件，不修改任何已有源/测试文件。
