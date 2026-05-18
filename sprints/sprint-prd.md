# Sprint PRD — Brain Version Endpoint

## OKR 对齐

- **对应 KR**：KR（系统可观测性 / 运维健康）
- **当前进度**：N/A（Brain API 上下文不可达，本地推断）
- **本次推进预期**：新增 1 个可机检版本查询端点，提升系统可观测性

## 背景

外部工具（evaluator、dashboard、CI 脚本）需要查询当前运行 Brain 的版本号与 schema 版本，
目前只能解析 package.json 或调用 /api/brain/status（返回字段噪音多）。
新增 GET /api/brain/version 端点，提供轻量、字段固定、可机检的版本信息接口。

## Golden Path（核心场景）

外部调用方从 [GET /api/brain/version] → 经过 [Brain 读取 package.json version + EXPECTED_SCHEMA_VERSION] → 到达 [返回 JSON 含 version 和 schema_version]

具体：
1. 调用方发送 `GET /api/brain/version`，无需任何参数
2. Brain 从 package.json 读取 `version` 字段，从 selfcheck.js 读取 `EXPECTED_SCHEMA_VERSION`
3. 返回 HTTP 200，body 为 `{"version":"<semver>","schema_version":"<str>"}`

## Response Schema

### Endpoint: GET /api/brain/version

**Query Parameters**: 无

**Success (HTTP 200)**:
```json
{"version": "1.230.10", "schema_version": "279"}
```
- `version` (string, 必填): semver 格式，来自 packages/brain/package.json `.version`
- `schema_version` (string, 必填): 来自 `EXPECTED_SCHEMA_VERSION` 常量，字符串形式
- **禁用响应字段名**: `ver`/`v`/`pkg_version`/`db_version`/`build`/`tag`/`release`
- **Schema 完整性**: 顶层 keys 必须完全等于 `["version", "schema_version"]`，不允许多余字段

**Error**: 此端点为纯只读常量读取，不预期 4xx/5xx；若出现则返回标准 `{"error":"<string>"}`

## 边界情况

- package.json 不可读：返回 HTTP 500，`{"error":"version read failed"}`
- 不接受任何 query 参数（多余参数忽略，不报错）

## 范围限定

**在范围内**：GET /api/brain/version 端点实现（只读，无 DB 查询）
**不在范围内**：POST/PUT/DELETE、版本比较逻辑、自动更新触发、/status 端点改造

## 假设

- [ASSUMPTION: EXPECTED_SCHEMA_VERSION 常量从 selfcheck.js 导入]
- [ASSUMPTION: 端点注册在现有 status router 或 brain-meta router 下]

## 预期受影响文件

- `packages/brain/src/routes/status.js`: 新增 GET /version 路由
- `packages/brain/src/selfcheck.js`: 导出 EXPECTED_SCHEMA_VERSION（若当前未 export）

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 内部路由，无 UI / 无外部 agent 协议
## target_environment: local_api
## target_environment_reason: 纯 Brain 内部端点，evaluator 在本地 curl localhost:5221/api/brain/version 验证
