---
task_id: 85058198-8234-4e6e-91b5-7e9365fc0805
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---
# 规格评审

verdict: APPROVE

## 逐条核对

| 验收条目 | 对应规格 | 验证方式是否可真实运行 | 是否缩小/改写 | 结论 |
|---|---|---|---|---|
| I-1 | S-1（实现）+ S-2（断言） | 是：S-2 用假 gh 截获 `pr create --body`，逐字断言小节标题、轮数、verdict、两条 R-n 行；无 review_file 时断言不含「规格评审」 | 否：轮数、最终 verdict、每个 R-n「针对 ID + 描述首行」、无 review_file 不出小节，全部覆盖 | 通过 |
| I-2 | S-2 | 是：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/publish.test.mjs` | 否：新增「有 review_file（2 条 R-n）」「无 review_file」两个用例，并要求原有用例同时通过 | 通过 |
| I-3 | S-3 | 是：`cd packages/brain && npx vitest run scripts/coding-workflow`，退出码 0 | 否 | 通过 |

## 可行性核实（对照仓库代码）

- `lib/review.mjs` 的 `parseReview` 已导出，返回 `{verdict, issues:[{id, targets, body}], errors}`；`body` 已去掉空行并 trim，`split('\n')[0]` 即描述首行；`targets` 已按 `,，、空白` 拆分，测试中 `针对: I-1, S-2` 会得到 `['I-1','S-2']`，用 `、` 连接后与断言 `针对 I-1、S-2` 一致。
- 不传 specIds/intentIds 时只会多出 `target_unknown` 类 errors，规格明确忽略 errors，不影响输出。
- `spec-review.mjs` 输出 `review_file: '02-review.md'`、`review_rounds: <round>`，publish 的 input 即上下文（与现有 `evidence_file`/`verified_ids` 的取法一致），字段来源成立。
- body 拼装沿用 `.filter(Boolean).join('\n\n')`，`reviewSummary` 返回 `''` 时自然不出现小节，与 `acceptanceSummary` 同构，不影响现有用例断言。

## 边界情况（已在规格中处理，无需修改）

- review_file 缺失/非字符串 → 返回 `''`；文件读取失败 → 返回 `''`，不让 publish 失败。
- review_rounds 非有限正整数 → `未知`；verdict 解析为 null → `未知`。
- 没有 R-n（APPROVE 常见情况）→ 只输出标题、轮数、verdict 三行。
- R-n 正文多行 → 只取首行，S-2 有「不含 R-1 正文第二行」的反向断言。
- 已有 PR 复用时不重写正文：I-1 只约束「生成的 PR 描述」，不在范围内。
