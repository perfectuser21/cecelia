---
skeletal: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: relay-demo pretty-bytes CLI 合同

**范围**: `scripts/relay-demo/pretty-bytes.mjs` 的单文件 CLI 行为、`sprints/07081030-headed-r7/tests/` 的 Red 合同测试、合同文档与任务计划
**大小**: S

## PrepPRD 铁律断言

- `[ASSERT:PREPPRD:SCOPE_ONLY_SCRIPT_AND_SPRINT]` 只允许新增 `scripts/relay-demo/pretty-bytes.mjs` 与 `sprints/07081030-headed-r7/` 合同产物；不得要求修改 `packages/brain/src` 与 `migrations`
- `[ASSERT:PREPPRD:CLI_ONLY_NO_SCREENSHOTS]` 完成信号只允许使用 CLI、退出码、`stdout`、`vitest` 输出；不得包含截图或视觉断言
- `[ASSERT:PREPPRD:BYTE_INPUT_ENTRY]` `scripts/relay-demo/pretty-bytes.mjs` 必须支持 Node CLI 字节输入
- `[ASSERT:PREPPRD:ZERO_1024_TB_CASES]` vitest 覆盖 `0`、`1024`、`1 TB` 三个 case
- `[ASSERT:PREPPRD:HUMAN_READABLE_OUTPUT]` 结果必须输出人类可读单位字符串
- `[ASSERT:PREPPRD:NO_EXTERNAL_DEPENDENCIES]` 不引入外部依赖
- `[ASSERT:PREPPRD:REALPATH_ROOT_RESOLUTION]` 合同测试定位 repo root 时必须先解析真实测试文件路径，避免 `packages/brain/sprints` 符号链接把脚本路径误指到 `packages/brain/scripts/...`

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/relay-demo/pretty-bytes.mjs` 文件存在，且入口以字节数参数驱动
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/pretty-bytes.mjs 0)"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "0 B"'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/pretty-bytes.mjs` 以 1024 进位规则输出人类可读单位
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/pretty-bytes.mjs 1024)"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "1 KB" && OUT_TB="$(node scripts/relay-demo/pretty-bytes.mjs 1099511627776)" && test "$OUT_TB" = "1 TB"'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/pretty-bytes.mjs` 不引入外部依赖
  Test: manual:bash -c 'test -f scripts/relay-demo/pretty-bytes.mjs && node --input-type=module -e "import fs from \"node:fs\"; const src = fs.readFileSync(\"scripts/relay-demo/pretty-bytes.mjs\", \"utf8\"); const specs = [...src.matchAll(/from\\s+[\"'\"']([^\"'\"']+)[\"'\"']|require\\([\"'\"']([^\"'\"']+)[\"'\"']\\)/g)].map(([, esm, cjs]) => esm ?? cjs); const bad = specs.filter((spec) => !spec.startsWith(\"./\") && !spec.startsWith(\"../\") && !spec.startsWith(\"node:\")); if (bad.length) { console.error(bad.join(\"\\n\")); process.exit(1); }"'
  期望: OK

- [ ] [ARTIFACT] `sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts` 定义零值、KB 阈值、TB 阈值三个合同用例
  Test: manual:bash -c 'grep -q "0 bytes returns a readable zero value" sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts && grep -q "1024 bytes promotes to KB" sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts && grep -q "1 TB stays in TB" sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts'
  期望: OK

- [ ] [ARTIFACT] `sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts` 先解析真实测试目录，再回溯 repo root 到 `scripts/relay-demo/pretty-bytes.mjs`
  Test: manual:bash -c 'grep -q "realpathSync" sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts && grep -q "workspaceRoot = path.resolve" sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts && grep -q "scripts/relay-demo/pretty-bytes.mjs" sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts'
  期望: OK

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] Step 1：提供字节数参数后，CLI 以 `node scripts/relay-demo/pretty-bytes.mjs <bytes>` 形态成功执行并返回退出码 0
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/pretty-bytes.mjs 0)"; STATUS=$?; [ "$STATUS" -eq 0 ] && test -n "$OUT"'
  期望: OK

- [ ] [BEHAVIOR] Step 2：输入 `0` 时，结果稳定返回 `0 B`，不会报错或输出空字符串
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/pretty-bytes.mjs 0)"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "0 B"'
  期望: OK

- [ ] [BEHAVIOR] Step 3：输入 `1024` 时，结果必须完成单位进位并输出 `1 KB`
  Test: manual:bash -c 'OUT="$(node scripts/relay-demo/pretty-bytes.mjs 1024)"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "1 KB"'
  期望: OK

- [ ] [BEHAVIOR] Step 4：输入 `1099511627776` 时，结果必须继续输出 `1 TB`，且本地 vitest 三个合同用例全部通过
  Test: manual:bash -c 'TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"; TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"; trap "rm -rf \"$TMP_CFG_DIR\"" EXIT; OUT="$(node scripts/relay-demo/pretty-bytes.mjs 1099511627776)"; STATUS=$?; [ "$STATUS" -eq 0 ] && test "$OUT" = "1 TB" && cat > "$TMP_CFG" <<EOF
