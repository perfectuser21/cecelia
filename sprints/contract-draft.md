# Sprint Contract Draft (Round 2)

## Golden Path

[外部调用方] → [GET /api/brain/version] → [Brain handler 读 package.json + selfcheck.js] → [返回 HTTP 200 `{"version":"<semver>","schema_version":"<str>"}`]

---

### Step 1: 调用方发送 GET /api/brain/version

**可观测行为**: Brain 接收请求，无需任何认证或参数，立即返回 HTTP 200。

**验证命令**:
```bash
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/version)
[ "$HTTP_CODE" = "200" ] || { echo "FAIL: HTTP $HTTP_CODE (期望 200)"; exit 1; }
echo "✅ Step 1: HTTP 200 通过"
```

**硬阈值**: HTTP 200，响应时间 < 1s

---

### Step 2: Brain 读取 package.json version 与 EXPECTED_SCHEMA_VERSION，返回实际值

**可观测行为**: 响应 body 含 `version`（semver string，值与 packages/brain/package.json 一致）和 `schema_version`（string，值与 selfcheck.js `EXPECTED_SCHEMA_VERSION` 一致）。

**验证命令**:
```bash
RESP=$(curl -sf localhost:5221/api/brain/version)

# 字段类型检查
echo "$RESP" | jq -e '.version | type == "string"' || { echo "FAIL: version 不是 string"; exit 1; }
echo "$RESP" | jq -e '.schema_version | type == "string"' || { echo "FAIL: schema_version 不是 string"; exit 1; }

# 值来源 oracle — version 必须与 package.json 实际值一致（防止 generator 硬编码）
EXPECTED_VERSION=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('packages/brain/package.json','utf8')).version)")
echo "$RESP" | jq -e ".version == \"$EXPECTED_VERSION\"" \
  || { echo "FAIL: version 与 package.json 不一致（expected=$EXPECTED_VERSION）"; exit 1; }

# 值来源 oracle — schema_version 必须与 selfcheck.js EXPECTED_SCHEMA_VERSION 一致
EXPECTED_SCHEMA=$(sed -n "s/.*EXPECTED_SCHEMA_VERSION = '\([^']*\)'.*/\1/p" packages/brain/src/selfcheck.js)
echo "$RESP" | jq -e ".schema_version == \"$EXPECTED_SCHEMA\"" \
  || { echo "FAIL: schema_version 与 selfcheck.js 不一致（expected=$EXPECTED_SCHEMA）"; exit 1; }

# semver 格式检查
echo "$RESP" | jq -r '.version' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || { echo "FAIL: version 不是 semver 格式 x.y.z"; exit 1; }

echo "✅ Step 2: 字段类型 + 值 oracle + semver 格式通过"
```

**硬阈值**: 两字段存在，类型 string，值与静态源一致，version 符合 semver x.y.z

---

### Step 3: 响应 schema 完整，无禁用字段名

**可观测行为**: 顶层 keys 完全等于 `["schema_version","version"]`（jq 字母排序），7 个禁用字段名均不出现。

**验证命令**:
```bash
RESP=$(curl -sf localhost:5221/api/brain/version)

echo "$RESP" | jq -e 'keys == ["schema_version","version"]' \
  || { echo "FAIL: keys 不完全等于 [schema_version,version]"; exit 1; }

for BANNED in ver v pkg_version db_version build tag release; do
  echo "$RESP" | jq -e "has(\"$BANNED\") | not" \
    || { echo "FAIL: 禁用字段 $BANNED 出现在响应中"; exit 1; }
done

echo "✅ Step 3: Schema 完整性 + 禁用字段检查通过"
```

**硬阈值**: keys 完全等于 `["schema_version","version"]`，7 个禁用字段均不存在

---

### Step 4: 多余 query 参数被忽略，不影响正常响应

**可观测行为**: GET /api/brain/version?foo=bar&baz=qux 仍返回 HTTP 200，body 与无参数版本相同。PRD 规定"多余参数忽略，不报错"。

**验证命令**:
```bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/version?foo=bar&baz=qux")
[ "$CODE" = "200" ] || { echo "FAIL: 多余 query 参数未被忽略，期望 200 得 $CODE"; exit 1; }
echo "✅ Step 4: 多余 query 参数忽略通过"
```

**硬阈值**: HTTP 200（多余参数不报错）

---

## E2E 验收（final-e2e — target_environment: local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

# 确认 Brain 运行
curl -sf localhost:5221/api/brain/status > /dev/null \
  || { echo "FAIL: Brain 未运行在 localhost:5221"; exit 1; }

RESP=$(curl -sf localhost:5221/api/brain/version)
[ -n "$RESP" ] || { echo "FAIL: 空响应"; exit 1; }

