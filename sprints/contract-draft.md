# Sprint Contract Draft (Round 2)

> **本轮基线**: 在 Round 1 基础上吸收 Reviewer 全部 4 条反馈：
> 1. `git fetch` 静默失败 → 显式报错 + `BASE_SHA` / `git merge-base` 双 fallback
> 2. 中文编码风险（BOM/GBK 导致 `grep '毫秒'` 不匹配）→ 编码前置校验，且单位关键字接受 `毫秒|ms|MS` 三选一
> 3. 测试文件路径 / `vitest.config` 排除风险 → Step 0 显式 `test -f` + `vitest list` 枚举校验
> 4. line 66 历史 Phase 注释干扰 grep "第一处" 判定 → 已通过 `< 100` 行号阈值缓解，并在 Risks 段显式登记

## Golden Path

[开发者打开 packages/brain/src/tick.js] → [视线落到 TICK_LOOP_INTERVAL_MS 出现的第一处 import 块] → [在该位置 ±2 行内看到一行明确说明单位的注释] → [开发者立刻判断常量数值的单位含义]

---

### Step 0 (前置环境校验): 工具链 / 编码 / 测试可发现性

**可观测行为**: 验证 Evaluator 能拿到执行验证命令所需的全部前置条件 —— 仓库根目录正确、目标文件存在且为 UTF-8 编码（避免 BOM/GBK 导致中文 grep 失配）、测试文件就绪、`vitest list` 能枚举到该测试。Step 0 任何一条失败都直接 abort，避免后续 Step 报"假阳性失败"。

**验证命令**:
```bash
set -e

# 0.1 仓库根（含 packages/brain 与 sprints/tests/ws1）
test -d packages/brain/src
test -d sprints/tests/ws1

# 0.2 目标文件存在
test -f packages/brain/src/tick.js
test -f packages/brain/src/tick-loop.js
test -f sprints/tests/ws1/tick-comment.test.ts

# 0.3 编码校验：tick.js 必须是 UTF-8 且 *无* BOM（避免中文 '毫秒' grep 失配）
HEAD3=$(head -c 3 packages/brain/src/tick.js | od -An -tx1 | tr -d ' \n')
if [ "$HEAD3" = "efbbbf" ]; then
  echo "FAIL: tick.js 含 UTF-8 BOM，会破坏中文 grep。请保存为 UTF-8 (no BOM)。"
  exit 1
fi
# 试探性确认非 GBK：用 iconv -f UTF-8 完整读一遍，失败说明不是合法 UTF-8
if command -v iconv >/dev/null 2>&1; then
  iconv -f UTF-8 -t UTF-8 packages/brain/src/tick.js > /dev/null \
    || { echo "FAIL: tick.js 不是合法 UTF-8 编码"; exit 1; }
fi

# 0.4 vitest 可枚举到本测试文件
# 注意：必须**在仓库根目录跑** vitest，不要 `cd packages/brain`。
# 因为 packages/brain/vitest.config.js 的 include glob 不覆盖 ../../sprints/，
# 而仓库根目录无 vitest.config，vitest 会用默认 include `**/*.{test,spec}.*` 自动找到 sprints/tests/。
LIST_OUT=$(timeout 60 npx vitest list sprints/tests/ws1/tick-comment.test.ts 2>&1 || true)
echo "$LIST_OUT" | grep -q 'tick-comment.test.ts' \
  || { echo "FAIL: vitest list 未枚举到 tick-comment.test.ts。output:"; echo "$LIST_OUT"; exit 1; }

echo "PASS: Step 0 环境就绪"
```

**硬阈值**:
- 仓库根有 `packages/brain/src/` 与 `sprints/tests/ws1/` 两目录
- `tick.js` 前 3 字节 ≠ `EF BB BF`（无 BOM）
- 若系统有 `iconv`，`tick.js` 通过 UTF-8 round-trip
- `vitest list ../../sprints/tests/ws1/tick-comment.test.ts` 输出包含 `tick-comment.test.ts` 字样
- 整段 exit 0

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

**可观测行为**: 文件中第一次出现 `TICK_LOOP_INTERVAL_MS` 这个标识符的那一行，连同它前后各 2 行，组成的 5 行窗口里至少有一行包含 `毫秒`、`ms` 或 `MS`，且这一行是注释（以 `//` 开头）。注释里必须能识别出该说明的对象是 `TICK_LOOP_INTERVAL_MS`（不是其他常量）。

> **注**: 仓库现状 `tick.js` 第 66 行有一条历史 Phase 注释含 `TICK_LOOP_INTERVAL_MS` 字样（详见 Risks R4）。本 Step 用 `grep -n -m1` 取**第一处**且强制行号 `< 100`，确保第一处永远落在 import 块（line 58 附近）而非更靠后的历史注释。

**验证命令**:
```bash
# 1) 取 TICK_LOOP_INTERVAL_MS 第一次出现的行号
FIRST_LINE=$(grep -n -m1 'TICK_LOOP_INTERVAL_MS' packages/brain/src/tick.js | cut -d: -f1)
[ -n "$FIRST_LINE" ] || { echo "FAIL: 找不到 TICK_LOOP_INTERVAL_MS"; exit 1; }

# 2) 该行属于 import 块（行号 < 100，避开末尾 export 块的第二处 ~line 160）
[ "$FIRST_LINE" -lt 100 ] || { echo "FAIL: 第一处出现位置异常 ($FIRST_LINE)"; exit 1; }

# 3) ±2 行窗口内必须存在一条 // 注释，且包含 '毫秒|ms|MS'，并提及 TICK_LOOP_INTERVAL_MS
START=$(( FIRST_LINE - 2 )); [ $START -lt 1 ] && START=1
END=$(( FIRST_LINE + 2 ))
WINDOW=$(sed -n "${START},${END}p" packages/brain/src/tick.js)
echo "$WINDOW" | grep -E '^\s*//' | grep -E '(毫秒|ms|MS)' | grep -q 'TICK_LOOP_INTERVAL_MS' \
  || { echo "FAIL: 窗口内未找到说明 TICK_LOOP_INTERVAL_MS 单位的 // 注释"; echo "窗口内容:"; echo "$WINDOW"; exit 1; }

