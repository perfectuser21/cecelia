## Brain {VERSION} — coding workflow 开闸 zenithjoy-workspace（C7）

- `repos.json`：`zenithjoy-workspace` 改 `enabled=true`。runner 默认启用 cecelia + zenithjoy（按表顺序）；Brain `work-router`（同读 repos.json）对 zenithjoy 的无头编码单改投 `coding_workflow`，不再抛 `runner_repo_unsupported`（未登记仓库仍抛）
- zenithjoy 第一阶段口径不变：`automerge=false`（QA + 裁判通过、必需检查全绿后停在 awaiting_human，Bark 主理人人工合并）、QA 走 local（不起预览）、回归 smoke 不固化
- 紧急关闸：plist 设 `CODING_WF_REPOS=cecelia`（不用改表），或把本行改回 `enabled=false`
- 运行时口径：runner 每 300s 自更新到 origin/main，合并后下一轮起认领 zenithjoy 任务，`runner.sh` 自动 clone `~/perfect21/zenithjoy-cw-runner`（不碰主理人的 zenithjoy checkout）；Brain 侧路由在 Brain 镜像重新部署后生效
