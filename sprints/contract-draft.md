# Sprint Contract Draft (Round 1)

## Golden Path

[开发者打开 packages/brain/src/tick.js] → [视线落到 TICK_LOOP_INTERVAL_MS 出现的第一处] → [在该位置 ±2 行内看到一行明确说明单位的注释] → [开发者立刻判断常量数值的单位含义]

---

### Step 1: 开发者打开 `packages/brain/src/tick.js`

**可观测行为**: 文件存在、可读、未被本任务破坏（仍是合法 ES Module）。

**验证命令**:
```bash
test -f packages/brain/src/tick.js && \
  node --check packages/brain/src/tick.js
# 期望：exit 0（语法合法）
```

**硬阈值**: exit code = 0；文件大小 > 0 字节；node --check 不报任何 SyntaxError。

---

### Step 2: 在 `TICK_LOOP_INTERVAL_MS` **第一处出现**（import 块）位置 ±2 行内出现单位注释

**可观测行为**: 文件中第一次出现 `TICK_LOOP_INTERVAL_MS` 这个标识符的那一行，连同它前后各 2 行，组成的 5 行窗口里至少有一行包含"毫秒"或字符串 "ms"，且这一行是注释（以 `//` 开头或位于 `/* */` 块里）。注释里必须能识别出该说明的对象是 `TICK_LOOP_INTERVAL_MS`（不是其他常量）。

**验证命令**:
```bash
# 1) 取 TICK_LOOP_INTERVAL_MS 第一次出现的行号
FIRST_LINE=$(grep -n -m1 'TICK_LOOP_INTERVAL_MS' packages/brain/src/tick.js | cut -d: -f1)
[ -n "$FIRST_LINE" ] || { echo "FAIL: 找不到 TICK_LOOP_INTERVAL_MS"; exit 1; }

# 2) 该行属于 import 块（行号 < 100，避开末尾 export 块的第二处出现 ~line 160）
[ "$FIRST_LINE" -lt 100 ] || { echo "FAIL: 第一处出现位置异常 ($FIRST_LINE)"; exit 1; }

# 3) ±2 行窗口内必须存在一条 // 注释，且包含 'ms' 或 '毫秒'，并提及 TICK_LOOP_INTERVAL_MS
START=$(( FIRST_LINE - 2 )); [ $START -lt 1 ] && START=1
END=$(( FIRST_LINE + 2 ))
WINDOW=$(sed -n "${START},${END}p" packages/brain/src/tick.js)
echo "$WINDOW" | grep -E '^\s*//' | grep -E '(毫秒|ms|MS)' | grep -q 'TICK_LOOP_INTERVAL_MS' \
  || { echo "FAIL: 窗口内未找到说明 TICK_LOOP_INTERVAL_MS 单位的 // 注释"; echo "窗口内容:"; echo "$WINDOW"; exit 1; }

echo "PASS: Step 2 注释存在并指向 TICK_LOOP_INTERVAL_MS"
```

**硬阈值**:
- `FIRST_LINE` 必须 < 100（确认是 import 块那一处，不是末尾 export 块）。
- 5 行窗口内 **恰好** 至少 1 条以 `//` 开头的注释行同时包含 `毫秒|ms|MS` 与 `TICK_LOOP_INTERVAL_MS` 字样。
- 命令整体 exit code = 0。

---

### Step 3: 不越界 — import / export 结构未被破坏，`tick-loop.js` 未动

**可观测行为**: 本任务只加注释，不动 import/export 结构。`TICK_LOOP_INTERVAL_MS` 仍同时出现在 `tick.js` 的 (a) 从 `./tick-loop.js` 的 import 名单内、(b) 文件末尾的 `export { ... }` 名单内；import 块内三个常量顺序保持 `TICK_INTERVAL_MINUTES → TICK_LOOP_INTERVAL_MS → TICK_TIMEOUT_MS`。`tick-loop.js` 完全未变更。

> 备注：PRD 中"出现 2 次"是基于代码标识符的口径；实际整文件还包含 line 66 那条历史 Phase 注释也提到该常量名。本合同改用更精准的 **import 名单 ∧ export 名单** 结构性检查，避免被字符串计数误导。

