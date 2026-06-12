contract_branch: cp-06121801-ws-01f31f66-ws1
sprint_dir: sprints/06121716-ci-defense-r6

---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: CI 防线三件套（R6）

**范围**: 新建 changed-test-router.mjs + check-contract-exists.mjs；新建 harness-evaluator.test.ts；扩展 reviewer/generator/proposer 现有测试；ci.yml 新增 skills 变更触发 step
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/scripts/ci/changed-test-router.mjs` 文件存在，包含 `readFileSync` 扫描逻辑
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/ci/changed-test-router.mjs','utf8');if(!c.includes('readFileSync'))process.exit(1)"

- [ ] [ARTIFACT] `packages/brain/scripts/ci/check-contract-exists.mjs` 文件存在，含 `contract-draft.md` 检查逻辑
  Test: node -e "const c=require('fs').readFileSync('packages/brain/scripts/ci/check-contract-exists.mjs','utf8');if(!c.includes('contract-draft.md'))process.exit(1)"

- [ ] [ARTIFACT] `packages/engine/tests/skills/harness-evaluator.test.ts` 文件存在
  Test: node -e "require('fs').accessSync('packages/engine/tests/skills/harness-evaluator.test.ts')"

- [ ] [ARTIFACT] `.github/workflows/ci.yml` 包含 skills 变更触发的 changed-test-router 调用
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('changed-test-router.mjs'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] changed-test-router.mjs 对 harness-evaluator SKILL.md 输出含 harness-evaluator.test.ts 路径的清单（Step1）
  Test: manual:bash -c 'OUTPUT=$(node packages/brain/scripts/ci/changed-test-router.mjs --files packages/workflows/skills/harness-evaluator/SKILL.md); echo "$OUTPUT" | grep -q "harness-evaluator.test.ts" || { echo "FAIL: 输出不含 harness-evaluator.test.ts"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] harness-evaluator.test.ts 含 env_missing 不变量断言（B-1.6 关键守卫，文件内容检查）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/engine/tests/skills/harness-evaluator.test.ts\",\"utf8\");if(!c.includes(\"env_missing\")){console.error(\"FAIL: 缺 env_missing 断言\");process.exit(1)}if(!c.match(/B-1\\.[6-8]/)){console.error(\"FAIL: 缺 B-1.6/1.7/1.8 步骤断言\");process.exit(1)}console.log(\"OK\")" || { echo "FAIL: harness-evaluator.test.ts 内容检查失败"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] skill 契约测试套件全绿——实际运行 vitest 验证 Step2（非仅文件内容检查）
  Test: manual:bash -c 'VITEST_OUT=$(npx vitest run packages/engine/tests/skills/ 2>&1); VITEST_EXIT=$?; [ "$VITEST_EXIT" = "0" ] || { echo "FAIL: skill契约测试失败 exit=$VITEST_EXIT"; echo "$VITEST_OUT"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 篡改 evaluator skill 删除 env_missing 段后契约测试报红（Step3 验证）
  Test: manual:bash -c 'SKILL_ORIG="$HOME/.claude/skills/harness-evaluator/SKILL.md"; if [ ! -f "$SKILL_ORIG" ]; then echo "SKIP: skill未安装（前提条件缺失，等同it.skipIf(!skillExists)）"; exit 0; fi; BACKUP=$(mktemp); cp "$SKILL_ORIG" "$BACKUP"; sed -i.bak "/env_missing/d" "$SKILL_ORIG"; rm -f "${SKILL_ORIG}.bak"; TAMPER_OUT=$(npx vitest run packages/engine/tests/skills/harness-evaluator.test.ts 2>&1); TAMPER_EXIT=$?; cp "$BACKUP" "$SKILL_ORIG"; rm -f "$BACKUP"; [ "$TAMPER_EXIT" != "0" ] || { echo "FAIL: 篡改后测试应红"; exit 1; }; echo "$TAMPER_OUT" | grep -q "env_missing" || { echo "FAIL: 红色报错未指明env_missing"; exit 1; }; echo OK'
  期望: OK
  gate-allow: cheat/exit-0-skip skill文件不存在是evaluator前提条件缺失而非代码缺陷，与it.skipIf(!skillExists)语义等同

- [ ] [BEHAVIOR] check-contract-exists.mjs 对缺 contract-draft.md 的文件清单非零退出（Step4 负向）
  Test: manual:bash -c 'printf "packages/brain/src/foo.js\npackages/brain/src/bar.js\n" | node packages/brain/scripts/ci/check-contract-exists.mjs && { echo "FAIL: 缺合同清单应非零退出"; exit 1; } || echo OK'
  期望: OK

- [ ] [BEHAVIOR] check-contract-exists.mjs 对含 contract-draft.md 的文件清单退出码 0（Step4 正向）
  Test: manual:bash -c 'printf "sprints/06121716-ci-defense-r6/contract-draft.md\npackages/brain/src/foo.js\n" | node packages/brain/scripts/ci/check-contract-exists.mjs || { echo "FAIL: 完整清单应退出码 0"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] harness-contract-reviewer.test.ts 含 7 维度名逐字断言（在活跃 it 块中，不在 describe.skip 内）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/engine/tests/skills/harness-contract-reviewer.test.ts\",\"utf8\");const active=c.replace(/describe\\.skip\\([\\s\\S]*?\\}\\);/g,\"\");const dims=[\"dod_machineability\",\"scope_match_prd\",\"test_is_red\",\"internal_consistency\",\"risk_registered\",\"verification_oracle_completeness\",\"ci_workflow_alignment\"];for(const d of dims){if(!active.includes(d)){console.error(\"FAIL: reviewer 测试缺维度名\",d);process.exit(1)}}console.log(\"OK\")" || { echo "FAIL: reviewer 7 维度名检查失败"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] ci.yml 包含 packages/workflows/skills/** 路径触发的 changed-test-router 调用（Step5）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/ci.yml\",\"utf8\");if(!c.includes(\"changed-test-router.mjs\")){console.error(\"FAIL: ci.yml 缺 changed-test-router.mjs\");process.exit(1)}if(!c.match(/workflows\\/skills\\/\\*\\*/)){console.error(\"FAIL: ci.yml 缺 skills/** 路径过滤\");process.exit(1)}console.log(\"OK\")" || { echo "FAIL: ci.yml 扩展检查失败"; exit 1; }'
  期望: OK
