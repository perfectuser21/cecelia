# 独立裁判（第 6 轮）

- 裁决：**FAIL**（product_failure）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r6.md
- 总评：I-1、I-2、I-3 均已由代码和预览环境真实 HTTP 输出验证满足。发现一项需求外的 made_by 约束迁移，属于范围蔓延风险；另有 malformed JSON 的既存 500 泄露问题，不阻断本次三条需求。

## 需求覆盖

### I-1
- 满足
- 依据：代码 packages/brain/src/routes/strategic-decisions.js:16-79、162-190 在写入前读取 decisions_category_chk 并拦截非法字符串和非字符串，响应不返回 SQL 原文，且对 23514/相关长度错误做 400 兜底。QA T-1、T-2、X-1、X-2 的真实 curl 输出分别证明非法字符串、数字、大小写、超长、数组、对象、布尔、空格、重复及并发请求均返回 400，响应含 allowed_categories 且未写入。

### I-2
- 满足
- 依据：代码 packages/brain/src/routes/strategic-decisions.js:153-160、164-166 对 undefined/null/空字符串跳过 category 校验并保留 general 默认值。迁移 packages/brain/migrations/545_decisions_category_allow_general.sql 将 general 加入数据库约束。QA T-3 真实输出证明不带 category 与空字符串均返回 201、data.category 为 general，GET 能查到；X-1 同样验证 null 返回 201。

### I-3
- 满足
- 依据：代码 packages/brain/src/routes/strategic-decisions.js:164-180 保留合法 category 的 INSERT/201 路径，迁移 545 保证 general 场景可写；额外迁移 546 使合同 Q-5 的 made_by=ai 可写。QA T-4 真实输出证明 decision POST 返回 201 且 GET 按 id/topic 查到；T-5 证明真实 coding-workflow shape 的 judgment 请求返回 201 且可查询。

## 问题

### J-1
- 类型：product
- 严重度：重要
- 对应：I-1
- 位置：packages/brain/migrations/546_decisions_made_by_allow_ai.sql:1-41
- 说明：PR 修改了需求外的 made_by 约束并新增迁移 546，同时新增了 smoke 脚本、对应测试及 allowlist/写入目标登记。这不是 category 非法输入修复本身，且会改变 decisions.made_by 的数据库约束和部署迁移行为，带来未经本需求充分验收的数据库风险。应拆分或明确纳入需求并单独验收。

### J-2
- 类型：qa_gap
- 严重度：建议
- 对应：I-1
- 位置：X-3
- 说明：真人 QA 的 X-3 证明 malformed JSON 在路由前返回 500 并透出 JSON 解析器英文原文。该情形属于请求输入错误，虽然规格把它排除在 category 校验范围外，不能据此判定本次 I-1 未满足；但当前 I-1 的真实错误输入面仍存在 500/原文泄露，建议另立任务处理。
