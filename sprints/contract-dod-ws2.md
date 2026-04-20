# Contract DoD — Workstream 2: 响应 Schema 契约 + Brain API 文档补充

**范围**: 新建 `packages/brain/src/contracts/time-response.schema.json`，在 `docs/current/README.md` 补充 `/api/brain/time` 端点说明
**大小**: S
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/contracts/time-response.schema.json` 文件存在且为合法 JSON
  Test: node -e "const fs=require('fs'),p='packages/brain/src/contracts/time-response.schema.json';if(!fs.existsSync(p))process.exit(1);try{JSON.parse(fs.readFileSync(p,'utf8'))}catch(e){process.exit(2)}"

- [ ] [ARTIFACT] Schema 声明 `type` 为 `object`
  Test: node -e "const s=JSON.parse(require('fs').readFileSync('packages/brain/src/contracts/time-response.schema.json','utf8'));if(s.type!=='object')process.exit(1)"

- [ ] [ARTIFACT] Schema `required` 字段恰好含 `iso` / `timezone` / `unix` 三项（顺序不论，不多不少）
  Test: node -e "const s=JSON.parse(require('fs').readFileSync('packages/brain/src/contracts/time-response.schema.json','utf8'));const r=(s.required||[]).slice().sort();if(JSON.stringify(r)!==JSON.stringify(['iso','timezone','unix']))process.exit(1)"

- [ ] [ARTIFACT] Schema `properties.iso.type === 'string'`
  Test: node -e "const s=JSON.parse(require('fs').readFileSync('packages/brain/src/contracts/time-response.schema.json','utf8'));if(!s.properties||s.properties.iso?.type!=='string')process.exit(1)"

- [ ] [ARTIFACT] Schema `properties.timezone.type === 'string'`
  Test: node -e "const s=JSON.parse(require('fs').readFileSync('packages/brain/src/contracts/time-response.schema.json','utf8'));if(!s.properties||s.properties.timezone?.type!=='string')process.exit(1)"

- [ ] [ARTIFACT] Schema `properties.unix.type === 'integer'`
  Test: node -e "const s=JSON.parse(require('fs').readFileSync('packages/brain/src/contracts/time-response.schema.json','utf8'));if(!s.properties||s.properties.unix?.type!=='integer')process.exit(1)"

- [ ] [ARTIFACT] Schema 显式禁止多余字段（`additionalProperties === false`）
  Test: node -e "const s=JSON.parse(require('fs').readFileSync('packages/brain/src/contracts/time-response.schema.json','utf8'));if(s.additionalProperties!==false)process.exit(1)"

- [ ] [ARTIFACT] `docs/current/README.md` 含 `/api/brain/time` 字面量
  Test: node -e "const c=require('fs').readFileSync('docs/current/README.md','utf8');if(!c.includes('/api/brain/time'))process.exit(1)"

- [ ] [ARTIFACT] `docs/current/README.md` 同时提及 `iso` / `timezone` / `unix` 三个字段名
  Test: node -e "const c=require('fs').readFileSync('docs/current/README.md','utf8');if(!c.includes('iso')||!c.includes('timezone')||!c.includes('unix'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 `sprints/tests/ws2/`）

见 `sprints/tests/ws2/schema-doc.test.ts`，覆盖：

- schema file is valid JSON with object type and additionalProperties false
- schema requires exactly iso, timezone, unix
- schema declares correct field types (string/string/integer)
- README documents /api/brain/time endpoint with all three fields
