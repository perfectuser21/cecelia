# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本 sprint 交付的是 CLI 工具，唯一正式输出面为 `stdout` JSON：

```json
{"<sorted_json>": "stdout JSON payload"}
```

- `stdout` (JSON, 必填): 读取传入的 JSON 文件后，递归按字典序排序对象键并输出到标准输出；来源——PRD Golden Path 第 2 条
- `stderr` (string, 仅失败时可见): 仅在执行失败时输出错误信息；来源——CLI 运行时约定

**禁用字段名**: N/A — 非 HTTP schema，不定义额外响应字段

**Error (CLI non-zero)**:
```json
N/A
```

## 已知约束（来自回归测试）

（暂无已知约束）

## PrepPRD 铁律落地断言

- `[ASSERT:PREPPRD:SCOPE_ONLY_SCRIPTS_AND_SPRINTS]` 本 sprint 合同只允许生成 `scripts/relay-demo/` 目标脚本与 `sprints/07071247-relay-demo-codex-r2/` 合同产物；不得要求修改 `packages/brain/src` 或 `migrations`
- `[ASSERT:PREPPRD:CLI_ONLY_NO_SCREENSHOTS]` 所有验收命令必须可由 CLI 直接执行并以退出码/`stdout`/测试输出判定；不得依赖截图、视觉比对或人工目测
- `[ASSERT:PREPPRD:READS_JSON_PATH_ARG]` `scripts/relay-demo/sort-json-keys.mjs` 必须读取一个 JSON 文件路径参数作为唯一输入
- `[ASSERT:PREPPRD:RECURSIVE_SORT_STDOUT]` 工具必须递归按字典序排序对象键，并把排序后的 JSON 输出到 `stdout`
- `[ASSERT:PREPPRD:NO_EXTERNAL_DEPENDENCIES]` 工具实现不得引入外部依赖
- `[ASSERT:PREPPRD:VITEST_CASES_NESTED_ARRAY_EMPTY]` vitest 合同测试必须覆盖嵌套对象、数组、空对象三个用例

## 接缝清单

- `logic-done-pending` 文件系统接缝：真实世界接缝是“传入的 JSON 文件路径必须可读取”；真目标验证方式是在 `local_api` 机器上用 `mktemp` 生成临时 JSON 文件，再用 `node scripts/relay-demo/sort-json-keys.mjs <path>` 运行并检查退出码
- `logic-done-pending` Node CLI 接缝：真实世界接缝是“工具必须把合法 JSON 结果写到 stdout，且退出码反映成败”；真目标验证方式是 bash 中捕获 `stdout` 并交给 `jq -e` / `node -e` 校验具体输出语义
- `logic-done-pending` 测试接缝：真实世界接缝是“vitest 在本地可跑并证明三个合同 case 全部通过”；真目标验证方式是执行 `vitest run` 并从 CLI 输出中断言退出码为 0 且 `3 passed`

## Golden Path

[Step 1 提供可读取的 JSON 文件路径] → [Step 2 CLI 读取文件并递归排序对象键，已排序输入仍保持语义一致且不增删字段] → [Step 3 stdout 输出稳定 JSON，数组顺序保持不变] → [Step 4 vitest 证明嵌套对象/数组/空对象三个场景都成立]

### Step 1: 使用者提供一个可读取的 JSON 文件路径

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条直接定义“使用者提供一个可读取的 JSON 文件路径，作为本工具唯一输入”

**可观测行为**: CLI 只接受一个 JSON 文件路径作为输入；给出可读取路径后命令成功执行并返回退出码 0

**验证命令**:
```bash
TMP_JSON="$(mktemp)"
printf '{"b":1,"a":2}\n' > "$TMP_JSON"
OUT="$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON")"
STATUS=$?
[ "$STATUS" -eq 0 ]
echo "$OUT" | jq -e '. == {"a":2,"b":1}'
rm -f "$TMP_JSON"
```

**硬阈值**: 命令入口形态必须是 `node scripts/relay-demo/sort-json-keys.mjs <json-file-path>`；输入来源只能是文件路径参数；成功路径退出码必须为 0

---

### Step 2: CLI 递归按字典序排序对象键，且已排序输入保持语义一致不增删字段

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条直接定义“对象键按字典序递归稳定排列”；PRD 边界情况要求“输入 JSON 已经有序时，输出仍语义一致，不增删字段”

**可观测行为**: 对象层级中的键顺序稳定为字典序，嵌套对象同样递归排序；若输入本来已排序，输出仍与输入语义一致且字段集合完全相同

**验证命令**:
```bash
TMP_JSON="$(mktemp)"
cat > "$TMP_JSON" <<'JSON'
{"alpha":{"charlie":3,"delta":4},"middle":{"alpha":1,"bravo":2},"zebra":1}
JSON
OUT="$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON")"
STATUS=$?
[ "$STATUS" -eq 0 ]
node -e 'const input=JSON.parse(process.argv[1]); const out=JSON.parse(process.argv[2]); const same=JSON.stringify(out)===JSON.stringify(input); const sameKeys=JSON.stringify(Object.keys(out))===JSON.stringify(Object.keys(input)) && JSON.stringify(Object.keys(out.alpha))===JSON.stringify(Object.keys(input.alpha)) && JSON.stringify(Object.keys(out.middle))===JSON.stringify(Object.keys(input.middle)); if (!same || !sameKeys) process.exit(1);' "$(cat "$TMP_JSON")" "$OUT"
rm -f "$TMP_JSON"
```

**硬阈值**: `stdout` 必须是合法 JSON；所有对象键递归按字典序排列；已排序输入不得丢字段、增字段或改值

---

