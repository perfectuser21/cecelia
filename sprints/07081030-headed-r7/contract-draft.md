# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本 sprint 交付的是 CLI 工具，正式输出面为 `stdout` 的单行文本结果：

```json
{"formatted": "stdout text payload"}
```

- `stdout` (string, 必填): 根据输入字节数输出一个人类可读格式化结果；来源——PRD Golden Path 第 2 条
- `stderr` (string, 仅失败时可见): 仅在执行失败时输出错误信息；来源——CLI 运行时约定

**禁用字段名**: N/A — 非 HTTP schema，不定义额外响应字段

**Error (CLI non-zero)**:
```json
N/A
```

## 已知约束（来自回归测试）

- `tests/pretty-bytes.contract.test.ts` 的路径模型不能假设 `__dirname` 一定位于 repo 根直系目录下；合同测试必须先解析测试文件真实路径，再回溯到 repo root

## PrepPRD 铁律落地断言

- `[ASSERT:PREPPRD:SCOPE_ONLY_SCRIPT_AND_SPRINT]` 本 sprint 合同只允许生成 `scripts/relay-demo/pretty-bytes.mjs` 目标脚本与 `sprints/07081030-headed-r7/` 合同产物；不得要求修改 `packages/brain/src` 或 `migrations`
- `[ASSERT:PREPPRD:CLI_ONLY_NO_SCREENSHOTS]` 所有验收命令必须可由 CLI 直接执行并以退出码/`stdout`/测试输出判定；不得依赖截图、视觉比对或人工目测
- `[ASSERT:PREPPRD:BYTE_INPUT_ENTRY]` `scripts/relay-demo/pretty-bytes.mjs` 必须支持从 Node CLI 直接执行，并接收一个字节数输入
- `[ASSERT:PREPPRD:ZERO_1024_TB_CASES]` 合同测试必须覆盖 `0`、`1024`、`1099511627776`（1 TB）三个代表性输入
- `[ASSERT:PREPPRD:HUMAN_READABLE_OUTPUT]` 输出必须是人类可读字符串，`1024` 不能仍显示为原始字节数，TB 量级不能回退到错误单位
- `[ASSERT:PREPPRD:NO_EXTERNAL_DEPENDENCIES]` 工具实现不得引入外部依赖

## 接缝清单

- `logic-done-pending` Node CLI 接缝：真实世界接缝是“调用方必须能直接执行 `node scripts/relay-demo/pretty-bytes.mjs <bytes>` 并拿到单行结果”；真目标验证方式是在 `local_api` 机器上用 `node` 调用并检查退出码与 `stdout`
- `logic-done-pending` 数值格式化接缝：真实世界接缝是“脚本必须在 `0`、`1024`、`1 TB` 三类阈值上稳定给出可读单位”；真目标验证方式是在 shell 中分别执行三次命令并用字符串精确比对
- `logic-done-pending` 测试接缝：真实世界接缝是“vitest 在本地可跑并证明三个合同 case 全部通过”；真目标验证方式是保留 `packages/brain` workspace 下的 `sprints/...` 入口运行 vitest，同时要求合同测试内部先解析真实文件路径，再从 CLI 输出中断言退出码为 0 且 `3 passed`

## Golden Path

[Step 1 通过 Node CLI 传入字节数] → [Step 2 pretty-bytes 脚本按 1024 进位规则转换为可读单位] → [Step 3 `0`、`1024`、`1 TB` 三类阈值在 `stdout` 输出稳定字符串] → [Step 4 vitest 证明三条合同场景全部成立]

### Step 1: 使用者通过 Node CLI 传入一个字节数

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条直接定义“调用方在本地执行 `scripts/relay-demo/pretty-bytes.mjs`”

**可观测行为**: 命令入口形态必须是 `node scripts/relay-demo/pretty-bytes.mjs <bytes>`；给出合法字节数后命令成功执行并返回退出码 0

**验证命令**:
```bash
OUT="$(node scripts/relay-demo/pretty-bytes.mjs 0)"
STATUS=$?
[ "$STATUS" -eq 0 ]
test -n "$OUT"
```

**硬阈值**: 命令入口形态必须是 `node scripts/relay-demo/pretty-bytes.mjs <bytes>`；成功路径退出码必须为 0；`stdout` 必须为非空单行字符串

---

### Step 2: `0` 输入输出稳定零值表示，不能报错或返回空字符串

**来源**: `[FROM_PRD]` — PRD 边界情况第 1 条直接定义“输入为 `0` 时，结果必须稳定返回可读的零值表示”

**可观测行为**: 输入 `0` 时，`stdout` 输出稳定的零值格式，不为空、不报错

**验证命令**:
```bash
OUT="$(node scripts/relay-demo/pretty-bytes.mjs 0)"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = "0 B"
```

**硬阈值**: `0` 输入必须返回 `0 B`；退出码必须为 0；`stderr` 不得污染成功路径

