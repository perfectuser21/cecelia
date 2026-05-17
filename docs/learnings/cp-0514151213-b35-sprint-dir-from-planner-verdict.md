# B35 — parsePrdNode sprint_dir 提取问题

### 根本原因

B34 添加了 subdir scan fallback，但 `sprints/` 目录在 git 历史中含有所有旧 sprint（w19-w44），readdir 按字母顺序返回，先找到 `w19-playground-sum/sprint-prd.md` 而非当前 sprint。

`parsePrdNode` 只读 `state.task?.payload?.sprint_dir`（值为 `'sprints'`），而 planner skill 的 verdict JSON 明确包含正确的子目录路径 `sprint_dir: "sprints/w45-xxx"`，但从未被提取。

### 下次预防

- [ ] planner 类 node 输出 JSON verdict 时，消费者 node 必须在第一步提取关键字段
- [ ] harness 新增状态字段后，检查所有赋值路径（payload / verdict / state）优先级
- [ ] subdir scan fallback 不适合存在历史目录的 git worktree 场景
