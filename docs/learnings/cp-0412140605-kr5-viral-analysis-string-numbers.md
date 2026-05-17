# Learning: KR5 Dashboard — ViralAnalysis 字符串数字 + Pipeline Steps 安全访问

## 背景
PR: KR5 Dashboard 阻断 Bug 清零

### 根本原因

**Bug 1 — ViralAnalysisPage engRate 计算错误**

Brain `/api/brain/analytics/content` 端点从 PostgreSQL 的 NUMERIC 列返回字符串类型（`"views": "100"`，`"likes": "10"`）。
TypeScript 接口声明为 `number` 但 JS 运行时是字符串。
`item.likes + item.comments + item.shares` 触发字符串拼接而非加法（`"10"+"2"+"1" = "1021"` 而非 `13`），互动率被极度虚报。

**Bug 2 — HarnessPipelineStepPage data.steps 不安全**

当 API 返回 `steps: null` 时，`data?.steps.find(...)` 会因 `null.find` 报错崩溃。

### 下次预防

- [ ] 当接收来自后端的数字字段时（尤其是 PostgreSQL NUMERIC/BIGINT 列），始终用 `Number()` 显式转换后再做算术，不依赖 TypeScript 类型声明保证运行时类型
- [ ] 访问数组方法前用 `(data?.field ?? []).method()` 模式，防止字段为 null 时崩溃
- [ ] 添加 API 测试时，mock 返回的数字字段应该测试字符串情形，不只测 number
