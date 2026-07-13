# Contract: relay-smoke-v2.2.0

## 目标

新增 `GET /api/brain/relay-smoke` 端点，返回 `{"ok":true,"controller":"2.2.0"}`。

该端点用于 relay harness 冒烟验证，确认 Brain 已部署并可正常响应，无需鉴权，无 DB 查询，纯内存返回。

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|----|-----------|--------------|------------|
| WS1 | `tests/relay-smoke.contract.test.js` | should return 200 OK / should have ok:true in response / should have controller 2.2.0 / should respond with JSON / should not break existing routes | 路由未实现时 supertest 返回 404 |

## E2E 验收

### 自动化验证

```bash
# 启动 Brain 后执行：
curl -s http://localhost:5221/api/brain/relay-smoke | jq -e '.ok==true and .controller=="2.2.0"'
# 期望：exit code 0
```

### 现有路由回归

```bash
curl -s http://localhost:5221/api/brain/context | jq -e '. != null'
# 期望：true
```

## 实现约束

- 仅在 `packages/brain/src/routes/walking-skeleton.js` 追加路由，不修改任何现有代码
- 无 DB 查询，纯内存返回
- 响应时间 < 100ms
- 无鉴权要求（公开端点，仅供内部冒烟）
