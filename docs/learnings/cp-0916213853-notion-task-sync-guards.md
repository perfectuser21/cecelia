# Notion 双向同步"死链"调查与守卫补齐（2026-09-16）

## 根本原因

- 症状（私人 Task DB 推/拉停摆）的真死因是 **env 变更未随容器重启生效**：`NOTION_LEGACY_PUSH_ENABLED=true` 于 09-16 08:24 写入 .env.docker，但 cecelia-node-brain 容器未重建；20:10 容器随其他部署重建后同步自愈。
- 交接误诊为「legacy-notion-push-scheduler.js 全库无人 import」：查证时在容器 `/app/src/` 下 grep，而接线在包根 `/app/server.js` 且为**动态 import**（`await import(...)`），静态 import 语法搜索命中不了。
- 二次误判险情：本地主仓库 checkout 落后 origin/main 175 个 commit，在 stale 工作区上 grep 得出"repo 没有 pushTasks"的假分叉结论——查证必须对 `origin/main`（`git show origin/main:<file>`）或干净 worktree。

## 下次预防

- [ ] 查"谁 import 了 X"必须覆盖：包根文件（server.js 不在 src/ 下）+ 动态 `import(` 字符串 + 全仓库（不只容器某目录）
- [ ] 改 .env.docker 后必须重启/重建容器并在日志确认生效行（如 `[legacy-notion-push] enabled`），否则"已设但无效"
- [ ] 在主仓库做代码考古前先 `git fetch` 并对 `origin/main` 查证，不信任本地工作区
- [ ] 调度入口孤儿化风险已由本 PR 两个 CI 守卫锁死（server.js 接线断言 + 默认 run 并联断言，均 proven-to-fire）
- [ ] blob:none partial clone 的仓库 push 会因 lazy-fetch 风暴挂死——patch 经完整 clone 的机器（us-vps /root/cecelia worktree）中转推送
