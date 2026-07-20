# Architecture: 对话原始捕获——多工具扩展 + session 闲置判定 + Haiku 摘要

- Initiative: `4ec80bd4-6c7e-40eb-b862-fef5953eb8ad`
- Decision: `39fa77ac-4915-4dae-90df-7f24745f102d`
- 前身: PR #4135（`docs/architecture/2026-07-20-conversation-capture/architecture.md`）
- 日期: 2026-07-20

## 概述

对已上线的对话原始捕获做三处修改：① 从"10 分钟轮询 + 文件 mtime 变化就抓"，改成"按 session 分组 + 15 分钟无新消息才算这个 session 结束"；② 从只支持 Claude Code，扩展到同时支持 Codex CLI 和 Grok CLI；③ session 判定结束后，除了原始文本，额外调一次 Haiku 生成 2-4 条 topic 摘要，两者都写进 `captures`。

## 三家工具的会话日志格式（已实测确认）

| 工具 | 路径 | 结构 | 是否需要过滤 |
|---|---|---|---|
| Claude Code | `~/.claude/projects/<slug>/<uuid>.jsonl` | 一个文件 = 一个 session；每行 `{type, uuid, timestamp, message:{role, content}}` | 需要（`role=user` 且 content 非 tool_result，见 PR#4135 的 `isRealUserText`） |
| Codex CLI | `~/.codex*/history.jsonl`（`.codex`/`.codex-team1`/`.codex-team2` 本机确认存在；`team3/4/5` 在西安机器，本次不碰） | 全局单文件，多 session 共用；每行 `{session_id, ts, text}` | 不需要——已经是纯人类输入 |
| Grok CLI | `~/.grok/sessions/<url编码的cwd>/prompt_history.jsonl` | 按项目目录分文件，目录内仍可能多 session 共用；每行 `{session_id, timestamp, prompt}` | 不需要——已经是纯人类输入 |

Codex/Grok 的"纯人类输入专用日志"比 Claude Code 的完整 transcript（`chat_history.jsonl`/`sessions/*.jsonl` rollout）更适合直接用——那些完整 transcript 里同样存在系统注入的 `user_info`/`AGENTS.md` 之类伪 user 消息，Codex/Grok 官方已经把"真人输入"单独抽出来一份，不用我们自己重新过滤。

## 范围边界（明确不做）

- **不做跨机同步**：只读 Brain 所在的美国本机文件。西安机器（`xian-m4`，Codex `team3/4/5` 账号所在地）上产生的内容这次不抓——同事有时会用 US 申请的 token 在西安机器交互式使用 Codex，US 本机的 `.codex-team1/2` 不会有这些内容（他登录的是西安本地账号目录，token 只是从 US 转发过去），所以"只读本机"这条规则天然把同事的内容排除在外，不需要额外的账号白名单。
- **不做多用户身份区分**：US 本机上如果有人交互使用（预期只有 Alex 本人），一律按 Alex 的话处理。
- 沿用 PR#4135 已定的边界：不做检索/追溯能力。

## Session 分组与"结束"判定

Claude Code 天然一个文件一个 session；Codex/Grok 是多 session 共用一个文件，需要先按 `session_id` 分组，取每组最后一条消息的时间戳，作为该 session 的"最后活跃时间"。

**判定规则（三家统一）**：`now - 该session最后一条消息时间戳 >= 15分钟` → 判定为已结束，进入处理；否则跳过（可能还在继续说）。

**幂等 key 设计（避免同一个 session 被反复处理）**：
```
dedupeKey(原始) = sha256(source + ':' + sessionId + ':' + lastEntryId)
dedupeKey(摘要) = sha256(source + ':' + sessionId + ':' + lastEntryId + ':summary')
```
`lastEntryId` 用该 session 最后一条消息的 `uuid`（Claude Code）或该行在文件里的序号（Codex/Grok 无天然 uuid，退化用 `session_id + 行号`）。**关键设计点**：dedupeKey 绑定到"最后一条消息"而不是只绑定 `sessionId`——这样同一个 session 如果长时间沉默后又被用户重新打开继续聊（同一个 `session_id` 复用），下一次这个 session 再次判定"结束"时，`lastEntryId` 已经指向新的最后一条消息，dedupeKey 随之变化，会产生一条新 capture，不会因为"session_id 之前处理过"就永远跳过后续内容。代价：如果用户在同一个 session 里反复"沉默 15 分钟又继续说"，会产生多条 capture（可接受，比"漏掉后续内容"更安全）。

## 数据模型变更

不新建表。

1. `packages/brain/src/routes/captures.js` `VALID_SOURCES`：`conversation` 拆成三个值 `conversation-claude` / `conversation-codex` / `conversation-grok`。
2. `packages/brain/src/routes/captures.js` `VALID_NATURES` 新增 `session_summary`（Haiku 摘要用这个 nature，跟系统产出的 `learning/issue/handoff` 区分开）。
3. 新 migration `packages/brain/migrations/356_rename_conversation_source.sql`：把 PR#4135 已经生产写入的 `captures.source = 'conversation'` 历史行改名为 `'conversation-claude'`（纯 data migration，非 DDL）。

## 模块变更

沿用 PR#4135 flat-file 风格（不建子目录）：

