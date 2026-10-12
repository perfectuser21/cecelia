## coding workflow 门禁循环按仓库遍历：仓库身份要跟着「视图」走，判卷代码不能跟着换（2026-10-12）

### 根本原因
- C4 有了 repos.json 与 `repoView`，但 run-once 的门禁循环、任务 worktree、gh 调用仍只作用于默认仓：gh 全靠 cwd 推断 `{owner}/{repo}`，worktree 从 `cfg.repo` 建，learnings / .dev-lock 写死 `repo: 'cecelia'`。
- 视图把 `cfg.repo` 换成目标仓库 clone 时，原本「判卷代码来自 runner 专用 clone」的 `path.join(cfg.repo, …)`（执行器、契约、evaluate）会被一起换走——判卷代码落到被测仓库里，等于让它判自己。
- zenithjoy 合入 main 会自动部署生产手机控制器，合并门不能只有「合并」一个出口。

### 下次预防
- [ ] 视图对象里区分「作用对象」（clone / worktree 根 / GH_REPO）和「可信来源」（trustedRepo），后者不随视图变
- [ ] 外部 CLI 的目标对象显式传（GH_REPO / -R），不靠 cwd 推断
- [ ] 不自动执行的出口（等人合并）也要有收账：人做完后 runner 负责把 Brain 状态推到终态，否则任务永远停在中间阶段
- [ ] 启动器补 clone 只补缺的，不对已存在的目录 fetch / reset，免得路径配错时冲掉人的现场
