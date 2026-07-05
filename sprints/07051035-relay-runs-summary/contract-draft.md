# Contract Draft: relay-runs 阶段汇总端点

**Sprint**: 07051035-relay-runs-summary
**Task ID**: d723bc13-b4b5-449a-922c-0172dcab7c62
**Date**: 2026-07-05
**Branch**: cp-07051128-ws-d723bc13

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 正常返回六个 phase 计数 | `../../packages/brain/src/__tests__/relay-runs-summary.test.js` | B-01/B-02/B-03 | 端点未实现 → 404 或 summary 被 :initiative_id 路由捕获 → FAIL |
| 无数据时全部为 0 | `../../packages/brain/src/__tests__/relay-runs-summary.test.js` | B-04/B-05 | 无数据时路由返回空对象或报错 → FAIL |
| 路由顺序（summary 在 :id 前） | `../../packages/brain/src/__tests__/relay-runs-summary.test.js` | B-06 | summary 路由注册在 :id 之后 → 被当 UUID 查询 → 500 |
| 只统计 v2 runs | `../../packages/brain/src/__tests__/relay-runs-summary.test.js` | B-07 | 无版本过滤 → 把 v1 runs 也计入 |
| 500 不暴露内部信息 | `../../packages/brain/src/__tests__/relay-runs-summary.test.js` | B-08 | 暴露 err.message → FAIL |

---

## [ARTIFACT] Tests

测试文件：`packages/brain/src/__tests__/relay-runs-summary.test.js`

运行命令：
```bash
# 只跑 summary 测试
cd /workspace && npx vitest run packages/brain/src/__tests__/relay-runs-summary.test.js

# 跑全部 relay-runs 相关测试（含既有）
cd /workspace && npx vitest run \
  packages/brain/src/__tests__/relay-runs.test.js \
  packages/brain/src/__tests__/relay-runs-filter.test.js \
  packages/brain/src/__tests__/relay-runs-verdicts.test.js \
  packages/brain/src/__tests__/relay-v101.test.js \
  packages/brain/src/__tests__/relay-runs-since.test.js \
  packages/brain/src/__tests__/relay-runs-summary.test.js
```

断言覆盖矩阵：

| 测试用例 | HTTP 200 | phases 含六 key | total 正确 | DB v2 过滤 | 无内部泄露 |
|----------|----------|-----------------|------------|------------|------------|
| B-01 | ✓ | ✓ | — | — | — |
| B-02 | ✓ | ✓ | — | — | — |
| B-03 | — | — | ✓ | — | — |
| B-04 | — | ✓ (all 0) | ✓ (0) | — | — |
| B-05 | ✓ | — | — | — | — |
| B-06 | ✓ | — | — | — | — |
| B-07 | — | — | — | ✓ | — |
| B-08 | 500 | — | — | — | ✓ |

---

## E2E 验收

环境：local_api（localhost:5221）

```bash
# E2E-1: 正常调用
curl -s http://localhost:5221/api/brain/orchestrator/relay-runs/summary | \
  python3 -c "import sys,json; d=json.load(sys.stdin); assert d['phases'] is not None; assert 'total' in d; assert 'done' in d['phases']; print('E2E-1 PASS')"

# E2E-2: phases 含六个固定 key
curl -s http://localhost:5221/api/brain/orchestrator/relay-runs/summary | \
  python3 -c "
import sys,json
d=json.load(sys.stdin)
expected={'planning','gan','generate','evaluate','done','failed'}
assert set(d['phases'].keys())==expected, f'missing keys: {expected-set(d[\"phases\"].keys())}'
print('E2E-2 PASS: phases keys OK')
"

# E2E-3: total 等于各 phase 之和
curl -s http://localhost:5221/api/brain/orchestrator/relay-runs/summary | \
  python3 -c "
import sys,json
d=json.load(sys.stdin)
assert d['total']==sum(d['phases'].values()), f'total mismatch: {d[\"total\"]} != {sum(d[\"phases\"].values())}'
print('E2E-3 PASS: total consistent')
"
```

---

## NFR

| 编号 | 约束 | 验证方式 |
|------|------|----------|
| NFR-1 | 只读端点，不做 DB 写入 | mock 无写入调用 |
| NFR-2 | 500 不暴露 SQL/stack trace | B-08 断言 body 无内部字段 |
| NFR-3 | 既有七份测试文件全绿 | CI 跑全量 relay-runs 相关测试 |

---

## 铁律覆盖确认

| 铁律 | 描述 | 覆盖 |
|------|------|------|
| INV-路由顺序 | summary 在 :initiative_id 之前注册 | B-06 |
| INV-v2过滤 | 只统计 orchestrator_version='v2' | B-07 |
| INV-无数据零值 | 空结果返回 0 非空对象/错误 | B-04/B-05 |
| INV-错误不泄露 | 500 只含通用 error 字符串 | B-08 |
| INV-既有兼容 | 既有端点行为不变 | NFR-3 |
