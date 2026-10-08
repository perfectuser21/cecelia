---
task_id: 15cf9cad-f2a6-4e03-bb67-f2add83afecc
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 构建记录：coding workflow 规格评审文档解析 lib/review.mjs

### B-1
对应：S-1
- 改动文件：新增 `packages/brain/scripts/coding-workflow/lib/review.mjs`，导出纯函数 `parseReview(text, { specIds, intentIds })`，复用 `./md-chain.mjs` 的 `parseFrontmatter` 取正文；verdict 行用规格给出的正则（取第一处，转大写判 APPROVE/REVISE）；`### R-n` 小节到下一个 `#`~`###` 标题结束；第一处 `针对` 行去 `**` 后按 `,`/`，`/`、`/空白切分；其余行 trim 后去空、换行拼接为 body。
- 新增测试：`review.test.mjs` 中「verdict 行写法」5 种写法（普通/小写/加粗字段名/整行加粗/全角冒号）+ 取第一处；「R-n 问题小节」断言 `issues[0]` 为 `{ id: 'R-1', targets: ['S-1','I-2'], body: 非空 }`、中文分隔符、`####` 不终止小节、多个 R-n 顺序。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/review.test.mjs`
  - 实现前：`Failed to load url ../lib/review.mjs ... Does the file exist?`，Test Files 1 failed（确认失败）
  - 实现后：`✓ review.test.mjs (22 tests)`，Tests 22 passed (22)
- 提交 SHA：2b565892abdc79c0ce6ebf9e00c0d050412a4568

### B-2
对应：S-2
- 改动文件：同 B-1 的 `lib/review.mjs`，错误码依次产生：`verdict_missing` / `verdict_invalid` → `issues_missing`（REVISE 且无 R-n）→ 逐个 R-n 的 `R-n:target_missing`、`R-n:body_empty`、`R-n:target_unknown:<ID>`（目标不在 specIds ∪ intentIds）。APPROVE 带或不带 R-n 均合法。
- 新增测试：「错误码」组覆盖无 verdict（verdict 为 null）、`verdict: MAYBE`、REVISE 无 R-n、R-1 无针对行、针对行切分后无 ID、R-2 无描述、`针对: S-9` 未知、APPROVE + 合法 R-1（errors 为 `[]`、issues 长度 1）、APPROVE 无 R-n、REVISE + 合法 R-1（针对 S-1, I-1，errors 为 `[]`）。
- 测试命令：同 B-1，Tests 22 passed (22)
- 提交 SHA：2b565892abdc79c0ce6ebf9e00c0d050412a4568

### B-3
对应：S-3
- 改动文件：新增 `packages/brain/scripts/coding-workflow/__tests__/review.test.mjs`（vitest，`import { parseReview } from '../lib/review.mjs'`），覆盖 S-1、S-2 全部情况，另含「带 frontmatter 与不带 frontmatter 解析结果相同」及「非字符串输入按空串处理」。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/review.test.mjs` → 退出码 0，Test Files 1 passed (1)，Tests 22 passed (22)
- 提交 SHA：2b565892abdc79c0ce6ebf9e00c0d050412a4568

### B-4
对应：S-4
- 改动文件：无其它文件改动（仅新增上述两个文件，未改 vitest 配置）。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow` → Test Files 29 passed (29)，Tests 541 passed (541)
- 提交 SHA：2b565892abdc79c0ce6ebf9e00c0d050412a4568