echo "PASS: Step 2 注释存在并指向 TICK_LOOP_INTERVAL_MS"
```

**硬阈值**:
- `FIRST_LINE` 必须 < 100（确认是 import 块那一处，不是末尾 export 块）。
- 5 行窗口内至少 1 条以 `//` 开头的注释行同时包含 `毫秒|ms|MS` **与** `TICK_LOOP_INTERVAL_MS` 字样（"且"，不是"或"）。
- 命令整体 exit code = 0。

---

### Step 3: 不越界 — import / export 结构未被破坏，`tick-loop.js` 未动

**可观测行为**: 本任务只加注释，不动 import/export 结构。`TICK_LOOP_INTERVAL_MS` 仍同时出现在 `tick.js` 的 (a) 从 `./tick-loop.js` 的 import 名单内、(b) 文件末尾的 `export { ... }` 名单内；import 块内三个常量顺序保持 `TICK_INTERVAL_MINUTES → TICK_LOOP_INTERVAL_MS → TICK_TIMEOUT_MS`。`tick-loop.js` 完全未变更。

**Diff 比对基线（BASE）解析顺序**（应对反馈 #1，三级 fallback，**任何一级失败都显式报错而非静默继续**）：
1. 优先 `$BASE_SHA`（CI/Evaluator 显式注入）
2. 否则 `git fetch origin main --depth=1`，成功则用 `origin/main`
3. 否则 `git merge-base HEAD main`（本地已有 main 分支时）
4. 全部失败 → exit 1 并打印错误信息，**禁止 `2>/dev/null` 静默继续**

