# 独立裁判（第 2 轮）

- 裁决：**FAIL**（product_failure）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r2.md
- 总评：正常预览路径的非法值拒绝、默认 general 写入以及合法值写入后查询都有真实操作证据，I-2、I-3 成立。当前仍不能通过最后验收：I-1 的约束读取失败路径存在明确缺口，且 PR 混入了需求外的 made_by 约束变更。

## 需求覆盖

### I-1
- 未满足
- 依据：正常路径已有真实验证：T-1 输出 workflow_bogus 返回 400、非空 allowed_categories、Q1_OK；T-2～T-4 验证数字、大小写变体和超长输入，X-2 验证并发拒绝且无写入。strategic-decisions.js:63-72 实现写入前校验，:162-164 转译指定 category CHECK 错误。但约束读取失败时，代码允许字符串继续 INSERT；单测明确接受 allowed_categories=[]，未满足响应说明允许取值的要求，超长输入在该路径也没有独立拦截。合同 S-1 明确允许这一降级，QA 未验证该错误路径。

### I-2
- 满足
- 依据：合同 S-2、Q-3 覆盖默认 general 写入。strategic-decisions.js:64 对缺省、null、空字符串跳过校验，原 INSERT 默认值保持；迁移 544 将 general 加入约束。T-5 两条真实 POST 均输出 201、category=general，GET 按本轮 topic 查找的断言输出 true、Q3_OK；X-1 补充 null 返回 201、general。

### I-3
- 满足
- 依据：合同 S-1、Q-4、Q-5 覆盖合法 category 的写入和查询。strategic-decisions.js:69-71 放行合法值并沿用原 INSERT。T-6 的 decision POST 输出 201 和 id=78e483b2-0886-4430-a261-b0e444b8d202，随后 GET 同时匹配 id、topic、category 的断言输出 true、Q4_OK；T-7 的 judgment 调用输出 201，GET 按 topic、category 匹配成功并输出 Q5_OK。

## 问题

### J-1
- 类型：product
- 严重度：重要
- 对应：I-1
- 位置：packages/brain/src/routes/strategic-decisions.js:39-45、:69-72、:162-166；packages/brain/src/routes/__tests__/strategic-decisions-category.test.js 的“兜底”用例；S-1 实现要点 2、3；T-4
- 说明：数据库约束读取失败的路径没有完整实现 I-1。loadAllowedCategories 查询失败返回 null，checkCategory 对字符串直接放行；INSERT 撞 category CHECK 后再次读取仍失败，就返回 error="category 非法"、allowed_categories=[]，调用方仍不知道可填什么。新增单测明确断言这一结果，因此不是仅缺少验证。更严重的是，5000 字符的非法 category 在同一路径直接进入 INSERT，可能先触发 varchar 长度错误 22001；catch 只转译 23514，其余错误仍以 500 和 err.message 返回。用户在约束元数据查询不可用时会再次遇到本任务要消除的问题。合同 S-1 将空列表降级视为合格，T-4 只验证了约束读取成功的超长输入路径。

### J-2
- 类型：product
- 严重度：重要
- 对应：I-3
- 位置：packages/brain/migrations/545_decisions_made_by_allow_ai.sql:1-41；packages/brain/src/__tests__/migration-545-decisions-made-by-ai.test.js:19-44；T-7
- 说明：迁移 545 额外修改 decisions_made_by_check，将 made_by=ai 从原来的非法值变为合法值。这是修复另一个字段的既有约束问题，不是 category 校验、默认 category 保留或合法 category 查询所必需的改动；合同 S-1/S-2 的实现范围也没有包含它。Q-5 使用 ai 的请求暴露了这个存量问题，但不能据此把 category 修复扩展为 made_by 枚举变更。T-7 证明新增 ai 能写入，却没有验证这项额外迁移对现有 made_by 取值的保留和重跑行为；对应新增单测只检查 SQL 文本。应将该迁移及专属测试拆到独立任务，或明确扩展需求、合同并补充真实迁移验收。