### Step 3: stdout 输出稳定 JSON，数组顺序保持不变且数组内对象递归排序

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条与边界情况第 2 条直接定义“数组顺序保持输入语义不变，数组中的对象元素同样满足递归键排序”

**可观测行为**: `stdout` 是合法 JSON；数组元素数量与顺序保持不变；若数组元素是对象，则对象键被递归排序

**验证命令**:
```bash
TMP_JSON="$(mktemp)"
cat > "$TMP_JSON" <<'JSON'
{"items":[{"b":2,"a":1},"plain",{"d":4,"c":3}]}
JSON
OUT="$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON")"
STATUS=$?
[ "$STATUS" -eq 0 ]
node -e 'const out=JSON.parse(process.argv[1]); if (JSON.stringify(out.items)!==JSON.stringify([{a:1,b:2},"plain",{c:3,d:4}])) process.exit(1);' "$OUT"
rm -f "$TMP_JSON"
```

**硬阈值**: `stdout` 必须可解析为 JSON；数组长度不变；数组顺序不变；数组内对象元素的键顺序符合字典序

---

### Step 4: 空对象保持为空对象，且本地 vitest 三用例全部通过

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条与边界情况第 1 条直接定义“空对象保持为空对象；vitest 证明嵌套对象、数组、空对象三个用例全部通过”

**可观测行为**: 空对象不会被替换成数组、`null` 或其他值；本地运行 vitest 时，三个合同用例全部通过且退出码为 0

**验证命令**:
```bash
TMP_JSON="$(mktemp)"
printf '{"outer":{}}\n' > "$TMP_JSON"
OUT="$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON")"
echo "$OUT" | jq -e '. == {"outer":{}}'
TMP_CFG="$(mktemp /tmp/relay-vitest-config-XXXX.mjs)"
cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts --reporter=verbose | tee /tmp/relay-demo-vitest.log
STATUS=$?
[ "$STATUS" -eq 0 ]
grep -Eq '3 passed|3 tests' /tmp/relay-demo-vitest.log
rm -f "$TMP_CFG"
rm -f "$TMP_JSON"
```

**硬阈值**: 空对象语义保持不变；vitest 命令退出码必须为 0；输出必须表明三个合同用例全部通过

## Red 前提（test_is_red）

在 `scripts/relay-demo/sort-json-keys.mjs` 未实现或错误实现时，直接运行合同测试必须以非零退出码失败；失败输出必须能定位到具体合同用例名或断言摘要，不能出现“实现缺失/错误但合同测试仍为 0”的假绿。

**未实现状态验证命令**:
```bash
TMP_REPO="$(mktemp -d /workspace/packages/brain/tmp-red-XXXXXX)"
TMP_CFG="$(mktemp /tmp/relay-vitest-config-XXXX.mjs)"
trap 'rm -rf "$TMP_REPO"; rm -f "$TMP_CFG"' EXIT
mkdir -p "$TMP_REPO/sprints/07071247-relay-demo-codex-r2/tests"
cp sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts "$TMP_REPO/sprints/07071247-relay-demo-codex-r2/tests/"
REL_TEST="${TMP_REPO#/workspace/packages/brain/}/sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts"
cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-missing.log"
STATUS=${PIPESTATUS[0]}
[ "$STATUS" -ne 0 ]
grep -Eq '嵌套对象会递归按字典序排序|数组顺序保持不变|空对象保持为空对象|expected 1 to be \+0|AssertionError' "$TMP_REPO/red-missing.log"
```

**错误实现状态验证命令**:
```bash
TMP_REPO="$(mktemp -d /workspace/packages/brain/tmp-red-XXXXXX)"
TMP_CFG="$(mktemp /tmp/relay-vitest-config-XXXX.mjs)"
trap 'rm -rf "$TMP_REPO"; rm -f "$TMP_CFG"' EXIT
mkdir -p "$TMP_REPO/scripts/relay-demo" "$TMP_REPO/sprints/07071247-relay-demo-codex-r2/tests"
cp sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts "$TMP_REPO/sprints/07071247-relay-demo-codex-r2/tests/"
cat > "$TMP_REPO/scripts/relay-demo/sort-json-keys.mjs" <<'EOF'
import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (Array.isArray(input.items)) {
  input.items = [...input.items].reverse();
}
process.stdout.write(`${JSON.stringify(input)}\n`);
EOF
REL_TEST="${TMP_REPO#/workspace/packages/brain/}/sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts"
cat > "$TMP_CFG" <<'EOF'
export default {
  test: {
    environment: 'node',
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-broken.log"
STATUS=${PIPESTATUS[0]}
[ "$STATUS" -ne 0 ]
grep -Eq '数组顺序保持不变|AssertionError|to deeply equal|expected' "$TMP_REPO/red-broken.log"
```

**硬阈值**: 上述 Red 验证命令都必须返回非零失败信号；未实现状态至少出现具体用例名或 `expected 1 to be +0` / `AssertionError` 这类断言失败摘要；错误实现状态至少出现 `数组顺序保持不变` 用例名或 `AssertionError` / `to deeply equal` / `expected` 断言摘要

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

<!-- GOLDEN_SMOKE_ABILITY_SLUG: relay-demo-sort-json-keys -->
<!-- GOLDEN_SMOKE_SCENARIO: local-cli-json-sort -->

```bash
bash sprints/07071247-relay-demo-codex-r2/smoke-verify.sh
```

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
| --- | --- | --- | --- |
| WS1 | `tests/sort-json-keys.contract.test.ts` | `嵌套对象会递归按字典序排序` / `数组顺序保持不变` / `空对象保持为空对象` | 未实现时 `vitest` 退出非零，输出含对应用例名或断言失败摘要 |
