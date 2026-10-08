---
task_id: b0828022-fd36-4e9d-b8ac-f4ce487d259c
step: intent
upstream: []
---
# coding workflow 01-intent.md 带上任务背景（description）

### I-1
packages/brain/scripts/coding-workflow/lib/intent.mjs 的 renderIntent 增加可选参数 description：非空时在标题之后、第一条 ### I-n 之前输出 `## 背景` 小节（原文），为空或缺省时不输出该小节；activities/intent.mjs 把 Brain 任务的 description 传进去

### I-2
lib/md-chain.mjs 的 extractAnchors 对带背景小节的 01-intent.md 仍只提取 I-n（背景正文里出现的 ### 以外文字不算锚点），有测试覆盖

### I-3
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/intent.test.mjs 全部通过，并新增测试：description 非空时 01-intent.md 含 `## 背景` 与原文且位于 I-1 之前；description 为空时不含 `## 背景`

### I-4
cd packages/brain && npx vitest run scripts/coding-workflow 全部通过
