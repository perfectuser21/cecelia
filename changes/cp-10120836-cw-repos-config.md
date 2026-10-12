## Brain {VERSION} — coding workflow 仓库配置表（repos.json）与状态文件按仓库分命名空间，cecelia 行为不变

- 新增 `scripts/coding-workflow/repos.json`：一行一个仓库（slug、origin、别名、clone、worktree 根、状态命名空间、必需检查登记口径、落后 main 检查名、安装命令、回归 smoke 目录、版本碎片规则、预览类型、生产判定正则、automerge）。cecelia 启用；zenithjoy-workspace 先登记 `enabled=false`、`automerge=false`（12 个必需检查经 gh api 分支保护只读核实；生产判定只含 hk-vps 100.86.118.99 / :5200，不含 MMV 公网 IP 38.23.47.81）
- 新增 `runner/lib/repos.mjs`：读表校验、别名归一（短名 / owner/repo / https / ssh URL / 缺省归 cecelia）、`CODING_WF_REPOS` 开关（与表内 enabled 双闸）、每仓库视图 `repoView`、状态路径 `prFile` / `stateDir`
- `plan.pickCandidates`：不支持的仓库不再静默过滤——未登记 / 未启用的每条打日志；返回任务带 `repoKey`
- `cifix-scan` 必需检查缓存从进程级单例改为按仓库（clone）的 Map，避免拿错仓库的必需检查放行合并
- qa / cifix / commander 状态与会话日志改走 `<logDir>[/<ns>]/`：cecelia 命名空间为空，沿用旧路径零迁移（含 C3 的 closed / reopened 字段）；保留期清理同时扫各仓库命名空间目录
- `loadConfig` 新增 `cfg.repos`（已启用仓库）与 `repoKey` / `repoSlug` / `stateNs`；`CODING_WF_REPO` / `CODING_WF_WORKTREE_BASE` 照旧覆盖 cecelia
- 运行时口径：runner 每 300s 自更新到 origin/main，合并后下一轮起生效；cecelia 路径、文件名、认领结果不变，只多出未启用仓库任务的日志行
