---
task_id: 15cf9cad-f2a6-4e03-bb67-f2add83afecc
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# 实现规格：coding workflow 规格评审文档解析 lib/review.mjs

### S-1
对应：I-1

新增文件：`packages/brain/scripts/coding-workflow/lib/review.mjs`（纯函数，不读写文件、不碰网络；风格对齐同目录 `lib/md-chain.mjs`、`lib/intent.mjs`）。

导出 `parseReview(text, { specIds = [], intentIds = [] } = {})`，返回 `{ verdict, issues, errors }`：

- 正文：若 `parseFrontmatter(text)`（复用 `./md-chain.mjs`）非 null 则取其 `body`，否则取整个 `text`；非字符串按空串处理。
- verdict 行：逐行匹配，大小写不敏感，允许 markdown 加粗与全/半角冒号，例如 `verdict: APPROVE`、`**verdict**: revise`、`**verdict: REVISE**`、`Verdict：Approve`。正则建议：`/^\s*(?:\*\*)?verdict(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*([^*\s]*)\s*(?:\*\*)?\s*$/i`。取第一处匹配；值转大写后为 `APPROVE` / `REVISE` 则 `verdict` 为该大写值，否则 `verdict` 为 `null`。
- 问题小节：标题行 `^### (R-\d+)(?:[\s:：].*)?$` 开启一个小节，到下一个 `#`~`###` 级标题行或文末结束。
- 小节内 `针对` 行：`^\s*(?:\*\*)?针对(?:\*\*)?\s*[:：]\s*(.*)$`，取第一处；值去掉 `**` 后按 `,`、`，`、`、` 及空白切分，去空项。
- 描述：小节内除 `针对` 行以外的行，trim 后拼接；全为空白即视为空。
- `issues` 为 `[{ id: 'R-n', targets: string[], body: string }]`，按出现顺序；缺 `针对` 行时 `targets` 为 `[]`。

验证：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/review.test.mjs` 中断言以下几种情况都能得到 `verdict` 为 `APPROVE`/`REVISE`：普通写法、小写、加粗字段名、整行加粗、全角冒号；且 `issues[0]` 等于 `{ id: 'R-1', targets: ['S-1', 'I-2'], body: <非空描述> }`。

### S-2
对应：I-2

文件：同 S-1 的 `packages/brain/scripts/coding-workflow/lib/review.mjs`，在 `parseReview` 内完成判定，错误码写入 `errors`（字符串数组，按下列顺序产生）：

| 情况 | 错误码 |
|---|---|
| 没有任何 verdict 行 | `verdict_missing` |
| 有 verdict 行但值不是 APPROVE/REVISE | `verdict_invalid` |
| verdict 为 REVISE 且 `issues` 为空 | `issues_missing` |
| 某 R-n 缺 `针对` 行，或切分后无 ID | `R-n:target_missing` |
| 某 R-n 描述为空 | `R-n:body_empty` |
| 某 R-n 的某个目标 ID 不在 `specIds ∪ intentIds` 中 | `R-n:target_unknown:<ID>`（每个未知 ID 一条） |

- APPROVE 带 R-n 合法（作为建议），只要 R-n 本身格式无误就不产生错误；APPROVE 不带 R-n 也合法。
- 全部合法时 `errors` 为 `[]`。

验证：`review.test.mjs` 分别断言：
- 无 verdict 行 → `errors` 含 `verdict_missing`，`verdict === null`；
- `verdict: MAYBE` → `errors` 含 `verdict_invalid`；
- `verdict: REVISE` 无 R-n → `errors` 含 `issues_missing`；
- R-1 无 `针对` 行 → `errors` 含 `R-1:target_missing`；
- R-2 仅有 `针对` 行无描述 → `errors` 含 `R-2:body_empty`；
- `针对: S-9`（`specIds=['S-1']`，`intentIds=['I-1']`）→ `errors` 含 `R-1:target_unknown:S-9`；
- `verdict: APPROVE` + 一个合法 R-1 → `errors` 严格等于 `[]`，`issues.length === 1`；
- `verdict: REVISE` + 合法 R-1（针对 `S-1, I-1`）→ `errors` 严格等于 `[]`。

### S-3
对应：I-3

新增测试文件：`packages/brain/scripts/coding-workflow/__tests__/review.test.mjs`（vitest，`import { parseReview } from '../lib/review.mjs'`），用例覆盖 S-1 与 S-2 列出的全部情况，并额外覆盖：带 frontmatter 与不带 frontmatter 两种输入均可解析。

验证：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/review.test.mjs` 退出码 0，全部用例通过。

### S-4
对应：I-4

不改动其它文件；新增模块与测试不得影响既有 coding-workflow 测试（`packages/brain/vitest.config.js` 的 include 已含 `scripts/**/*.test.mjs`，无需改配置）。

验证：`cd packages/brain && npx vitest run scripts/coding-workflow` 退出码 0，全部测试文件通过（含新增的 `review.test.mjs`）。
