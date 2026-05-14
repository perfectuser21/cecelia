## B34 Sprint 子目录检测（2026-05-14）

### 根本原因
Harness planner 在真实 worktree 中按历史惯例创建 `sprints/{sprint-name}/` 子目录（容器里 `HARNESS_SPRINT_DIR` env 指向完整路径），但 Brain 代码在 3 处用 `sprints/` 顶层路径硬读文件，导致 ENOENT 连锁失败：
1. Runner Phase A 读 `sprint-prd.md` → GAN 收到 planner stdout 废话而非真 PRD
2. `parsePrdNode` 同路径 → GAN 收错内容且 state.sprintDir 缺失
3. `inferTaskPlanNode` 读 `${sprintDir}/task-plan.json` → "proposer_didnt_push" 误报

W44 验证跑失败时只看到最后一个错误（inferTaskPlanNode），真正根因是从第 1 步开始的路径错误。

### 下次预防
- [ ] 凡读 `sprints/` 下固定文件名时，加 `readdir` fallback 扫描子目录
- [ ] 子目录扫描代码里的路径前缀必须用 `sprintDir` 变量，不能硬编码 `'sprints'`（本次 code review 捕获了这个回归）
- [ ] 新增 LangGraph 状态字段时同步更新两处 `Annotation.Root`（`InitiativeState` + `FullInitiativeState`）
- [ ] W 级验证失败后优先看 Brain console.error 日志，ENOENT 路径错误通常一眼可见
- [ ] Subagent 实现后必须核查 commit sha 和 `git show --name-only` 确认所有文件都入库了，不要只看 STATUS: DONE
