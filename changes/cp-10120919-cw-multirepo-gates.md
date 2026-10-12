## Brain {VERSION} — coding workflow 门禁循环按仓库遍历，automerge=false 的仓库止于「已批准、等人合并」

- `run-once`：门禁（外部关闭收尾 → 人工合并收账 → 合并门 → commander → CI 修复 → QA 门）按 `cfg.repos`（repos.json 顺序）逐仓库跑，每个仓库用自己的视图（clone / worktree 根 / 状态命名空间 / GH_REPO）；任一仓库做了事本轮到此；clone 不存在的仓库跳过并记日志
- 任务执行按 `task.repoKey`：worktree 从该仓库 clone 建在它的 worktree 根，依赖安装用 repos.json 的 `install`，`.dev-lock` 记 `repo=<key>`；判卷代码（契约、执行器、evaluate）仍只从默认仓 clone 读（`cfg.trustedRepo`）
- gh 调用统一走 `proc.gh(cfg, …)`：cwd=该仓库 clone 且设 `GH_REPO=<owner/repo>`（等同 `gh -R`，`gh api` 的 `{owner}/{repo}` 也按它解析），不再靠 cwd 推断仓库
- 合并门：`repos.json automerge=false` 的仓库在 QA + 独立裁判通过、必需检查全绿后不调 `gh pr merge`，记 `qa 状态.awaiting_human`、Brain `runner.phase=awaiting_human` / `merge.awaiting_human=true`，Bark 主理人（复用 commander 上交的 Bark 通道，同一批准 head 只通知一次）；人工合并后下一轮收账（`merge.merged=true, by=human`、`phase=merged`、交接单、终态合并 span、learnings）
- learnings 的 `repo` 改为仓库 key；CI 修复的「落后 main」检查名按仓库（`base_fresh_check`，null 则不走 update-branch）；QA 门只对 `preview.type=brain_preview` 的仓库起预览，其他 QA 模式（zenithjoy local）接入前不验、不批准
- `runner.sh`：其他已启用仓库（repos.json enabled + `CODING_WF_REPOS`）clone 不存在时按 repos.json 的路径与 origin clone，已存在的不 fetch、不 reset；`install.sh` / plist 模板透传 `CODING_WF_REPOS` 并预 clone；新增 `runner/list-clones.mjs`；`CODING_WF_REPOS_FILE` 可覆盖配置表路径（测试 / 演练）
- 运行时口径：runner 每 300s 自更新到 origin/main，合并后下一轮起生效；zenithjoy 仍 `enabled=false`，cecelia（automerge=true、命名空间为空）路径与行为不变
