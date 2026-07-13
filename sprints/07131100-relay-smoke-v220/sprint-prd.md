# Sprint PRD: relay-smoke-v2.2.0

## 目标

新增 GET /api/brain/relay-smoke 端点，返回 `{"ok":true,"controller":"2.2.0"}`。
用于 relay harness 冒烟验证，确认 Brain 已部署并可响应。

## Invariant 约束

1. 不改任何既有路由/中间件——仅新增，不修改现有端点行为
2. 现有 CI 全绿——brain-ci、engine-ci、workspace-ci 无新失败

## 累积 FR

| ID  | 描述 |
|-----|------|
| FR1 | GET /api/brain/relay-smoke → 200 + `{"ok":true,"controller":"2.2.0"}` |

## Golden Path

1. 用户执行 `curl localhost:5221/api/brain/relay-smoke`
2. 系统返回 HTTP 200
3. 响应体为 `{"ok":true,"controller":"2.2.0"}`

## NFR

- 响应时间 < 100ms（纯内存返回，无 DB 查询）
- 无鉴权要求（公开端点，仅供内部冒烟）

## 验收标准（E2E）

```bash
curl -s localhost:5221/api/brain/relay-smoke | jq -e '.ok==true'
# 预期输出: true，exit code 0

curl -s localhost:5221/api/brain/relay-smoke | jq -r '.controller'
# 预期输出: 2.2.0
```

- [ ] `curl -s localhost:5221/api/brain/relay-smoke | jq -e '.ok==true'` 返回 true
- [ ] CI 全绿（brain-ci.yml 通过）

---

journey_type: feature
target_environment: local