**验证命令**:
```bash
# 1) import 块结构：从 './tick-loop.js' 拉的 import 名单内同时含 3 个常量，且顺序为 MINUTES→LOOP_INTERVAL_MS→TIMEOUT_MS
node -e '
const c = require("fs").readFileSync("packages/brain/src/tick.js", "utf8");
const m = c.match(/from\s+["\x27]\.\/tick-loop\.js["\x27]/);
if (!m) { console.error("FAIL: 没找到 from \"./tick-loop.js\" 的 import"); process.exit(1); }
const block = c.slice(0, m.index);
const lastImport = block.lastIndexOf("import");
const importBlock = c.slice(lastImport, m.index);
const idxMin  = importBlock.indexOf("TICK_INTERVAL_MINUTES");
const idxLoop = importBlock.indexOf("TICK_LOOP_INTERVAL_MS");
const idxTmo  = importBlock.indexOf("TICK_TIMEOUT_MS");
if (!(idxMin > -1 && idxLoop > -1 && idxTmo > -1 && idxMin < idxLoop && idxLoop < idxTmo)) {
  console.error("FAIL: import 块内 3 个常量缺失或顺序被改动");
  process.exit(1);
}
console.log("PASS: import 顺序未变");
'

# 2) export 名单仍然 re-export TICK_LOOP_INTERVAL_MS
node -e '
const c = require("fs").readFileSync("packages/brain/src/tick.js", "utf8");
// 任何形如 export { ... TICK_LOOP_INTERVAL_MS ... }; 的块（多行兼容）
const re = /export\s*\{[\s\S]*?TICK_LOOP_INTERVAL_MS[\s\S]*?\}/m;
if (!re.test(c)) { console.error("FAIL: 未找到含 TICK_LOOP_INTERVAL_MS 的 export 名单"); process.exit(1); }
console.log("PASS: export 仍 re-export TICK_LOOP_INTERVAL_MS");
'

# 3) tick-loop.js 与 origin/main 完全一致
git fetch origin main --depth=1 2>/dev/null
git diff --quiet origin/main -- packages/brain/src/tick-loop.js \
  || { echo "FAIL: tick-loop.js 被改动（任务范围外）"; exit 1; }

echo "PASS: Step 3 范围限定守住"
```

**硬阈值**:
- import 块同时含 `TICK_INTERVAL_MINUTES`、`TICK_LOOP_INTERVAL_MS`、`TICK_TIMEOUT_MS` 三者，且相对顺序保持 MINUTES → LOOP_INTERVAL_MS → TIMEOUT_MS。
- 文件中存在至少一个匹配 `export\s*\{...TICK_LOOP_INTERVAL_MS...\}` 的 export 名单块。
- `git diff origin/main -- packages/brain/src/tick-loop.js` 无输出（exit 0）。
- 命令整体 exit code = 0。

---

### Step 4 (出口): 净 diff 等价于"加 1 行注释"

**可观测行为**: 与 origin/main 比，本任务对 `tick.js` 的净影响是新增 1 行注释、删除 0 行；对其他文件 0 改动。

**验证命令**:
```bash
git fetch origin main --depth=1 2>/dev/null

# 1) 仅 tick.js 被改动
CHANGED=$(git diff --name-only origin/main -- packages/brain/ | sort -u)
EXPECTED="packages/brain/src/tick.js"
[ "$CHANGED" = "$EXPECTED" ] || { echo "FAIL: 改动文件清单不符。实际: [$CHANGED]"; exit 1; }

# 2) tick.js 净 diff = +1 -0
ADDED=$(git diff --numstat origin/main -- packages/brain/src/tick.js | awk '{print $1}')
DELETED=$(git diff --numstat origin/main -- packages/brain/src/tick.js | awk '{print $2}')
[ "$ADDED" = "1" ] || { echo "FAIL: 新增行数 = $ADDED，应为 1"; exit 1; }
[ "$DELETED" = "0" ] || { echo "FAIL: 删除行数 = $DELETED，应为 0"; exit 1; }

# 3) 新增的那一行就是注释（以 // 开头）且含 "ms" 或 "毫秒" + "TICK_LOOP_INTERVAL_MS"
NEW_LINE=$(git diff origin/main -- packages/brain/src/tick.js | grep -E '^\+[^+]' | sed 's/^+//')
echo "$NEW_LINE" | grep -E '^\s*//' | grep -E '(毫秒|ms|MS)' | grep -q 'TICK_LOOP_INTERVAL_MS' \
  || { echo "FAIL: 新增行不是说明 TICK_LOOP_INTERVAL_MS 单位的注释。实际: $NEW_LINE"; exit 1; }

echo "PASS: 净 diff 等于 1 行单位注释"
```

**硬阈值**:
- `git diff --name-only origin/main -- packages/brain/` 输出**恰好**只有 `packages/brain/src/tick.js`。
- `tick.js` 净 diff = `+1 / -0`。
- 新增的那一行同时满足：以 `//` 开头、含 `毫秒|ms|MS`、含 `TICK_LOOP_INTERVAL_MS` 字样。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd "${WORKSPACE_ROOT:-/workspace}"

