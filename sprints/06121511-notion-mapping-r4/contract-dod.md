---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Brain↔Notion 属性映射修复（R4）

**范围**: notes.js Initiative ID 降级 + notion-task Title 属性校准 + notion-push-sync step_link Order 属性校准，三处共用 schema 查询 + 属性过滤机制
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/notes.js` 包含 schema 查询逻辑（不再硬编码 'Initiative ID'）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8');if(!c.includes('schema')||!c.includes('warnings'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/routes/notes.js` 响应 payload 包含 `warnings` 字段
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8');if(!c.includes('warnings'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/notion-push-sync.js` step_link 写入逻辑不再硬编码 `Order:` 字段（已改为动态 schema 过滤或正确属性名）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');const lines=c.split('\n');const orderLine=lines.find(l=>l.includes('Order:')&&l.includes('step_order')&&!l.includes('schema')&&!l.includes('//')&&!l.includes('filter'));if(orderLine){console.error('FAIL: 仍有硬编码 Order 字段:',orderLine);process.exit(1);}console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/__tests__/routes/notes-notion-task.test.js` 包含 Initiative ID 降级回归测试
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/routes/notes-notion-task.test.js','utf8');if(!c.includes('Initiative ID')||!c.includes('warnings'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/__tests__/notion-push-sync.test.js` 包含 step_link Order 降级回归测试
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/notion-push-sync.test.js','utf8');if(!c.includes('Order')||!c.includes('step_link'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type = autonomous）

