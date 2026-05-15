# Sprint PRD — Echo API（GET /echo 端点）

## OKR 对齐

- **对应 KR**：N/A（Brain API 不可达，跳过 OKR 关联）
- **当前进度**：N/A
- **本次推进预期**：playground 新增 /echo 端点

## 背景

在已有 playground 服务（`playground/server.js`）中新增 GET /echo 端点，验证最简回显场景。无外部依赖，纯本地。

## Golden Path（核心场景）

调用方从 [GET /echo?msg=hello] → 经过 [服务读取 msg 参数原样回显] → 到达 [HTTP 200 + {echo: "hello"}]

具体：
1. 客户端向 `localhost:3099/echo?msg=hello` 发起 GET 请求
2. 服务读取 query param `msg`，原样回显
3. 返回 HTTP 200 + `{"echo": "hello"}`
4. 当 `msg=`（空字符串）时，返回 `{"echo": ""}`

## Response Schema

### Endpoint: GET /echo

**Query Parameters**:
- `msg` (string, 必填): 待回显的文本，允许空字符串
- **禁用 query 名**: `text`, `input`, `message`, `q`, `str`, `value`, `content`, `m`
- **强约束**: 传入 `msg` 参数，服务必须字面回显其值（包括空字符串）

**Success (HTTP 200)**:
```json
{"echo": "hello"}
```
- `echo` (string, 必填): 与 `msg` 参数值完全相同（包括空字符串 `""`）
- **禁用 key 名**: `message`, `result`, `response`, `data`, `output`, `text`, `reply`, `body`, `msg`

**Schema 完整性**: response 顶层 keys 必须**完全等于** `["echo"]`，不允许多余字段

## 边界情况

- `msg=`（空字符串）→ `{"echo": ""}` ，非 null、非 undefined
- `msg` 参数缺失 → 本 sprint 不做强制约束（见假设）

## 范围限定

**在范围内**：
- `playground/server.js` 新增 `GET /echo` 端点
- 服务端口 3099
- vitest 单元测试（msg=hello 和 msg= 两个 case）

**不在范围内**：
- 修改现有端点（/sum / /multiply 等）
- 身份验证、持久化存储
- 连接 Brain API 或数据库

## 假设

- [ASSUMPTION: 端口 3099 通过 `PLAYGROUND_PORT=3099` 或修改默认值实现]
- [ASSUMPTION: 缺少 msg 参数时行为不做测试]
- [ASSUMPTION: 现有 playground/package.json 已含 express + vitest 依赖，无需新增]

## 预期受影响文件

- `playground/server.js`: 新增 GET /echo 路由
- `playground/tests/echo.test.js`（或同目录 `*.test.ts`）: vitest 单元测试

## journey_type: autonomous
## journey_type_reason: 纯后端 playground 服务，无 UI 交互，无 Brain/engine/dashboard 依赖