**验证命令**:
```bash
# 解析 BASE（三级 fallback，显式报错）
resolve_base() {
  if [ -n "${BASE_SHA:-}" ]; then
    echo "$BASE_SHA"
    return 0
  fi
  set +e
  git fetch origin main --depth=1
  FETCH_RC=$?
  set -e
  if [ "$FETCH_RC" = "0" ]; then
    echo "origin/main"
    return 0
  fi
  echo "WARN: git fetch origin main 失败（rc=$FETCH_RC），尝试 fallback git merge-base HEAD main" >&2
  if git rev-parse --verify main >/dev/null 2>&1; then
    git merge-base HEAD main
    return 0
  fi
  echo "FAIL: 无法解析 diff BASE（$BASE_SHA / origin/main / merge-base 均失败）" >&2
  return 1
}
BASE=$(resolve_base) || exit 1
echo "[diff base] = $BASE"

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
const re = /export\s*\{[\s\S]*?TICK_LOOP_INTERVAL_MS[\s\S]*?\}/m;
if (!re.test(c)) { console.error("FAIL: 未找到含 TICK_LOOP_INTERVAL_MS 的 export 名单"); process.exit(1); }
console.log("PASS: export 仍 re-export TICK_LOOP_INTERVAL_MS");
'

# 3) tick-loop.js 与 BASE 完全一致
git diff --quiet "$BASE" -- packages/brain/src/tick-loop.js \
  || { echo "FAIL: tick-loop.js 被改动（任务范围外）"; exit 1; }

echo "PASS: Step 3 范围限定守住"
```

**硬阈值**:
- import 块同时含 `TICK_INTERVAL_MINUTES`、`TICK_LOOP_INTERVAL_MS`、`TICK_TIMEOUT_MS` 三者，且相对顺序保持 MINUTES → LOOP_INTERVAL_MS → TIMEOUT_MS。
- 文件中存在至少一个匹配 `export\s*\{...TICK_LOOP_INTERVAL_MS...\}` 的 export 名单块。
- `git diff "$BASE" -- packages/brain/src/tick-loop.js` 无输出（exit 0）。
- BASE 解析任意一级 fallback 都已显式报错，未被 `2>/dev/null` 吞掉。
- 命令整体 exit code = 0。

---

### Step 4 (出口): 净 diff 等价于"加 1 行注释"

**可观测行为**: 与 BASE 比，本任务对 `tick.js` 的净影响是新增 1 行注释、删除 0 行；对其他文件 0 改动。

**验证命令**:
```bash
# 复用 Step 3 的 resolve_base
resolve_base() {
  if [ -n "${BASE_SHA:-}" ]; then echo "$BASE_SHA"; return 0; fi
  set +e; git fetch origin main --depth=1; FETCH_RC=$?; set -e
  [ "$FETCH_RC" = "0" ] && { echo "origin/main"; return 0; }
  echo "WARN: git fetch origin main 失败（rc=$FETCH_RC），尝试 fallback git merge-base HEAD main" >&2
  git rev-parse --verify main >/dev/null 2>&1 && { git merge-base HEAD main; return 0; }
  echo "FAIL: 无法解析 diff BASE" >&2; return 1
}
BASE=$(resolve_base) || exit 1

# 1) 仅 tick.js 被改动
CHANGED=$(git diff --name-only "$BASE" -- packages/brain/ | sort -u)
EXPECTED="packages/brain/src/tick.js"
[ "$CHANGED" = "$EXPECTED" ] || { echo "FAIL: 改动文件清单不符。实际: [$CHANGED]"; exit 1; }

# 2) tick.js 净 diff = +1 -0
ADDED=$(git diff --numstat "$BASE" -- packages/brain/src/tick.js | awk '{print $1}')
DELETED=$(git diff --numstat "$BASE" -- packages/brain/src/tick.js | awk '{print $2}')
[ "$ADDED" = "1" ] || { echo "FAIL: 新增行数 = $ADDED，应为 1"; exit 1; }
[ "$DELETED" = "0" ] || { echo "FAIL: 删除行数 = $DELETED，应为 0"; exit 1; }

# 3) 新增的那一行就是注释（以 // 开头）且含 "毫秒|ms|MS" + "TICK_LOOP_INTERVAL_MS"
NEW_LINE=$(git diff "$BASE" -- packages/brain/src/tick.js | grep -E '^\+[^+]' | sed 's/^+//')
echo "$NEW_LINE" | grep -E '^\s*//' | grep -E '(毫秒|ms|MS)' | grep -q 'TICK_LOOP_INTERVAL_MS' \
  || { echo "FAIL: 新增行不是说明 TICK_LOOP_INTERVAL_MS 单位的注释。实际: $NEW_LINE"; exit 1; }

echo "PASS: 净 diff 等于 1 行单位注释"
```