| 模块 | 变更类型 | 说明 |
|---|---|---|
| `packages/brain/src/conversation-capture-claude.js` | 新建（从旧 `conversation-capture.js` 拆出并改造） | `extractClaudeSessions(sinceMs)` — 扫 `~/.claude/projects/*/*.jsonl`，每文件当一个 session，复用 PR#4135 的 `isRealUserText`/`extractText` 逻辑，返回 `[{sessionId, turns, lastActivityMs, lastEntryId}]` |
| `packages/brain/src/conversation-capture-codex.js` | 新建 | `extractCodexSessions(sinceMs)` — glob `~/.codex*/history.jsonl`，按 `session_id` 分组，直接用 `text` 字段（无需过滤） |
| `packages/brain/src/conversation-capture-grok.js` | 新建 | `extractGrokSessions(sinceMs)` — glob `~/.grok/sessions/*/prompt_history.jsonl`，按 `session_id` 分组，直接用 `prompt` 字段 |
| `packages/brain/src/conversation-capture.js` | 重写为编排层 | `runConversationCapture(pool, {llm=callLLM}={})` — 调三个适配器拿到全部 session、过滤出"已闲置≥15分钟"的、逐个：①原始文本 `pushCapture(nature=null)` ②调 `llm('thalamus', prompt)` 生成摘要 `pushCapture(nature='session_summary')`；失败处理同 PR#4135（`result===null`/异常都计入 errors，绝不静默） |
| `packages/brain/src/routes/captures.js` | 修改 | `VALID_SOURCES`/`VALID_NATURES` 扩容 |
| `packages/brain/migrations/356_rename_conversation_source.sql` | 新建 | 历史行改名 |
| `packages/brain/scripts/smoke/conversation-capture-smoke.sh` | 修改 | 加 codex/grok 适配器结构校验 + 新 source/nature 值校验 |

`scheduler-jobs.js` 不需要改——已注册的 `conversation-capture` job 继续调 `runConversationCapture(pool)`，函数签名不变（新增的 `llm` 可选参数有默认值）。

## LLM 摘要 Prompt 与调用方式

复用 `capture-triage.js` 已验证的调用惯例：`llm('thalamus', prompt, { maxTokens })`，`thalamus` profile 已配置为 haiku（`model-profile.js`），返回 `{text}`，用 `json-utils.js` 的 `extractJsonObject` 解析。

```
你是 Cecelia 的对话摘要助手。以下是 Alex 在一段 AI 编程会话里说过的原始内容（只有他自己打的字，不含 AI 回复）。
提炼出 2-4 条这段会话的核心话题，每条一句话。只输出 JSON，不要其他文字：
{"topics": ["话题1", "话题2", ...]}

原始内容：
---
<拼接后的turns>
---
```

摘要 capture 的 `content` 字段写 `topics` 数组 join 成的文本（如 `"1. xxx\n2. xxx"`），原始 capture 的 `content` 写 turns 原文拼接（仍按 `pushCapture` 现有 2000 字符截断）。

## 关键决策

| 决策 | 选项A | 选项B | 选择 | 理由 |
|---|---|---|---|---|
| 触发粒度 | 每条消息一条 capture（PR#4135 现状） | 每个 session 一条（+摘要一条） | B | Alex 明确要求"以 session 为单位"，单条消息太碎 |
| 结束判定 | 接 Stop Hook | 按 session_id 分组的闲置判断 | 闲置判断 | Stop Hook 是 Claude Code 专属，Codex/Grok 没有；闲置判断天然跨工具通用，不需要每个工具单独接一次 |
| 摘要是否加 LLM | 不加（PR#4135 原决定） | 加（本次翻盘） | 加 | Alex 明确要求"总结一下 topic"；成本可控（只对闲置后的小段原始文本跑一次 haiku，不是全量对话） |
| Codex/Grok 是否需要过滤 role | 需要（担心和 Claude Code 一样混杂 assistant/tool 内容） | 不需要（官方已有纯人类输入专用日志） | 不需要 | 实测确认 `history.jsonl`/`prompt_history.jsonl` 已经是纯人类打字内容，比 Claude Code 更省事 |
| 是否做跨机同步 | 做（西安内容也收） | 不做（只抓本机） | 不做 | 会误抓同事在西安机器上的交互内容，且是独立更大范围的需求，Alex 明确选择先不做 |
| dedupeKey 绑定粒度 | 只绑 sessionId | 绑 sessionId + 最后一条消息id | 后者 | 前者会导致同一个 session 后续复聊的内容永远被跳过；后者在"复聊后再次闲置"时能产生新 capture |

## 测试策略

- **Unit**：三个适配器各自的 fixture 测试（Codex/Grok 主要测多 session 混在一个文件里能否正确按 session_id 分组、闲置判定阈值边界；Claude Code 适配器沿用 PR#4135 的过滤逻辑测试，额外测"一个文件当一个session、返回 lastActivityMs/lastEntryId 正确"）。
- **Integration**（真实 DB，`llm` 参数注入假摘要函数避免 CI 里真调 LLM——跟 `capture-triage.js` 的 `{llm=callLLM}` 依赖注入模式一致）：验证 `runConversationCapture` 真的写出"原始 capture + 摘要 capture"两条、source 按工具区分正确、同一 session 重复扫描不重复写、session 复聊后再次闲置能产生新 capture。
- Migration 356 配一条 smoke/test 验证历史 `conversation` 行被正确改名，且改名后不残留旧值。
