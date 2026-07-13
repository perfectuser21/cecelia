# Contract DoD: relay-runs 阶段汇总端点

## Definition of Done

- [x] [BEHAVIOR] B-01: GET /api/brain/orchestrator/relay-runs/summary → HTTP 200，body.phases 含 planning/gan/generate/evaluate/done/failed 六个 key
- [x] [BEHAVIOR] B-02: DB 有数据时，phases 里对应 phase 的 count 正确反映实际记录数
- [x] [BEHAVIOR] B-03: body.total === sum(phases values)，total 是所有 phase 计数之和
- [x] [BEHAVIOR] B-04: DB 无 v2 数据时，phases 每个 key=0，total=0，HTTP 200
- [x] [BEHAVIOR] B-05: 无数据时不报错，返回 200 而非 404/500
- [x] [BEHAVIOR] B-06: GET /relay-runs/summary 不被 :initiative_id 通配路由拦截（路由顺序正确）
- [x] [BEHAVIOR] B-07: SQL WHERE 含 orchestrator_version = 'v2'（只统计 v2 runs）
- [x] [BEHAVIOR] B-08: DB 抛异常时 → HTTP 500，body 仅 { error: string }，不含 SQL/stack/表名

## 铁律验证

- [x] INV-路由顺序：summary 路由注册在 GET /relay-runs/:initiative_id 之前
- [x] INV-v2过滤：SQL 含 orchestrator_version='v2'
- [x] INV-无数据零值：六个 phase key 始终存在，无数据时为 0
- [x] INV-错误不泄露：500 响应不含内部 err.message
- [x] INV-既有兼容：七份既有 relay-runs 测试全绿，未被本次改动破坏

## 验收命令

```bash
# manual:bash 合同验收
cd /workspace

# 1. 跑单元测试（Red→Green 验证）
npx vitest run packages/brain/src/__tests__/relay-runs-summary.test.js

# 2. 跑全量 relay-runs 测试（既有不破坏）
npx vitest run \
  packages/brain/src/__tests__/relay-runs.test.js \
  packages/brain/src/__tests__/relay-runs-filter.test.js \
  packages/brain/src/__tests__/relay-runs-verdicts.test.js \
  packages/brain/src/__tests__/relay-v101.test.js \
  packages/brain/src/__tests__/relay-runs-since.test.js \
  packages/brain/src/__tests__/relay-runs-summary.test.js

# 3. E2E 验收（本地 Brain 跑起来后）
curl -s http://localhost:5221/api/brain/orchestrator/relay-runs/summary | python3 -c "
import sys,json
d=json.load(sys.stdin)
expected={'planning','gan','generate','evaluate','done','failed'}
assert set(d['phases'].keys())==expected
assert d['total']==sum(d['phases'].values())
print('E2E PASS')
"
```

## 范围限制
- 只改 packages/brain/src/routes/initiatives.js（一个文件，新增一个路由）
- 新增测试文件：packages/brain/src/__tests__/relay-runs-summary.test.js
- 不改现有测试文件
- 不改 schema/migrations
