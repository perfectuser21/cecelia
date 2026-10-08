---
task_id: b0828022-fd36-4e9d-b8ac-f4ce487d259c
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4"]
---
# 构建总结：01-intent.md 带上任务背景（description）

### B-1
对应：S-1

- 改动文件：
  - `packages/brain/scripts/coding-workflow/lib/intent.mjs`：`renderIntent` 新增可选 `description`；`trim()` 后非空时，在 `# 标题` 与空行之后插入 `## 背景`、空行、原文、空行；会被 md-chain 识别成锚点的行（复用 `extractAnchors` 判断）在行首加 `\` 转义；空、空白、null、undefined、非字符串时输出与原先逐字节一致。
  - `packages/brain/scripts/coding-workflow/activities/intent.mjs`：第 37 行改为 `renderIntent({ taskId, title: task?.title, items, description: task?.description })`。
- 新增测试：见 B-3（intent.test.mjs）。
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/md-chain.test.mjs`
  - 实现前：`Test Files 2 failed (2)`、`Tests 5 failed | 53 passed (58)`
  - 实现后：`Test Files 2 passed (2)`、`Tests 58 passed (58)`
- `grep -n "description: task?.description" packages/brain/scripts/coding-workflow/activities/intent.mjs` → 第 37 行命中
- 提交：a81e0055c

### B-2
对应：S-2

- 改动文件：`packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs`（只加测试，`lib/md-chain.mjs` 未改）
- 新增测试（在 `describe('extractAnchors')` 下）：
  - 带背景的 01-intent.md（背景含 `## 小标题`、`#### I-9`、`- I-7 列表`、正文 `I-5`、`### I-8 伪锚点`）：`extractAnchors(parseFrontmatter(md).body)` 等于 `['I-1', 'I-2']`
  - 带背景的 01-intent.md + 只覆盖 I-1/I-2 的 02-spec.md：`checkChain({ dir, taskId })` 的 `errors` 为 `[]`、`ok` 为 true
- 测试命令：同 B-1；实现前“伪锚点”用例失败（renderIntent 尚未输出 `## 背景`），实现后通过
- 提交：083f055e2

### B-3
对应：S-3

- 改动文件：`packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs`
- 新增测试：
  - `renderIntent`：description 非空时写入 `## 背景` 和原文（去掉首尾空白，内部换行保留），顺序为 `# 标题` < `## 背景` < `### I-1`，frontmatter 不变
  - `renderIntent`：description 为 `''`、`'   '`、undefined、null、42 时，输出不含 `## 背景`，且与不传 description 时完全相同
  - `renderIntent`：`### I-9` 行转义为 `\### I-9`，`#### I-7 …` 和行中的 `### I-6` 原样保留，锚点只有 `['I-1']`
  - 活动（子进程 + 假 Brain）：`description: '背景说明 XYZ\n验收：①A ②B'`、没有 payload 时，`## 背景` 和 `背景说明 XYZ` 在 `### I-1` 之前；`intent_ids` 为 `['I-1','I-2']`；`intent_sha256` 与文件内容一致
  - 改写原有用例“payload.acceptance 优先”：去掉 `not.toContain('X')`，改为断言 `## 背景` 下面是 description 原文，锚点严格等于 `['I-1','I-2']`，并且不含 `### I-3`
- 测试命令：同 B-1（实现前 4 条 intent 用例失败，实现后全部通过）
- 提交：a81e0055c

### B-4
对应：S-4

- 改动文件：无（回归时其他测试没有失败，不需要改断言）
- 测试命令：`cd packages/brain && npx vitest run scripts/coding-workflow`
- 输出摘要：`Test Files 28 passed (28)`、`Tests 519 passed (519)`
- 提交：无新增提交（回归覆盖 a81e0055c、083f055e2）
