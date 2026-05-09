---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: 收集 evidence 并写 run-evidence.md（含 evaluator_worktree_path — R4）

**范围**: 实现 collect-evidence 脚本，从 DB + gh CLI 拉数据，渲染 6 key 到 run-evidence.md（含 R4 mitigation 的 evaluator_worktree_path 字段）。
**大小**: S
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] `sprints/w8-langgraph-v14/scripts/collect-evidence.sh` 文件存在且可执行
  Test: test -x sprints/w8-langgraph-v14/scripts/collect-evidence.sh

- [ ] [ARTIFACT] collect-evidence.sh 含查 tasks 表 SQL（status / parent_task_id 关联）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/collect-evidence.sh','utf8');if(!c.includes('tasks'))process.exit(1);if(!c.includes('parent_task_id'))process.exit(1)"

- [ ] [ARTIFACT] collect-evidence.sh 含查 harness_state_transitions 表（节点耗时数据源）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/collect-evidence.sh','utf8');if(!c.includes('harness_state_transitions'))process.exit(1)"

- [ ] [ARTIFACT] collect-evidence.sh 调 gh pr view 校验 PR 真存在（R2 反造假）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/collect-evidence.sh','utf8');if(!c.includes('gh pr view'))process.exit(1)"

- [ ] [ARTIFACT] collect-evidence.sh 输出文件路径硬编码为 sprints/w8-langgraph-v14/run-evidence.md
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/collect-evidence.sh','utf8');if(!c.includes('sprints/w8-langgraph-v14/run-evidence.md'))process.exit(1)"

- [ ] [ARTIFACT] collect-evidence.sh 输出 6 个 key 模板（initiative_task_id / tasks_table_status / pr_url / gan_proposer_rounds / node_durations / evaluator_worktree_path）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/collect-evidence.sh','utf8');for(const k of ['initiative_task_id','tasks_table_status','pr_url','gan_proposer_rounds','node_durations','evaluator_worktree_path']){if(!c.includes(k)){console.error('missing key:',k);process.exit(1)}}"

- [ ] [ARTIFACT] collect-evidence.sh 渲染的 evaluator_worktree_path 必须包含 task- 前缀（R4 worktree 串扰 mitigation 实证）
  Test: node -e "const c=require('fs').readFileSync('sprints/w8-langgraph-v14/scripts/collect-evidence.sh','utf8');if(!/evaluator_worktree_path/.test(c))process.exit(1);if(!/task-/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 不修改 packages/brain / packages/engine / packages/workflows 任何文件
  Test: bash -c "git diff --name-only main...HEAD | grep -E '^(packages/brain|packages/engine|packages/workflows)/' && exit 1 || exit 0"

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/collect-evidence.test.ts`，覆盖：
- collect-evidence 脚本可执行性
- 执行后 run-evidence.md 6 key 全有非占位值
- mtime 在执行后 2h 内
- pr_url 经 gh pr view 真实校验（R2）
- evaluator_worktree_path 含 task- 前缀（R4 mitigation 实证）
