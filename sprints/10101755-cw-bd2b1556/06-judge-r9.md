# 独立裁判（第 9 轮）

- 裁决：**FAIL**（product_failure）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r9.md
- 总评：I-1、I-2、I-3 在正常预览环境中均有代码实现和真实 HTTP 证据，QA 场景也覆盖了主要对抗输入与真实调用方 shape。发现一个重要边界问题：数据库约束读取失败时，错误响应使用迁移文件推导的可能过时白名单，而不是规格要求的空数组或真实约束值。

## 需求覆盖

### I-1
- 满足
- 依据：代码在 packages/brain/src/routes/strategic-decisions.js:191-206 通过 checkCategory 在 INSERT 前校验字符串、非字符串、大小写变体和超长值，并在约束错误时转为 400；400 响应由 categoryRejection 生成，不包含数据库约束名或 SQL 原文。T-1 对 workflow_bogus 真实返回 400、列出 allowed_categories 且 GET 查不到写入记录；T-2、X-1、X-2 分别验证数字、重复请求、大小写、超长、空格、数组、对象、布尔值、并发请求均返回 400 且未写入。合同由 S-1、Q-1、Q-2 覆盖。

### I-2
- 满足
- 依据：代码在 packages/brain/src/routes/strategic-decisions.js:177-189 对 undefined/null/空字符串跳过 category 校验，继续使用原有 category || 'general'；packages/brain/migrations/545_decisions_category_allow_general.sql:25-36 将 general 加入数据库约束且不收窄已有值。T-3 真实验证不带 category 和 category='' 均返回 201、data.category 为 general，并能通过 GET 查到；X-1 进一步验证 null 同样返回 201。合同由 S-2、Q-3 覆盖。

### I-3
- 满足
- 依据：代码在 packages/brain/src/routes/strategic-decisions.js:191-206 对合法 category 放行，原 INSERT 和 201 响应路径保持不变。T-4 真实验证 category=decision 返回 201、获得非空 id，并通过 GET category=decision 查到同一记录；T-5 使用 coding-workflow 的 judgment、made_by、author、source_ref 真实 shape 验证返回 201 且可查询。合同由 S-1、S-2、Q-4、Q-5 覆盖。

## 问题

### J-1
- 类型：product
- 严重度：重要
- 对应：I-1
- 位置：packages/brain/src/routes/strategic-decisions.js:89-99、packages/brain/src/routes/strategic-decisions.js:205-209；02-spec.md S-1 第 3 点
- 说明：需求规格 S-1 明确规定：约束读取失败且兜底重读仍取不到时，allowed_categories 应返回空数组。实际代码在 packages/brain/src/routes/strategic-decisions.js:89-99 的 categoryRejection 中会调用 loadMigrationCategories()，从迁移文件拼出一组静态取值并返回；这不是当前数据库约束的真实内容，尤其线上约束可能已漂移或包含迁移文件未声明的值。数据库目录查询临时失败且非法 category 触发 23514 时，调用方会收到看似完整但可能错误的合法值列表，按该列表修改仍可能继续失败，未完全满足错误响应应准确说明允许值的要求。代码新增测试还将该偏离固化在 strategic-decisions-category.test.js 的多个 fallback 用例中。
