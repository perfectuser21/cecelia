---
task_id: 85058198-8234-4e6e-91b5-7e9365fc0805
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3"]
---
# 构建：PR 描述写入规格评审结论

### B-1
- 对应：S-1
- 改动文件：`packages/brain/scripts/coding-workflow/activities/publish.mjs`
  - 引入 `parseReview`（`../lib/review.mjs`）。
  - 新增纯函数 `reviewSummary(input, dir, sprintRel)`：`review_file` 非空字符串才输出；读文件失败返回 `''`；输出 `## 规格评审（<sprintRel>/<review_file>）`、`- 评审轮数：<n|未知>`、`- 最终 verdict：<verdict|未知>`，以及每条 `- R-n（针对 A、B）：<body 首行>`。
  - `pr create` body 改为 `[文件列表, reviewSummary(...), acceptanceSummary(...)].filter(Boolean).join('\n\n')`。
- 新增测试：见 B-2。
- 测试命令：`grep -n "reviewSummary\|规格评审" packages/brain/scripts/coding-workflow/activities/publish.mjs`
- 输出摘要：命中第 90、93、105、153 行。
- 提交 SHA：3559b90d5f69f65efed3863061e27bc4ff960cfc

### B-2
- 对应：S-2
- 改动文件：`packages/brain/scripts/coding-workflow/__tests__/publish.test.mjs`
- 新增测试：
  1. `有 review_file：PR 正文含规格评审小节（轮数、最终 verdict、每条 R-n 首行）`——写入带 frontmatter、`verdict: APPROVE`、R-1（针对 S-1，两行正文）/R-2（针对 I-1, S-2，一行正文）的 `02-review.md`，断言标题、轮数 2、APPROVE、R-1 仅首行、R-2 目标以 `、` 连接。
  2. `无 review_file：PR 正文不带规格评审小节`。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/publish.test.mjs`
- 输出摘要：
  - 实现前（TDD 红）：`Tests 1 failed | 31 passed (32)`，失败用例为新用例 1（body 不含 `## 规格评审（sprints/s1/02-review.md）`）。
  - 实现后（绿）：`Test Files 1 passed (1)`，`Tests 32 passed (32)`。
- 提交 SHA：3559b90d5f69f65efed3863061e27bc4ff960cfc

### B-3
- 对应：S-3
- 改动文件：无新增。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow`
- 输出摘要：`Test Files 31 passed (31)`，`Tests 575 passed (575)`，退出码 0。
- 提交 SHA：3559b90d5f69f65efed3863061e27bc4ff960cfc
