## /reports 日报骨架（battle-report）（2026-07-07）

### 根本原因
作战循环缺每日 L1 对齐产物：战况/决策/哨兵数据器官就绪后没有"每天一份给主理人读的汇总"，Wave 2 后 diary 类定时总结全死（executeTick 废弃）没有替代通道。

### 下次预防
- [ ] migration"放开约束"类描述要读原文核实：195 名为 expand 实为重建 11 种白名单，凭文件名/记忆判断会翻车（本次设计初稿"不建 migration"被生产实测推翻）
- [ ] 含 brain/src 配置改动（如 selfcheck 版本号）的 commit 也受 lint-tdd-commit-order 约束——PR 首个 commit 若碰 brain/src 必须先有真 test commit，计划期把"migration+selfcheck"排在首个 Red 测试之后
- [ ] dev_records 写入链路自 2026-05-13 断供（日报 PR 段恒空）——接回写入或改用 initiative_runs/GitHub API 作 PR 数据源，留第二刀
- [ ] worktree 神秘清理今日发生 3 次（.git 链接被删/整目录被删）+ 主仓 apps/dashboard/node_modules 嵌套包被掏空——环境系统性问题，已恢复但根因未查（疑与 janitor/cleanup-worker 或 npm 穿透有关）