- [ ] [BEHAVIOR] POST /api/brain/notes 带 initiative_id → 201 + id/url/title/warnings 字段存在且类型正确；禁用字段 warning/skipped/errors 不存在；keys 完整性（Initiative ID 降级，不再 502）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"title\":\"[contract-e2e] R4-dod-1\",\"content\":\"dod test\",\"type\":\"Note\",\"initiative_id\":\"r4-dod-test\"}"); echo "$RESP" | jq -e ".id | type == \"string\"" || { echo "FAIL: id缺失"; exit 1; }; echo "$RESP" | jq -e ".url | type == \"string\"" || { echo "FAIL: url缺失"; exit 1; }; echo "$RESP" | jq -e ".title | type == \"string\"" || { echo "FAIL: title缺失"; exit 1; }; echo "$RESP" | jq -e ".warnings | type == \"array\"" || { echo "FAIL: warnings字段缺失"; exit 1; }; echo "$RESP" | jq -e "has(\"warning\") | not" || { echo "FAIL: 禁用字段warning(单数)出现"; exit 1; }; echo "$RESP" | jq -e "has(\"skipped\") | not" || { echo "FAIL: 禁用字段skipped出现"; exit 1; }; echo "$RESP" | jq -e "has(\"errors\") | not" || { echo "FAIL: 禁用字段errors出现"; exit 1; }; echo "$RESP" | jq -e "[keys[]] | sort == [\"id\",\"title\",\"url\",\"warnings\"]" || { echo "FAIL: keys不符，期望[id,title,url,warnings]"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notes 带 initiative_id → warnings 数组包含 Initiative ID 被跳过的说明（降级有留痕，不静默丢弃）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"title\":\"[contract-e2e] R4-dod-2\",\"content\":\"dod warn\",\"initiative_id\":\"r4-dod-warn-test\"}"); echo "$RESP" | jq -e ".warnings | length >= 1" || { echo "FAIL: warnings 数组为空，Initiative ID 被静默丢弃"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notion/task → 201 + keys 完整性（[id,title,url] 三字段，无 warnings）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notion/task -H "Content-Type: application/json" -d "{\"title\":\"[contract-e2e] R4-dod-3-task\",\"ws_number\":1}"); echo "$RESP" | jq -e "[keys[]] | sort == [\"id\",\"title\",\"url\"]" || { echo "FAIL: keys不符，期望[id,title,url]"; exit 1; }; echo "$RESP" | jq -e "has(\"warnings\") | not" || { echo "FAIL: task路由不应有warnings字段"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notes 负向 — initiative_id 传入但 DB 无该属性 → 201（非 502）+ warnings 非空（全量降级不中断请求）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"title\":\"[contract-e2e] R4-dod-neg\",\"content\":\"neg\",\"initiative_id\":\"fake-neg-r4\"}"); [ "$CODE" = "201" ] || { echo "FAIL: 期望201,实际$CODE（502=Initiative ID降级未生效）"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — POST /api/brain/notes 缺少 title → 400 + error 字段存在
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"content\":\"no title\"}"); [ "$CODE" = "400" ] || { echo "FAIL: 期望400,实际$CODE"; exit 1; }; RESP=$(curl -s -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"content\":\"no title\"}"); echo "$RESP" | jq -e ".error | type == \"string\"" || { echo "FAIL: error 字段缺失或非 string"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — POST /api/brain/notion/task 缺少 title → 400
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notion/task -H "Content-Type: application/json" -d "{}"); [ "$CODE" = "400" ] || { echo "FAIL: 期望400,实际$CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] step_link Order 属性降级 — pushJourneyStepLinks 在 schema 无 Order 时不向 Notion 传递该字段（单测验证）
  Test: manual:bash -c 'cd /workspace && /workspace/node_modules/.bin/vitest run --root /workspace sprints/06121511-notion-mapping-r4/tests/step-link-order-degrade.test.ts --reporter=verbose 2>&1 | tee /tmp/r4-step-link.log; FAILS=$(grep -c " FAIL \|✗" /tmp/r4-step-link.log || true); [ "$FAILS" = "0" ] || { echo "FAIL: step_link 单测失败 FAIL数=$FAILS"; exit 1; }; echo OK'
  期望: OK

---

## dod-selftest 凭证（Round 3，proposer 容器内实跑）

> PRD 要求："proposer 必须在容器内实跑每条 Test 命令，合同附 dod-selftest 凭证"

### ARTIFACT 自测结果（实跑时间: 2026-06-12）

| # | Test 命令摘要 | 结果 | 期望 |
|---|---|---|---|
| ARTIFACT 1 | notes.js 含 schema + warnings 标识符 | ❌ FAIL（尚未实现） | FAIL = Red 正确 |
| ARTIFACT 2 | notes.js response payload 含 warnings 字段 | ❌ FAIL（尚未实现）| FAIL = Red 正确 |
| ARTIFACT 3 | notion-push-sync.js 无硬编码 Order 行 | ❌ FAIL（FAIL: 仍有硬编码 Order 字段: `Order: { number: l.step_order }`）| FAIL = Red 正确 |
| ARTIFACT 4 | notes-notion-task.test.js 含 Initiative ID + warnings | ❌ FAIL（现有测试文件未含新回归测试）| FAIL = Red 正确 |
| ARTIFACT 5 | notion-push-sync.test.js 含 Order + step_link 断言 | ❌ FAIL（现有测试文件未更新）| FAIL = Red 正确 |

### 单测 Red 证据（/workspace/node_modules/.bin/vitest run --root /workspace sprints/06121511-notion-mapping-r4/）

```
Test Files  3 failed (3)
      Tests  6 failed | 5 passed (11)

❌ notes-initiative-id-degrade.test.ts:73 — properties 含 'Initiative ID'（expected: not have property）
❌ notes-initiative-id-degrade.test.ts:88 — res.body.warnings undefined（expected: defined）
❌ notion-task-title-fix.test.ts:75 — properties 无 'Name'（expected: have property 'Name'）
❌ notion-task-title-fix.test.ts:112 — res.body 无 'id'（schema mock consumed by wrong call）
❌ step-link-order-degrade.test.ts:80 — properties 含 'Order: {number:3}'（expected: not have）
❌ step-link-order-degrade.test.ts:172 — UPDATE journey_step_links 被调用（expected: undefined）
```

**结论**: 所有 ARTIFACT FAIL、单测 6 FAIL ——正确 Red 状态，等待 Generator 实现修复。

### Round 3 修订说明

本轮针对 Contract Gate 硬红线：
1. **修复 weak-oracle/curl-no-jq（第 349 行）**：E2E teardown 循环的 `curl ... -o /dev/null || true` 改为状态码 oracle 模式（`ARCHIVE_CODE=$(curl -s -o /dev/null -w "%{http_code}" ...)` + `[ "$ARCHIVE_CODE" = "200" ] || echo "WARN..."`），符合 gate 惯用法速查表"状态码 oracle"规则。移除旧的 `gate-allow: cheat/or-true` 注释（新写法不再需要豁免）。
