# Contract DoD: relay-runs since 过滤

**Sprint**: 07042120-relay-runs-since
**Task ID**: 61fd2e5c-4c79-4184-8584-cab426596846
**Date**: 2026-07-04

---

## DoD 条目

- [x] GET /relay-runs?since= 只返回 started_at >= since 的 runs（FR-19：SQL WHERE 含 `started_at >= $N`，参数化绑定，非字符串拼接）
- [x] since+phase+limit 三参数 AND 组合生效（FR-21：同一次 DB 查询，三条件全部出现在 SQL 中）
- [x] 非法 since 格式 → 400 + {error: "..."}（FR-22：`?since=not-a-date`、`?since=2026-13-99` → 400，不执行 DB 查询）
- [x] since 空字符串 → 400 + {error: "..."}（FR-23：`?since=` → 400，不执行 DB 查询）
- [x] 不带 since 行为与原来完全相同（INV-5：SQL 不含 `started_at >=` 条件，既有 limit/phase 行为不变）
- [x] colErr 回退路径（pr_url 列不存在）中 since 条件同样生效（FR-24：回退 SQL 也含 since 过滤）
- [x] 现有 4 份测试文件零改动全绿（INV-2：relay-runs.test.js、relay-runs-filter.test.js、relay-runs-verdicts.test.js、relay-v101.test.js 均通过）
- [x] 新增单测覆盖 since 相关场景（`packages/brain/src/__tests__/relay-runs-since.test.js` 含 B-01 到 B-14 全部场景）
- [x] CI 全绿（brain-ci.yml 通过）
