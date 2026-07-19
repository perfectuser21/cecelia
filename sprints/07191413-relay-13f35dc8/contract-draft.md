# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

本 sprint 交付的是 CLI 工具，唯一正式输出面为 `stdout` 单行文本：

```json
{"stdout": "url-safe-slug-string"}
```

- `stdout` (string, 必填): 对输入字符串做小写化、以连字符分隔、去除首尾多余连字符处理后的 URL-safe slug 结果；来源——PRD Golden Path 第 2 条
- `stderr` (string, 仅失败时可见): 仅在执行失败时输出错误信息；来源——CLI 运行时约定

**禁用字段名**: N/A — 非 HTTP schema，不定义额外响应字段

**Error (CLI non-zero)**:
```json
N/A
```

## 已知约束（来自回归测试）

- `[累积FR]` context-manifest: unavailable（`GET /api/brain/line/bb8cc561-b3ee-4fec-b74d-2255694bd963/context-manifest` 返回 404，即 PRD 所述"本 line 暂无历史"）
- 仓内未发现 `scripts/relay-demo/*.contract.test.ts` 或其他 slugify 相关测试文件（已用 `find` 全仓搜索 `*slugify*` 无命中），无历史断言可继承
- `scripts/relay-demo/pretty-bytes.mjs`、`scripts/relay-demo/sort-json-keys.mjs` 已存在，本 sprint 严禁修改或覆盖这两个文件（来源：PRD"不在范围内"段）

## PrepPRD 铁律落地断言

- `[ASSERT:PREPPRD:SCOPE_ONLY_SCRIPT_AND_SPRINT]` 本 sprint 合同只允许生成 `scripts/relay-demo/slugify.mjs` 目标脚本与 `sprints/07191413-relay-13f35dc8/` 合同产物；不得要求修改 `packages/brain/src` 或 `migrations`
- `[ASSERT:PREPPRD:CLI_ONLY_NO_SCREENSHOTS]` 所有验收命令必须可由 CLI 直接执行并以退出码/`stdout`/测试输出判定；不得依赖截图、视觉比对或人工目测
- `[ASSERT:PREPPRD:STRING_INPUT_ENTRY]` `scripts/relay-demo/slugify.mjs` 必须支持从 Node CLI 直接执行，并接收一个字符串输入
- `[ASSERT:PREPPRD:THREE_BOUNDARY_CASES]` 合同测试必须覆盖"空字符串"、"含空格与标点的普通短语"、"含连续分隔符与非 ASCII 字符"三个代表性场景
- `[ASSERT:PREPPRD:EMPTY_INPUT_STABLE]` 空字符串输入必须稳定返回空字符串，不能报错或抛异常
- `[ASSERT:PREPPRD:COLLAPSE_SEPARATORS]` 连续空格、连续连字符或首尾空白必须折叠为单个连字符并去除首尾多余连字符
- `[ASSERT:PREPPRD:DETERMINISTIC_NON_ASCII]` 非 ASCII 字符（中文、emoji 等）处理方式必须确定性且被测试覆盖，不能崩溃或输出不可预测值
- `[ASSERT:PREPPRD:NO_EXTERNAL_DEPENDENCIES]` 工具实现不得引入外部依赖
- `[ASSERT:PREPPRD:NO_OVERWRITE_EXISTING_TOOLS]` 不得修改或覆盖已存在的 `scripts/relay-demo/pretty-bytes.mjs`、`scripts/relay-demo/sort-json-keys.mjs`

## 接缝清单

- `logic-done-pending` Node CLI 接缝：真实世界接缝是"调用方必须能直接执行 `node scripts/relay-demo/slugify.mjs <string>` 并拿到单行 slug 结果"；真目标验证方式是在 `local_api` 机器上用 `node` 调用并检查退出码与 `stdout`
- `logic-done-pending` 边界折叠接缝：真实世界接缝是"脚本必须在空字符串、含标点空格的普通短语、含连续分隔符/非 ASCII 字符三类输入上稳定给出确定性 slug"；真目标验证方式是在 shell 中分别执行三次命令并用字符串精确比对
- `logic-done-pending` 测试接缝：真实世界接缝是"vitest 在本地可跑并证明三个合同 case 全部通过"；真目标验证方式是在 `packages/brain` workspace 下运行 vitest 指向本 sprint 测试文件，同时要求合同测试内部先解析真实文件路径，再从 CLI 输出中断言退出码为 0 且 `3 passed`

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 把任意字符串转换为 URL-safe slug（小写、连字符分隔、无首尾多余连字符） | `node scripts/relay-demo/slugify.mjs "<string>"` 输出单行 slug 到 stdout |
| **NFR（做得多好）** | 本地 CLI 同步执行，无网络/IO 等待 | 单次调用 < 1s，无外部依赖，纯函数计算 |
| **Invariant（永不违反）** | 相同输入必须永远产生相同输出（确定性）；不得抛未捕获异常导致非 0 退出码 | 三个合同用例覆盖此不变量 |
| **判定点（怎么知道）** | 非 ASCII 字符处理策略需要一次性拍板（保留 or 剔除） | 见下方判定点登记表 |
| **保质期（何时过期）** | N/A — 本 sprint 为一次性 relay 自测演练，非长期维护能力 | N/A |
| **死亡告警（停了谁知道）** | N/A — 无常驻服务，无监控告警场景 | N/A |
| **失败语义（挂了怎么办）** | 非字符串输入（如脚本被以非法方式调用）如何处理 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 无对外发布动作，仅本地 stdout 输出 | CLI 退出码 0 + stdout 精确比对即为生效确认 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 非 ASCII 字符（中文/emoji）如何处理 | A. 保留原字符直接拼入 slug；B. 剔除（作为分隔符边界处理，不出现在结果中） | B. 剔除 | PRD 要求"URL-safe slug"——保留非 ASCII 字符会破坏 URL-safe 特性（需额外编码），剔除后结果保证只含 `[a-z0-9-]`，天然 URL-safe，且实现最简单确定 | 若选 A 未做百分比编码，输出的 slug 直接用于 URL path 会产生非法字符；本 sprint 选 B，此判定点误判后果为 N/A（已消除该风险） |