# 1. 字段类型
echo "$RESP" | jq -e '.version | type == "string"' \
  || { echo "FAIL: version 不是 string"; exit 1; }
echo "$RESP" | jq -e '.schema_version | type == "string"' \
  || { echo "FAIL: schema_version 不是 string"; exit 1; }

# 2. 值来源 oracle — 防止 generator 硬编码任意 semver 通过类型检查
EXPECTED_VERSION=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('packages/brain/package.json','utf8')).version)")
echo "$RESP" | jq -e ".version == \"$EXPECTED_VERSION\"" \
  || { echo "FAIL: version=$( echo "$RESP" | jq -r .version) 与 package.json 不一致（expected=$EXPECTED_VERSION）"; exit 1; }

EXPECTED_SCHEMA=$(sed -n "s/.*EXPECTED_SCHEMA_VERSION = '\([^']*\)'.*/\1/p" packages/brain/src/selfcheck.js)
echo "$RESP" | jq -e ".schema_version == \"$EXPECTED_SCHEMA\"" \
  || { echo "FAIL: schema_version 与 selfcheck.js 不一致（expected=$EXPECTED_SCHEMA）"; exit 1; }

# 3. semver 格式（x.y.z）
echo "$RESP" | jq -r '.version' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || { echo "FAIL: version 不是 semver 格式"; exit 1; }

# 4. Schema 完整性（keys 完全匹配）
echo "$RESP" | jq -e 'keys == ["schema_version","version"]' \
  || { echo "FAIL: keys 不完全等于 [schema_version,version]"; exit 1; }

# 5. 禁用字段反向检查
for BANNED in ver v pkg_version db_version build tag release; do
  echo "$RESP" | jq -e "has(\"$BANNED\") | not" \
    || { echo "FAIL: 禁用字段 $BANNED 出现在响应中"; exit 1; }
done

# 6. 多余 query 参数被忽略
CODE_WITH_PARAMS=$(curl -s -o /dev/null -w "%{http_code}" "localhost:5221/api/brain/version?foo=bar")
[ "$CODE_WITH_PARAMS" = "200" ] || { echo "FAIL: 多余 query 参数导致非 200 响应"; exit 1; }

echo "✅ Golden Path 全程验证通过"
echo "   version=$(echo $RESP | jq -r .version)"
echo "   schema_version=$(echo $RESP | jq -r .schema_version)"
```

**通过标准**: 脚本 exit 0

---

## Risks

| # | 风险 | 影响 | 缓解措施 |
|---|---|---|---|
| R1 | `EXPECTED_SCHEMA_VERSION` 在 selfcheck.js 中未 export（仅为内部常量）→ 路由 `import` 失败，端点注册时抛 SyntaxError，Brain 启动报错 | High：Brain 无法启动 | ARTIFACT 条目强制验证 selfcheck.js 含 `export const EXPECTED_SCHEMA_VERSION`；selfcheck.js 当前已 export（见 `export const EXPECTED_SCHEMA_VERSION = '279'`），BEHAVIOR 7 通过 schema_version 值 oracle 确认值已正确传递 |
| R2 | package.json 路径解析问题：路由 handler 内 `readFileSync` 相对路径与工作目录不一致 → 每次请求 ENOENT，端点恒返 500 | Medium：功能不可用 | 合同要求使用 `new URL('../../package.json', import.meta.url)` 方式（同模块顶层已有的 `pkg` 加载方式），BEHAVIOR 1（HTTP 200）+ BEHAVIOR 7（值 oracle）双重验证路径解析正确 |

---

## Workstreams

workstream_count: 1

### Workstream 1: 新增 GET /api/brain/version 路由

**范围**: 在 `packages/brain/src/routes/status.js` 新增 GET /version 路由。路由 handler 内部使用独立 `try-catch` + `fs.readFileSync`（不使用模块顶层 `pkg` 缓存变量）读取 package.json version，从 selfcheck.js import `EXPECTED_SCHEMA_VERSION`，返回固定 2 字段 JSON。package.json 不可读时返回 HTTP 500 + `{"error":"version read failed"}`。
**大小**: S（净增 ~25 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/version-endpoint.test.ts`

---

## Workstreams 切分确认

整 contract 净增 < 100 行（仅新增 ~25 行路由代码）→ `workstream_count=1` 合规 ✓

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/version-endpoint.test.ts` | HTTP 200、version 类型、schema_version 类型、keys 完整性、禁用字段缺席、值 oracle（与 package.json 一致）、semver 格式、error path 500、多余 query 参数忽略 | 端点未实现 → fetch 返 404 → ≥ 6 failures |
