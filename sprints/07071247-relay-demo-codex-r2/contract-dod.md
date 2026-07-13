---
skeletal: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: relay-demo sort-json-keys CLI 合同

**范围**: `scripts/relay-demo/sort-json-keys.mjs` 的单文件 CLI 行为、`sprints/07071247-relay-demo-codex-r2/tests/` 的 Red 合同测试、合同文档与任务计划
**大小**: S

## PrepPRD 铁律断言

- `[ASSERT:PREPPRD:SCOPE_ONLY_SCRIPTS_AND_SPRINTS]` 只允许新增 `scripts/relay-demo/` 下目标脚本与 `sprints/07071247-relay-demo-codex-r2/` 合同产物；不得要求修改 `packages/brain/src` 与 `migrations`
- `[ASSERT:PREPPRD:CLI_ONLY_NO_SCREENSHOTS]` 完成信号只允许使用 CLI、退出码、`stdout`、`jq`、`vitest` 输出；不得包含截图或视觉断言
- `[ASSERT:PREPPRD:READS_JSON_PATH_ARG]` `scripts/relay-demo/sort-json-keys.mjs` 读取 JSON 文件路径参数作为唯一输入
- `[ASSERT:PREPPRD:RECURSIVE_SORT_STDOUT]` 递归按字典序排序对象键并输出到 `stdout`
- `[ASSERT:PREPPRD:NO_EXTERNAL_DEPENDENCIES]` 不引入外部依赖
- `[ASSERT:PREPPRD:VITEST_CASES_NESTED_ARRAY_EMPTY]` vitest 覆盖嵌套对象、数组、空对象三个 case

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/relay-demo/sort-json-keys.mjs` 文件存在，且入口以 JSON 文件路径参数驱动
  Test: manual:bash -c 'TMP_JSON="$(mktemp)"; trap "rm -f \"$TMP_JSON\"" EXIT; cat > "$TMP_JSON" <<JSON
{"b":1,"a":2}
JSON
OUT="$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON")"; STATUS=$?; [ "$STATUS" -eq 0 ] && echo "$OUT" | jq -e ". == {\"a\":2,\"b\":1}" >/dev/null'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/sort-json-keys.mjs` 实现包含递归排序意图，并以 `stdout` 输出结果
  Test: manual:bash -c 'TMP_JSON="$(mktemp)"; trap "rm -f \"$TMP_JSON\"" EXIT; cat > "$TMP_JSON" <<'"'"'JSON'"'"'\n{"z":1,"a":{"d":4,"c":3},"m":{"b":2,"a":1}}\nJSON\nOUT=$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON"); STATUS=$?; [ "$STATUS" -eq 0 ] && echo "$OUT" | jq -e '"'"'. == {"a":{"c":3,"d":4},"m":{"a":1,"b":2},"z":1}'"'"' >/dev/null'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/sort-json-keys.mjs` 不引入外部依赖
  Test: manual:bash -c 'test -f scripts/relay-demo/sort-json-keys.mjs && ! grep -Eq "from '\''[^./]|require\\('\''[^./]" scripts/relay-demo/sort-json-keys.mjs'
  期望: OK

- [ ] [ARTIFACT] `sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts` 定义嵌套对象、数组、空对象三个合同用例
  Test: manual:bash -c 'grep -q "嵌套对象" sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts && grep -q "数组" sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts && grep -q "空对象" sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts'
  期望: OK

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] Step 1：提供一个可读取 JSON 文件路径后，CLI 以该路径作为唯一输入成功执行并返回退出码 0
  Test: manual:bash -c 'TMP_JSON="$(mktemp)"; trap "rm -f \"$TMP_JSON\"" EXIT; cat > "$TMP_JSON" <<JSON
{"b":1,"a":2}
JSON
OUT="$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON")"; STATUS=$?; [ "$STATUS" -eq 0 ] && echo "$OUT" | jq -e ". == {\"a\":2,\"b\":1}" >/dev/null'
  期望: OK

- [ ] [BEHAVIOR] Step 2：CLI 递归按字典序排序对象键，且已排序输入保持语义一致并且不增删字段
  Test: manual:bash -c 'TMP_JSON="$(mktemp)"; trap "rm -f \"$TMP_JSON\"" EXIT; cat > "$TMP_JSON" <<'"'"'JSON'"'"'\n{"alpha":{"charlie":3,"delta":4},"middle":{"alpha":1,"bravo":2},"zebra":1}\nJSON\nOUT=$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON"); STATUS=$?; [ "$STATUS" -eq 0 ] && node -e '"'"'const input=JSON.parse(process.argv[1]); const out=JSON.parse(process.argv[2]); const same=JSON.stringify(out)===JSON.stringify(input); const sameKeys=JSON.stringify(Object.keys(out))===JSON.stringify(Object.keys(input)) && JSON.stringify(Object.keys(out.alpha))===JSON.stringify(Object.keys(input.alpha)) && JSON.stringify(Object.keys(out.middle))===JSON.stringify(Object.keys(input.middle)); if (!same || !sameKeys) process.exit(1);'"'"' "$(cat "$TMP_JSON")" "$OUT"'
  期望: OK

- [ ] [BEHAVIOR] Step 3：stdout 输出稳定 JSON，数组顺序保持不变，数组中的对象元素同样递归按字典序排序
  Test: manual:bash -c 'TMP_JSON="$(mktemp)"; trap "rm -f \"$TMP_JSON\"" EXIT; cat > "$TMP_JSON" <<'"'"'JSON'"'"'\n{"items":[{"b":2,"a":1},"plain",{"d":4,"c":3}]}\nJSON\nOUT=$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON"); STATUS=$?; [ "$STATUS" -eq 0 ] && node -e '"'"'const out=JSON.parse(process.argv[1]); if (JSON.stringify(out.items)!==JSON.stringify([{a:1,b:2},"plain",{c:3,d:4}])) process.exit(1);'"'"' "$OUT"'
  期望: OK

- [ ] [BEHAVIOR] Step 4：空对象保持为空对象，且本地 vitest 三个合同用例全部通过
  Test: manual:bash -c 'TMP_JSON="$(mktemp)"; TMP_CFG="$(mktemp /tmp/relay-vitest-config-XXXX.mjs)"; trap "rm -f \"$TMP_JSON\" \"$TMP_CFG\"" EXIT; cat > "$TMP_JSON" <<JSON
{"outer":{}}
JSON
OUT="$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON")"; STATUS=$?; echo "$OUT" | jq -e ". == {\"outer\":{}}" >/dev/null && [ "$STATUS" -eq 0 ] && cat > "$TMP_CFG" <<EOF
export default {
  test: {
    environment: "node",
    globals: false,
  },
};
EOF
npm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts --reporter=verbose 2>&1 | tee /tmp/relay-demo-vitest.log; VITEST_STATUS=${PIPESTATUS[0]}; [ "$VITEST_STATUS" -eq 0 ] && grep -Eq "3 passed|3 tests" /tmp/relay-demo-vitest.log'
  期望: OK

- [ ] [BEHAVIOR] Red 前提：当 `scripts/relay-demo/sort-json-keys.mjs` 未实现时，直接运行合同测试必须非零失败，并出现缺失实现的失败定位
  Test: manual:bash -c 'TMP_REPO="$(mktemp -d /workspace/packages/brain/tmp-red-XXXXXX)"; TMP_CFG="$(mktemp /tmp/relay-vitest-config-XXXX.mjs)"; trap "rm -rf \"$TMP_REPO\"; rm -f \"$TMP_CFG\"" EXIT; mkdir -p "$TMP_REPO/sprints/07071247-relay-demo-codex-r2/tests"; cp sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts "$TMP_REPO/sprints/07071247-relay-demo-codex-r2/tests/"; REL_TEST="${TMP_REPO#/workspace/packages/brain/}/sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts"; cat > "$TMP_CFG" <<'"'"'EOF'"'"'\nexport default {\n  test: {\n    environment: "node",\n    globals: false,\n  },\n};\nEOF\nnpm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-missing.log"; VITEST_STATUS=${PIPESTATUS[0]}; [ "$VITEST_STATUS" -ne 0 ] && grep -Eq "嵌套对象会递归按字典序排序|数组顺序保持不变|空对象保持为空对象|expected 1 to be \\+0|AssertionError" "$TMP_REPO/red-missing.log"'
  期望: non-zero，并出现具体失败用例名或 `expected 1 to be +0` / `AssertionError` 摘要

- [ ] [BEHAVIOR] Red 前提：当 `scripts/relay-demo/sort-json-keys.mjs` 错误实现为“把 `items` 数组反转后再输出”时，直接运行合同测试必须非零失败，并出现具体失败用例或断言摘要
  Test: manual:bash -c 'TMP_REPO="$(mktemp -d /workspace/packages/brain/tmp-red-XXXXXX)"; TMP_CFG="$(mktemp /tmp/relay-vitest-config-XXXX.mjs)"; trap "rm -rf \"$TMP_REPO\"; rm -f \"$TMP_CFG\"" EXIT; mkdir -p "$TMP_REPO/scripts/relay-demo" "$TMP_REPO/sprints/07071247-relay-demo-codex-r2/tests"; cp sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts "$TMP_REPO/sprints/07071247-relay-demo-codex-r2/tests/"; cat > "$TMP_REPO/scripts/relay-demo/sort-json-keys.mjs" <<'"'"'EOF'"'"'\nimport { readFileSync } from "node:fs";\nconst input = JSON.parse(readFileSync(process.argv[2], "utf8"));\nif (Array.isArray(input.items)) {\n  input.items = [...input.items].reverse();\n}\nprocess.stdout.write(`${JSON.stringify(input)}\\n`);\nEOF\nREL_TEST="${TMP_REPO#/workspace/packages/brain/}/sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts"; cat > "$TMP_CFG" <<'"'"'EOF'"'"'\nexport default {\n  test: {\n    environment: "node",\n    globals: false,\n  },\n};\nEOF\nnpm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run "$REL_TEST" --reporter=verbose 2>&1 | tee "$TMP_REPO/red-broken.log"; VITEST_STATUS=${PIPESTATUS[0]}; [ "$VITEST_STATUS" -ne 0 ] && grep -Eq "数组顺序保持不变|AssertionError|to deeply equal|expected" "$TMP_REPO/red-broken.log"'
  期望: non-zero，并出现 `数组顺序保持不变` 用例名或 `AssertionError` / `to deeply equal` / `expected` 摘要

## 机械验收钩子

- `[MECH:BEHAVIOR_COUNT]` `grep -c '\[BEHAVIOR\]' sprints/07071247-relay-demo-codex-r2/contract-dod.md` 必须 `>= 4`
- `[MECH:DRAFT_E2E_HEADING]` `grep -q '## E2E 验收' sprints/07071247-relay-demo-codex-r2/contract-draft.md`
- `[MECH:MANUAL_BASH]` `grep -q 'manual:bash' sprints/07071247-relay-demo-codex-r2/contract-dod.md`
- `[MECH:E2E_STATUS_PORCELAIN]` `grep -q 'git status --porcelain --untracked-files=all' sprints/07071247-relay-demo-codex-r2/contract-draft.md`
- `[MECH:RED_NONZERO]` `grep -q 'Red 前提' sprints/07071247-relay-demo-codex-r2/contract-draft.md && grep -q 'VITEST_STATUS.*-ne 0' sprints/07071247-relay-demo-codex-r2/contract-dod.md`
