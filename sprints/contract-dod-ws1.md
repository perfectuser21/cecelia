---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 1: GET /api/brain/version 路由

**范围**: 在 `packages/brain/src/routes/status.js` 新增 GET /version 路由，handler 内部独立 readFileSync + try-catch，返回 `{version, schema_version}`
**大小**: S（净增 ~25 行）
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/routes/status.js` 包含 `/version` 路由注册
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.includes('/version'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `/version` 路由使用 `EXPECTED_SCHEMA_VERSION` 来自 selfcheck.js 导入
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.includes('EXPECTED_SCHEMA_VERSION'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `selfcheck.js` 含 `export const EXPECTED_SCHEMA_VERSION`（风险 R1 验证）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/selfcheck.js','utf8');if(!c.includes('export const EXPECTED_SCHEMA_VERSION'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `/version` 路由 handler 包含 try-catch + HTTP 500（支持 error path）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/status.js','utf8');if(!c.match(/try\s*\{/)||!c.match(/500/))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /api/brain/version 返回 HTTP 200，`version` 字段类型为 string
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/version); echo "$RESP" | jq -e '"'"'.version | type == "string"'"'"' || { echo "FAIL: version 不是 string"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/brain/version 返回 `schema_version` 字段类型为 string
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/version); echo "$RESP" | jq -e '"'"'.schema_version | type == "string"'"'"' || { echo "FAIL: schema_version 不是 string"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 响应 keys 完全等于 `["schema_version","version"]`，不多不少
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/version); echo "$RESP" | jq -e '"'"'keys == ["schema_version","version"]'"'"' || { echo "FAIL: keys schema drift"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段 `ver`/`v`/`pkg_version`/`db_version`/`build`/`tag`/`release` 均不出现在响应中
  Test: manual:bash -c 'RESP=$(curl -sf localhost:5221/api/brain/version); for BANNED in ver v pkg_version db_version build tag release; do echo "$RESP" | jq -e "has(\"$BANNED\") | not" || { echo "FAIL: 禁用字段 $BANNED 出现"; exit 1; }; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] package.json 不可读时 GET /api/brain/version 返回 HTTP 500，body 含 `error` 字段（string 类型）
  Test: manual:bash -c 'ORIG=$(stat -c "%a" packages/brain/package.json 2>/dev/null || echo 644); chmod 000 packages/brain/package.json; CODE=$(curl -s -o /tmp/ver-err.json -w "%{http_code}" localhost:5221/api/brain/version); chmod "$ORIG" packages/brain/package.json; [ "$CODE" = "500" ] || { echo "FAIL: error path 期望 HTTP 500，得 $CODE（路由须在 handler 内 readFileSync，不可用模块级缓存 pkg）"; exit 1; }; cat /tmp/ver-err.json | jq -e '"'"'.error | type == "string"'"'"' || { echo "FAIL: error body 缺 error 字段"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 多余 query 参数被忽略，GET /api/brain/version?foo=bar 仍返回 HTTP 200
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/version?foo=bar&baz=qux"); [ "$CODE" = "200" ] || { echo "FAIL: 多余 query 参数未被忽略，期望 200 得 $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `version` 值与 packages/brain/package.json 实际值一致（值来源 oracle，防止 generator 硬编码）
  Test: manual:bash -c 'EXPECTED=$(node -e "process.stdout.write(JSON.parse(require('"'"'fs'"'"').readFileSync('"'"'packages/brain/package.json'"'"','"'"'utf8'"'"')).version)"); RESP=$(curl -sf localhost:5221/api/brain/version); echo "$RESP" | jq -e ".version == \"$EXPECTED\"" || { echo "FAIL: version 与 package.json 不一致（expected=$EXPECTED）"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `version` 字段符合 semver 格式 x.y.z（数字点数字点数字）
  Test: manual:bash -c 'VER=$(curl -sf localhost:5221/api/brain/version | jq -r '"'"'.version'"'"'); echo "$VER" | grep -E '"'"'^[0-9]+\.[0-9]+\.[0-9]+$'"'"' || { echo "FAIL: version \"$VER\" 不是 semver x.y.z 格式"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] `schema_version` 值与 selfcheck.js `EXPECTED_SCHEMA_VERSION` 一致（值来源 oracle）
  Test: manual:bash -c 'EXPECTED=$(sed -n "s/.*EXPECTED_SCHEMA_VERSION = '"'"'\([^'"'"']*\)'"'"'.*/\1/p" packages/brain/src/selfcheck.js); RESP=$(curl -sf localhost:5221/api/brain/version); echo "$RESP" | jq -e ".schema_version == \"$EXPECTED\"" || { echo "FAIL: schema_version 与 selfcheck.js 不一致（expected=$EXPECTED）"; exit 1; }; echo OK'
  期望: OK
