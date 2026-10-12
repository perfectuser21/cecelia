## coding workflow 开闸 zenithjoy：开关翻转要先把「依赖关闸状态」的测试改成显式口径（2026-10-12）

### 根本原因
- C4~C6 把多仓库能力做完，但 zenithjoy 仍 `enabled=false`；开闸只是一行配置，却有 14 条测试隐式依赖「真实 repos.json 里 zenithjoy 未启用」（用 zenithjoy 当「不支持的仓库」样本），翻开关即全红。
- Brain work-router 与 runner 同读 repos.json，开闸同时改变 Brain 的无头编码单路由——这是期望的单一来源效果，但必须有断言钉住。

### 下次预防
- [ ] 测「不支持/未启用的仓库」用未登记的仓库名或注入的配置表（`CODING_WF_REPOS_FILE` / `enabled` 参数），不要拿真实表里一个暂时关着的仓库当样本
- [ ] 开关类配置同时提供不改表的紧急关闸（`CODING_WF_REPOS=cecelia`），并有测试钉住
- [ ] 配置翻转 PR 的描述写清两侧生效时机：runner 自更新（300s）与 Brain 镜像部署
