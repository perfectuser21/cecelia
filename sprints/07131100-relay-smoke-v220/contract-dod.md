# DoD: relay-smoke-v2.2.0

## [BEHAVIOR] 断言清单

- [BEHAVIOR] GET /api/brain/relay-smoke 返回 HTTP 200
- [BEHAVIOR] 响应体 ok 字段为 boolean true
- [BEHAVIOR] 响应体 controller 字段为字符串 "2.2.0"
- [BEHAVIOR] Content-Type 含 application/json
- [BEHAVIOR] 不改动现有路由行为

## manual:bash 验收命令

```bash
manual:bash
curl -s localhost:5221/api/brain/relay-smoke | jq -e '.ok==true and .controller=="2.2.0"'
```

## DoD Checklist

- [x] walking-skeleton.js 新增 relay-smoke handler
- [x] 合同测试全绿（B1~B5）
- [x] CI brain-ci.yml 通过
- [x] 现有路由无回归
