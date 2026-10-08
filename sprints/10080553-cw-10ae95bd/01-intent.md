---
task_id: 10ae95bd-55c4-43f2-a7d5-399466ed7d26
step: intent
upstream: []
---
# runner 测试不受外部 CODING_WF_* 环境变量影响

### I-1
在 CODING_WF_REPO=/nonexistent CODING_WF_AUTOMERGE=0 CODING_WF_MAIN_LOG=/tmp/cw-x.log 环境下运行 cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__ 全部通过

### I-2
不设置任何 CODING_WF_* 变量时运行 cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__ 全部通过
