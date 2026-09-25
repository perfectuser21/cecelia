## Brain {VERSION} — skill-sync-to-runners 慢链路修复：超时可配 + --partial + 失败重试（任务 4950ccf3，棒 8 遗留缺口）

- 病根（09-25 实测）：MMV→西安直连跨洋仅 7~16 KB/s，脚本里写死的 `rsync --timeout=60` 让首次全量同步（约 27MB，慢速下要二三十分钟）在 xian-m4/xian-m1 上都因 60 秒 IO 无进展而失败，每次 MMV 改 skill 都可能再撞
- 超时可配：`SKILL_SYNC_RSYNC_TIMEOUT`（默认 60，非数字/≤0 回落 60，慢链路建议 600~900），dry-run 打印与 apply 实跑同值；rsync 的 ssh 加保活 `ServerAliveInterval=30 ServerAliveCountMax=20`
- 续传：rsync 加 `--partial`，中断的大文件下次接着传；仍不带 `--delete`，prune 仍只在 `--prune` 时
- 重试：第一跳 rsync 因 rc=30/35/255（IO 超时/连接超时/ssh 断线）失败自动重试，最多 `SKILL_SYNC_RETRIES`（默认 3，0=不重试）次，间隔 `SKILL_SYNC_RETRY_BACKOFF`×第几次（默认 5s/10s/15s）；耗尽才判该目标失败，其它失败码（如 23）不重试；退出码语义不变（0/1/2/64），日志记录重试次数
- 测试：`skill-sync-to-runners.test.js` 新增假 rsync 注入（`SKILL_SYNC_RSYNC`，只记参数与注入退出码，其余转交真 rsync 走假 ssh，不连任何远端）——超时 env 传到命令行、7 种非法值回落 60、rc=30/35/255 一次失败后成功、耗尽退出 1 且不进入镜像、RETRIES 0/1/非法、rc=23 不重试、一个目标耗尽不影响另一个
