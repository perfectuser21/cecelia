# PRD — resume 历史软链回主仓（修 session 隔离副作用）

## 背景

PR #3557 session 隔离后每个交互 session 落唯一 cwd，Claude Code 按 cwd（物理路径）派生 projects key 存 transcript，
/resume 按当前 cwd 的 key 过滤 → 只见当前 session 自己，历史全部不可见，且持续产生孤儿文件夹。

## 目标

per-session worktree 的 projects key 软链到主仓 key，transcript 汇聚一池，
/resume 在任意 session worktree 内可见全部历史。

## 需求

1. launcher 建 worktree 并 cd 后、claude 启动前，建软链 <wt_key> → <main_key>（key 按物理路径派生；CLAUDE_PROJECTS_ROOT 可覆盖）。
2. <wt_key> 位置已存在孤儿真实目录 → 内容迁入主仓文件夹后替换为软链；迁移失败保留原目录不建链。
3. 干净退出清理 worktree 的同一分支里删软链（_PROJ_LINK_CREATED 记账，-L 先验，只删链接本身）；脏 worktree 保留时软链保留。
4. 全段 best-effort：任何失败仅 stderr 警告，不阻断 claude 启动。
5. --dry-run 契约：auto-worktree 分支输出含 ln -s 行。

## 成功标准

- claude 运行期内 <wt_key> 是指向 <main_key>（物理 key）的软链；孤儿目录被迁移合并。
- 干净退出软链删除、主仓池子 transcript 完好；脏退出软链保留；幂等复用/错误目标替换正确。
- 软链失败（如只读 root）→ claude 照常启动、退出码透传、stderr 警告。
- --dry-run 输出含 ln -s；headless/逃生阀/已在 worktree 场景行为不变。
