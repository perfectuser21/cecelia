# 独立裁判（第 1 轮）

- 裁决：**FAIL**（product_failure）
- 模型：gpt-5.6-sol
- 复核的 QA 报告：05-qa-report-r1.md
- 总评：三条需求的核心结果均有代码实现和预览环境真实请求、回读输出支持，未发现核心功能未完成的证据。但 PR 包含独立的 made_by、priority 行为变更及 coding workflow 既有故障修复，存在重要范围蔓延问题，建议拆分后再合并。

## 需求覆盖

### I-1
- 满足
- 依据：strategic-decisions.js:101-109 在写库前校验 category，非法值直接返回 400，响应包含完整允许列表且不引用数据库错误；decision-categories.js:10-24 定义了 13 个合法值。合同 S-1、S-2、Q-1、Q-2 覆盖核心要求。T-1 实际输出 HTTP 400、完整 allowed_categories，并通过响应无约束原文及 topic 未写入的断言；T-2 的大小写、数字、数组、超长字符串四次请求均输出 400 和 Q2_OK；T-8 验证重复非法请求仍被拒绝。

### I-2
- 满足
- 依据：strategic-decisions.js:101、133 将缺省 category 写为 DEFAULT_DECISION_CATEGORY；decision-categories.js:27 定义其为 decision。合同明确说明旧默认 general 不符合现有数据库约束，并在 S-2、Q-3 中覆盖恢复缺省请求成功写入的结果。T-3 对不带 category、空字符串、null 分别输出 201、非空记录 ID 和 category=decision，且过滤 GET 回读断言通过，输出 Q3_OK；T-7 也实际验证分类留空后弹窗关闭、列表出现 decision 记录。这里更换原本无法写入的默认值，不构成对用户可用行为的回退。

### I-3
- 满足
- 依据：strategic-decisions.js:133 对合法 category 原样传入参数化 INSERT，PR 未修改 GET 过滤逻辑；合同 S-2、Q-4、Q-5、Q-6 覆盖合法写入与过滤回读。T-4 实际输出 POST 201，并验证 GET HTTP 200、目标 topic 恰好一条、category=decision、status=active，输出 Q4_OK；T-5 对 judgment 输出 201 和 Q5_OK；T-8 验证合法重复请求两次均为 201，过滤回读得到两条记录。

## 问题

### J-1
- 类型：product
- 严重度：重要
- 对应：I-3
- 位置：packages/brain/src/routes/strategic-decisions.js:112；packages/brain/scripts/coding-workflow/activities/spec-review.mjs:75；S-1、S-2、S-4
- 说明：PR 扩展到了与 category 修复无关的 made_by、priority 输入行为，并修复了 coding workflow 原有的 made_by:'ai' 写入问题。strategic-decisions.js 新增这两个字段的主动枚举校验，使相关请求的响应行为发生变化；spec-review.mjs 将 ai 改为 system，则改变了另一个真实调用方的写入行为。合同现状已经说明这些故障来自 migration 193，是既有问题，并非 category 校验引入的回归。把它们列进 S-1～S-4、再用 Q-5/Q-7 验证，并不能使其成为 I-1～I-3 所要求的改动。这属于需求外的行为扩展，应拆出独立需求验收；本 PR 可保留 category 校验、缺省值修复、响应脱敏，以及直接相关的 Dashboard 和 category 测试调用方修正。
