---
skeletal: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: relay-demo slugify CLI 合同

**范围**: `scripts/relay-demo/slugify.mjs` 的单文件 CLI 行为、`sprints/07191413-relay-13f35dc8/tests/` 的 Red 合同测试、合同文档与任务计划
**大小**: S

## PrepPRD 铁律断言

- `[ASSERT:PREPPRD:SCOPE_ONLY_SCRIPT_AND_SPRINT]` 只允许新增 `scripts/relay-demo/slugify.mjs` 与 `sprints/07191413-relay-13f35dc8/` 合同产物；不得要求修改 `packages/brain/src` 与 `migrations`
- `[ASSERT:PREPPRD:CLI_ONLY_NO_SCREENSHOTS]` 完成信号只允许使用 CLI、退出码、`stdout`、`vitest` 输出；不得包含截图或视觉断言
- `[ASSERT:PREPPRD:STRING_INPUT_ENTRY]` `scripts/relay-demo/slugify.mjs` 必须支持 Node CLI 字符串输入
- `[ASSERT:PREPPRD:THREE_BOUNDARY_CASES]` vitest 覆盖空字符串、普通短语、连续分隔符/非 ASCII 三个 case
- `[ASSERT:PREPPRD:DETERMINISTIC_NON_ASCII]` 非 ASCII 字符处理必须确定性且被测试覆盖
- `[ASSERT:PREPPRD:NO_EXTERNAL_DEPENDENCIES]` 不引入外部依赖
- `[ASSERT:PREPPRD:NO_OVERWRITE_EXISTING_TOOLS]` 不得修改或覆盖 `scripts/relay-demo/pretty-bytes.mjs`、`scripts/relay-demo/sort-json-keys.mjs`
- `[ASSERT:PREPPRD:REALPATH_ROOT_RESOLUTION]` 合同测试定位 repo root 时必须先解析真实测试文件路径，避免符号链接把脚本路径误指

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/relay-demo/slugify.mjs` 文件存在，且入口以字符串参数驱动
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/slugify.mjs "Test")"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "test"'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/slugify.mjs` 按规则折叠分隔符并去除首尾多余连字符
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/slugify.mjs "Hello, World!")"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "hello-world" && OUT2="$(node scripts/relay-demo/slugify.mjs "  Hello   世界---World  ")" && test "$OUT2" = "hello-world"'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/slugify.mjs` 不引入外部依赖
  Test: manual:bash -c 'test -f scripts/relay-demo/slugify.mjs && node --input-type=module -e "import fs from \"node:fs\"; const src = fs.readFileSync(\"scripts/relay-demo/slugify.mjs\", \"utf8\"); const specs = [...src.matchAll(/from\\s+[\"'\''']([^\"'\''']+)[\"'\''']|require\\([\"'\''']([^\"'\''']+)[\"'\''']\\)/g)].map(([, esm, cjs]) => esm ?? cjs); const bad = specs.filter((spec) => !spec.startsWith(\"./\") && !spec.startsWith(\"../\") && !spec.startsWith(\"node:\")); if (bad.length) { console.error(bad.join(\"\\n\")); process.exit(1); }"'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/pretty-bytes.mjs` 与 `scripts/relay-demo/sort-json-keys.mjs` 未被修改或覆盖
  Test: manual:bash -c 'git diff --name-only HEAD -- scripts/relay-demo/pretty-bytes.mjs scripts/relay-demo/sort-json-keys.mjs | grep -q . && exit 1 || echo OK'
  期望: OK

- [ ] [ARTIFACT] `sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts` 定义空字符串、普通短语、连续分隔符/非 ASCII 三个合同用例
  Test: manual:bash -c 'grep -q "空字符串输入返回空字符串" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts && grep -q "普通短语转换为小写连字符 slug" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts && grep -q "连续分隔符与非 ASCII 字符折叠为单个连字符" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts'
  期望: OK

- [ ] [ARTIFACT] `sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts` 先解析真实测试目录，再回溯 repo root 到 `scripts/relay-demo/slugify.mjs`
  Test: manual:bash -c 'grep -q "realpathSync" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts && grep -q "workspaceRoot = path.resolve" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts && grep -q "scripts/relay-demo/slugify.mjs" sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts'
  期望: OK

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] Step 1：提供任意字符串参数后，CLI 以 `node scripts/relay-demo/slugify.mjs <string>` 形态成功执行并返回退出码 0
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/slugify.mjs "Test")"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "test"'
  期望: OK

- [ ] [BEHAVIOR] Step 2：输入空字符串时，结果稳定返回空字符串，不会报错或抛异常
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/slugify.mjs "")"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = ""'
  期望: OK

- [ ] [BEHAVIOR] Step 3：输入含空格与标点的普通短语 `"Hello, World!"` 时，结果必须为小写连字符 slug `hello-world`
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/slugify.mjs "Hello, World!")"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "hello-world"'
  期望: OK

- [ ] [BEHAVIOR] Step 4：输入含连续分隔符与非 ASCII 字符 `"  Hello   世界---World  "` 时，结果必须确定性折叠为 `hello-world`，且本地 vitest 三个合同用例全部通过
  Test: manual:bash -c 'TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"; TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"; trap "rm -rf \"$TMP_CFG_DIR\"" EXIT; OUT="$(node scripts/relay-demo/slugify.mjs "  Hello   世界---World  ")"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "hello-world" && cat > "$TMP_CFG" <<EOF
export default {
  test: {
    environment: "node",
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts --reporter=verbose 2>&1 | tee /tmp/slugify-vitest.log; VITEST_STATUS=${PIPESTATUS[0]}; [ "$VITEST_STATUS" -eq 0 ] && grep -Eq "3 passed|3 tests" /tmp/slugify-vitest.log'
  期望: OK

- [ ] [BEHAVIOR] Red 前提：当 `scripts/relay-demo/slugify.mjs` 未实现时，直接运行合同测试必须非零失败，并出现缺失实现的失败定位
  Test: manual:bash -c 'TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-missing.XXXXXX")"; TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"; TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"; trap "rm -rf \"$TMP_REPO\" \"$TMP_CFG_DIR\"" EXIT; mkdir -p "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests"; cp sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/"; REL_TEST="$(node --input-type=module -e '"'"'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));'"'"' "$PWD/packages/brain" "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts")"; cat > "$TMP_CFG" <<'"'"'EOF'"'"'
export default {
  test: {
    environment: "node",
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-missing.log"; VITEST_STATUS=${PIPESTATUS[0]}; [ "$VITEST_STATUS" -ne 0 ] && grep -Eq "空字符串输入返回空字符串|普通短语转换为小写连字符 slug|连续分隔符与非 ASCII 字符折叠为单个连字符|ENOENT|AssertionError|expected" "$TMP_REPO/red-missing.log"'
  期望: non-zero，并出现具体失败用例名或 `ENOENT` / `AssertionError` / `expected` 摘要

- [ ] [BEHAVIOR] Red 前提：当 `scripts/relay-demo/slugify.mjs` 错误实现为"仅做小写化、不折叠分隔符也不剔除非 ASCII 字符"时，直接运行合同测试必须非零失败，并出现具体失败用例或断言摘要
  Test: manual:bash -c 'TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-broken.XXXXXX")"; TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"; TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"; trap "rm -rf \"$TMP_REPO\" \"$TMP_CFG_DIR\"" EXIT; mkdir -p "$TMP_REPO/scripts/relay-demo" "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests"; cp sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/"; cat > "$TMP_REPO/scripts/relay-demo/slugify.mjs" <<'"'"'EOF'"'"'
process.stdout.write(`${(process.argv[2] ?? "").toLowerCase()}\n`);
EOF
REL_TEST="$(node --input-type=module -e '"'"'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));'"'"' "$PWD/packages/brain" "$TMP_REPO/sprints/07191413-relay-13f35dc8/tests/slugify.contract.test.ts")"; cat > "$TMP_CFG" <<'"'"'EOF'"'"'
export default {
  test: {
    environment: "node",
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-broken.log"; VITEST_STATUS=${PIPESTATUS[0]}; [ "$VITEST_STATUS" -ne 0 ] && grep -Eq "普通短语转换为小写连字符 slug|连续分隔符与非 ASCII 字符折叠为单个连字符|AssertionError|expected|to be" "$TMP_REPO/red-broken.log"'
  期望: non-zero，并出现 `普通短语转换为小写连字符 slug` 或 `连续分隔符与非 ASCII 字符折叠为单个连字符` 用例名，或 `AssertionError` / `expected` 摘要

## 机械验收钩子

- `[MECH:BEHAVIOR_COUNT]` `grep -c '\[BEHAVIOR\]' sprints/07191413-relay-13f35dc8/contract-dod.md` 必须 `>= 4`
- `[MECH:DRAFT_E2E_HEADING]` `grep -q '## E2E 验收' sprints/07191413-relay-13f35dc8/contract-draft.md`
- `[MECH:MANUAL_BASH]` `grep -q 'manual:bash' sprints/07191413-relay-13f35dc8/contract-dod.md`
- `[MECH:E2E_STATUS_PORCELAIN]` `grep -q 'git status --porcelain --untracked-files=all' sprints/07191413-relay-13f35dc8/smoke-verify.sh`
- `[MECH:RED_NONZERO]` `grep -q 'Red 前提' sprints/07191413-relay-13f35dc8/contract-draft.md && grep -q 'VITEST_STATUS.*-ne 0' sprints/07191413-relay-13f35dc8/contract-dod.md`
