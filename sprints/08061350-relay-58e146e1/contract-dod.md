---
skeleton: false
journey_type: internal_tooling
target_environment: local_api
task_id: 58e146e1-ff3a-4e4d-89de-17721a0ade6b
---
# Contract DoD — WS3: 成品呈报 + 裁决窄口回读

**范围**: `packages/brain/src/notion-inbox-push.js`（新建）+ `packages/brain/src/notion-verdict-ingest.js`（新建）+ `packages/brain/src/scheduler-jobs.js`（扩展 +2 jobs）+ 对应单测
**大小**: M（两个新模块 + 调度注册 + INV×6 单测覆盖）
**依赖**: WS1(#4661) WS2(#4671) 已 merge

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/notion-inbox-push.js` 文件存在
  Test: node -e "require('fs').accessSync('/workspace/packages/brain/src/notion-inbox-push.js');console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/notion-verdict-ingest.js` 文件存在
  Test: node -e "require('fs').accessSync('/workspace/packages/brain/src/notion-verdict-ingest.js');console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/__tests__/notion-inbox-push.test.js` 测试文件存在
  Test: node -e "require('fs').accessSync('/workspace/packages/brain/src/__tests__/notion-inbox-push.test.js');console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/__tests__/notion-verdict-ingest.test.js` 测试文件存在
  Test: node -e "require('fs').accessSync('/workspace/packages/brain/src/__tests__/notion-verdict-ingest.test.js');console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] `notion-inbox-push.js` 导出 `pushProductToNotionInbox` 函数，含幂等键前缀 `notion:product:` 和产物类型白名单（proposal/morning_summary/acceptance_receipt）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"/workspace/packages/brain/src/notion-inbox-push.js\",\"utf8\");if(!c.includes(\"pushProductToNotionInbox\")){console.error(\"FAIL: 函数不存在\");process.exit(1);}if(!c.includes(\"notion:product:\")){console.error(\"FAIL: 幂等键前缀缺失\");process.exit(1);}[\"proposal\",\"morning_summary\",\"acceptance_receipt\"].forEach(function(t){if(!c.includes(t)){console.error(\"FAIL: 产物类型白名单缺失: \"+t);process.exit(1);}});console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `notion-inbox-push.js` 推送成功后回写 Brain tasks.notion_page_id 字段（FR-1 接缝：DB 写入）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"/workspace/packages/brain/src/notion-inbox-push.js\",\"utf8\");if(!c.includes(\"notion_page_id\")){console.error(\"FAIL: notion_page_id 回写逻辑缺失\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `notion-verdict-ingest.js` 导出 `consumeVerdictFromNotion` 函数，含 `already_consumed` 幂等处理和 `not_configured` 凭据缺失处理（INV-4/INV-6）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"/workspace/packages/brain/src/notion-verdict-ingest.js\",\"utf8\");if(!c.includes(\"consumeVerdictFromNotion\")){console.error(\"FAIL: 函数不存在\");process.exit(1);}if(!c.includes(\"already_consumed\")){console.error(\"FAIL: 幂等锚点 already_consumed 缺失\");process.exit(1);}if(!c.includes(\"not_configured\")){console.error(\"FAIL: not_configured 凭据处理缺失\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `notion-verdict-ingest.js` 实现 fail-closed：非白名单字段/非 checkbox 类型返回 `{skipped:true}`（INV-1/INV-2 接缝断言）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"/workspace/packages/brain/src/notion-verdict-ingest.js\",\"utf8\");if(!c.includes(\"non_whitelist\")&&!c.includes(\"skipped\")&&!c.includes(\"非白名单\")){console.error(\"FAIL: fail-closed 逻辑缺失\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `notion-verdict-ingest.js` 放行=true 时调用 Brain PATCH tasks status=completed 且写 decisions 表（FR-2 放行流转接缝）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"/workspace/packages/brain/src/notion-verdict-ingest.js\",\"utf8\");if(!c.includes(\"completed\")){console.error(\"FAIL: status=completed 逻辑缺失\");process.exit(1);}if(!c.includes(\"decisions\")){console.error(\"FAIL: decisions 写库逻辑缺失\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `scheduler-jobs.js` JOBS 数组中注册 `notion-product-push` 和 `notion-verdict-ingest` 两个 job（FR-3 调度注册）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"/workspace/packages/brain/src/scheduler-jobs.js\",\"utf8\");if(!c.includes(\"notion-product-push\")){console.error(\"FAIL: notion-product-push job 未注册\");process.exit(1);}if(!c.includes(\"notion-verdict-ingest\")){console.error(\"FAIL: notion-verdict-ingest job 未注册\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

---

## BEHAVIOR: INV 铁律覆盖（≥ 6 条 INV 单测）

- [ ] [BEHAVIOR:INV] INV-1: 字段解析失败 = 不执行任何动作（fail-closed）
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/notion-verdict-ingest.test.js --reporter=verbose 2>&1 | grep -E "(INV-1|fail.closed|non_whitelist|PASS|FAIL)" | head -20'
  期望: PASS（含 INV-1 相关 test 通过）

- [ ] [BEHAVIOR:INV] INV-2: 散文/rich_text/paragraph 字段永不回读
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/notion-verdict-ingest.test.js --reporter=verbose 2>&1 | grep -E "(INV-2|rich_text|paragraph|散文|PASS|FAIL)" | head -20'
  期望: PASS（含 INV-2 相关 test 通过）

- [ ] [BEHAVIOR:INV] INV-3: 需拍板=true 且 放行=false 时不执行（review_required 守护）
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/notion-inbox-push.test.js packages/brain/src/__tests__/notion-verdict-ingest.test.js --reporter=verbose 2>&1 | grep -E "(INV-3|review_required|awaiting_approval|PASS|FAIL)" | head -20'
  期望: PASS（含 INV-3 相关 test 通过）

- [ ] [BEHAVIOR:INV] INV-4: 幂等锚点，重复消费返回 already_consumed
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/notion-verdict-ingest.test.js --reporter=verbose 2>&1 | grep -E "(INV-4|already_consumed|幂等|PASS|FAIL)" | head -20'
  期望: PASS（含 INV-4 相关 test 通过）

- [ ] [BEHAVIOR:INV] INV-6: 凭据缺失静默跳过
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/notion-inbox-push.test.js packages/brain/src/__tests__/notion-verdict-ingest.test.js --reporter=verbose 2>&1 | grep -E "(INV-6|not_configured|凭据|PASS|FAIL)" | head -20'
  期望: PASS（含 INV-6 相关 test 通过）

- [ ] [BEHAVIOR:INV] INV-5: scheduler job 间隔 ≤5min（推送成功→Brain流转时效）
  Test: manual:bash -c 'node -e "const fs=require(\"fs\");const c=fs.readFileSync(\"/workspace/packages/brain/src/scheduler-jobs.js\",\"utf8\");const m=c.match(/notion-product-push[\s\S]*?interval.*?(\d+)/);const ms=m?parseInt(m[1]):null;if(!ms||ms>300000){console.error(\"FAIL: 调度间隔超过5min或未找到\");process.exit(1);}console.log(\"OK: interval=\"+ms+\"ms\")"'
  期望: OK（interval ≤ 300000ms）

---

## BEHAVIOR:CI 条目（CI 绿才 done）

- [ ] [BEHAVIOR:CI] 新增两个测试文件加入 vitest 运行，全绿无 skip
  Test: manual:bash -c 'cd /workspace && npx vitest run packages/brain/src/__tests__/notion-inbox-push.test.js packages/brain/src/__tests__/notion-verdict-ingest.test.js 2>&1 | tail -10'
  期望: 所有 tests passed，exit 0