**硬阈值**:
- `git diff --name-only "$BASE" -- packages/brain/` 输出**恰好**只有 `packages/brain/src/tick.js`。
- `tick.js` 净 diff = `+1 / -0`。
- 新增的那一行同时满足：以 `//` 开头、含 `毫秒|ms|MS`、含 `TICK_LOOP_INTERVAL_MS` 字样。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

cd "${WORKSPACE_ROOT:-/workspace}"

# ============================================================
# Step 0: 环境 / 编码 / 测试可发现性
# ============================================================
test -d packages/brain/src
test -d sprints/tests/ws1
test -f packages/brain/src/tick.js
test -f packages/brain/src/tick-loop.js
test -f sprints/tests/ws1/tick-comment.test.ts

# 编码校验（无 BOM + UTF-8 round-trip）
HEAD3=$(head -c 3 packages/brain/src/tick.js | od -An -tx1 | tr -d ' \n')
[ "$HEAD3" != "efbbbf" ] || { echo "FAIL: tick.js 含 UTF-8 BOM"; exit 1; }
if command -v iconv >/dev/null 2>&1; then
  iconv -f UTF-8 -t UTF-8 packages/brain/src/tick.js > /dev/null
fi

# vitest 可枚举到测试（**从仓库根跑**，packages/brain/vitest.config.js 不覆盖 sprints/ 路径）
timeout 60 npx vitest list sprints/tests/ws1/tick-comment.test.ts 2>&1 \
  | grep -q 'tick-comment.test.ts'

# ============================================================
# BASE 解析（三级 fallback，显式报错）
# ============================================================
resolve_base() {
  if [ -n "${BASE_SHA:-}" ]; then echo "$BASE_SHA"; return 0; fi
  set +e; git fetch origin main --depth=1; FETCH_RC=$?; set -e
  [ "$FETCH_RC" = "0" ] && { echo "origin/main"; return 0; }
  echo "WARN: git fetch origin main 失败（rc=$FETCH_RC），尝试 fallback merge-base" >&2
  git rev-parse --verify main >/dev/null 2>&1 && { git merge-base HEAD main; return 0; }
  echo "FAIL: 无法解析 diff BASE" >&2; return 1
}
BASE=$(resolve_base)

# ============================================================
# Step 1: tick.js 语法合法
# ============================================================
node --check packages/brain/src/tick.js

# ============================================================
# Step 2: TICK_LOOP_INTERVAL_MS 第一处 ±2 行内有单位注释
# ============================================================
FIRST_LINE=$(grep -n -m1 'TICK_LOOP_INTERVAL_MS' packages/brain/src/tick.js | cut -d: -f1)
[ -n "$FIRST_LINE" ] && [ "$FIRST_LINE" -lt 100 ]
START=$(( FIRST_LINE - 2 )); [ $START -lt 1 ] && START=1
END=$(( FIRST_LINE + 2 ))
sed -n "${START},${END}p" packages/brain/src/tick.js \
  | grep -E '^\s*//' \
  | grep -E '(毫秒|ms|MS)' \
  | grep -q 'TICK_LOOP_INTERVAL_MS'

# ============================================================
# Step 3: 范围守住（import 名单/顺序未变, export 名单仍含, tick-loop.js 未动）
# ============================================================
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
git diff --quiet "$BASE" -- packages/brain/src/tick-loop.js

# ============================================================
# Step 4: 净 diff = 仅 tick.js +1 -0，新增行就是注释
# ============================================================
CHANGED=$(git diff --name-only "$BASE" -- packages/brain/ | sort -u)
[ "$CHANGED" = "packages/brain/src/tick.js" ]
ADDED=$(git diff --numstat "$BASE" -- packages/brain/src/tick.js | awk '{print $1}')
DELETED=$(git diff --numstat "$BASE" -- packages/brain/src/tick.js | awk '{print $2}')
[ "$ADDED" = "1" ] && [ "$DELETED" = "0" ]
NEW_LINE=$(git diff "$BASE" -- packages/brain/src/tick.js | grep -E '^\+[^+]' | sed 's/^+//')
echo "$NEW_LINE" | grep -E '^\s*//' | grep -E '(毫秒|ms|MS)' | grep -q 'TICK_LOOP_INTERVAL_MS'

