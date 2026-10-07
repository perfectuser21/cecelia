## coding workflow 第二刀：spec 自身超时 + report 回写 Brain（2026-10-07）

### 根本原因

- 第一刀端到端时真 claude 生成的 02-spec 自己提出两个缺口（S-4 spec 自身超时、S-5 report 回写），本刀照单实现——产物链开始反哺下一刀。
- 修"超时只杀直接子进程"时让 claude 自成进程组（detached），结果把执行器的整组收割挡在外面：执行器取消只给活动根发 SIGTERM，活动无 SIGTERM 处理直接退出，claude 带 acceptEdits 权限成孤儿继续改 worktree。审查者用执行器真实取消路径实测复现。
- 孙进程继承 stdout 管道时，父进程 close 事件永远不来，活动会挂到超时被误判。

### 下次预防

- [ ] 活动里凡 spawn 的子进程若自成进程组，必须自己处理 SIGTERM 并在执行器 cleanup_grace_s 之内整组收割
- [ ] 子进程收尾以 exit 为准，exit 后短 grace 未 close 就整组 SIGKILL 并 destroy 管道
- [ ] 活动自身超时必须钳在契约 budget 之内，否则执行器先到、原因码退化
- [ ] Brain PATCH 只传 result 是 jsonb 合并语义，可安全追加字段；不要顺带传 status
