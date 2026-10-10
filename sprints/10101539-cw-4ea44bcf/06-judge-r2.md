# 独立裁判（第 2 轮）

- 裁决：**FAIL**（product_failure）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r2.md
- 总评：三个 category 需求均有代码实现和预览环境真实操作输出支持，默认值调整也有现有数据库约束依据。但 PR 夹带了 made_by、priority 校验及调用方作者来源修复，存在必须处理的重要范围扩展问题，建议处理后再合并。

## 需求覆盖

### I-1
- 满足
- 依据：packages/brain/src/routes/strategic-decisions.js:101 起在 INSERT 前校验 category，非法值直接返回 400，响应包含完整 allowed_categories 和合法值提示；POST catch 不再返回 err.message。packages/brain/src/decision-categories.js:10 定义与合同所列数据库约束一致的 13 个值。T-1 的真实 curl 输出为 HTTP 400，响应列出 13 个允许值，无数据库约束名或 SQL 原文，随后 GET 未找到探针 topic；T-2 验证大小写变体、数字、数组及超长字符串均返回 400。S-1、S-2、Q-1、Q-2 覆盖核心需求。

### I-2
- 满足
- 依据：packages/brain/src/routes/strategic-decisions.js:101 将未提供、null 和空字符串 category 视为缺省，INSERT 使用 DEFAULT_DECISION_CATEGORY；packages/brain/src/decision-categories.js:26 将默认值设为 decision。T-3 的三次真实 POST 均返回 201、category=decision 和非空 id，按 category=decision 查询找到全部三条记录。合同说明旧默认 general 不满足现有数据库约束，因此改用 decision 实现用户要求的默认写入成功；S-2、Q-3 覆盖该行为，现有材料未显示需要保留 general 的有效写入行为。

### I-3
- 满足
- 依据：packages/brain/src/routes/strategic-decisions.js:101 起接受枚举内 category，并在 INSERT 参数中保留原值，GET 未改动。T-4 的真实输出显示 category=decision 的 POST 返回 201，随后 GET 返回 200，并断言该 topic 恰有一条、category=decision、status=active；T-5 另验证 judgment 写入与分类回读。T-7、T-8 验证合法重复提交仍各自成功并生成两条记录。S-2、Q-4、Q-5、Q-6 覆盖写入及查询。

## 问题

### J-1
- 类型：product
- 严重度：重要
- 对应：I-3
- 位置：packages/brain/src/routes/strategic-decisions.js:110；packages/brain/src/decision-categories.js:28；packages/brain/scripts/coding-workflow/activities/spec-review.mjs:75；S-2/S-4
- 说明：PR 同时新增 made_by、priority 的输入校验及其专用 400 响应，并将 coding workflow 的 made_by 从 ai 改为 system。这些改动修复的是合同另行发现的作者字段和优先级问题，并非实现 category 校验、默认 category 写入或合法 category 查询所必需。它们改变了独立字段的 API 行为及调用方写入的作者来源语义，属于需求外的范围扩展。S-2、S-4 将这些工作标为对应 I-1 至 I-3，不能替代需求授权；T-5、T-6 虽验证了选定路径，也不能消除范围扩展本身。应将这部分拆出本 PR，或先将其纳入明确的需求与验收范围。
