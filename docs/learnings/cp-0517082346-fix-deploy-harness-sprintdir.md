# Learning: 三联修复 — deploy 容器命名冲突 + harness 重启丢检查点 + sprint_dir 检测不稳

## 根本原因

**Fix 1 (scripts/brain-deploy.sh)**
只清理 `exited|created` 两种状态，漏掉 `restarting/pausing/dead` 及外部 compose project 的 `running` 容器。`docker compose up -d` 遇到同名容器报 naming conflict，Brain DOWN。

**Fix 2 (packages/brain/src/executor.js)**
`syncOrphanTasksOnStartup` SELECT 无 `task_type` 字段，把所有 `in_progress` 任务当 OS 进程孤儿。`harness_initiative` 是 LangGraph 同步任务（Brain 进程内运行），无子进程，`isTaskProcessAlive()` 永远 false。每次 Brain 重启 → reset + 丢 checkpoint → 从头跑 Attempt N+1。

**Fix 3 (packages/brain/src/workflows/harness-initiative.graph.js)**
B37 用 `git diff origin/main HEAD -- sprints/`，但 GAN propose 阶段 HEAD 可能不含 Planner 的提交（切到 propose branch 后），diff 为空 → sprintDir 回退 LLM 解析（不稳定）。子任务 `payload.sprint_dir` 只写 graph state 内存不写 DB，Brain 重启后 dispatcher 从 DB 读到旧的顶级 `sprints/`，Proposer ENOENT。

## 下次预防

- [ ] `syncOrphanTasksOnStartup` 处理新任务类型时，先检查 SELECT 是否含 `task_type`，新的同步执行类型（无子进程）必须加入 `LANGGRAPH_TYPES` 白名单并以 `resume_from_checkpoint=true` requeue
- [ ] docker 容器清理：始终用无条件 `docker rm -f`（精确名称 `^/container-name$` 匹配），禁止分状态逐一过滤
- [ ] harness sprint 路径写入：创建子任务时同步写 `payload.sprint_dir`，不依赖 graph state 内存传递（重启后丢失）
- [ ] parsePrdNode 文件系统检测：优先 `git log --diff-filter=A origin/main..HEAD`（覆盖整条历史，不只 HEAD diff），git 失败时 fallback `find sprints/ -maxdepth 1 -mindepth 1 -type d`
- [ ] `LANGGRAPH_TYPES` 等常量禁止定义在循环体内