---

### Step 3: `1024` 输入必须完成单位进位，避免仍以原始字节值展示

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条与边界情况第 2 条直接定义“输入跨过 `1024` 阈值时，结果必须完成单位进位”

**可观测行为**: 输入 `1024` 时，脚本输出 `1 KB`，而不是 `1024 B` 或其他未进位结果

**验证命令**:
```bash
OUT="$(node scripts/relay-demo/pretty-bytes.mjs 1024)"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = "1 KB"
```

**硬阈值**: `1024` 输入必须返回 `1 KB`；不得返回 `1024 B`；退出码必须为 0

---

### Step 4: `1 TB` 输入必须继续输出可读单位，且本地 vitest 三用例全部通过

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条与边界情况第 3 条直接定义“输入达到 `TB` 量级时，结果必须继续输出可读单位”

**可观测行为**: 输入 `1099511627776`（`1024 ** 4`）时，脚本输出 `1 TB`；本地运行 vitest 时，三个合同用例全部通过且退出码为 0

**验证命令**:
```bash
OUT="$(node scripts/relay-demo/pretty-bytes.mjs 1099511627776)"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = "1 TB"
TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"
TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"
cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts --reporter=verbose | tee /tmp/pretty-bytes-vitest.log
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -eq 0 ]
grep -Eq '3 passed|3 tests' /tmp/pretty-bytes-vitest.log
rm -rf "$TMP_CFG_DIR"
```

**硬阈值**: `1099511627776` 输入必须返回 `1 TB`；vitest 命令退出码必须为 0；输出必须表明三个合同用例全部通过

## Red 前提（test_is_red）

在 `scripts/relay-demo/pretty-bytes.mjs` 未实现或错误实现时，直接运行合同测试必须以非零退出码失败；失败输出必须能定位到具体合同用例名或断言摘要，不能出现“实现缺失/错误但合同测试仍为 0”的假绿。

**未实现状态验证命令**:
```bash
TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-missing.XXXXXX")"
TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"
TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"
trap 'rm -rf "$TMP_REPO" "$TMP_CFG_DIR"' EXIT
mkdir -p "$TMP_REPO/sprints/07081030-headed-r7/tests"
cp sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts "$TMP_REPO/sprints/07081030-headed-r7/tests/"
REL_TEST="$(node --input-type=module -e 'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));' "$PWD/packages/brain" "$TMP_REPO/sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts")"
cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-missing.log"
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -ne 0 ]
grep -Eq '0 bytes returns a readable zero value|1024 bytes promotes to KB|1 TB stays in TB|ENOENT|AssertionError|expected' "$TMP_REPO/red-missing.log"
```

**错误实现状态验证命令**:
```bash
TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-broken.XXXXXX")"
TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"
TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"
trap 'rm -rf "$TMP_REPO" "$TMP_CFG_DIR"' EXIT
mkdir -p "$TMP_REPO/scripts/relay-demo" "$TMP_REPO/sprints/07081030-headed-r7/tests"
cp sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts "$TMP_REPO/sprints/07081030-headed-r7/tests/"
cat > "$TMP_REPO/scripts/relay-demo/pretty-bytes.mjs" <<'EOF'
process.stdout.write(`${process.argv[2]} B\n`);
EOF
REL_TEST="$(node --input-type=module -e 'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));' "$PWD/packages/brain" "$TMP_REPO/sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts")"
cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-broken.log"
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -ne 0 ]
grep -Eq '1024 bytes promotes to KB|1 TB stays in TB|AssertionError|expected|to be' "$TMP_REPO/red-broken.log"
```

**硬阈值**: 上述 Red 验证命令都必须返回非零失败信号；未实现状态至少出现具体用例名或 `ENOENT` / `AssertionError` / `expected` 失败摘要；错误实现状态至少出现 `1024 bytes promotes to KB` 或 `1 TB stays in TB` 用例名，或 `AssertionError` / `expected` 断言摘要

**路径模型约束**: 合同测试定位 repo root 时必须先解析测试文件真实路径，再回溯三级目录；在 `packages/brain` workspace 下执行 vitest 时，验收命令仅通过已验证的 `sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts` 入口触发，并命中 repo 根下的 `scripts/relay-demo/pretty-bytes.mjs`

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

<!-- GOLDEN_SMOKE_ABILITY_SLUG: relay-demo-pretty-bytes -->
<!-- GOLDEN_SMOKE_SCENARIO: local-cli-pretty-bytes -->

```bash
bash sprints/07081030-headed-r7/tests/smoke-verify.sh
```

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
| --- | --- | --- | --- |
| WS1 | `tests/pretty-bytes.contract.test.ts` | `0 bytes returns a readable zero value` / `1024 bytes promotes to KB` / `1 TB stays in TB` | 未实现时 `vitest` 退出非零，输出含对应用例名或断言失败摘要 |