export default {
  test: {
    environment: "node",
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts --reporter=verbose 2>&1 | tee /tmp/pretty-bytes-vitest.log; VITEST_STATUS=${PIPESTATUS[0]}; [ "$VITEST_STATUS" -eq 0 ] && grep -Eq "3 passed|3 tests" /tmp/pretty-bytes-vitest.log'
  期望: OK

- [ ] [BEHAVIOR] Red 前提：当 `scripts/relay-demo/pretty-bytes.mjs` 未实现时，直接运行合同测试必须非零失败，并出现缺失实现的失败定位
  Test: manual:bash -c 'TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-missing.XXXXXX")"; TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"; TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"; trap "rm -rf \"$TMP_REPO\" \"$TMP_CFG_DIR\"" EXIT; mkdir -p "$TMP_REPO/sprints/07081030-headed-r7/tests"; cp sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts "$TMP_REPO/sprints/07081030-headed-r7/tests/"; REL_TEST="$(node --input-type=module -e '"'"'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));'"'"' "$PWD/packages/brain" "$TMP_REPO/sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts")"; cat > "$TMP_CFG" <<'"'"'EOF'"'"'\nexport default {\n  test: {\n    environment: "node",\n    globals: false,\n  },\n};\nEOF\nnpm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-missing.log"; VITEST_STATUS=${PIPESTATUS[0]}; [ "$VITEST_STATUS" -ne 0 ] && grep -Eq "0 bytes returns a readable zero value|1024 bytes promotes to KB|1 TB stays in TB|ENOENT|AssertionError|expected" "$TMP_REPO/red-missing.log"'
  期望: non-zero，并出现具体失败用例名或 `ENOENT` / `AssertionError` / `expected` 摘要

- [ ] [BEHAVIOR] Red 前提：当 `scripts/relay-demo/pretty-bytes.mjs` 错误实现为“总是回显 `<bytes> B`”时，直接运行合同测试必须非零失败，并出现具体失败用例或断言摘要
  Test: manual:bash -c 'TMP_REPO="$(mktemp -d "${PWD}/packages/brain/tmp-red-broken.XXXXXX")"; TMP_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/relay-vitest-config.XXXXXX")"; TMP_CFG="$TMP_CFG_DIR/vitest.config.mjs"; trap "rm -rf \"$TMP_REPO\" \"$TMP_CFG_DIR\"" EXIT; mkdir -p "$TMP_REPO/scripts/relay-demo" "$TMP_REPO/sprints/07081030-headed-r7/tests"; cp sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts "$TMP_REPO/sprints/07081030-headed-r7/tests/"; cat > "$TMP_REPO/scripts/relay-demo/pretty-bytes.mjs" <<'"'"'EOF'"'"'\nprocess.stdout.write(`${process.argv[2]} B\\n`);\nEOF\nREL_TEST="$(node --input-type=module -e '"'"'import path from "node:path"; console.log(path.relative(process.argv[1], process.argv[2]));'"'"' "$PWD/packages/brain" "$TMP_REPO/sprints/07081030-headed-r7/tests/pretty-bytes.contract.test.ts")"; cat > "$TMP_CFG" <<'"'"'EOF'"'"'\nexport default {\n  test: {\n    environment: "node",\n    globals: false,\n  },\n};\nEOF\nnpm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-broken.log"; VITEST_STATUS=${PIPESTATUS[0]}; [ "$VITEST_STATUS" -ne 0 ] && grep -Eq "1024 bytes promotes to KB|1 TB stays in TB|AssertionError|expected|to be" "$TMP_REPO/red-broken.log"'
  期望: non-zero，并出现 `1024 bytes promotes to KB` 或 `1 TB stays in TB` 用例名，或 `AssertionError` / `expected` 摘要

## 机械验收钩子

- `[MECH:BEHAVIOR_COUNT]` `grep -c '\[BEHAVIOR\]' sprints/07081030-headed-r7/contract-dod.md` 必须 `>= 4`
- `[MECH:DRAFT_E2E_HEADING]` `grep -q '## E2E 验收' sprints/07081030-headed-r7/contract-draft.md`
- `[MECH:MANUAL_BASH]` `grep -q 'manual:bash' sprints/07081030-headed-r7/contract-dod.md`
- `[MECH:E2E_STATUS_PORCELAIN]` `grep -q 'git status --porcelain --untracked-files=all' sprints/07081030-headed-r7/tests/smoke-verify.sh`
- `[MECH:RED_NONZERO]` `grep -q 'Red 前提' sprints/07081030-headed-r7/contract-draft.md && grep -q 'VITEST_STATUS.*-ne 0' sprints/07081030-headed-r7/contract-dod.md`
