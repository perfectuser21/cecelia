# 独立裁判（第 5 轮）

- 裁决：**FAIL**（product_failure）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r5.md
- 总评：I-2 和 I-3 有代码与预览环境真实输出支持。I-1 的正常路径已验证，但数据库约束读取失败时会返回 503，未满足非法 category 始终返回 400 的要求，因此不能通过最终验收。

## 需求覆盖

### I-1
- 未满足
- 依据：在正常约束查询成功时，T-1、T-2、X-1、X-2 的预览环境输出证明非法 category 返回 400、包含 allowed_categories、未写入且未透出 SQL 原文；但代码在读取 decisions_category_chk 失败且无缓存时，loadAllowedCategories 返回 unavailable，checkCategory 通过 categoryRejection 返回 503，而不是按规格放行后由 23514 兜底返回 400。该失败路径未被 QA 真实验证。

### I-2
- 满足
- 依据：代码 strategic-decisions.js:156-159 对 undefined、null、空字符串跳过 category 校验并保留原有 general 默认值；T-3 真实输出证明不带 category 和 category="" 均返回 201、data.category 为 general 且可通过 GET 查到；X-1 进一步证明 category:null 返回 201 并写入 general。

### I-3
- 满足
- 依据：代码 strategic-decisions.js:156-171 在合法 category 时继续原 INSERT 路径并返回 201；T-4 真实输出证明 category=decision 返回 201 且 GET 按 category 查到相同 id/topic/category；T-5 真实输出证明 judgment 及 coding-workflow 请求形状也返回 201 并可查询。

## 问题

### J-1
- 类型：product
- 严重度：阻断
- 对应：I-1
- 位置：packages/brain/src/routes/strategic-decisions.js:35-70；02-spec.md:S-1
- 说明：当读取数据库约束定义失败且没有旧缓存时，代码没有继续 INSERT 让数据库约束错误进入 23514 兜底，而是直接返回 503：loadAllowedCategories 在 strategic-decisions.js:35-43 返回 unavailable，checkCategory 在 strategic-decisions.js:57-70 将其转换为 CATEGORIES_UNAVAILABLE。这样真实用户提交非法 category 时会得到 503，而需求明确要求无论该输入路径都返回 400，且规格 S-1 明确要求读取失败时放行并由 23514 转译为 400。QA 只验证了约束查询成功的正常路径，没有覆盖该错误路径。
