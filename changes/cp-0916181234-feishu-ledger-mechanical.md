## Brain {VERSION} — 飞书交办入账去 LLM 化 + 修 mentions 漏判

- **修阻断性 bug**：飞书历史消息 API 的 `mentions[].id` 是扁平字符串（`{"id":"ou_xxx","id_type":"open_id"}`），而 webhook 事件才是嵌套 `{"id":{"open_id":...}}`。模块原先只认后者，导致 requireMention 群候选恒空——悦升云端群一条都入不了账。新增 `mentionOpenId()` 兼容两种形态，回归测试锁死。
- **判据2 去 LLM 化**：「秋米有没有真派 agent 去干」是机械事实，OpenClaw `task_runs` 已记录，不需要让 LLM 猜意图。原实现在 us-vps 上遇 Anthropic 欠费 / MiniMax 超额即整条腿卡死（2026-09-16 实证）。
- **改为三态机械判定**（零 LLM、零 API 费用）：交办后 10min 内有非 cron 执行记录 → `executed`（入账 completed）；无执行但秋米有回复 → `answered`（当场答完的提问，不入账）；既无执行也无回复 → `dropped`（派了没人管的活，入账 blocked——主理人最该看见的一类）。重发组内任一条命中即算 executed（实测 run 常挂在后一次重发上）。
- Brain 镜像加 `sqlite` CLI（~1.5MB）只读查 OpenClaw 库；容器 Node 20 无 `node:sqlite`（22.5+ 才内置）。`-readonly` 防写穿第三方状态库。
- 真实数据验证：近 7 天 56 条 @秋米 消息，抽最新 25 条人工核对——「帮我整理成表格」「mcp+cli 联动同步」「给于瑾弹授权」全部命中 run；「表在哪」「现在的模型是什么」「在吗？」「授权成功了」全部 0 run 正确排除。