# 0. 前提：tick.js 文件存在且语法合法
test -f packages/brain/src/tick.js
node --check packages/brain/src/tick.js

# 1. Step 2: TICK_LOOP_INTERVAL_MS 第一处出现 ±2 行内有单位注释
FIRST_LINE=$(grep -n -m1 'TICK_LOOP_INTERVAL_MS' packages/brain/src/tick.js | cut -d: -f1)
[ -n "$FIRST_LINE" ] && [ "$FIRST_LINE" -lt 100 ]
START=$(( FIRST_LINE - 2 )); [ $START -lt 1 ] && START=1
END=$(( FIRST_LINE + 2 ))
sed -n "${START},${END}p" packages/brain/src/tick.js \
  | grep -E '^\s*//' \
  | grep -E '(毫秒|ms|MS)' \
  | grep -q 'TICK_LOOP_INTERVAL_MS'

# 2. Step 3: 范围守住 (import 名单/顺序未变, export 名单仍含, tick-loop.js 未动)
node -e '
const c = require("fs").readFileSync("packages/brain/src/tick.js", "utf8");
const m = c.match(/from\s+["\x27]\.\/tick-loop\.js["\x27]/);
if (!m) process.exit(1);
const block = c.slice(0, m.index);
const lastImport = block.lastIndexOf("import");
const importBlock = c.slice(lastImport, m.index);
const a = importBlock.indexOf("TICK_INTERVAL_MINUTES");
const b = importBlock.indexOf("TICK_LOOP_INTERVAL_MS");
const d = importBlock.indexOf("TICK_TIMEOUT_MS");
if (!(a > -1 && b > -1 && d > -1 && a < b && b < d)) process.exit(1);
if (!/export\s*\{[\s\S]*?TICK_LOOP_INTERVAL_MS[\s\S]*?\}/m.test(c)) process.exit(1);
'
git fetch origin main --depth=1 2>/dev/null
git diff --quiet origin/main -- packages/brain/src/tick-loop.js

# 3. Step 4: 净 diff = 仅 tick.js +1 -0，且新增行就是注释
CHANGED=$(git diff --name-only origin/main -- packages/brain/ | sort -u)
[ "$CHANGED" = "packages/brain/src/tick.js" ]
ADDED=$(git diff --numstat origin/main -- packages/brain/src/tick.js | awk '{print $1}')
DELETED=$(git diff --numstat origin/main -- packages/brain/src/tick.js | awk '{print $2}')
[ "$ADDED" = "1" ] && [ "$DELETED" = "0" ]
NEW_LINE=$(git diff origin/main -- packages/brain/src/tick.js | grep -E '^\+[^+]' | sed 's/^+//')
echo "$NEW_LINE" | grep -E '^\s*//' | grep -E '(毫秒|ms|MS)' | grep -q 'TICK_LOOP_INTERVAL_MS'

# 4. BEHAVIOR 单元测试通过
cd packages/brain
npx vitest run "../../sprints/tests/ws1/" --reporter=verbose

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0。

**防造假说明**:
- Step 4 锁定净 diff = `+1 / -0`，无法靠"先改一堆其他东西再加一行注释"绕过。
- Step 3 防止"重命名常量"或"改 import 顺序"伪装合规。
- Step 2 强制要求注释行同时含"单位关键字"+ "常量名"，避免随便加一行 `// hello ms` 就过。
- E2E 末尾跑 vitest 真实加载 tick.js，模块加载侧路径未坏。

---

## Workstreams

workstream_count: 1

### Workstream 1: tick.js 单位注释补强

**范围**: 仅修改 `packages/brain/src/tick.js`，在 import 块（约 line 53–60）内 `TICK_LOOP_INTERVAL_MS` 行 ±2 行范围里追加一行 `//` 注释，明确写出"单位：毫秒（ms）"且包含字串 `TICK_LOOP_INTERVAL_MS`。其余文件、其余常量、import/export 顺序、运行时逻辑一律不动。

**大小**: S（< 100 行；预期实际 +1 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/tick-comment.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/tick-comment.test.ts` | (1) `TICK_LOOP_INTERVAL_MS` 第一处出现行号 < 100 且 ±2 行内存在含 `毫秒\|ms` 与 `TICK_LOOP_INTERVAL_MS` 的 `//` 注释；(2) import 块内三个常量顺序保持 MINUTES→LOOP_INTERVAL_MS→TIMEOUT_MS；(3) `export { ... }` 名单仍含 `TICK_LOOP_INTERVAL_MS`；(4) `node --check packages/brain/src/tick.js` 通过 | WS1 当前至少 1 个 it 失败（因为注释尚未添加） |
