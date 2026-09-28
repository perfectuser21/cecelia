## Brain {VERSION} — 秋米派活修复：执行参数解析 + 写明即直派 + 不强传模型 + 正文全读 + 中文短标题（任务 0d4215f2，决策 56328560）

- 新增 `routing/exec-params.js`：解析正文【执行参数】块（执行Agent / 模型 / 超时 / 验收 / 设备 / 思考强度），只认固定字段名，模型别名与允许清单精确匹配、不做后缀猜测；写错即 `exec_params_invalid`
- 删除 `cheap-gates` 的「用 <型号>」正文正则：模板里的「调用Agent：」曾被匹配成 `agent` → `xai/grok-4.20-multi-agent`，09-23 起 Notion 秋米任务全挂
- `qiumi-router`：写明执行者（执行参数 > Notion 关联列）即直派，不调 Jev；未知 agent 判 `exec_agent_unknown`；模型只取执行参数，不再由 engine 推导（空则用 agent 自身默认模型）；超时 / 思考强度 / 验收 / 设备落 payload
- `openclaw-agent-executor`：`--model` 可选，`--timeout` 与 `--thinking` 按 payload（白名单 + 越界回落）
- 新增 `lib/notion-page-content.js`：正文分页读完、下钻子块、表格按行、2 万字上限（原顶层前 100 块、8000 字）
- `pre-flight-check`：`qiumi_task` 标题下限 2 字（「抖音养号」曾被三振），其余仍 5 字
