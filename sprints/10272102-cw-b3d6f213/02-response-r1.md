### R-1
处理: 采纳
说明: `activities/intent.mjs` 的 `outputs.intent_sha256` 只在活动结果中，`lib/protocol.mjs` 将该结果写入子进程 stdout；任务 API 的 runner 摘要不能替代。S-4、QA 场景总则及 Q-1 已明确由 QA 外控制器只读交付本次 intent 原生 stdout JSON、执行输入与新 01 文件归属。QA 核任务 ID、预置场景 nonce、新 01 路径和文件 frontmatter 后，独立重算文件 SHA-256 与该次结果的 `outputs.intent_sha256` 比较；缺结果或归属证据不得判 PASS。不新增历史快照接口，也不要求 QA 读取 03/04 或保护来源根。