# ============================================================
# BEHAVIOR 单元测试通过（Green 后必须 PASS）
# 必须从仓库根跑 vitest（无 root vitest.config，使用默认 include），
# 不要 cd packages/brain（其 vitest.config.js 排除了 sprints/ 路径）
# ============================================================
npx vitest run sprints/tests/ws1/ --reporter=verbose

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0。

**防造假说明**:
- Step 0 强制编码 + 可枚举性，避免"测试存在但 vitest 跑不到"或"中文 grep 永远失配"的伪通过。
- Step 4 锁定净 diff = `+1 / -0`，无法靠"先改一堆其他东西再加一行注释"绕过。
- Step 3 防止"重命名常量"或"改 import 顺序"伪装合规。
- Step 2 强制要求注释行同时含"单位关键字"+"常量名"，避免随便加一行 `// hello ms` 就过。
- BASE 解析三级 fallback 全部显式报错，无 `2>/dev/null` 静默吞掉，杜绝 fetch 失败时拿 stale 比对源。
- E2E 末尾跑 vitest 真实加载 tick.js，模块加载侧路径未坏。

---

## Risks（应对反馈 #4）

| ID | 风险 | 触发条件 | 缓解 |
|---|---|---|---|
| R1 | `git fetch origin main` 失败（断网/CI 凭据失效）→ 验证脚本以 stale 基线 false-pass | CI runner 出口被防火墙；或 origin 临时不可达 | `BASE_SHA` 环境变量优先；fallback 到本地 `git merge-base HEAD main`；任何一级失败都打 `WARN`/`FAIL`，禁用 `2>/dev/null` 静默 |
| R2 | tick.js 编码异常（UTF-8 BOM / GBK）导致 `grep '毫秒'` 永远不匹配 → 即使注释加上了 Step 2 也 false-fail | 开发者用 Windows + 旧 IDE 落盘；或 git autocrlf 配置异常 | Step 0 检测前 3 字节 ≠ `EF BB BF`；`iconv -f UTF-8 -t UTF-8` round-trip 校验；同时**单位关键字接受 `毫秒\|ms\|MS` 三选一**，给纯英文注释留逃生通道 |
| R3 | `sprints/tests/ws1/tick-comment.test.ts` 被 `packages/brain/vitest.config.js` 排除 / 路径 typo / vitest 不解析 → BEHAVIOR 测试**永远不跑**就报"全绿" | 移动测试文件目录；或修改 vitest.config 时误加 exclude | Step 0 显式 `test -f` + `npx vitest list <path>` 输出必须含 `tick-comment.test.ts` 字符串；E2E 末尾再次 `vitest run` 显式路径，强制实跑 |
| R4 | `tick.js` 第 66 行有历史 Phase 注释 `// Phase D2.2: TICK_INTERVAL_MINUTES / TICK_LOOP_INTERVAL_MS / TICK_TIMEOUT_MS 已搬到 tick-loop.js` —— 字符串扫描可能把它当成"已有单位说明" false-pass | grep 不带行号约束就直接搜 `TICK_LOOP_INTERVAL_MS` + `毫秒\|ms` | Step 2 用 `grep -n -m1` 只取**第一处**；强制 `FIRST_LINE < 100`（line 66 也 < 100，但 line 66 不在 line 58 的 ±2 窗口里，所以即便它包含 `ms` 字样也不会污染窗口判定）；再叠加"必须以 `//` 开头 ∧ 包含 `TICK_LOOP_INTERVAL_MS` 字样"双约束；Step 4 锁 `+1 / -0` 净 diff，根本不允许新增行落到 line 66 |
| R5 | 跨平台 `sed`/`grep -E` 行为差异（macOS BSD vs GNU） | Evaluator 在 macOS 跑 | 用 POSIX 子集；不依赖 `-P` PCRE；`-E` 是 BSD/GNU 都支持的 ERE |
| R6 | vitest 工作目录陷阱 — 在 `packages/brain/` 下跑 `npx vitest run ../../sprints/tests/ws1/` 会因 `packages/brain/vitest.config.js` 的 include glob (`src/**/...` + `tests/**/...` + `../../tests/...`) 不覆盖 `../../sprints/` 而**完全找不到测试文件**（实测：`No test files found, exiting with code 1`），表面"红"实则"空跑" | 历史 Round 1 实际就在此陷阱中（已用 Round 2 实测复现） | **强制从仓库根跑** vitest：`npx vitest run sprints/tests/ws1/...`。仓库根无 `vitest.config.*`，vitest 用默认 include `**/*.{test,spec}.*` 自然涵盖 `sprints/`。Step 0 + E2E 全部命令均按此修正；DoD ARTIFACT 中"vitest 可枚举"那条同步修正 |

