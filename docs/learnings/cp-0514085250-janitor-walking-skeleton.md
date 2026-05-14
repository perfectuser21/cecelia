# Learning: Settings 控制中心 + Janitor Walking Skeleton

### 根本原因
系统维护任务长期散落在各模块，没有统一注册/调度/记录机制，导致磁盘爆满无预警（OrbStack data.img.raw 膨胀至 127GB）、无法从前端控制任何维护行为。

### 下次预防
- [ ] 新增 Brain 维护类功能必须注册到 janitor.js REGISTRY（导出 JOB_ID/JOB_NAME/run()）
- [ ] brain-build.sh 已自动触发 docker image prune，不需要手动清理
- [ ] OrbStack data.img.raw 是稀疏文件，删除后需执行 `sudo purge` 才能让 APFS 回收 purgeable 空间
- [ ] Settings 新配置项统一放到对应 sub-page（Brain系统/维护/通知/账户），不要在其他页面单独加开关

### 部署陷阱

- [ ] brain-build.sh 默认从 origin/main 拉代码，若分支尚未合并需显式 `DEPLOY_BRANCH=<branch>`
- [ ] Worktree 的 .git/worktrees/<name> 元数据会被 `git worktree prune` 自动清除，需手动重建三个文件（gitdir/commondir/HEAD）
- [ ] brain-deploy.sh 从 worktree 运行会内部再调 brain-build.sh（origin/main），导致覆盖刚构建的分支镜像；应从主仓库根目录以 DEPLOY_BRANCH 运行 brain-build.sh，然后 `docker compose up -d node-brain`

### Smoke 脚本修复
- [ ] janitor-smoke.sh 第 23 行 grep pattern 应为 `'"status":"[^"]*"'`，不是 `'"last_status":"[^"]*"'`（API 返回嵌套结构 last_run.status，不是顶层 last_status 字段）
