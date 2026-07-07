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
  Test: manual:bash -c 'test -f scripts/relay-demo/sort-json-keys.mjs && grep -Eq "process\\.argv\\[[23]\\]|argv\\.slice\\(" scripts/relay-demo/sort-json-keys.mjs'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/sort-json-keys.mjs` 实现包含递归排序意图，并以 `stdout` 输出结果
  Test: manual:bash -c 'test -f scripts/relay-demo/sort-json-keys.mjs && grep -Eq "Object\\.keys|sort\\(" scripts/relay-demo/sort-json-keys.mjs && grep -Eq "process\\.stdout\\.write|console\\.log" scripts/relay-demo/sort-json-keys.mjs'
  期望: OK

- [ ] [ARTIFACT] `scripts/relay-demo/sort-json-keys.mjs` 不引入外部依赖
  Test: manual:bash -c 'test -f scripts/relay-demo/sort-json-keys.mjs && ! grep -Eq "from '\''[^./]|require\\('\''[^./]" scripts/relay-demo/sort-json-keys.mjs'
  期望: OK

- [ ] [ARTIFACT] `sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts` 定义嵌套对象、数组、空对象三个合同用例
  Test: manual:bash -c 'grep -q "嵌套对象" sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts && grep -q "数组" sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts && grep -q "空对象" sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts'
  期望: OK

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] 可读取 JSON 文件路径参数后，stdout 返回合法 JSON，且嵌套对象键递归按字典序排序
  Test: manual:bash -c 'TMP_JSON="$(mktemp)"; trap "rm -f \"$TMP_JSON\"" EXIT; cat > "$TMP_JSON" <<'"'"'JSON'"'"'\n{"z":1,"a":{"d":4,"c":3},"m":{"b":2,"a":1}}\nJSON\nOUT=$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON"); echo "$OUT" | jq -e '"'"'. == {"a":{"c":3,"d":4},"m":{"a":1,"b":2},"z":1}'"'"' >/dev/null'
  期望: OK

- [ ] [BEHAVIOR] 数组顺序保持输入语义不变，数组中的对象元素同样递归按字典序排序
  Test: manual:bash -c 'TMP_JSON="$(mktemp)"; trap "rm -f \"$TMP_JSON\"" EXIT; cat > "$TMP_JSON" <<'"'"'JSON'"'"'\n{"items":[{"b":2,"a":1},"plain",{"d":4,"c":3}]}\nJSON\nOUT=$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON"); node -e '"'"'const out=JSON.parse(process.argv[1]); if (JSON.stringify(out.items)!==JSON.stringify([{a:1,b:2},"plain",{c:3,d:4}])) process.exit(1);'"'"' "$OUT"'
  期望: OK

- [ ] [BEHAVIOR] 空对象输入仍输出合法 JSON，且空对象保持为空对象
  Test: manual:bash -c 'TMP_JSON="$(mktemp)"; trap "rm -f \"$TMP_JSON\"" EXIT; printf '"'"'{"outer":{}}\n'"'"' > "$TMP_JSON"; OUT=$(node scripts/relay-demo/sort-json-keys.mjs "$TMP_JSON"); echo "$OUT" | jq -e '"'"'. == {"outer":{}}'"'"' >/dev/null'
  期望: OK

- [ ] [BEHAVIOR] 本地 vitest 合同测试覆盖嵌套对象、数组、空对象三个 case，并全部通过
  Test: manual:bash -c 'TMP_CFG="$(mktemp /tmp/relay-vitest-config-XXXX.mjs)"; cat > "$TMP_CFG" <<'"'"'EOF'"'"'\nexport default {\n  test: {\n    environment: "node",\n    globals: false,\n  },\n};\nEOF\nnpm exec --workspace packages/brain vitest -- --config "$TMP_CFG" run sprints/07071247-relay-demo-codex-r2/tests/sort-json-keys.contract.test.ts --reporter=verbose 2>&1 | tee /tmp/relay-demo-vitest.log; STATUS=$?; rm -f "$TMP_CFG"; [ "$STATUS" -eq 0 ] && grep -Eq "3 passed|3 tests" /tmp/relay-demo-vitest.log'
  期望: OK

## 机械验收钩子

- `[MECH:BEHAVIOR_COUNT]` `grep -c '\[BEHAVIOR\]' sprints/07071247-relay-demo-codex-r2/contract-dod.md` 必须 `>= 4`
- `[MECH:DRAFT_E2E_HEADING]` `grep -q '## E2E 验收' sprints/07071247-relay-demo-codex-r2/contract-draft.md`
- `[MECH:MANUAL_BASH]` `grep -q 'manual:bash' sprints/07071247-relay-demo-codex-r2/contract-dod.md`
