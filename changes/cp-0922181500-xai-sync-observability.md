## Brain {VERSION} — grok token 同步器补可观测性：日志时刻按本地时区、逐 agent 出进度

- launchd 首轮实跑暴露两处：①`date -r` 在 launchd 环境（不带 TZ）按 UTC 渲染，把到期时刻 `23:01` 打成 `08:01`，排查时会误以为 token 早已过期；②23 个 agent × 每个约 30s ≈ **11 分钟整轮零输出**，「卡住」和「正常跑」在日志上完全同形。
- 修：到期时刻显式按 `SYNC_TZ`（默认 `Asia/Shanghai`）渲染并带时区缩写；开跑先报总数与预计耗时，每个 agent 留一行 `[N/总数] <agent>`。
- 守卫加 3 项断言（每个 agent 有进度行 / 进度带 N/总数 / 两个时区渲染结果必须不同），共 16 项；新增 2 项变异实跑验证被抓。
- 时刻渲染要 GNU/BSD 双兼容：`date -r <epoch>` 是 BSD/macOS 写法，GNU coreutils 的 `-r` 是「取文件 mtime」，在 Linux 上必然失败并回落成打印原始 epoch。生产在 MMV（macOS）而 CI 跑 Linux——**守卫在 CI 上把这个 macOS 专用写法抓了出来**，已改为先试 GNU `-d @<epoch>` 再试 BSD `-r`，两家本地都实跑验证过。
