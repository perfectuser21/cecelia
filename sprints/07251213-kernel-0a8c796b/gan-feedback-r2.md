# Round 2 终验反馈

Evaluator 在 PR #4327 head `90a6ef1bfb03b9d3aa6d75a659bd983842758fb4` 真跑后确认：

- 产品行为、真 PostgreSQL 路径、launcher、allowlist、cleanup、版本同步均可通过。
- 获批 DoD 仍引用已经毕业迁移掉的 `sprints/.../tests/*.ts`，与 PR 的永久池 `tests/live` / `tests/regression` 不一致。
- 最终 E2E 未强制 `RUN_LIVE_HAIKU=1`，导致真 Haiku 子测试可被跳过。
- Round 2 把 `anthropic-api` 写成唯一运输层超出 PRD；PRD 要求真实 Haiku 摘要，不指定付费直连。当前系统默认真实运输层是 Claude Code 订阅 bridge。
- local_api evaluator 在 Docker 内应显式连接宿主 `cecelia_test` 与 executor bridge，不能把 `localhost` 当宿主。

Round 3 只修上述合同/验收剧场漂移，不扩大产品范围。