> 该判定点误判后果非"静默丢数据"级别（纯 CLI 演练工具，无面客/不可逆动作），不标 `⚠️`，无需 `judgment-pending-user` 登记。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 未提供任何参数（`process.argv[2]` 为 `undefined`） | 视为空字符串处理，返回空字符串，退出码 0（不抛异常） | 天然幂等（纯函数，无状态） | 无需降级 |
| 传入非字符串类型（理论上 CLI argv 恒为字符串，此分支仅防御性覆盖） | 内部函数对非 string 输入抛 `TypeError`，但 CLI 入口层保证 argv 恒为 string，故该分支不会在 CLI 路径触发 | N/A | N/A |

### 输入对抗面

（本任务为本地 CLI 纯函数工具，非对外暴露 agent，无外部用户可写入接口，N/A）

## Golden Path

[Step 1 通过 Node CLI 传入任意字符串] → [Step 2 空字符串输入稳定返回空字符串] → [Step 3 含空格标点的普通短语转换为小写连字符 slug] → [Step 4 含连续分隔符与非 ASCII 字符的输入确定性折叠，且本地 vitest 三用例全部通过]

### Step 1: 使用者通过 Node CLI 传入任意字符串

**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条直接定义"调用方在本地执行 `scripts/relay-demo/slugify.mjs`，并运行针对该脚本的 vitest 用例"

**可观测行为**: 命令入口形态必须是 `node scripts/relay-demo/slugify.mjs "<string>"`；给出合法字符串后命令成功执行并返回退出码 0

**验证命令**:
```bash
OUT="$(node scripts/relay-demo/slugify.mjs "Test")"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = "test"
```

**硬阈值**: 命令入口形态必须是 `node scripts/relay-demo/slugify.mjs <string>`；成功路径退出码必须为 0；`stdout` 必须为确定性单行字符串

---

### Step 2: 空字符串输入必须稳定返回空字符串，不能报错或抛异常

**来源**: `[FROM_PRD]` — PRD 边界情况第 1 条直接定义"输入为空字符串时，结果必须稳定返回空字符串，不能报错或抛异常"

**可观测行为**: 输入空字符串时，`stdout` 输出空字符串（单行仅换行符），退出码为 0，不抛异常

**验证命令**:
```bash
OUT="$(node scripts/relay-demo/slugify.mjs "")"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = ""
```

**硬阈值**: 空字符串输入必须返回空字符串；退出码必须为 0；`stderr` 不得输出异常堆栈

---

### Step 3: 含空格与标点的普通短语转换为小写连字符分隔的 slug

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条直接定义"脚本把输入字符串转换为小写、以连字符分隔、去除首尾多余连字符的 slug"，对应边界情况第 1 段中"普通短语"场景

**可观测行为**: 输入 `"Hello, World!"` 时，脚本输出 `hello-world`（标点与空格被折叠为单个连字符，末尾标点不留下多余连字符）

**验证命令**:
```bash
OUT="$(node scripts/relay-demo/slugify.mjs "Hello, World!")"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = "hello-world"
```

**硬阈值**: `"Hello, World!"` 输入必须返回 `hello-world`；不得保留标点符号或大写字母；退出码必须为 0

---

### Step 4: 含连续分隔符与非 ASCII 字符的输入确定性折叠，且本地 vitest 三用例全部通过

**来源**: `[FROM_PRD]` — PRD 边界情况第 2、3 条直接定义"输入含连续空格、连续连字符或首尾空白时，结果必须折叠为单个连字符并去除首尾多余连字符"与"输入含非 ASCII 字符时，结果必须给出确定性处理"

