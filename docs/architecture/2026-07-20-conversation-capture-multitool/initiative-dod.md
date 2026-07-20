# Initiative DoD: 对话原始捕获——多工具扩展

- Initiative: `4ec80bd4-6c7e-40eb-b862-fef5953eb8ad`
- architecture.md: `docs/architecture/2026-07-20-conversation-capture-multitool/architecture.md`

## 功能验收条件

- [ ] F1: `extractClaudeSessions` 把每个 `.jsonl` 文件当一个 session，返回 `{sessionId, turns, lastActivityMs, lastEntryId}`，过滤逻辑与 PR#4135 一致
- [ ] F2: `extractCodexSessions` 正确按 `session_id` 分组多 session 共用的 `history.jsonl`，跨 `.codex`/`.codex-team1`/`.codex-team2` 三个目录聚合
- [ ] F3: `extractGrokSessions` 正确按 `session_id` 分组 `~/.grok/sessions/*/prompt_history.jsonl`
- [ ] F4: 三家适配器返回的 session，只有"最后一条消息距今 ≥15 分钟"的才被 `runConversationCapture` 处理
- [ ] F5: 每个被处理的 session 产生两条 capture：原始文本（`nature=null`）+ Haiku 摘要（`nature='session_summary'`），`source` 按工具分别是 `conversation-claude`/`conversation-codex`/`conversation-grok`
- [ ] F6: 同一 session 重复扫描（未产生新消息）不重复写入；session 复聊后再次闲置能产生新的一条（dedupeKey 绑定最后一条消息）
- [ ] F7: `VALID_SOURCES` 含三个新值，`VALID_NATURES` 含 `session_summary`
- [ ] F8: migration 356 把历史 `source='conversation'` 行改名为 `conversation-claude`，改名后表里不再有 `source='conversation'` 的行
- [ ] F9: 写入失败（原始或摘要任一步）不抛出、计入 errors、scheduler 层能感知（沿用 PR#4135 已修的可观测性设计，不得倒退）

## 集成测试通过条件

- [ ] I1: 集成测试全部通过（真实 DB，`llm` 参数注入假摘要函数）
- [ ] I2: `scheduler-jobs.test.js`/smoke 脚本更新后仍全绿

## 架构对齐条件

- [ ] A1: 未新建数据库表（只有 migration 356 一条 data UPDATE + VALID_SOURCES/VALID_NATURES 值域扩展）
- [ ] A2: 三个适配器文件存在，`conversation-capture.js` 变成编排层
- [ ] A3: 只读本机文件，代码里没有 SSH/scp 之类跨机逻辑
- [ ] A4: dedupeKey 方案按"sessionId + lastEntryId"落地，不是纯 sessionId

## 非功能条件

- [ ] N1: 无新增 L1 bug（code_review 无 BLOCK）
- [ ] N2: Brain CI 全通过（含 DevGate 三闸 + 版本 bump + smoke 登记 + CodeQL 无新高危）
