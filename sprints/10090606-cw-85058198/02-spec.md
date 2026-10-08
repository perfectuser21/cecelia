---
task_id: 85058198-8234-4e6e-91b5-7e9365fc0805
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 规格：PR 描述写入规格评审结论

### S-1
- 对应：I-1
- 改动文件：`packages/brain/scripts/coding-workflow/activities/publish.mjs`
- 实现：
  - 从 `../lib/review.mjs` 引入 `parseReview`。
  - 新增纯函数 `reviewSummary(input, dir, sprintRel)`，与现有 `acceptanceSummary` 写法保持一致：
    - `input.review_file` 不是非空字符串时返回 `''`（不出现小节）。
    - 读取 `path.join(dir, review_file)`；读取失败时也返回 `''`，不让 publish 失败。
    - 用 `parseReview(text)` 解析（只取 `verdict` 与 `issues`，忽略 `errors`；不传 specIds/intentIds）。
    - 输出格式：
      ```
      ## 规格评审（<sprintRel>/<review_file>）
      - 评审轮数：<review_rounds>
      - 最终 verdict：<verdict>
      - R-1（针对 S-2）：<body 首行>
      - R-2（针对 I-1、S-3）：<body 首行>
      ```
      其中 `review_rounds` 来自 `input.review_rounds`（不是有限正整数时写 `未知`）；`verdict` 为 `parseReview` 结果（null 时写 `未知`）；每个 R-n 一行，针对的 ID 用 `、` 连接，描述取 `issue.body.split('\n')[0]`。没有 R-n 时只输出前三行。
  - `pr create` 的 body 拼装数组改为 `[文件列表, reviewSummary(...), acceptanceSummary(...)]`，仍 `.filter(Boolean).join('\n\n')`。
- 验证：
  - `grep -n "reviewSummary\|规格评审" packages/brain/scripts/coding-workflow/activities/publish.mjs` 有命中。
  - 由 S-2 的测试断言 PR body 内容。

### S-2
- 对应：I-2
- 改动文件：`packages/brain/scripts/coding-workflow/__tests__/publish.test.mjs`
- 新增测试：
  1. 有 review_file：在 `sprints/s1/02-review.md` 写入带 frontmatter、`verdict: APPROVE`、两个 `### R-1` / `### R-2` 小节的评审文档（R-1 `针对: S-1`，正文两行；R-2 `针对: I-1, S-2`，正文一行），以 `run('new', { chain_files: [..., '02-review.md'], review_file: '02-review.md', review_rounds: 2 })` 运行。断言：
     - `exitCode === 0`；
     - body 含 `## 规格评审（sprints/s1/02-review.md）`、`- 评审轮数：2`、`- 最终 verdict：APPROVE`；
     - body 含 `- R-1（针对 S-1）：<R-1 正文首行>`，且不含 R-1 正文第二行；
     - body 含 `- R-2（针对 I-1、S-2）：<R-2 正文首行>`。
  2. 无 review_file：`run('new')`，断言 body 不含 `规格评审`。
- 验证：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/publish.test.mjs` 全部通过（含原有用例与上述两个新用例）。

### S-3
- 对应：I-3
- 改动文件：无新增（仅确认 S-1、S-2 的改动不破坏其它 coding-workflow 测试）。
- 验证：`cd packages/brain && npx vitest run scripts/coding-workflow` 全部通过，退出码 0。
