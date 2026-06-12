---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Brain↔Notion 属性映射修复（R2 重发）

**范围**: routes/notes.js + notion-push-sync.js 三处属性名修复 + 新增 notion-property-map.js 统一剔除+warn 模块
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] 新文件 `packages/brain/src/notion-property-map.js` 存在且导出 `stripUnknownProperties` 函数和 `NOTION_PROPERTY_MAP` 对象
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/notion-property-map.js','utf8'); if(!c.includes('stripUnknownProperties') || !c.includes('NOTION_PROPERTY_MAP')) process.exit(1); console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/routes/notes.js` /notes 路由不含旧属性 `Initiative ID`（精确路由体提取）
  Test: node -e "const src=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8'); const s=src.indexOf(\"router.post('/notes'\"); if(s<0){console.error('FAIL: /notes 路由未找到');process.exit(1);} const e=src.indexOf('\nrouter.',s+1); const body=src.slice(s,e>0?e:undefined); if(body.includes(\"'Initiative ID'\")){console.error('FAIL: Initiative ID 仍在 /notes 路由');process.exit(1);} console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/routes/notes.js` /notion/task 路由使用 `Name` 属性（Tasks DB 真实 title 属性名），不含旧 `Title:`
  Test: node -e "const src=require('fs').readFileSync('packages/brain/src/routes/notes.js','utf8'); const s=src.indexOf(\"router.post('/notion/task'\"); if(s<0){console.error('FAIL');process.exit(1);} const e1=src.indexOf('\nrouter.',s+1); const e2=src.indexOf('\nexport ',s+1); const end=e1>0?e1:(e2>0?e2:undefined); const body=src.slice(s,end); if(/\\bTitle\\s*:\\s*\\{/.test(body)){console.error('FAIL: 仍含 Title:');process.exit(1);} if(!/\\bName\\s*:\\s*\\{/.test(body)){console.error('FAIL: 缺 Name:');process.exit(1);} console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/notion-push-sync.js` `pushJourneyStepLinks` 函数体不含旧 `Order:` 属性
  Test: node -e "const src=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8'); const s=src.indexOf('async function pushJourneyStepLinks'); if(s<0){console.error('FAIL: 函数未找到');process.exit(1);} const e=src.indexOf('\nasync function ',s+1); const body=src.slice(s,e>0?e:undefined); if(/\\bOrder\\s*:\\s*\\{/.test(body)){console.error('FAIL: 仍含 Order:');process.exit(1);} console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash，≥4 类场景）

- [ ] [BEHAVIOR] POST /api/brain/notes（带 initiative_id）→ 201 + warnings array 非空（Initiative ID 剔除后留痕，warnings 必须 ≥1 条）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"title\":\"dod-notes-warnings\",\"content\":\"body\",\"type\":\"Note\",\"initiative_id\":\"cf4f596c-fa2b-48f2-ba7b-9969557c85a4\"}") || { echo "FAIL: POST /api/brain/notes 非 2xx"; exit 1; }; echo "$RESP" | jq -e ".id | type == \"string\"" || { echo "FAIL: id 缺失"; exit 1; }; echo "$RESP" | jq -e ".warnings | type == \"array\"" || { echo "FAIL: warnings 缺失"; exit 1; }; echo "$RESP" | jq -e ".warnings | length >= 1" || { echo "FAIL: warnings 应非空（Initiative ID 剔除后应有留痕）"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notes 响应 schema 完整性：顶层 keys 必须完全等于 ["id","title","url","warnings"]，不多不少
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"title\":\"dod-schema\",\"content\":\"body\",\"type\":\"Note\"}") || exit 1; echo "$RESP" | jq -e "keys | sort == [\"id\",\"title\",\"url\",\"warnings\"]" || { echo "FAIL: schema keys 不符，实际=$(echo "$RESP" | jq -c keys)，期望 [id,title,url,warnings]"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] POST /api/brain/notion/task → 201 + id/url/title/warnings（Name 属性修复后无 502，含完整 schema 验证）
  Test: manual:bash -c 'RESP=$(curl -sf -X POST localhost:5221/api/brain/notion/task -H "Content-Type: application/json" -d "{\"title\":\"dod-task-name\",\"ws_number\":1}") || { echo "FAIL: POST /api/brain/notion/task 非 2xx"; exit 1; }; echo "$RESP" | jq -e ".id | type == \"string\"" || { echo "FAIL: task.id 缺失"; exit 1; }; echo "$RESP" | jq -e ".url | type == \"string\"" || { echo "FAIL: task.url 缺失（Notion 页面 URL 未返回）"; exit 1; }; echo "$RESP" | jq -e ".title | startswith(\"[WS1]\")" || { echo "FAIL: task.title 缺 [WS1] 前缀（ws_number=1 未正确写入）"; exit 1; }; echo "$RESP" | jq -e "keys | sort == [\"id\",\"title\",\"url\",\"warnings\"]" || { echo "FAIL: notion/task schema keys 不符，实际=$(echo "$RESP" | jq -c keys)"; exit 1; }; echo "$RESP" | jq -e ".warnings | type == \"array\"" || { echo "FAIL: task.warnings 缺失"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 源码精确断言：三处旧属性全移除（node 函数体提取，避免注释误匹配）
  Test: manual:bash -c 'node -e "
