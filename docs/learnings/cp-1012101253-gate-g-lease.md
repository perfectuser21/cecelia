# 统一领单租约 + 心跳 + 设备池（派发总闸 G，任务 c5f6e683）

## 背景
外部执行者各自 claim、死了没人知道：openclaw-agent/controller 探活 unknown 一律 fail-open 不处置；
设备锁的「持有任务 in_progress」判据让锁 TTL 被无限压住；手机写死一台，忙了就只能等。

## 做法
- 租约单独成表 task_leases（不给 tasks 宽表加列），claim 带 lease_seconds 即落、heartbeat 续约、reaper 60s 收过期
- 过期处置复用执行者合同 onStale：requeue/release-claim-and-alert → 回队，其余外部执行体 → 判 lost；领单方可显式覆盖
- Brain 自派 openclaw-agent 落「超时 + 15 分钟」的 Brain 租约，过期先探活再判
- 设备锁占用判据改成「in_progress 且租约未过期」，无租约旧持有者最多保护 240 分钟；只回收已过期的锁
- 设备池 = 同平台同账号类型；派发按 priority 过同一道设备闸，被占换下一台

## 踩坑
- tasks.retry_count / max_retries 生产库有、迁移建出的库没有（CI/scratch）——回队计数改存 task_leases.requeue_count
- pg 参数同时当 integer 列值和 make_interval(secs => $n)（double）会报 42P08，统一写 `$n::int * INTERVAL '1 second'`
- 会话 cwd 在主仓时 Write/Edit 被主仓守卫拦，bash-guard 按 hook 进程 cwd 判分支——先 `cd` 进 worktree 再用 bash 写文件，git 用 `git -C <worktree>`
