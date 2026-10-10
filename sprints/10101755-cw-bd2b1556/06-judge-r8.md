# 独立裁判（第 8 轮）

- 裁决：**FAIL**（product_failure）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r8.md
- 总评：正常预览路径的三项目标均有真实接口操作支持；但 I-1 在约束定义读取失败时失去允许值提示，且合同将这一缺口写成了可接受行为，合并前需要处理。

## 需求覆盖

### I-1
- 未满足
- 依据：T-1 实测 workflow_bogus 返回 400，列出允许值且未泄露数据库报错；T-2、X-1、X-2 覆盖了其他非法输入。但这些操作均未验证约束定义读取失败时的响应。

### I-2
- 满足
- 依据：T-3 实测不带 category 返回 201，写入 general，并能通过 GET 查到；迁移 545 将 general 加入数据库约束。Q-3 覆盖了该行为。

### I-3
- 满足
- 依据：T-4 实测 decision 写入返回 201，GET 按返回的 id 和 topic 查到记录；T-5 还验证了 judgment 调用方。Q-4、Q-5 覆盖了相应路径。

## 问题

### J-1
- 类型：product
- 严重度：重要
- 对应：I-1
- 位置：packages/brain/src/routes/strategic-decisions.js:74；packages/brain/src/routes/__tests__/strategic-decisions-category.test.js:143
- 说明：约束定义读取失败且没有缓存时，非法字符串会继续尝试 INSERT；即使数据库约束正确将其拒绝，兜底响应仍可能只有“category 非法”和空的 allowed_categories。调用方依旧不知道该填什么，未满足 I-1 要求的“响应体说明 category 允许的取值”。单测明确断言了这一退化结果，预览环境 QA 未操作此路径。

### J-2
- 类型：contract_gap
- 严重度：重要
- 对应：I-1
- 位置：S-1；Q-1；Q-2
- 说明：S-1 明确允许兜底读取失败时返回空数组及“category 非法”，把需求中的允许值提示缩小成了仅正常读取约束时才提供；Q-1、Q-2 也只验正常读取路径。因此合同和 QA PASS 都不能证明错误路径仍能告知调用方合法取值。