const src1=require(\"fs\").readFileSync(\"packages/brain/src/notion-push-sync.js\",\"utf8\");
const s1=src1.indexOf(\"async function pushJourneyStepLinks\");
if(s1<0){console.error(\"FAIL: pushJourneyStepLinks 函数未找到\");process.exit(1);}
const e1=src1.indexOf(\"\nasync function \",s1+1);
const body1=src1.slice(s1,e1>0?e1:undefined);
if(/\\bOrder\\s*:\\s*\\{/.test(body1)){console.error(\"FAIL: pushJourneyStepLinks 仍含 Order:\");process.exit(1);}
const src2=require(\"fs\").readFileSync(\"packages/brain/src/routes/notes.js\",\"utf8\");
const s2=src2.indexOf(\"router.post(\x27/notes\x27\");
const e2=src2.indexOf(\"\nrouter.\",s2+1);
const body2=src2.slice(s2,e2>0?e2:undefined);
if(body2.includes(\"'\''Initiative ID'\''\"))  {console.error(\"FAIL: /notes 仍含 Initiative ID\");process.exit(1);}
const s3=src2.indexOf(\"router.post(\x27/notion/task\x27\");
const e3a=src2.indexOf(\"\nrouter.\",s3+1);
const e3b=src2.indexOf(\"\nexport \",s3+1);
const body3=src2.slice(s3,e3a>0?e3a:(e3b>0?e3b:undefined));
if(/\\bTitle\\s*:\\s*\\{/.test(body3)){console.error(\"FAIL: /notion/task 仍含 Title:\");process.exit(1);}
if(!/\\bName\\s*:\\s*\\{/.test(body3)){console.error(\"FAIL: /notion/task 缺 Name:\");process.exit(1);}
console.log(\"ALL_OK: 三处旧属性全移除\");
"'
  期望: ALL_OK: 三处旧属性全移除

- [ ] [BEHAVIOR] notion-property-map.js 导出 stripUnknownProperties 函数语义正确（已知属性保留，未知属性剔除并写入 warnings）
  Test: manual:bash -c 'node --input-type=module << '"'"'JSEOF'"'"'
import { stripUnknownProperties } from "./packages/brain/src/notion-property-map.js";
if (typeof stripUnknownProperties !== "function") { console.error("FAIL: not a function"); process.exit(1); }
const { props, warnings } = stripUnknownProperties({ Title: { title: [] }, FakeField: { rich_text: [] } }, ["Title"]);
if (!props.Title) { console.error("FAIL: 已知属性 Title 被误删"); process.exit(1); }
if (props.FakeField) { console.error("FAIL: 未知属性 FakeField 未被剔除"); process.exit(1); }
if (!warnings || !warnings.some(w => w.includes("FakeField"))) { console.error("FAIL: warnings 未记录 FakeField"); process.exit(1); }
console.log("OK");
JSEOF'
  期望: OK

- [ ] [BEHAVIOR] error path — POST /api/brain/notes 缺 title 返 400 + error 字段
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"content\":\"body\"}"); [ "$CODE" = "400" ] || { echo "FAIL: expected 400 got $CODE"; exit 1; }; BODY=$(curl -s -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"content\":\"body\"}" 2>/dev/null); echo "${BODY:-{}}" | jq -e ".error | type == \"string\"" || { echo "FAIL: error field missing"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — POST /api/brain/notion/task 缺 title 返 400
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST localhost:5221/api/brain/notion/task -H "Content-Type: application/json" -d "{}"); [ "$CODE" = "400" ] || { echo "FAIL: expected 400 got $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Brain DB notes 表在 5 分钟内有 initiative_id 对应记录（initiative_id 仍存 Brain DB，不因剔除 Notion 属性而丢失）
  Test: manual:bash -c 'curl -sf -X POST localhost:5221/api/brain/notes -H "Content-Type: application/json" -d "{\"title\":\"dod-db-init\",\"content\":\"body\",\"type\":\"Note\",\"initiative_id\":\"cf4f596c-fa2b-48f2-ba7b-9969557c85a4\"}" >/dev/null; COUNT=$(psql "${DB:-postgresql://localhost/cecelia}" -t -c "SELECT count(*) FROM notes WHERE initiative_id='"'"'cf4f596c-fa2b-48f2-ba7b-9969557c85a4'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d '"'"' '"'"'); [ "${COUNT:-0}" -ge 1 ] || { echo "FAIL: Brain DB 无 initiative_id 记录"; exit 1; }; echo OK'
  期望: OK

---

## Risks

| # | 风险描述 | Mitigation（已写入合同验证） |
|---|---|---|
| R1 | **Notion API 网络超时**：Brain 调 Notion API 超时时，若未捕获则级联返回 Brain 500，导致调用方重试并产生脏页面 | Generator 必须在 notion 调用处加 try-catch，统一 catch → HTTP 502 + `{"error": "Notion API timeout"}` 响应；合同 error path BEHAVIOR 验证 Notion API 失败 → 502 |
| R2 | **Notion schema 再次变更**：若 Notion 侧再次重构属性名，三处硬编码无法一处改通 | Generator 必须将属性名清单集中到 `notion-property-map.js` 的 `NOTION_PROPERTY_MAP` 常量，所有 route 调 `stripUnknownProperties`，下次 schema 变更只需改一个文件；合同 ARTIFACT 条目验证单一映射文件存在 |
| R3 | **grep 误匹配注释**：若源码中注释含 `Order:` 或 `Title:` 等旧属性名字符串，简单 grep 会产生假负（false negative），误判修复未完成 | Round 3 改用 node 函数体提取 + 正则 `/\bOrder\s*:\s*\{/` 精确匹配，注释中的 `Order:` 文字不会触发 FAIL |
