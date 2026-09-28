# 秋米派活修复：执行参数解析 + 直派 + 不强传模型 + 正文全读 + 中文短标题

任务 0d4215f2 · 决策 56328560 · 主理人 2026-09-28 对话确认范围

## 问题（已坐实）

| 现象 | 根因 |
|---|---|
| 09-23 起 Notion 秋米任务 4 条失败，OpenClaw 报 `Unknown model: xai/grok-4.20-multi-agent` | `cheap-gates.js` 的「用 <型号>」正则把模板里「调**用Agent**」匹配成 token `agent`，`resolveModelRef` 后缀唯一命中 `grok-4.20-multi-agent` |
| 写明了执行者仍去问 Jev；非部门 agent 写了也不生效 | `qiumi-router.js` 除设备委派分支外一律调 Jev；`--agent` 只取 6 个部门 |
| 不写模型也被强塞 `--model` | `model = cheap.hardModel ?? env.modelMap[engine]` 恒有值，覆盖 agent 自身默认模型 |
| 正文里的表格、折叠块内容丢失 | `fetchNotionPageContent` 只读 10 种顶层块、前 100 块、不下钻子块 |
| 「抖音养号」被三振 blocked | `pre-flight-check.js` 标题 < 5 字一刀切 |

## 设计

### 1. 执行参数块（新模块 `routing/exec-params.js`）

正文顶部可选块，只认固定字段名，不做任何正则猜测：

```
【执行参数】
执行Agent：media
模型：claude            （别名或完整型号）
超时：30分钟
验收：……
设备：小龙虾
思考强度：high
【执行参数结束】
```

`parseExecParams(body)` → `{ present, agent, model, modelRaw, timeoutSec, acceptance, device, thinking, errors[] }`

- 无该块 → `present=false`，全部字段 null，零错误。
- 字段分隔符接受 `：` 与 `:`；字段名大小写 / 全半角不敏感；未知字段忽略。
- 结束标记缺失时读到第一个空行为止。
- 模型：别名表（claude→`anthropic/claude-sonnet-5`、codex/terra→`openai/gpt-5.6-terra`、sol→`openai/gpt-6-sol`、grok→`xai/grok-4.7`）或允许清单里的全名 / 短名**精确**匹配；不做后缀猜测。解析不出 → `errors` 记 `unknown_model`。
- 超时：`N分钟 / N秒 / Nm / Ns / N`（默认单位分钟），范围 1–180 分钟；越界 → `errors` 记 `bad_timeout`。

### 2. 路由（`qiumi-router.js`）

顺序（先到先定案）：

1. 执行参数有 `errors` → `fail`（reason=`exec_params_invalid`，detail 列出错误），不猜。
2. 设备委派开关开且便宜闸定到序列号 → 原设备分支（不变）。
3. **写明了执行者** → 直派，**不调 Jev**：
   - 来源优先级：执行参数 `执行Agent` > Notion「执行 Agent / Workflow」关联列命中的 agent（部门或非部门）。
   - 执行参数里的 agent 名必须在 OpenClaw agent 池（`ops_agents` active）或部门表里，否则 `fail`（`exec_agent_unknown`）。
   - `engine` 记为 `explicit`，`qiumi_route.source='explicit'`。
4. 其余 → 原 Jev 流程，但**不再由 engine 推导模型**。

模型：只有执行参数写了 `模型` 才进 `payload.model`；否则 `payload.model = null`，由 agent 自身默认模型决定。
超时 / 思考强度 / 验收 / 设备写入 payload（`timeout_sec` / `thinking` / `acceptance` / `device_hint`）。

删除 `cheap-gates.js` 的「用 <型号>」正则分支（`hardModel` 字段保留为 null，兼容读方）。

### 3. 执行器（`openclaw-agent-executor.js`）

- `model` 改为可选：为空时命令里不带 `--model`。
- `--timeout` 取 `payload.timeout_sec`，缺省仍为 1800。
- `payload.thinking` 有值时带 `--thinking`（白名单校验）。
- 必填仍是 `run_id` 与 `qiumi_department`（执行者）。

### 4. 正文读取（新模块 `lib/notion-page-content.js`，`notion-push-sync.js` 改为 import 再导出）

- 分页读完（`has_more` / `start_cursor`），递归下钻 `has_children` 的块（深度上限 3）。
- 新增块类型：`toggle`、`table`（逐行 `table_row` 单元格用 ` | ` 连接）、`child_page` 标题、`divider` 跳过。
- 总长上限 20000 字；超出截断并在末尾标注「（正文过长已截断）」。
- 任一请求失败仍返回已读到的部分；全失败返回 ''（不阻塞排单，行为不变）。

### 5. 标题预检（`pre-flight-check.js`）

`qiumi_task` 标题下限 2 字（中文 2 字已可表意）；其余任务类型保持 5 字不变。

## 测试策略

| 层 | 内容 |
|---|---|
| unit | `exec-params`：无块 / 完整块 / 全角冒号 / 缺结束标记 / 别名 / 全名 / 未知模型 / 超时各单位与越界；**回归：正文含「调用Agent：」且无参数块 → 不产生任何模型** |
| unit | `qiumi-router`：写明 agent 不调 Jev（fetch 不被调用）；关联列命中非部门 agent 直派；未知 agent → fail；参数错误 → fail；无模型 → payload.model=null；有模型 → 原样 |
| unit | 执行器：无 model 时命令不含 `--model`；timeout / thinking 进命令；非法 thinking 被拒 |
| unit | 正文读取：分页、子块递归、表格、截断、部分失败 |
| unit | 预检：qiumi_task 2 字通过、1 字拒；dev 任务 4 字仍拒 |
| 真实验收 | 部署后把 4 条失败 + 1 条 blocked 的任务重排，查库：`payload.model` 不再是 `grok-4.20-multi-agent`、OpenClaw 退出码 0 |

## 不在范围

技能工厂串联、Jev 题目调整、按额度选 provider、其它任务类型接 Jev。
