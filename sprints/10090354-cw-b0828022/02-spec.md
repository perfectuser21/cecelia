---
task_id: b0828022-fd36-4e9d-b8ac-f4ce487d259c
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# 实现规格：01-intent.md 带上任务背景（description）

### S-1
对应：I-1

改动文件：
- `packages/brain/scripts/coding-workflow/lib/intent.mjs`
- `packages/brain/scripts/coding-workflow/activities/intent.mjs`

实现：
- `renderIntent({ taskId, title, items, description })` 新增可选参数 `description`。
- `description` 为字符串且 `trim()` 后非空时，在 `# <标题>` 与空行之后、第一条 `### I-1` 之前插入：
  `## 背景`、空行、description 原文（去掉首尾空白，内部换行保留）、空行。
- `description` 为 `undefined` / `null` / 非字符串 / 空串 / 纯空白时，输出与现状**逐字节一致**（不出现 `## 背景`），保证老调用与重复运行字节一致。
- 防伪锚点：原文中会被 `md-chain.mjs` 的 `ANCHOR_RE`（`^### [A-Z]+-\d+…`）识别为锚点的行，在行首加反斜杠转义成 `\### …`（markdown 渲染不变），其余行原样保留；使背景小节不会产生 I-n/S-n 锚点。
- 输出保持确定性（不写时间戳）。
- `activities/intent.mjs` 第 37 行改为 `renderIntent({ taskId, title: task?.title, items, description: task?.description })`。`outputs.intent_ids` 仍按 `items` 生成，不受背景影响。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/intent.test.mjs`（新增用例见 S-3）
- `grep -n "description: task?.description" packages/brain/scripts/coding-workflow/activities/intent.mjs` 有命中

### S-2
对应：I-2

改动文件：
- `packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs`（只加测试；`lib/md-chain.mjs` 的 `extractAnchors` 逻辑不需要改）

实现（在 `describe('extractAnchors')` 下新增用例）：
- 用 `renderIntent` 渲染一个带 description 的 01-intent.md，description 包含 `## 小标题`、`#### I-9`、`- I-7 列表`、正文里的 `I-5` 字样，以及一行 `### I-8 伪锚点`；断言 `extractAnchors(parseFrontmatter(md).body)` 严格等于 `['I-1', 'I-2']`（items 两条）。
- 再写一份 sprint 目录：带背景的 01-intent.md + 只覆盖 I-1/I-2 的 02-spec.md，断言 `checkChain({ dir, taskId })` 返回 `ok: true`，没有 `upstream_anchor_missing` / `intent_not_covered` 一类的错误。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/md-chain.test.mjs` 全部通过，新增用例包含在其中。

### S-3
对应：I-3

改动文件：
- `packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs`

新增用例：
- `describe('renderIntent')`：
  - description 非空：`md` 含 `## 背景` 和 description 原文；`md.indexOf('## 背景') < md.indexOf('### I-1')`；`md.indexOf('# 标题') < md.indexOf('## 背景')`；`parseFrontmatter(md).data` 仍为 `{ task_id, step: 'intent', upstream: [] }`。
  - description 为 `''`、`'   '`、`undefined`：`md` 不含 `## 背景`，并且与不传 description 时的输出全等。
  - description 含 `### I-9` 行：输出里这一行变成 `\### I-9`，正文其余部分原样保留。
- `describe('intent 活动（子进程 + 假 Brain）')`：
  - 假 Brain 返回 `description: '背景说明 XYZ\n验收：①A ②B'`、没有 payload：生成的 01-intent.md 含 `## 背景` 和 `背景说明 XYZ`，位于 `### I-1` 之前；`outputs.intent_ids` 为 `['I-1', 'I-2']`；`intent_sha256` 与文件内容一致。
  - 原有用例 `payload.acceptance 优先` 里 `expect(md).not.toContain('X')` 会因为背景写入 description 原文而失败，要改成断言 `### I-n` 里没有 X/Y/Z 条目（例如 `expect(md).not.toContain('### I-3')`，并确认 I-1/I-2 的内容是 payload 条目），同时断言 `## 背景` 下面有 description 原文。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/intent.test.mjs` 全部通过。

### S-4
对应：I-4

改动文件：无新增（只做回归）；如果其他测试对 01-intent.md 做了逐字节/内容断言而失败，就在相应 `__tests__` 里按新格式更新断言。

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow` 全部通过（包括 `runner/__tests__`、`e2e-contract.test.mjs`、`md-chain.test.mjs`、`spec.test.mjs`、`verify.test.mjs`）。
