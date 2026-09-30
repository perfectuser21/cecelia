# 秋米 agent 见正文执行参数块自派子会话，空报告被当完成（09-29）

### 根本原因
- Brain 已按执行参数用 `--agent media --model openai/gpt-6-sol` 起 agent，但 prompt 原样带着「执行Agent：media/模型：sol」块，agent 读成"要再派 media/sol"，sessions_spawn 子会话后 sessions_yield。
- 收割器只看退出码：exit 0 一律 completed_no_pr，`result.payloads=[]` / `meta.yielded=true` 没人看，真机操作在追踪外跑完。

### 下次预防
- [ ] 给 agent 的 prompt 里不留"调度指令样"的文本：已被 Brain 消费的参数要么摘掉，要么明确声明已应用
- [ ] 收割判完成要看"交付物在不在"（最终文本 / payloads），不只看退出码；用生产真实 .log 当夹具回放