---

## Workstreams

workstream_count: 1

### Workstream 1: tick.js 单位注释补强

**范围**: 仅修改 `packages/brain/src/tick.js`，在 import 块（约 line 53–60）内 `TICK_LOOP_INTERVAL_MS` 行 ±2 行范围里追加一行 `//` 注释，明确写出"单位：毫秒（ms）"且包含字串 `TICK_LOOP_INTERVAL_MS`。其余文件、其余常量、import/export 顺序、运行时逻辑一律不动。

**大小**: S（< 100 行；预期实际 +1 行）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `sprints/tests/ws1/tick-comment.test.ts`

**测试文件 it() 名单**（应对加固反馈，Evaluator 可 grep 测试名校验红证据落点）：
1. `it('TICK_LOOP_INTERVAL_MS 第一处出现行的 ±2 行窗口内存在含「毫秒|ms」与常量名的 // 注释')`
2. `it('文件末尾 export { ... } 名单仍 re-export TICK_LOOP_INTERVAL_MS')`
3. `it('import 块内三个常量顺序仍为 MINUTES → LOOP_INTERVAL_MS → TIMEOUT_MS')`
4. `it('tick.js 通过 node --check 静态语法校验')`

Round 1 红证据：测试 1 当前 fail（注释尚未添加，5 行窗口内找不到含"毫秒|ms"+常量名的 `//` 行），测试 2、3、4 当前 pass。即至少 1 个 `it` 失败 → Red ✅。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（对应 it 名） | 当前红证据（Round 1 实测） |
|---|---|---|---|
| WS1 | `sprints/tests/ws1/tick-comment.test.ts` | (1) `it('TICK_LOOP_INTERVAL_MS 第一处出现行的 ±2 行窗口内存在含「毫秒\|ms」与常量名的 // 注释')` — 第一处行号 `< 100` 且 ±2 行窗口内存在含 `毫秒\|ms\|MS` 与 `TICK_LOOP_INTERVAL_MS` 的 `//` 注释；(2) `it('文件末尾 export { ... } 名单仍 re-export TICK_LOOP_INTERVAL_MS')`；(3) `it('import 块内三个常量顺序仍为 MINUTES → LOOP_INTERVAL_MS → TIMEOUT_MS')`；(4) `it('tick.js 通过 node --check 静态语法校验')` | WS1：测试 1 fail（注释尚未添加），测试 2/3/4 pass — vitest 输出含 `1 failed` ⇒ 至少 1 个 `it` 红 ✅ |

**红证据复现命令**（Evaluator 可直接跑校验"测试名匹配实际断言"）：
```bash
# **从仓库根跑**，不要 cd packages/brain（见 Risks R6）
npx vitest run sprints/tests/ws1/tick-comment.test.ts --reporter=verbose 2>&1 | tee /tmp/ws1-red.log
grep -E "✓|✗|FAIL|PASS|failed|passed" /tmp/ws1-red.log
# 期望（Round 2 已实测）：
#   ✓ 文件末尾 export { ... } 名单仍 re-export TICK_LOOP_INTERVAL_MS
#   ✓ import 块内三个常量顺序仍为 MINUTES → LOOP_INTERVAL_MS → TIMEOUT_MS
#   ✓ tick.js 通过 node --check 静态语法校验
#   FAIL  ... > TICK_LOOP_INTERVAL_MS 第一处出现行的 ±2 行窗口内存在含「毫秒|ms」与常量名的 // 注释
#   Tests  1 failed | 3 passed (4)
```