**可观测行为**: 输入 `"  Hello   世界---World  "`（含首尾空白、连续空格、连续连字符、中文非 ASCII 字符）时，脚本输出 `hello-world`（中文字符按判定点登记表所选策略"剔除"处理、作为分隔符边界，不出现在结果中；所有分隔符折叠为单个连字符；首尾连字符被去除）；本地运行 vitest 时，三个合同用例全部通过且退出码为 0

**验证命令**:
```bash
OUT="$(node scripts/relay-demo/slugify.mjs "  Hello   世界---World  ")"
STATUS=$?
[ "$STATUS" -eq 0 ]
test "$OUT" = "hello-world"
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
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts --reporter=verbose | tee /tmp/slugify-vitest.log
VITEST_STATUS=${PIPESTATUS[0]}
[ "$VITEST_STATUS" -eq 0 ]
grep -Eq '3 passed|3 tests' /tmp/slugify-vitest.log
rm -rf "$TMP_CFG_DIR"
```

**硬阈值**: `"  Hello   世界---World  "` 输入必须返回 `hello-world`；vitest 命令退出码必须为 0；输出必须表明三个合同用例全部通过

## Red 前提（test_is_red）

在 `scripts/relay-demo/slugify.mjs` 未实现或错误实现时，直接运行合同测试必须以非零退出码失败；失败输出必须能定位到具体合同用例名或断言摘要，不能出现"实现缺失/错误但合同测试仍为 0"的假绿。

**未实现状态验证命令**:
```bash
TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-missing.XXXXXX")"
TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"
TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"
trap 'rm -rf "$TMP_REPO" "$TMP_CFG_DIR"' EXIT
mkdir -p "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests"
cp sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/"
REL_TEST="$(node --input-type=module -e 'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));' "$PWD/packages/brain" "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts")"
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
grep -Eq '空字符串输入返回空字符串|普通短语转换为小写连字符 slug|连续分隔符与非 ASCII 字符折叠为单个连字符|ENOENT|AssertionError|expected' "$TMP_REPO/red-missing.log"
```

**错误实现状态验证命令**:
```bash
TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-broken.XXXXXX")"
TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"
TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"
trap 'rm -rf "$TMP_REPO" "$TMP_CFG_DIR"' EXIT
mkdir -p "$TMP_REPO/scripts/relay-demo" "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests"
cp sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/"
cat > "$TMP_REPO/scripts/relay-demo/slugify.mjs" <<'EOF'
process.stdout.write(`${(process.argv[2] ?? '').toLowerCase()}\n`);
EOF
REL_TEST="$(node --input-type=module -e 'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));' "$PWD/packages/brain" "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts")"
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
grep -Eq '普通短语转换为小写连字符 slug|连续分隔符与非 ASCII 字符折叠为单个连字符|AssertionError|expected|to be' "$TMP_REPO/red-broken.log"
```

**硬阈值**: 上述 Red 验证命令都必须返回非零失败信号；未实现状态至少出现具体用例名或 `ENOENT` / `AssertionError` / `expected` 失败摘要；错误实现状态（只做小写化、不折叠分隔符不剔除非 ASCII）至少出现 `普通短语转换为小写连字符 slug` 或 `连续分隔符与非 ASCII 字符折叠为单个连字符` 用例名，或 `AssertionError` / `expected` 断言摘要

**路径模型约束**: 合同测试定位 repo root 时必须先解析测试文件真实路径（`realpathSync`），再回溯三级目录（`tests/` → `07191413-relay-13f35dc8/` → `sprints/` → repo root）；在 `packages/brain` workspace 下执行 vitest 时，验收命令仅通过已验证的 `sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts` 入口触发，并命中 repo 根下的 `scripts/relay-demo/slugify.mjs`

## 禁 mock 边清单

（本单纯新增本地纯函数 CLI 工具 + vitest 合同测试，不涉及调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径，无接缝边，N/A）

## 未覆盖真实链路清单

（本合同无 mock 豁免；测试直接 spawn 真实 `node scripts/relay-demo/slugify.mjs` 子进程并断言真实 stdout，无 force_*/stub/假数据，N/A）

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

<!-- GOLDEN_SMOKE_ABILITY_SLUG: relay-demo-slugify -->
<!-- GOLDEN_SMOKE_SCENARIO: local-cli-slugify -->

```bash
bash sprints/07191413-relay-13f35dc8/smoke-verify.sh
```

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
| --- | --- | --- | --- |
| WS1 | `tests/slugify.contract.test.ts` | `空字符串输入返回空字符串` / `普通短语转换为小写连字符 slug` / `连续分隔符与非 ASCII 字符折叠为单个连字符` | 未实现时 `vitest` 退出非零，输出含对应用例名或断言失败摘要 |
